"""Rank existing mapped ski sections near a drawn route without joining their geometry."""

import json
from datetime import date as Date
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import Field, model_validator
from shapely import LineString as ShapeLine, transform

from app.models import (
    ApiModel, AnalyzeRequest, AnalyzeResponse, AvoidThreshold, DataSource,
    ForecastResponse, LineString, Position, RouteComparison,
)
from app.forecast import effective_avoid_at_or_above
from app.route_analysis import TO_UTM, TerrainCoverageError, TerrainGrids, analyze_route

Difficulty = Literal['novice', 'easy', 'intermediate', 'advanced', 'expert', 'extreme']
DIFFICULTIES = ('novice', 'easy', 'intermediate', 'advanced', 'expert', 'extreme')
CATALOG_PATH = Path(__file__).resolve().parents[2] / 'data/routes/openskidata.geojson'
WARNING_LIMITATION = 'UAC recommends avoiding all avalanche terrain today.'
LIMITATIONS = [
    'Catalog features can represent only sections of a tour. Confirm the complete itinerary.',
    'Difficulty comes from OpenStreetMap piste tags. Snow conditions can change the required skills.',
    'Access, closures, obstacles, snow coverage, and route completeness require separate confirmation.',
    'Exposure checks use a 10 m DEM and the selected forecast. They do not establish route feasibility.',
]


class SuggestionLimits(ApiModel):
    max_difficulty: Difficulty = Field(description='Highest OSM piste grade the user accepts')
    max_distance_m: float = Field(gt=0, le=100000, allow_inf_nan=False)
    max_climb_ft: float = Field(ge=0, le=30000, allow_inf_nan=False)
    endpoint_tolerance_m: float = Field(default=200, ge=0, le=500, allow_inf_nan=False)
    limit: int = Field(default=3, ge=1, le=10)


class SuggestionsRequest(AnalyzeRequest, SuggestionLimits):
    corridor_width_m: float = Field(default=400, ge=50, le=1500, allow_inf_nan=False)


class EndpointSuggestionsRequest(SuggestionLimits):
    start: Position
    destination: Position
    date: Date
    avoid_at_or_above: AvoidThreshold = 'considerable'


class SourceReference(ApiModel):
    id: str
    type: Literal['openstreetmap']


class CatalogProperties(ApiModel):
    id: str = Field(min_length=1)
    name: str | None
    difficulty: str | None
    status: str | None
    sources: list[SourceReference] = Field(min_length=1)
    route_scope: Literal['mapped_section']
    oneway: bool | None


class CatalogFeature(ApiModel):
    type: Literal['Feature']
    geometry: LineString
    properties: CatalogProperties

    @model_validator(mode='after')
    def valid_geography(self) -> 'CatalogFeature':
        coordinates = np.asarray(self.geometry.coordinates)
        if not np.isfinite(coordinates).all() or not (
            (np.abs(coordinates[:, 0]) <= 180).all() and
            (np.abs(coordinates[:, 1]) <= 90).all()
        ):
            raise ValueError('Catalog coordinates must be finite longitude and latitude.')
        return self


class Catalog(ApiModel):
    type: Literal['FeatureCollection']
    source: str
    source_url: str
    retrieved_at: str
    license: str
    license_url: str
    attribution: str
    features: list[CatalogFeature]

    @model_validator(mode='after')
    def unique_ids(self) -> 'Catalog':
        ids = [feature.properties.id for feature in self.features]
        if len(set(ids)) != len(ids):
            raise ValueError('Catalog route IDs must be unique.')
        return self


class CatalogInfo(ApiModel):
    source: str
    source_url: str
    retrieved_at: str
    license: str
    license_url: str
    attribution: str
    feature_count: int


class MappedSuggestion(ApiModel):
    id: str
    name: str | None
    difficulty: Difficulty
    route_scope: Literal['mapped_section']
    source_urls: list[str]
    route: LineString
    analysis: AnalyzeResponse
    start_distance_m: float
    end_distance_m: float


