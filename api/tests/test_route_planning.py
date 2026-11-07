"""Plan finds a line from terrain alone and flags it. Only the reroute's search avoids danger."""

import json

import numpy as np
import pytest
from affine import Affine
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import LineString as ShapeLine
from shapely.geometry import box

from app import main
from app.models import AnalyzeRequest, ForecastResponse, PlanRequest, PlanResponse
from app.route_analysis import TO_UTM, TerrainGrids, analyze_route, load_grids
from app.route_planning import plan_route, to_lng_lat
from app.route_search import (
    BLOCKED_SLOPE_DEG,
    OsmLayers,
    build_cost_grid,
    crop_window,
    flagged_mask,
    highest_clean_point,
    least_cost_line,
)

LEFT, TOP, CELL = 430000, 4500000, 10
SIZE = 401
NO_OSM = OsmLayers((), ())
HIGH, MODERATE = 8, 4
MID_ROW = SIZE // 2
WEST_COL, EAST_COL, WALL_COL = 160, 240, 200
WARNING_LINE = "UAC recommends avoiding all avalanche terrain today."


def xy(row: float, col: float) -> tuple[float, float]:
    return LEFT + (col + 0.5) * CELL, TOP - (row + 0.5) * CELL


def lng_lat(row: float, col: float) -> tuple[float, float]:
    return TO_UTM.transform(*xy(row, col), direction="INVERSE")


def flat_grids() -> TerrainGrids:
    elevation = np.full((SIZE, SIZE), 2700.0)
    return TerrainGrids(
        Affine(CELL, 0, LEFT, 0, -CELL, TOP), elevation,
        np.zeros_like(elevation), np.zeros_like(elevation),
    )


def wall(grids: TerrainGrids, rows: slice, slope: float = 35.0) -> TerrainGrids:
    """A north-south band of steep cells, on flat ground otherwise."""
    grids.slope[rows, WALL_COL - 2:WALL_COL + 3] = slope
    return grids


def forecast_rated(value: int, level: str = "none") -> ForecastResponse:
    body = json.loads((main.FIXTURES_DIR / "forecast.response.json").read_text())
    danger = {0: "no_rating", 2: "low", 4: "moderate", 6: "considerable", 8: "high"}[value]
    for cell in body["rose"]:
        cell.update(value=value, danger=danger, pockets=False)
    body["ratings_issued"] = value > 0
    if level != "none":
        body["alert"] = {
            "level": level, "what": "w", "where": "w", "impacts": "i", "what_to_do": "w",
            "valid_from": "2026-01-15T06:00:00-07:00", "valid_to": "2026-01-16T06:00:00-07:00",
        }
    return ForecastResponse.model_validate(body)


@pytest.fixture
def forecast():
    return forecast_rated(HIGH)


def plan(forecast, grids, osm=NO_OSM, setting="considerable", start=None, end=None):
    request = PlanRequest(
        start=start or lng_lat(MID_ROW, WEST_COL), end=end or lng_lat(MID_ROW, EAST_COL),
        date=forecast.date, avoid_at_or_above=setting,
    )
    return plan_route(request, forecast, grids, osm)


def projected(route) -> ShapeLine:
    return ShapeLine([TO_UTM.transform(*point) for point in route.coordinates])


def flagged_m(result) -> float:
    return result.analysis.totals.flagged_length_m


# Plan: the line comes from terrain, and the forecast only adds flags to it.


def test_plan_crosses_flagged_terrain_and_flags_it(forecast):
    result = plan(forecast, wall(flat_grids(), slice(0, SIZE)))
    assert result.status == "found"
    assert flagged_m(result) > 0
    assert result.analysis.totals.flagged_stretch_count == 1
    assert result.message.startswith("1 stretch crosses flagged terrain")
    assert projected(result.route).length == pytest.approx(800, abs=30)


