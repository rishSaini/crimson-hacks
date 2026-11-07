"""Replace only the flagged stretches of a route, and verify the result with analysis.

The rest of the line stays as drawn. A new line is only offered if analysis confirms it
crosses less flagged terrain, and thresholds are never loosened to get there.
"""

from dataclasses import replace

import numpy as np
from rasterio import features
from shapely import LineString as ShapeLine
from shapely.ops import substring

from app.forecast import effective_avoid_at_or_above
from app.models import (
    AlternativeRequest,
    AlternativeResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    FallbackOption,
    ForecastResponse,
    LineString,
    RouteComparison,
)
from app.route_analysis import TO_UTM, TerrainCoverageError, TerrainGrids, analyze_route
from app.route_search import CostGrid, OsmLayers, build_cost_grid, least_cost_line

ANCHOR_MARGIN_M = 100
SIMPLIFY_TOLERANCE_M = 10
MAX_CORRIDOR_M = 1500
# Analysis samples every 15 m, so smaller drops can be noise from a slightly different line.
MIN_FLAGGED_DROP_M = 30
NOTHING_TO_REROUTE = "No flagged terrain on this route, so there's nothing to reroute."
CLEAN_MESSAGE = (
    "This line avoids terrain flagged by this forecast. It does not remove avalanche risk."
)


def _projected(route: LineString) -> ShapeLine:
    return ShapeLine([TO_UTM.transform(*point) for point in route.coordinates])


def _to_lng_lat(points: list[tuple[float, float]]) -> LineString:
    xs, ys = zip(*points)
    lngs, lats = TO_UTM.transform(xs, ys, direction="INVERSE")
    return LineString(coordinates=list(zip(lngs, lats)))


def _windows(analysis: AnalyzeResponse, total_m: float) -> list[tuple[float, float]]:
    """Where each flagged stretch runs along the route, padded to anchors outside it."""
    starts, position = {}, 0.0
    for feature in analysis.segments.features:
        length = feature.properties.length_m
        starts[feature.properties.id] = (position, position + length)
        position += length
    windows: list[list[float]] = []
    for stretch in analysis.flagged_stretches:
        first = max(0.0, starts[stretch.segment_ids[0]][0] - ANCHOR_MARGIN_M)
        last = min(total_m, starts[stretch.segment_ids[-1]][1] + ANCHOR_MARGIN_M)
        if windows and first <= windows[-1][1]:
            windows[-1][1] = last
        else:
            windows.append([first, last])
    return [(first, last) for first, last in windows]


def _fenced_grid(
    grids: TerrainGrids, corridor, osm: OsmLayers, rose: list[int], threshold: str
) -> CostGrid:
    """Cost grid over the corridor, with every cell outside it impassable."""
    west, south, east, north = corridor.bounds
    height, width = grids.elevation.shape
    inverse = ~grids.transform
    c0, r0 = inverse @ (west, north)
    c1, r1 = inverse @ (east, south)
    window = (
        max(0, int(r0) - 1), min(height, int(r1) + 2), max(0, int(c0) - 1), min(width, int(c1) + 2)
    )
    if window[0] >= window[1] or window[2] >= window[3]:
        raise TerrainCoverageError("The route is outside the prepared terrain coverage.")
    grid = build_cost_grid(grids, window, osm, avoid=(rose, threshold))
    inside = features.rasterize(
        [(corridor, 1)], out_shape=grid.cost.shape, transform=grid.transform,
        fill=0, all_touched=True, dtype="uint8",
    ).astype(bool)
    return replace(grid, cost=np.where(inside, grid.cost, -1.0))


