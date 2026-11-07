"""Least-cost lines over the terrain grids.

Plan mode searches on terrain alone. The reroute passes the forecast too, which adds the
same rules as route analysis so the search avoids what /analyze would flag. Analysis
still has the last word: a reroute must verify every line.
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from math import ceil
from pathlib import Path

import numpy as np
from affine import Affine
from rasterio import features
from shapely import STRtree, box, transform
from shapely.geometry import shape
from skimage.graph import route_through_array
from skimage.measure import label

from app.route_analysis import METERS_TO_FEET, OVERHEAD_FACING_DEG, TO_UTM, TerrainGrids
from app.terrain import is_reroute_target, rose_value

OSM_DIR = Path(__file__).resolve().parents[2] / "data" / "osm"
PLAN_MARGIN_M = 1500

# Cost per cell, on top of 1 for distance.
SKINNING_START_DEG = 25
SKINNING_PENALTY_PER_DEG = 0.2  # Steeper than this is hard to skin up.
BLOCKED_SLOPE_DEG = 45  # Impassable, whatever the forecast says.
STEEP_PENALTY = 40  # 30 degrees or more is a poor line to skin, whatever the forecast says.
FLAGGED_PENALTY = 10_000  # Near-blocking, so the search only crosses when it has to.
NEAR_FLAGGED_PENALTY = 20  # Keeps lines a cell clear, since analysis samples between cells.
WINTER_SPORTS_PENALTY = 4  # Ski areas aren't backcountry tours.
TRAIL_COST_FACTOR = 0.6  # Known paths are preferred, not required.

# One representative elevation for each band case in candidate_bands, in feet.
_BAND_CASE_EDGES = (7900, 8100, 9400, 9600)
_BAND_CASE_FEET = (5000, 8000, 9000, 9500, 10000)


@dataclass(frozen=True)
class OsmLayers:
    trails: tuple  # Shapely lines in UTM.
    winter_sports: tuple  # Shapely polygons in UTM.
    attribution: str = "© OpenStreetMap contributors (ODbL)"


@lru_cache(maxsize=1)
def load_osm() -> OsmLayers:
    def read(name: str) -> tuple:
        data = json.loads((OSM_DIR / name).read_text())
        return tuple(
            transform(shape(feature["geometry"]), TO_UTM.transform, interleaved=False)
            for feature in data["features"]
        )

    return OsmLayers(read("trails.geojson"), read("winter_sports.geojson"))


@dataclass(frozen=True)
class CostGrid:
    cost: np.ndarray  # Negative means impassable.
    flagged: np.ndarray  # What analysis would flag, by steep terrain or overhead exposure.
    elevation: np.ndarray
    transform: Affine
    row0: int
    col0: int

    def cell_of(self, x: float, y: float) -> tuple[int, int]:
        col, row = (~self.transform) @ (x, y)
        return int(row), int(col)

    def center_of(self, row: int, col: int) -> tuple[float, float]:
        return self.transform @ (col + 0.5, row + 0.5)


def crop_window(
    grids: TerrainGrids, start_xy: tuple[float, float], end_xy: tuple[float, float],
    margin_m: float = PLAN_MARGIN_M,
) -> tuple[int, int, int, int]:
    """Rows and columns of the points' bounding box plus the margin, clipped to the grid."""
    start, end = grids.cell_at(*start_xy), grids.cell_at(*end_xy)
    margin = ceil(margin_m / grids.transform.a)
    height, width = grids.elevation.shape
    return (
        max(0, min(start[0], end[0]) - margin), min(height, max(start[0], end[0]) + margin + 1),
        max(0, min(start[1], end[1]) - margin), min(width, max(start[1], end[1]) + margin + 1),
    )


def _rating_tables(rose: list[int], threshold: str) -> np.ndarray:
    """Whether each band case and octant is a reroute target, using the real rating rules."""
    return np.array(
        [
            [is_reroute_target(rose_value(rose, feet, octant), threshold) for octant in range(8)]
            for feet in _BAND_CASE_FEET
        ]
    )