def test_forecast_never_changes_the_line():
    grids = wall(flat_grids(), slice(120, 281))
    routes = [
        plan(forecast_rated(value, level), grids, setting=setting).route
        for value, level, setting in [
            (HIGH, "none", "considerable"),
            (2, "none", "considerable"),
            (0, "none", "considerable"),
            (MODERATE, "none", "low"),
            (HIGH, "warning", "considerable"),
        ]
    ]
    assert all(route == routes[0] for route in routes)


def test_setting_changes_the_flags_but_not_the_line():
    moderate = forecast_rated(MODERATE)
    grids = wall(flat_grids(), slice(0, SIZE))
    default, stricter = plan(moderate, grids), plan(moderate, grids, setting="moderate")
    assert default.route == stricter.route
    assert flagged_m(default) == 0
    assert default.analysis.totals.steep_segment_count > 0
    assert flagged_m(stricter) > 0


def test_clear_line_says_no_flags_found(forecast):
    result = plan(forecast, flat_grids())
    assert result.status == "found"
    assert result.message == "No flags found on this route today."
    assert projected(result.route).length == pytest.approx(800, abs=1)
    assert len(result.route.coordinates) == 2


def test_overhead_slope_flags_the_line_without_moving_it(forecast):
    grids = flat_grids()
    row, cols = MID_ROW - 12, slice(WEST_COL + 25, EAST_COL - 25)
    grids.elevation[row, cols] += 30
    grids.slope[row, cols] = 35
    grids.aspect[row, cols] = 180
    result = plan(forecast, grids)
    assert projected(result.route).length == pytest.approx(800, abs=1)
    reasons = {f.properties.flag_reason for f in result.analysis.segments.features}
    assert "overhead_exposure" in reasons


def test_steep_terrain_is_skirted_when_a_short_way_around_exists(forecast):
    # A sensible line goes around a small steep patch, without any forecast involved.
    result = plan(forecast_rated(2), wall(flat_grids(), slice(MID_ROW - 8, MID_ROW + 9)))
    assert not projected(result.route).intersects(
        box(*xy(MID_ROW + 8, WALL_COL - 2), *xy(MID_ROW - 8, WALL_COL + 2))
    )


def test_slopes_of_30_degrees_cost_more_than_skinning_alone_explains(forecast):
    # A thin 30 degree band adds little skinning cost, so only the steep penalty makes
    # a detour of about 640 m worth it. Rated Low, so no forecast rule is involved.
    grids = wall(flat_grids(), slice(MID_ROW - 60, MID_ROW + 61), slope=30.0)
    line = projected(plan(forecast_rated(2), grids).route)
    assert not line.intersects(box(*xy(MID_ROW + 60, WALL_COL - 2), *xy(MID_ROW - 60, WALL_COL + 2)))


def test_cells_at_45_degrees_are_blocked(forecast):
    passable = wall(flat_grids(), slice(0, SIZE), slope=BLOCKED_SLOPE_DEG - 1)
    assert plan(forecast, passable).status == "found"
    result = plan(forecast, wall(flat_grids(), slice(0, SIZE), slope=BLOCKED_SLOPE_DEG))
    assert result.status == "no_route"
    assert result.route is None
    assert result.analysis is None
    assert result.message.startswith("No route")


def test_partial_45_degree_wall_is_walked_around(forecast):
    result = plan(forecast, wall(flat_grids(), slice(120, 281), slope=BLOCKED_SLOPE_DEG))
    assert result.status == "found"
    assert projected(result.route).length > 800 * 1.2


def test_start_on_a_blocked_cell_is_no_route(forecast):
    grids = flat_grids()
    grids.slope[MID_ROW, WEST_COL] = 50
    assert plan(forecast, grids).status == "no_route"


def test_skinning_penalty_prefers_gentler_ground(forecast):
    grids = flat_grids()
    grids.slope[MID_ROW - 3:MID_ROW + 4, WEST_COL + 10:EAST_COL - 10] = 28
    line = projected(plan(forecast, grids).route)
    assert not line.intersects(
        box(*xy(MID_ROW + 3, WEST_COL + 10), *xy(MID_ROW - 3, EAST_COL - 10))
    )


