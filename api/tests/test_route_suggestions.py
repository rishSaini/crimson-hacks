"""Check geometric matching, source grade filters, and forecast exposure limits."""
import json

import numpy as np
import pytest
from affine import Affine
from fastapi.testclient import TestClient

from app import main
from app.models import AnalyzeRequest, ForecastAlert, ForecastResponse, LineString
from app.route_analysis import TO_UTM, TerrainCoverageError, TerrainGrids, analyze_route
from app.route_suggestions import (
    Catalog, CatalogFeature, CatalogProperties, EndpointSuggestionsRequest, SourceReference,
    SuggestionsRequest, load_catalog, suggest_from_endpoints, suggest_routes,
)


@pytest.fixture
def forecast():
    return ForecastResponse.model_validate_json(
        (main.FIXTURES_DIR / 'forecast.response.json').read_text()
    )


@pytest.fixture
def grids():
    elevation = np.full((201, 201), 2500.)
    return TerrainGrids(
        Affine(10, 0, 430000, 0, -10, 4500000), elevation,
        np.zeros_like(elevation), np.zeros_like(elevation),
    )


def route(row=100, start=70, end=130):
    return LineString(coordinates=[TO_UTM.transform(
        430000 + (col + .5) * 10, 4500000 - (row + .5) * 10, direction='INVERSE'
    ) for col in (start, end)])


def feature(name, line=None, difficulty='easy', oneway=False):
    return CatalogFeature(
        type='Feature', geometry=line or route(102),
        properties=CatalogProperties(
            id=name, name=name, difficulty=difficulty, status='operating',
            sources=[SourceReference(type='openstreetmap', id='way/123')],
            route_scope='mapped_section', oneway=oneway,
        ),
    )


def catalog(*features):
    return Catalog(
        type='FeatureCollection', source='test fixture', source_url='https://example.org',
        retrieved_at='2026-11-06T00:00:00Z', license='test fixture',
        license_url='https://example.org/license', attribution='Synthetic test geometry',
        features=list(features),
    )


def request(forecast, **kwargs):
    return SuggestionsRequest(
        route=route(), date=forecast.date, max_difficulty='intermediate',
        max_distance_m=1000, max_climb_ft=1000, **kwargs,
    )


def test_closest_eligible_section_wins_and_retains_geometry(grids, forecast):
    close, far = feature('close'), feature('far', route(108))
    result = suggest_routes(request(forecast), forecast, grids, catalog(far, close))
    assert result.status == 'found'
    assert [item.id for item in result.suggestions] == ['close', 'far']
    assert result.suggestions[0].route == close.geometry
    assert result.suggestions[0].comparison.max_deviation_m == pytest.approx(20)
    assert result.suggestions[0].start_distance_m == pytest.approx(20)
    assert result.source == forecast.source
    assert result.suggestions[0].route_scope == 'mapped_section'


@pytest.mark.parametrize('candidate,reason', [
    (feature('unknown', difficulty=None), 'difficulty_unknown'),
    (feature('hard', difficulty='expert'), 'difficulty_limit'),
    (feature('short', route(start=95, end=105)), 'endpoints_too_far'),
    (feature('far', route(160)), 'endpoints_too_far'),
    (feature('reverse', route(start=130, end=70), oneway=True), 'endpoints_too_far'),
])
def test_excludes_without_relaxing_limits(candidate, reason, grids, forecast):
    result = suggest_routes(request(forecast), forecast, grids, catalog(candidate))
    assert result.status == 'no_match'
    assert result.suggestions == []
    assert result.excluded == {reason: 1}


def test_checks_whole_geometry(grids, forecast):
    detour = LineString(coordinates=[
        route().coordinates[0], route(160).coordinates[0], route().coordinates[-1]
    ])
    result = suggest_routes(request(forecast), forecast, grids, catalog(feature('detour', detour)))
    assert result.excluded == {'outside_corridor': 1}


def test_reverse_requires_explicit_bidirectional_source(grids, forecast):
    candidate = feature('reverse', route(start=130, end=70), oneway=False)
    result = suggest_routes(request(forecast), forecast, grids, catalog(candidate))
    assert result.status == 'found'
    assert result.suggestions[0].route.coordinates == list(reversed(candidate.geometry.coordinates))