def _band_cases(elevation_ft: np.ndarray) -> np.ndarray:
    """Which band case each cell falls in. The edges at 7,900 and 9,400 ft are inclusive."""
    cases = np.zeros(elevation_ft.shape, dtype=int)
    cases[elevation_ft >= 7900] = 1
    cases[elevation_ft > 8100] = 2
    cases[elevation_ft >= 9400] = 3
    cases[elevation_ft > 9600] = 4
    return cases


def _shifted(array: np.ndarray, row: int, col: int, fill) -> np.ndarray:
    """Each cell's value taken from the cell at this offset, with `fill` past the edge."""
    result = np.full(array.shape, fill, dtype=array.dtype)
    height, width = array.shape
    result[max(0, -row):height - max(0, row), max(0, -col):width - max(0, col)] = (
        array[max(0, row):height + min(0, row), max(0, col):width + min(0, col)]
    )
    return result


@lru_cache(maxsize=4)
def _overhead_reach(cell_size_m: float) -> tuple[tuple[np.ndarray, np.ndarray], ...]:
    """For each whole degree of aspect, the cells a slope facing that way can threaten.

    One cell wider and one degree wider than analysis, since a slope's aspect is rounded
    here and analysis samples between cell centers.
    """
    reach_m = 300 + cell_size_m
    radius = ceil(reach_m / cell_size_m)
    rows, cols = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    near = np.hypot(rows, cols) * cell_size_m <= reach_m
    bearing = np.degrees(np.arctan2(cols, -rows))
    reach = []
    for aspect in range(360):
        facing = np.abs((bearing - aspect + 180) % 360 - 180) <= OVERHEAD_FACING_DEG + 1
        reach.append((rows[near & facing], cols[near & facing]))
    return tuple(reach)