class SuggestedRoute(MappedSuggestion):
    comparison: RouteComparison


class SelectionResponse(ApiModel):
    date: Date
    source: DataSource
    avoid_at_or_above: AvoidThreshold = Field(description='The setting actually applied')
    forced_by_warning: bool
    status: Literal['found', 'no_match']
    message: str
    catalog: CatalogInfo
    excluded: dict[str, int]
    limitations: list[str]


class SuggestionsResponse(SelectionResponse):
    original_analysis: AnalyzeResponse
    suggestions: list[SuggestedRoute]


class EndpointSuggestionsResponse(SelectionResponse):
    forced_by_warning: bool
    suggestions: list[MappedSuggestion]


def load_catalog(path: Path = CATALOG_PATH) -> Catalog:
    return Catalog.model_validate(json.loads(path.read_text()))


def projected_line(route: LineString) -> ShapeLine:
    return transform(ShapeLine(route.coordinates), TO_UTM.transform, interleaved=False)


def _find_candidates(
    request: SuggestionsRequest | EndpointSuggestionsRequest,
    forecast: ForecastResponse, grids: TerrainGrids, catalog: Catalog,
    start: Position, destination: Position, drawn: ShapeLine | None = None,
) -> tuple[list[MappedSuggestion], dict[str, int]]:
    corridor_width = request.corridor_width_m if isinstance(request, SuggestionsRequest) else 0
    corridor = drawn.buffer(corridor_width) if drawn is not None else None
    accepted = []
    excluded: dict[str, int] = {}
    start_xy = np.asarray(start)
    destination_xy = np.asarray(destination)
    grade_limit = DIFFICULTIES.index(request.max_difficulty)

    for feature in catalog.features:
        properties = feature.properties
        if properties.status != 'operating':
            reason = 'operating_status_unknown_or_closed'
        elif properties.difficulty not in DIFFICULTIES:
            reason = 'difficulty_unknown'
        elif DIFFICULTIES.index(properties.difficulty) > grade_limit:
            reason = 'difficulty_limit'
        else:
            reason = None
        if reason is not None:
            excluded[reason] = excluded.get(reason, 0) + 1
            continue

        route = feature.geometry
        line = projected_line(route)
        first, last = np.asarray(line.coords[0]), np.asarray(line.coords[-1])
        direct = (np.linalg.norm(first - start_xy), np.linalg.norm(last - destination_xy))
        reverse = (np.linalg.norm(last - start_xy), np.linalg.norm(first - destination_xy))
        if properties.oneway is False and (max(reverse), sum(reverse)) < (max(direct), sum(direct)):
            route = LineString(coordinates=list(reversed(route.coordinates)))
            direct = reverse
        start_distance, end_distance = map(float, direct)
        if max(direct) > request.endpoint_tolerance_m:
            reason = 'endpoints_too_far'
        elif corridor is not None and (
            not corridor.covers(line) or not line.buffer(corridor_width).covers(drawn)
        ):
            reason = 'outside_corridor'
        else:
            try:
                analysis = analyze_route(AnalyzeRequest(
                    route=route, date=request.date, avoid_at_or_above=request.avoid_at_or_above,
                ), forecast, grids)
            except TerrainCoverageError:
                reason = 'incomplete_terrain_coverage'
            else:
                if analysis.totals.length_m > request.max_distance_m:
                    reason = 'distance_limit'
                elif analysis.totals.climb_ft > request.max_climb_ft:
                    reason = 'climb_limit'
                elif analysis.totals.flagged_length_m > 0:
                    reason = 'forecast_exposure'
        if reason is not None:
            excluded[reason] = excluded.get(reason, 0) + 1
            continue

        accepted.append(MappedSuggestion(
            id=properties.id, name=properties.name, difficulty=properties.difficulty,
            route_scope=properties.route_scope,
            source_urls=[f'https://www.openstreetmap.org/{source.id}' for source in properties.sources],
            route=route, analysis=analysis,
            start_distance_m=start_distance, end_distance_m=end_distance,
        ))
    return accepted, excluded


