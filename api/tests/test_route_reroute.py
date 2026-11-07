"""The reroute replaces only flagged stretches, and only offers lines analysis confirms."""

import json

import numpy as np
import pytest
from affine import Affine
from fastapi.testclient import TestClient
from shapely.geometry import LineString as ShapeLine
from shapely.geometry import box

from app import main
from app.models import AlternativeRequest, AnalyzeRequest, ForecastResponse, LineString
from app.route_analysis import TO_UTM, TerrainGrids, analyze_route
from app.route_planning import found_message
from app.route_reroute import reroute
from app.route_search import OsmLayers

LEFT, TOP, CELL = 430000, 4500000, 10
SIZE = 501
NO_OSM = OsmLayers((), ())
MID_ROW = SIZE // 2
WEST_COL, EAST_COL, WALL_COL = 150, 350, 250
HIGH, MODERATE, LOW = 8, 4, 2


def xy(row, col):
    return LEFT + (col + 0.5) * CELL, TOP - (row + 0.5) * CELL


def lng_lat(row, col):
    return TO_UTM.transform(*xy(row, col), direction="INVERSE")


def flat_grids() -> TerrainGrids:
    elevation = np.full((SIZE, SIZE), 2700.0)
    return TerrainGrids(
        Affine(CELL, 0, LEFT, 0, -CELL, TOP), elevation,
        np.zeros_like(elevation), np.zeros_like(elevation),
    )


def wall(grids, rows, col=WALL_COL, slope=35.0):
    grids.slope[rows, col - 2:col + 3] = slope
    return grids


def forecast_rated(value, level="none") -> ForecastResponse:
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


def straight_route():
    return LineString(coordinates=[lng_lat(MID_ROW, WEST_COL), lng_lat(MID_ROW, EAST_COL)])


def run(forecast, grids, route=None, width=400, setting="considerable"):
    request = AlternativeRequest(
        route=route or straight_route(), date=forecast.date,
        corridor_width_m=width, avoid_at_or_above=setting,
    )
    return reroute(request, forecast, grids, NO_OSM)


def projected(route):
    return ShapeLine([TO_UTM.transform(*point) for point in route.coordinates])


def flagged_m(route, forecast, grids, setting="considerable"):
    return analyze_route(
        AnalyzeRequest(route=route, date=forecast.date, avoid_at_or_above=setting), forecast, grids
    ).totals.flagged_length_m


def test_reroute_avoids_a_flagged_slope_with_a_way_around():
    forecast, grids = forecast_rated(HIGH), wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    result = run(forecast, grids)
    assert result.status == "found"
    assert result.comparison.original_flagged_m > 0
    assert result.comparison.alternative_flagged_m == 0
    assert result.analysis.totals.flagged_length_m == 0
    assert flagged_m(result.alternative, forecast, grids) == 0
    assert "does not remove avalanche risk" in result.message
    assert not projected(result.alternative).intersects(
        box(*xy(MID_ROW + 15, WALL_COL - 2), *xy(MID_ROW - 15, WALL_COL + 2))
    )


def test_reroute_says_so_when_only_flagged_paths_exist():
    forecast, grids = forecast_rated(HIGH), wall(flat_grids(), slice(0, SIZE))
    result = run(forecast, grids)
    assert result.status == "no_line"
    assert result.alternative is None
    assert result.analysis is None
    assert result.message.startswith("No lower-exposure line within 400 m")
    assert result.fallbacks == ["widen_corridor", "turnaround_point", "nearby_tours"]


def test_rest_of_the_line_is_kept():
    forecast, grids = forecast_rated(HIGH), wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    line = projected(run(forecast, grids).alternative)
    assert line.coords[0] == pytest.approx(xy(MID_ROW, WEST_COL), abs=0.01)
    assert line.coords[-1] == pytest.approx(xy(MID_ROW, EAST_COL), abs=0.01)
    # 2 km of straight line, with flags only near the middle, stays on the original at each end.
    original = projected(straight_route())
    assert original.distance(ShapeLine([line.coords[0], line.coords[1]]).interpolate(0.5, normalized=True)) < 1
    assert line.interpolate(300).distance(original) < 1
    assert line.interpolate(line.length - 300).distance(original) < 1