def test_distance_and_climb_limits(grids, forecast):
    limited = request(forecast).model_copy(update={'max_distance_m': 100})
    result = suggest_routes(limited, forecast, grids, catalog(feature('long')))
    assert result.excluded == {'distance_limit': 1}
    grids.elevation[:, :] += np.arange(201)[None, :]
    limited = request(forecast).model_copy(update={'max_climb_ft': 10})
    result = suggest_routes(limited, forecast, grids, catalog(feature('climb')))
    assert result.excluded == {'climb_limit': 1}


def test_low_threshold_excludes_steep_low_rated_sections(grids, forecast):
    for cell in forecast.rose:
        cell.value, cell.danger, cell.pockets = 2, 'low', False
    grids.slope[101:104, 90:110] = 35
    result = suggest_routes(
        request(forecast, avoid_at_or_above='low'), forecast, grids, catalog(feature('steep'))
    )
    assert result.excluded == {'forecast_exposure': 1}
    analysis = analyze_route(AnalyzeRequest(
        route=route(102), date=forecast.date, avoid_at_or_above='considerable'
    ), forecast, grids)
    assert analysis.totals.steep_length_m > 0
    assert analysis.totals.flagged_length_m == 0


@pytest.mark.parametrize('threshold,raw,flagged', [
    ('considerable', 2, False), ('low', 2, True), ('considerable', 0, True),
])
def test_overhead_uses_threshold_and_unrated_terrain(threshold, raw, flagged, grids):
    grids.elevation[95, 100] += 20
    grids.slope[95, 100] = 35
    grids.aspect[95, 100] = 180
    sample = grids.sample(431005, 4498995, [raw] * 24, threshold)
    assert sample.level is None
    assert (sample.overhead_level is not None) == flagged


def test_missing_overhead_data_prevents_analysis(grids):
    grids.elevation[95, 100] = np.nan
    with pytest.raises(TerrainCoverageError):
        grids.sample(431005, 4498995, [2] * 24, 'considerable')


def test_endpoint_uses_computed_results(monkeypatch, grids, forecast):
    monkeypatch.setattr(main, 'terrain_context', lambda date: (forecast, grids))
    monkeypatch.setattr(main, 'load_catalog', lambda: catalog(feature('test')))
    response = TestClient(main.app).post('/suggestions', json=request(forecast).model_dump(mode='json'))
    assert response.status_code == 200, response.text
    assert response.json()['suggestions'][0]['id'] == 'test'
    assert response.json()['catalog']['attribution'] == 'Synthetic test geometry'


def test_catalog_failure_is_an_error(monkeypatch, grids, forecast):
    monkeypatch.setattr(main, 'terrain_context', lambda date: (forecast, grids))
    def missing():
        raise OSError('Missing catalog')
    monkeypatch.setattr(main, 'load_catalog', missing)
    response = TestClient(main.app).post('/suggestions', json=request(forecast).model_dump(mode='json'))
    assert response.status_code == 503


def test_committed_catalog_preserves_unknown_grades():
    data = load_catalog()
    assert len(data.features) == 20
    assert data.license == 'ODbL-1.0'
    assert any(feature.properties.difficulty is None for feature in data.features)
    assert all(feature.properties.route_scope == 'mapped_section' for feature in data.features)


def test_no_ratings_excludes_steep_sections(grids, forecast):
    for cell in forecast.rose:
        cell.value, cell.danger, cell.pockets = 0, 'no_rating', False
    forecast.ratings_issued = False
    grids.slope[101:104, 90:110] = 35
    result = suggest_routes(request(forecast), forecast, grids, catalog(feature('unrated')))
    assert result.excluded == {'forecast_exposure': 1}


def test_missing_operating_status_is_excluded(grids, forecast):
    candidate = feature('status-unknown')
    candidate.properties.status = None
    result = suggest_routes(request(forecast), forecast, grids, catalog(candidate))
    assert result.excluded == {'operating_status_unknown_or_closed': 1}


def with_alert(forecast, level):
    alert = {'level': level}
    if level != 'none':
        alert.update(
            what='w', where='w', what_to_do='w',
            valid_from='2026-01-15T06:00:00-07:00', valid_to='2026-01-16T06:00:00-07:00',
        )
    return forecast.model_copy(update={'alert': ForecastAlert.model_validate(alert)})