def test_ski_area_penalty_steers_around_it(forecast):
    area = box(*xy(MID_ROW + 4, WEST_COL + 25), *xy(MID_ROW - 4, EAST_COL - 25))
    line = projected(plan(forecast, flat_grids(), OsmLayers((), (area,))).route)
    assert not line.intersects(area)


def test_trail_bonus_draws_the_line_onto_a_nearby_trail(forecast):
    trail = ShapeLine(
        [xy(MID_ROW, WEST_COL), xy(MID_ROW + 8, WEST_COL + 8),
         xy(MID_ROW + 8, EAST_COL - 8), xy(MID_ROW, EAST_COL)]
    )
    line = projected(plan(forecast, flat_grids(), OsmLayers((trail,), ())).route)
    assert line.hausdorff_distance(trail) < 2 * CELL


def test_far_away_trail_does_not_pull_the_line(forecast):
    trail = ShapeLine([xy(MID_ROW + 120, WEST_COL), xy(MID_ROW + 120, EAST_COL)])
    result = plan(forecast, flat_grids(), OsmLayers((trail,), ()))
    assert projected(result.route).length == pytest.approx(800, abs=1)


def test_crop_is_the_bounding_box_plus_1500_m():
    grids = TerrainGrids(
        flat_grids().transform, np.full((1000, 1000), 2700.0),
        np.zeros((1000, 1000)), np.zeros((1000, 1000)),
    )
    assert crop_window(grids, xy(400, 300), xy(500, 700)) == (250, 651, 150, 851)


def test_crop_clips_to_the_grid():
    assert crop_window(flat_grids(), xy(10, 20), xy(30, 40)) == (0, 181, 0, 191)


def test_plan_outside_the_grid_is_a_coverage_error(forecast):
    with pytest.raises(ValueError):
        plan(forecast, flat_grids(), end=lng_lat(MID_ROW, SIZE + 50))


def test_warning_forces_low_and_says_so():
    result = plan(forecast_rated(2, "warning"), wall(flat_grids(), slice(0, SIZE)))
    assert (result.avoid_at_or_above, result.forced_by_warning) == ("low", True)
    assert flagged_m(result) > 0
    assert result.limitations[0] == WARNING_LINE
    calm = plan(forecast_rated(2), wall(flat_grids(), slice(0, SIZE)))
    assert flagged_m(calm) == 0
    assert WARNING_LINE not in calm.limitations


def test_plan_carries_the_labels_the_ui_must_show(forecast):
    result = plan(forecast, flat_grids())
    assert result.limitations[0].startswith("Computer-generated line, not a known skin track")
    assert any("does not remove avalanche risk" in item for item in result.limitations)
    assert "OpenStreetMap" in result.attribution


# Reroute's search: this is the one place the forecast shapes the line.


def avoiding_line(forecast, grids, setting="considerable", start=None, end=None):
    """The danger-avoiding line and its analysis, as the reroute will use them."""
    start_xy, end_xy = start or xy(MID_ROW, WEST_COL), end or xy(MID_ROW, EAST_COL)
    rose = [cell.value for cell in forecast.rose]
    grid = build_cost_grid(
        grids, crop_window(grids, start_xy, end_xy), NO_OSM, avoid=(rose, setting)
    )
    line = least_cost_line(grid, start_xy, end_xy)
    route = to_lng_lat(line)
    analysis = analyze_route(
        AnalyzeRequest(route=route, date=forecast.date, avoid_at_or_above=setting), forecast, grids
    )
    return route, analysis, grid


def test_avoiding_search_routes_around_a_flagged_slope(forecast):
    route, analysis, _ = avoiding_line(forecast, wall(flat_grids(), slice(120, 281)))
    assert analysis.totals.flagged_length_m == 0
    line = projected(route)
    assert not line.intersects(box(*xy(280, WALL_COL - 2), *xy(120, WALL_COL + 2)))
    assert line.length > 800 * 1.2
    assert line.coords[0] == pytest.approx(xy(MID_ROW, WEST_COL))
    assert line.coords[-1] == pytest.approx(xy(MID_ROW, EAST_COL))


