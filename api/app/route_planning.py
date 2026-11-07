"""Plan a line between two points from terrain alone, then flag it with route analysis.

The forecast never changes the line. Avoiding flagged terrain is the reroute's job.
"""

from shapely import LineString as ShapeLine

from app.forecast import effective_avoid_at_or_above
from app.models import (
    AnalyzeRequest,
    ForecastResponse,
    LineString,
    PlanRequest,
    PlanResponse,
    RouteTotals,
)
from app.route_analysis import TO_UTM, TerrainGrids, analyze_route
from app.route_search import OsmLayers, build_cost_grid, crop_window, least_cost_line

SIMPLIFY_TOLERANCE_M = 10
NO_ROUTE_MESSAGE = (
    "No route: slopes of 45 degrees or more block every way between these points within 1.5 km."
)
LIMITATIONS = [
    "Computer-generated line, not a known skin track. Check it against a map.",
    "This line follows the terrain, not the forecast. It does not remove avalanche risk.",
]
WARNING_LIMITATION = "UAC recommends avoiding all avalanche terrain today."


def to_lng_lat(line_xy: list[tuple[float, float]]) -> LineString:
    xs, ys = zip(*line_xy)
    lngs, lats = TO_UTM.transform(xs, ys, direction="INVERSE")
    return LineString(coordinates=list(zip(lngs, lats)))


def found_message(totals: RouteTotals) -> str:
    if totals.flagged_stretch_count > 0:
        count = totals.flagged_stretch_count
        noun = "stretch crosses" if count == 1 else "stretches cross"
        return f"{count} {noun} flagged terrain ({round(totals.flagged_length_m)} m)."
    if totals.steep_stretch_count > 0:
        # Steep terrain rated below the setting. It's listed, and it's not "no flags".
        count = totals.steep_stretch_count
        noun = "stretch" if count == 1 else "stretches"
        ratings = " to ".join(rating.capitalize() for rating in totals.steep_ratings)
        return (
            f"{count} {noun} in avalanche terrain, rated {ratings} today "
            f"({round(totals.steep_length_m)} m). Not rerouted by default."
        )
    return "No flags found on this route today."


def plan_route(
    request: PlanRequest, forecast: ForecastResponse, grids: TerrainGrids, osm: OsmLayers
) -> PlanResponse:
    threshold, forced = effective_avoid_at_or_above(request.avoid_at_or_above, forecast.alert.level)
    start_xy, end_xy = TO_UTM.transform(*request.start), TO_UTM.transform(*request.end)
    grid = build_cost_grid(grids, crop_window(grids, start_xy, end_xy), osm)
    line = least_cost_line(grid, start_xy, end_xy)
    common = {
        "date": forecast.date,
        "source": forecast.source,
        "avoid_at_or_above": threshold,
        "forced_by_warning": forced,
        "limitations": ([WARNING_LIMITATION] if forced else []) + LIMITATIONS,
        "attribution": osm.attribution,
    }
    if line is None:
        return PlanResponse(**common, status="no_route", message=NO_ROUTE_MESSAGE)

    route = to_lng_lat(list(ShapeLine(line).simplify(SIMPLIFY_TOLERANCE_M).coords))
    analysis = analyze_route(
        AnalyzeRequest(route=route, date=request.date, avoid_at_or_above=request.avoid_at_or_above),
        forecast,
        grids,
    )
    return PlanResponse(
        **common,
        status="found",
        message=found_message(analysis.totals),
        route=route,
        analysis=analysis,
    )