def test_warning_forces_low_and_flags_low_rated_steep_terrain(grids, forecast):
    for cell in forecast.rose:
        cell.value, cell.danger, cell.pockets = 2, 'low', False
    grids.slope[101:104, 90:110] = 35
    plan = AnalyzeRequest(route=route(102), date=forecast.date, avoid_at_or_above='considerable')
    calm = analyze_route(plan, with_alert(forecast, 'none'), grids)
    warned = analyze_route(plan, with_alert(forecast, 'warning'), grids)
    assert (calm.avoid_at_or_above, calm.forced_by_warning) == ('considerable', False)
    assert calm.totals.flagged_length_m == 0
    assert (warned.avoid_at_or_above, warned.forced_by_warning) == ('low', True)
    assert warned.totals.flagged_length_m > 0
    assert plan.avoid_at_or_above == 'considerable'


@pytest.mark.parametrize('level', ['none', 'watch', 'special_bulletin'])
def test_other_alerts_keep_the_requested_setting(level, grids, forecast):
    plan = AnalyzeRequest(route=route(), date=forecast.date, avoid_at_or_above='moderate')
    result = analyze_route(plan, with_alert(forecast, level), grids)
    assert (result.avoid_at_or_above, result.forced_by_warning) == ('moderate', False)


def test_suggestions_on_a_warning_day_are_forced_and_carry_uac_advice(grids, forecast):
    warned = with_alert(forecast, 'warning')
    result = suggest_routes(request(forecast), warned, grids, catalog(feature('flat')))
    assert (result.avoid_at_or_above, result.forced_by_warning) == ('low', True)
    assert result.limitations[0] == 'UAC recommends avoiding all avalanche terrain today.'
    assert result.suggestions[0].analysis.forced_by_warning is True
    calm = suggest_routes(request(forecast), forecast, grids, catalog(feature('flat')))
    assert 'UAC recommends avoiding all avalanche terrain today.' not in calm.limitations


def test_suggestions_reports_warning_threshold(grids):
    replay = json.loads((main.FIXTURES_DIR / 'demo_days.json').read_text())['2026-02-18']
    forecast = ForecastResponse.model_validate(replay)
    result = suggest_routes(
        request(forecast, avoid_at_or_above='considerable'),
        forecast,
        grids,
        catalog(feature('flat')),
    )
    assert result.avoid_at_or_above == 'low'
    assert result.original_analysis.forced_by_warning
    assert result.suggestions[0].analysis.avoid_at_or_above == 'low'
    assert result.suggestions[0].analysis.forced_by_warning


def test_pins_use_catalog_geometry_instead_of_a_straight_connector(grids, forecast):
    start, destination = route(start=60, end=140).coordinates
    path = LineString(coordinates=[
        start, *route(145, start=60, end=140).coordinates, destination,
    ])
    grids.elevation[100, 100] = np.nan  # The straight connector crosses missing data.
    pins = EndpointSuggestionsRequest(
        start=start, destination=destination, date=forecast.date,
        max_difficulty='easy', max_distance_m=3000, max_climb_ft=1000,
    )
    result = suggest_from_endpoints(pins, forecast, grids, catalog(feature('bent', path)))
    assert result.status == 'found'
    assert result.suggestions[0].route == path
    assert result.suggestions[0].analysis.totals.length_m == pytest.approx(1700)


def test_endpoint_suggestions_rejects_coincident_pins(monkeypatch, grids, forecast):
    monkeypatch.setattr(main, 'terrain_context', lambda date: (forecast, grids))
    monkeypatch.setattr(main, 'load_catalog', lambda: catalog(feature('test')))
    start = route().coordinates[0]
    body = EndpointSuggestionsRequest(
        start=start, destination=start, date=forecast.date,
        max_difficulty='easy', max_distance_m=1000, max_climb_ft=1000,
    )
    response = TestClient(main.app).post('/endpoint-suggestions', json=body.model_dump(mode='json'))
    assert response.status_code == 422
    assert 'at least 1 m apart' in response.json()['detail']


def test_suggestions_fixtures_match_contract():
    from app.route_suggestions import SuggestionsResponse
    SuggestionsRequest.model_validate_json((main.FIXTURES_DIR / 'suggestions.request.json').read_text())
    body = SuggestionsResponse.model_validate_json(
        (main.FIXTURES_DIR / 'suggestions.response.json').read_text()
    )
    assert body.source == 'fixture'
    assert body.status == 'no_match'
    assert sum(body.excluded.values()) == body.catalog.feature_count