def _spliced(
    line: ShapeLine, windows: list[tuple[float, float]], request: AlternativeRequest,
    grids: TerrainGrids, osm: OsmLayers, rose: list[int], threshold: str, simplify: bool,
) -> list[tuple[float, float]]:
    """The route with each window replaced by a search inside its corridor, where one exists."""
    points: list[tuple[float, float]] = []
    position = 0.0

    def keep(first: float, last: float) -> None:
        if last > first:
            points.extend(tuple(point[:2]) for point in substring(line, first, last).coords)

    for first, last in windows:
        keep(position, first)
        piece = substring(line, first, last)
        anchors = tuple(piece.coords[0][:2]), tuple(piece.coords[-1][:2])
        corridor = piece.buffer(request.corridor_width_m)
        found = least_cost_line(
            _fenced_grid(grids, corridor, osm, rose, threshold), *anchors
        )
        if found is None:
            points.extend(tuple(point[:2]) for point in piece.coords)
        elif simplify:
            points.extend(ShapeLine(found).simplify(SIMPLIFY_TOLERANCE_M).coords)
        else:
            points.extend(found)
        position = last
    keep(position, line.length)
    return [point for index, point in enumerate(points) if index == 0 or point != points[index - 1]]


def _turnaround(analysis: AnalyzeResponse, grids: TerrainGrids) -> tuple[float, float] | None:
    """The highest point on the route before its first flagged stretch."""
    best, best_height = None, -np.inf
    for feature in analysis.segments.features:
        if feature.properties.flagged:
            break
        for lng, lat in feature.geometry.coordinates:
            height = grids.elevation_at(*grids.cell_at(*TO_UTM.transform(lng, lat)))
            if height > best_height:
                best, best_height = (lng, lat), height
    return best


def reroute(
    request: AlternativeRequest, forecast: ForecastResponse, grids: TerrainGrids, osm: OsmLayers
) -> AlternativeResponse:
    threshold, forced = effective_avoid_at_or_above(request.avoid_at_or_above, forecast.alert.level)
    width = request.corridor_width_m

    def analyzed(route: LineString) -> AnalyzeResponse:
        return analyze_route(
            AnalyzeRequest(
                route=route, date=request.date, avoid_at_or_above=request.avoid_at_or_above
            ),
            forecast,
            grids,
        )

    common = {
        "date": forecast.date,
        "source": forecast.source,
        "corridor_width_m": width,
        "avoid_at_or_above": threshold,
        "forced_by_warning": forced,
    }
    original = analyzed(request.route)
    if not original.flagged_stretches:
        return AlternativeResponse(**common, status="no_line", message=NOTHING_TO_REROUTE)

    line = _projected(request.route)
    windows = _windows(original, line.length)
    rose = [cell.value for cell in forecast.rose]
    before = original.totals.flagged_length_m
    best = None
    # Smooth the grid's stair-steps if that stays as clean, and only trust what analysis says.
    for simplify in (True, False):
        points = _spliced(line, windows, request, grids, osm, rose, threshold, simplify)
        route = _to_lng_lat(points)
        analysis = analyzed(route)
        if best is None or analysis.totals.flagged_length_m < best[1].totals.flagged_length_m:
            best = route, analysis
        if analysis.totals.flagged_length_m == 0:
            break
    route, analysis = best
    after = analysis.totals.flagged_length_m

    if after > 0 and before - after < MIN_FLAGGED_DROP_M:
        fallbacks: list[FallbackOption] = []
        if width < MAX_CORRIDOR_M:
            fallbacks.append("widen_corridor")
        turnaround = _turnaround(original, grids)
        if turnaround is not None:
            fallbacks.append("turnaround_point")
        fallbacks.append("nearby_tours")
        return AlternativeResponse(
            **common,
            status="no_line",
            message=f"No lower-exposure line within {round(width)} m. "
            "Today, this part of the route sits in rated terrain.",
            fallbacks=fallbacks,
            turnaround_point=turnaround,
        )

    new_line = _projected(route)
    message = CLEAN_MESSAGE if after == 0 else (
        f"This line cuts flagged terrain from {round(before)} m to {round(after)} m, "
        f"and {round(after)} m still remains. It does not remove avalanche risk."
    )
    return AlternativeResponse(
        **common,
        status="found",
        message=message,
        alternative=route,
        analysis=analysis,
        comparison=RouteComparison(
            original_flagged_m=before,
            alternative_flagged_m=after,
            added_distance_m=analysis.totals.length_m - original.totals.length_m,
            added_climb_ft=analysis.totals.climb_ft - original.totals.climb_ft,
            max_deviation_m=float(line.hausdorff_distance(new_line)),
        ),
    )