def flagged_mask(
    elevation: np.ndarray, slope: np.ndarray, aspect: np.ndarray,
    rose: list[int], threshold: str, cell_size_m: float,
) -> np.ndarray:
    """Cells analysis would flag: a target in the 3 by 3 window, or a target slope overhead."""
    targets = _rating_tables(rose, threshold)
    finite = np.isfinite(elevation) & np.isfinite(slope) & np.isfinite(aspect)
    feet = np.where(finite, elevation, 0) * METERS_TO_FEET
    cases = _band_cases(feet)
    filled_aspect = np.where(finite, aspect, 0)
    octants = (((filled_aspect + 22.5) % 360) // 45).astype(int)
    steep = finite & (slope >= 30)

    # A point is rated at its own elevation, using the aspects of steep cells around it.
    flagged = np.zeros(elevation.shape, dtype=bool)
    for row in (-1, 0, 1):
        for col in (-1, 0, 1):
            neighbor_steep = _shifted(steep, row, col, False)
            neighbor_octant = _shifted(octants, row, col, 0)
            flagged |= neighbor_steep & targets[cases, neighbor_octant]

    # Overhead: spread each target slope to the lower cells it faces.
    sources = steep & targets[cases, octants]
    source_rows, source_cols = np.nonzero(sources)
    degrees = np.rint(filled_aspect[sources]).astype(int) % 360
    reach = _overhead_reach(cell_size_m)
    height, width = elevation.shape
    for degree in np.unique(degrees):
        chosen = degrees == degree
        reach_rows, reach_cols = reach[degree]
        rows = source_rows[chosen, None] + reach_rows
        cols = source_cols[chosen, None] + reach_cols
        inside = (rows >= 0) & (rows < height) & (cols >= 0) & (cols < width)
        heights = elevation[source_rows[chosen], source_cols[chosen]][:, None]
        below = np.zeros(rows.shape, dtype=bool)
        below[inside] = elevation[rows[inside], cols[inside]] < np.broadcast_to(
            heights, rows.shape
        )[inside]
        flagged[rows[below], cols[below]] = True
    return flagged


def _rasterize(shapes: tuple, window_box, grid_shape, grid_transform: Affine) -> np.ndarray:
    hits = STRtree(shapes).query(window_box) if shapes else []
    if len(hits) == 0:
        return np.zeros(grid_shape, dtype=bool)
    return features.rasterize(
        [(shapes[index], 1) for index in hits], out_shape=grid_shape,
        transform=grid_transform, fill=0, all_touched=True, dtype="uint8",
    ).astype(bool)


def build_cost_grid(
    grids: TerrainGrids, window: tuple[int, int, int, int], osm: OsmLayers,
    avoid: tuple[list[int], str] | None = None,
) -> CostGrid:
    """Terrain costs, plus near-blocking flagged terrain if `avoid` gives (rose, threshold)."""
    r0, r1, c0, c1 = window
    # Read past the window, so slopes just outside it still count as overhead.
    pad = ceil(300 / grids.transform.a) + 2
    height, width = grids.elevation.shape
    pr0, pr1, pc0, pc1 = max(0, r0 - pad), min(height, r1 + pad), max(0, c0 - pad), min(width, c1 + pad)
    if avoid is None:
        flagged = np.zeros((r1 - r0, c1 - c0), dtype=bool)
    else:
        flagged = flagged_mask(
            grids.elevation[pr0:pr1, pc0:pc1], grids.slope[pr0:pr1, pc0:pc1],
            grids.aspect[pr0:pr1, pc0:pc1], avoid[0], avoid[1], grids.transform.a,
        )[r0 - pr0:r1 - pr0, c0 - pc0:c1 - pc0]

    slope = grids.slope[r0:r1, c0:c1]
    elevation = grids.elevation[r0:r1, c0:c1]
    grid_transform = grids.transform @ Affine.translation(c0, r0)
    shape_ = slope.shape
    left, top = grid_transform @ (0, 0)
    right, bottom = grid_transform @ (shape_[1], shape_[0])
    window_box = box(left, bottom, right, top)

    known = np.isfinite(slope) & np.isfinite(elevation)
    known_slope = np.where(known, slope, 0)
    cost = 1 + np.clip(known_slope - SKINNING_START_DEG, 0, None) * SKINNING_PENALTY_PER_DEG
    cost += np.where(_rasterize(osm.winter_sports, window_box, shape_, grid_transform), WINTER_SPORTS_PENALTY, 0)
    cost *= np.where(_rasterize(osm.trails, window_box, shape_, grid_transform), TRAIL_COST_FACTOR, 1)
    cost += np.where(known_slope >= 30, STEEP_PENALTY, 0)
    near_flagged = flagged.copy()
    for row in (-1, 0, 1):
        for col in (-1, 0, 1):
            near_flagged |= _shifted(flagged, row, col, False)
    cost += np.where(near_flagged, NEAR_FLAGGED_PENALTY, 0)
    cost += np.where(flagged, FLAGGED_PENALTY, 0)
    cost = np.where(known & (known_slope < BLOCKED_SLOPE_DEG), cost, -1.0)
    return CostGrid(cost, flagged, elevation, grid_transform, r0, c0)


def least_cost_line(
    grid: CostGrid, start_xy: tuple[float, float], end_xy: tuple[float, float]
) -> list[tuple[float, float]] | None:
    """Cheapest line in projected meters, or None if blocked cells cut the points off."""
    start, end = grid.cell_of(*start_xy), grid.cell_of(*end_xy)
    if grid.cost[start] < 0 or grid.cost[end] < 0:
        return None
    try:
        path, _ = route_through_array(
            grid.cost, start, end, fully_connected=True, geometric=True
        )
    except ValueError:
        return None
    return [start_xy, *(grid.center_of(*cell) for cell in path[1:-1]), end_xy]


def highest_clean_point(
    grid: CostGrid, start_xy: tuple[float, float]
) -> tuple[float, float] | None:
    """The highest point reachable from the start without crossing flagged or blocked cells."""
    start = grid.cell_of(*start_xy)
    passable = (grid.cost >= 0) & ~grid.flagged
    if not passable[start]:
        return None
    regions = label(passable, connectivity=2)
    reachable = regions == regions[start]
    heights = np.where(reachable & np.isfinite(grid.elevation), grid.elevation, -np.inf)
    highest = np.unravel_index(heights.argmax(), heights.shape)
    return None if highest == start else grid.center_of(*highest)