def test_avoiding_search_crosses_flags_only_if_every_path_does(forecast):
    _, analysis, _ = avoiding_line(forecast, wall(flat_grids(), slice(0, SIZE)))
    assert analysis.totals.flagged_length_m > 0  # The reroute reports this as no clean line.


def test_long_detour_beats_crossing_a_thin_flagged_strip(forecast):
    # One cell wide, with the gap just inside the crop, so crossing would be far shorter.
    grids = flat_grids()
    grids.slope[56:, WALL_COL] = 35
    route, analysis, _ = avoiding_line(forecast, grids)
    assert analysis.totals.flagged_length_m == 0
    assert projected(route).length > 2500


def test_gap_outside_the_1500_m_crop_does_not_count(forecast):
    grids = flat_grids()
    grids.slope[40:, WALL_COL] = 35
    _, analysis, _ = avoiding_line(forecast, grids)
    assert analysis.totals.flagged_length_m > 0


def test_avoiding_search_follows_the_setting():
    moderate = forecast_rated(MODERATE)
    grids = wall(flat_grids(), slice(0, SIZE))
    assert avoiding_line(moderate, grids)[1].totals.flagged_length_m == 0
    assert avoiding_line(moderate, grids, "moderate")[1].totals.flagged_length_m > 0


def test_avoiding_search_avoids_unrated_steep_terrain():
    grids = wall(flat_grids(), slice(120, 281))
    assert avoiding_line(forecast_rated(0), grids)[1].totals.flagged_length_m == 0


def test_avoiding_search_routes_around_a_slope_overhead(forecast):
    grids = flat_grids()
    row, cols = MID_ROW - 12, slice(WEST_COL + 25, EAST_COL - 25)
    grids.elevation[row, cols] += 30
    grids.slope[row, cols] = 35
    grids.aspect[row, cols] = 180
    route, analysis, _ = avoiding_line(forecast, grids)
    assert analysis.totals.flagged_length_m == 0
    assert projected(route).length > 800 * 1.05


def test_turnaround_is_the_highest_point_reachable_without_crossing_flags(forecast):
    grids = wall(flat_grids(), slice(0, SIZE))
    grids.elevation[MID_ROW + 40, WEST_COL - 40] = 2750  # On the start's side.
    grids.elevation[MID_ROW, EAST_COL + 40] = 2900  # Higher, but past the wall.
    grid = avoiding_line(forecast, grids)[2]
    assert highest_clean_point(grid, xy(MID_ROW, WEST_COL)) == pytest.approx(
        xy(MID_ROW + 40, WEST_COL - 40)
    )


def test_no_turnaround_if_the_start_itself_is_flagged(forecast):
    grids = wall(flat_grids(), slice(0, SIZE))
    grid = avoiding_line(forecast, grids)[2]
    assert highest_clean_point(grid, xy(MID_ROW, WALL_COL)) is None


def test_terrain_only_grid_flags_nothing(forecast):
    grids = wall(flat_grids(), slice(0, SIZE))
    window = crop_window(grids, xy(MID_ROW, WEST_COL), xy(MID_ROW, EAST_COL))
    assert not build_cost_grid(grids, window, NO_OSM).flagged.any()


# Contract.


def test_request_rejects_identical_points(forecast):
    with pytest.raises(ValidationError):
        PlanRequest(start=(-111.6, 40.6), end=(-111.6, 40.6), date=forecast.date)


def test_request_defaults_to_considerable(forecast):
    request = PlanRequest(start=(-111.6, 40.6), end=(-111.7, 40.6), date=forecast.date)
    assert request.avoid_at_or_above == "considerable"


def test_found_plan_needs_a_route_and_analysis(forecast):
    body = plan(forecast, flat_grids()).model_dump(mode="json")
    body["analysis"] = None
    with pytest.raises(ValidationError):
        PlanResponse.model_validate(body)