def _catalog_info(catalog: Catalog) -> CatalogInfo:
    return CatalogInfo(
        **catalog.model_dump(exclude={'type', 'features'}), feature_count=len(catalog.features)
    )


def suggest_routes(
    request: SuggestionsRequest, forecast: ForecastResponse,
    grids: TerrainGrids, catalog: Catalog,
) -> SuggestionsResponse:
    original = analyze_route(request, forecast, grids)
    drawn = projected_line(request.route).segmentize(15)
    accepted, excluded = _find_candidates(
        request, forecast, grids, catalog, drawn.coords[0], drawn.coords[-1], drawn
    )
    ranked = [
        SuggestedRoute(
            **route.model_dump(),
            comparison=RouteComparison(
                original_flagged_m=original.totals.flagged_length_m,
                alternative_flagged_m=route.analysis.totals.flagged_length_m,
                added_distance_m=route.analysis.totals.length_m - original.totals.length_m,
                added_climb_ft=route.analysis.totals.climb_ft - original.totals.climb_ft,
                max_deviation_m=float(drawn.hausdorff_distance(projected_line(route.route).segmentize(15))),
            ),
        )
        for route in accepted
    ]
    ranked.sort(key=lambda route: (
        route.comparison.max_deviation_m,
        route.start_distance_m + route.end_distance_m,
        max(0, route.comparison.added_distance_m),
        max(0, route.comparison.added_climb_ft), route.id,
    ))
    return SuggestionsResponse(
        date=forecast.date, source=forecast.source,
        avoid_at_or_above=original.avoid_at_or_above,
        forced_by_warning=original.forced_by_warning,
        status='found' if ranked else 'no_match',
        message=(
            'Nearby mapped sections meet the selected grade, distance, climb, and exposure limits.'
            if ranked else 'No catalog section meets all selected limits. No limits were relaxed.'
        ),
        catalog=_catalog_info(catalog), original_analysis=original,
        suggestions=ranked[:request.limit], excluded=excluded,
        limitations=([WARNING_LIMITATION] if original.forced_by_warning else []) + LIMITATIONS,
    )


def suggest_from_endpoints(
    request: EndpointSuggestionsRequest, forecast: ForecastResponse,
    grids: TerrainGrids, catalog: Catalog,
) -> EndpointSuggestionsResponse:
    """Match catalog endpoints without creating a line between the requested pins."""
    pins = (request.start, request.destination)
    if not all(-180 <= lng <= 180 and -90 <= lat <= 90 for lng, lat in pins):
        raise TerrainCoverageError('Start and destination must be valid coordinates.')
    start, destination = (TO_UTM.transform(*point) for point in pins)
    if np.linalg.norm(np.asarray(start) - destination) < 1:
        raise TerrainCoverageError('Place the start and destination at least 1 m apart.')
    for point in (start, destination):
        grids.elevation_at(*grids.cell_at(*point))
    accepted, excluded = _find_candidates(request, forecast, grids, catalog, start, destination)
    accepted.sort(key=lambda route: (
        max(route.start_distance_m, route.end_distance_m),
        route.start_distance_m + route.end_distance_m,
        route.analysis.totals.length_m, route.analysis.totals.climb_ft, route.id,
    ))
    threshold, forced = effective_avoid_at_or_above(request.avoid_at_or_above, forecast.alert.level)
    return EndpointSuggestionsResponse(
        date=forecast.date, source=forecast.source, avoid_at_or_above=threshold,
        forced_by_warning=forced, status='found' if accepted else 'no_match',
        message=(
            'Mapped sections near both pins meet the selected limits.'
            if accepted else 'No mapped section near both pins meets the selected limits.'
        ),
        catalog=_catalog_info(catalog), suggestions=accepted[:request.limit],
        excluded=excluded,
        limitations=([WARNING_LIMITATION] if forced else []) + LIMITATIONS,
    )