def test_only_the_flagged_stretches_change():
    forecast = forecast_rated(HIGH)
    grids = flat_grids()
    wall(grids, slice(MID_ROW - 10, MID_ROW + 11), col=190)
    wall(grids, slice(MID_ROW - 10, MID_ROW + 11), col=310)
    result = run(forecast, grids)
    assert result.status == "found"
    assert result.comparison.alternative_flagged_m == 0
    # Halfway between the two walls, the line is back on the original.
    line, original = projected(result.alternative), projected(straight_route())
    assert line.interpolate(0.5, normalized=True).distance(original) < 1


def test_new_line_stays_within_the_corridor():
    forecast, grids = forecast_rated(HIGH), wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    result = run(forecast, grids, width=400)
    assert result.comparison.max_deviation_m <= 400 + CELL


def test_gap_outside_the_corridor_does_not_count_until_widened():
    # The wall's gap is about 500 m off the line: too far at 200 and 400 m, reachable at 800 m.
    forecast = forecast_rated(HIGH)
    grids = wall(flat_grids(), slice(MID_ROW - 48, SIZE))
    assert run(forecast, grids, width=200).status == "no_line"
    assert run(forecast, grids, width=400).status == "no_line"
    wider = run(forecast, grids, width=800)
    assert wider.status == "found"
    assert wider.comparison.alternative_flagged_m == 0
    assert wider.comparison.added_distance_m > 0


def test_widening_stops_being_offered_at_the_maximum():
    forecast, grids = forecast_rated(HIGH), wall(flat_grids(), slice(0, SIZE))
    assert "widen_corridor" in run(forecast, grids, width=800).fallbacks
    assert "widen_corridor" not in run(forecast, grids, width=1500).fallbacks


def test_comparison_reports_the_trade():
    forecast, grids = forecast_rated(HIGH), wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    result = run(forecast, grids)
    comparison = result.comparison
    assert comparison.added_distance_m == pytest.approx(
        result.analysis.totals.length_m - 2000, abs=1
    )
    assert comparison.added_distance_m > 0
    assert comparison.max_deviation_m > 100


def test_partly_clean_line_reports_what_remains():
    # A flagged start can't be avoided, since the route has to begin there.
    forecast = forecast_rated(HIGH)
    grids = wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    grids.slope[MID_ROW - 8:MID_ROW + 9, WEST_COL - 8:WEST_COL + 9] = 35
    result = run(forecast, grids)
    assert result.status == "found"
    remaining = result.comparison.alternative_flagged_m
    assert 0 < remaining < result.comparison.original_flagged_m
    assert f"{round(remaining)} m still remains" in result.message


def test_route_with_nothing_flagged_has_nothing_to_reroute():
    result = run(forecast_rated(HIGH), flat_grids())
    assert result.status == "no_line"
    assert result.message.startswith("No flagged terrain")
    assert result.fallbacks == []


def test_moderate_is_only_avoided_when_asked():
    forecast = forecast_rated(MODERATE)
    grids = wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    assert run(forecast, grids).message.startswith("No flagged terrain")
    assert run(forecast, grids, setting="moderate").status == "found"


def test_low_is_only_avoided_when_asked():
    forecast = forecast_rated(LOW)
    grids = wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    assert run(forecast, grids, setting="moderate").message.startswith("No flagged terrain")
    assert run(forecast, grids, setting="low").status == "found"


def test_unrated_steep_terrain_is_always_avoided():
    forecast = forecast_rated(0)
    grids = wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    result = run(forecast, grids)
    assert result.status == "found"
    assert result.comparison.alternative_flagged_m == 0


def test_warning_forces_low_and_reports_it():
    forecast = forecast_rated(LOW, "warning")
    grids = wall(flat_grids(), slice(MID_ROW - 15, MID_ROW + 16))
    result = run(forecast, grids)
    assert result.status == "found"
    assert (result.avoid_at_or_above, result.forced_by_warning) == ("low", True)


def test_slope_overhead_is_routed_around():
    forecast = forecast_rated(HIGH)
    grids = flat_grids()
    row, cols = MID_ROW - 12, slice(WALL_COL - 10, WALL_COL + 11)
    grids.elevation[row, cols] += 30
    grids.slope[row, cols] = 35
    grids.aspect[row, cols] = 180
    result = run(forecast, grids)
    assert result.status == "found"
    assert result.comparison.alternative_flagged_m == 0