def test_no_route_plan_cannot_carry_a_route(forecast):
    body = plan(forecast, flat_grids()).model_dump(mode="json")
    body["status"] = "no_route"
    with pytest.raises(ValidationError):
        PlanResponse.model_validate(body)


def test_plan_message_cannot_call_terrain_safe(forecast):
    body = plan(forecast, flat_grids()).model_dump(mode="json")
    body["message"] = "This line is safe."
    with pytest.raises(ValidationError):
        PlanResponse.model_validate(body)


@pytest.mark.parametrize("name", ["plan.response.json", "plan.no_route.response.json"])
def test_plan_fixtures_match_the_model(name):
    PlanResponse.model_validate_json((main.FIXTURES_DIR / name).read_text())


def test_plan_request_fixture_matches_the_model():
    PlanRequest.model_validate_json((main.FIXTURES_DIR / "plan.request.json").read_text())


# The endpoint and real terrain.


client = TestClient(main.app)
ALTA = (-111.6376, 40.5905)
ALBION = (-111.6100, 40.5750)


def test_endpoint_returns_a_flagged_line_on_real_terrain():
    response = client.post("/plan", json={"start": ALTA, "end": ALBION, "date": "2026-02-21"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "found"
    assert body["source"] == "demo_replay"
    assert body["forced_by_warning"] is False
    assert body["analysis"]["totals"]["length_m"] > 0


def test_endpoint_line_is_the_same_on_every_forecast_day():
    lines = [
        client.post("/plan", json={"start": ALTA, "end": ALBION, "date": date}).json()["route"]
        for date in ("2026-02-21", "2026-02-18", "2026-01-15")
    ]
    assert lines[0] == lines[1] == lines[2]


def test_endpoint_forces_low_on_a_warning_day():
    response = client.post("/plan", json={"start": ALTA, "end": ALBION, "date": "2026-02-18"})
    assert response.status_code == 200, response.text
    assert response.json()["avoid_at_or_above"] == "low"
    assert response.json()["forced_by_warning"] is True


def test_endpoint_returns_404_for_a_day_with_no_forecast():
    response = client.post("/plan", json={"start": ALTA, "end": ALBION, "date": "2026-03-01"})
    assert response.status_code == 404


def test_endpoint_returns_422_outside_the_terrain():
    response = client.post(
        "/plan", json={"start": ALTA, "end": (-110.0, 40.6), "date": "2026-02-21"}
    )
    assert response.status_code == 422


def test_avoiding_grid_marks_everything_analysis_would_flag_on_real_terrain():
    """If the mask misses cells that analysis flags, reroutes silently fail verification."""
    grids = load_grids()
    forecast = ForecastResponse.model_validate(
        json.loads((main.FIXTURES_DIR / "demo_days.json").read_text())["2026-02-21"]
    )
    rose = [cell.value for cell in forecast.rose]
    row, col = grids.cell_at(*TO_UTM.transform(*ALTA))
    r0, r1, c0, c1 = row - 150, row + 150, col - 150, col + 150
    pad = 32
    mask = flagged_mask(
        grids.elevation[r0 - pad:r1 + pad, c0 - pad:c1 + pad],
        grids.slope[r0 - pad:r1 + pad, c0 - pad:c1 + pad],
        grids.aspect[r0 - pad:r1 + pad, c0 - pad:c1 + pad],
        rose, "considerable", grids.transform.a,
    )
    rng = np.random.default_rng(7)
    missed, flagged = 0, 0
    for _ in range(600):
        r, c = int(rng.integers(r0, r1)), int(rng.integers(c0, c1))
        x, y = grids.transform @ (c + 0.5, r + 0.5)
        sample = grids.sample(x, y, rose, "considerable")
        by_analysis = sample.overhead_level is not None or (
            sample.level is not None and (sample.level == 0 or sample.level >= 3)
        )
        flagged += by_analysis
        missed += by_analysis and not mask[r - r0 + pad, c - c0 + pad]
    assert flagged > 50, "the sample should include plenty of flagged terrain"
    assert missed == 0