def test_turnaround_is_the_highest_point_before_the_first_flag():
    forecast = forecast_rated(HIGH)
    grids = wall(flat_grids(), slice(0, SIZE))
    # A slight rise on the way in, and a higher one past the wall that doesn't count.
    grids.elevation[MID_ROW - 3:MID_ROW + 4, WEST_COL + 48:WEST_COL + 53] = 2720
    grids.elevation[MID_ROW - 3:MID_ROW + 4, EAST_COL - 22:EAST_COL - 17] = 2800
    result = run(forecast, grids)
    assert TO_UTM.transform(*result.turnaround_point) == pytest.approx(
        xy(MID_ROW, WEST_COL + 50), abs=30
    )


def test_no_turnaround_if_the_route_starts_flagged():
    forecast = forecast_rated(HIGH)
    grids = flat_grids()
    grids.slope[:, WEST_COL - 3:WEST_COL + 4] = 35
    result = run(forecast, grids)
    assert result.turnaround_point is None
    assert "turnaround_point" not in result.fallbacks


# Plan messages, which send people to this step.


class Totals:
    def __init__(self, flagged=0, flagged_m=0, steep=0, steep_m=0, ratings=()):
        self.flagged_stretch_count, self.flagged_length_m = flagged, flagged_m
        self.steep_stretch_count, self.steep_length_m = steep, steep_m
        self.steep_ratings = list(ratings)


@pytest.mark.parametrize(
    "totals, expected",
    [
        (Totals(), "No flags found on this route today."),
        (Totals(flagged=1, flagged_m=120), "1 stretch crosses flagged terrain (120 m)."),
        (Totals(flagged=2, flagged_m=640), "2 stretches cross flagged terrain (640 m)."),
        (
            Totals(steep=2, steep_m=450, ratings=["low"]),
            "2 stretches in avalanche terrain, rated Low today (450 m). Not rerouted by default.",
        ),
        (
            Totals(steep=1, steep_m=90, ratings=["moderate"]),
            "1 stretch in avalanche terrain, rated Moderate today (90 m). Not rerouted by default.",
        ),
        (
            Totals(steep=3, steep_m=700, ratings=["low", "moderate"]),
            "3 stretches in avalanche terrain, rated Low to Moderate today (700 m). "
            "Not rerouted by default.",
        ),
    ],
)
def test_plan_messages_follow_the_rulings(totals, expected):
    assert found_message(totals) == expected


# The endpoint, on real terrain.


client = TestClient(main.app)


def plan_then_reroute(start, end, date="2026-02-21", **extra):
    planned = client.post("/plan", json={"start": start, "end": end, "date": date}).json()
    assert planned["status"] == "found"
    response = client.post(
        "/alternative", json={"route": planned["route"], "date": date, **extra}
    )
    assert response.status_code == 200, response.text
    return planned, response.json()


def test_endpoint_clears_the_little_cottonwood_route_at_a_wide_enough_corridor():
    planned, body = plan_then_reroute((-111.72, 40.572), (-111.68, 40.578), corridor_width_m=1500)
    assert planned["analysis"]["totals"]["flagged_length_m"] > 0
    assert body["status"] == "found"
    assert body["source"] == "demo_replay"
    assert body["comparison"]["alternative_flagged_m"] < body["comparison"]["original_flagged_m"]
    assert body["analysis"]["totals"]["flagged_length_m"] == body["comparison"]["alternative_flagged_m"]


def test_endpoint_returns_404_for_a_day_with_no_forecast():
    route = {"type": "LineString", "coordinates": [(-111.72, 40.572), (-111.68, 40.578)]}
    response = client.post("/alternative", json={"route": route, "date": "2026-03-01"})
    assert response.status_code == 404


def test_endpoint_returns_422_outside_the_terrain():
    route = {"type": "LineString", "coordinates": [(-111.72, 40.572), (-110.0, 40.6)]}
    response = client.post("/alternative", json={"route": route, "date": "2026-02-21"})
    assert response.status_code == 422


def test_tiny_drop_from_sampling_noise_is_not_a_reroute():
    # Crossing a full wall at a slightly different angle changes flagged meters by a few
    # meters, which must not be offered as a better line.
    result = run(forecast_rated(HIGH), wall(flat_grids(), slice(0, SIZE)))
    assert result.status == "no_line"


def test_short_flagged_run_can_still_be_cleared_entirely():
    # Under the noise floor in meters, but it clears every flag.
    forecast = forecast_rated(HIGH)
    grids = flat_grids()
    grids.slope[MID_ROW, WALL_COL] = 35
    result = run(forecast, grids)
    assert result.status == "found"
    assert result.comparison.original_flagged_m <= 45
    assert result.comparison.alternative_flagged_m == 0
