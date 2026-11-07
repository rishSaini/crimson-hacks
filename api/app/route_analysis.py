"""Sample routes against the prepared terrain grids and a supplied forecast."""

from dataclasses import dataclass
from functools import lru_cache
from itertools import groupby
from math import ceil
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer

from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    ForecastResponse,
    LineString,
    RouteTotals,
    SegmentCollection,
    SegmentFeature,
    SegmentProperties,
)
from app.terrain import aspect_octant, is_reroute_target, rose_value
from app.forecast import effective_avoid_at_or_above

GRID_DIR = Path(__file__).resolve().parents[2] / "data" / "grids"
METERS_TO_FEET = 1 / 0.3048
SAMPLE_SPACING_M = 15
DANGERS = ("no_rating", "low", "moderate", "considerable", "high", "extreme")
COLORS = ("unrated", "green", "yellow", "orange", "red", "black")
ASPECTS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
TO_UTM = Transformer.from_crs(4326, 32612, always_xy=True)


class TerrainCoverageError(ValueError):
    pass


@dataclass(frozen=True)
class TerrainGrids:
    transform: Affine
    elevation: np.ndarray
    slope: np.ndarray
    aspect: np.ndarray

    def cell_at(self, x: float, y: float) -> tuple[int, int]:
        col, row = (~self.transform) @ (x, y)
        if not (0 <= row < self.elevation.shape[0] and 0 <= col < self.elevation.shape[1]):
            raise TerrainCoverageError("The route is outside the prepared terrain coverage.")
        return int(row), int(col)

    def elevation_at(self, row: int, col: int) -> float:
        elevation = self.elevation[row, col]
        if not np.isfinite(elevation):
            raise TerrainCoverageError("The elevation grid has no data for part of the route.")
        return float(elevation * METERS_TO_FEET)

    def overhead_level(
        self, x: float, y: float, rose: list[int], threshold: str
    ) -> int | None:
        """Check higher steep cells within 300 m, using the current forecast setting."""
        row, col = self.cell_at(x, y)
        radius = ceil(300 / self.transform.a) + 1
        height, width = self.slope.shape
        left, top = self.transform.c, self.transform.f
        right = left + width * self.transform.a
        bottom = top + height * self.transform.e
        if x - 300 < left or x + 300 > right or y - 300 < bottom or y + 300 > top:
            raise TerrainCoverageError("The overhead search extends beyond terrain coverage.")
        r0, r1 = max(0, row - radius), min(self.slope.shape[0], row + radius + 1)
        c0, c1 = max(0, col - radius), min(self.slope.shape[1], col + radius + 1)
        rows, cols = np.mgrid[r0:r1, c0:c1]
        cell_x = self.transform.c + (cols + 0.5) * self.transform.a
        cell_y = self.transform.f + (rows + 0.5) * self.transform.e
        within = (cell_x - x) ** 2 + (cell_y - y) ** 2 <= 300 ** 2
        elevation = self.elevation[r0:r1, c0:c1]
        slopes = self.slope[r0:r1, c0:c1]
        higher = elevation > self.elevation[row, col]
        # Missing terrain inside the search area prevents a complete exposure check.
        if np.any(within & (~np.isfinite(elevation) | ~np.isfinite(slopes))):
            raise TerrainCoverageError("Terrain coverage is incomplete within the overhead search area.")
        rr, cc = np.where(within & higher & (slopes >= 30))
        levels = []
        for local_row, local_col in zip(rr, cc):
            aspect = self.aspect[r0 + local_row, c0 + local_col]
            if not np.isfinite(aspect):
                raise TerrainCoverageError("The overhead search area has missing aspect data.")
            value = rose_value(
                rose, float(elevation[local_row, local_col] * METERS_TO_FEET),
                aspect_octant(float(aspect)),
            )
            if is_reroute_target(value, threshold):
                levels.append((value + 1) // 2)
        return max(levels, default=None)

    def sample(
        self, x: float, y: float, rose: list[int], threshold: str = "considerable"
    ) -> "TerrainSample":
        row, col = self.cell_at(x, y)
        elevation = self.elevation_at(row, col)
        window = np.s_[row - 1:row + 2, col - 1:col + 2]
        slopes = self.slope[window]
        if slopes.shape != (3, 3) or not np.isfinite(slopes).all():
            raise TerrainCoverageError("The slope grid has incomplete data for part of the route.")
        # Rate the aspect of the cell that supplied the slope. Prefer the center on ties.
        steepest = (1, 1)
        if slopes[steepest] < slopes.max():
            steepest = np.unravel_index(slopes.argmax(), slopes.shape)
        slope = float(slopes[steepest])
        aspect = self.aspect[window][steepest]
        if not np.isfinite(aspect):
            raise TerrainCoverageError("The aspect grid has no data for part of the route.")
        octant = aspect_octant(float(aspect))
        level = (rose_value(rose, elevation, octant) + 1) // 2 if slope >= 30 else None
        overhead = self.overhead_level(x, y, rose, threshold) if level is None else None
        return TerrainSample(slope, elevation, octant, level, overhead)


@dataclass(frozen=True)
class TerrainSample:
    slope: float
    elevation: float
    octant: int
    level: int | None
    overhead_level: int | None = None


@lru_cache(maxsize=1)
def load_grids() -> TerrainGrids:
    arrays = []
    grid = None
    for name in ("dem", "slope", "aspect"):
        with rasterio.open(GRID_DIR / f"{name}.tif") as raster:
            metadata = (raster.transform, raster.shape)
            if raster.crs != rasterio.crs.CRS.from_epsg(32612) or (
                grid is not None and metadata != grid
            ):
                raise ValueError("Terrain grids must share one EPSG:32612 grid.")
            grid = metadata
            arrays.append(raster.read(1, masked=True).filled(np.nan))
    return TerrainGrids(grid[0], *arrays)


def analyze_route(
    request: AnalyzeRequest, forecast: ForecastResponse, grids: TerrainGrids
) -> AnalyzeResponse:
    """Rate intervals of at most 15 m and retain every original route vertex."""
    threshold, forced_by_warning = effective_avoid_at_or_above(
        request.avoid_at_or_above, forecast.alert.level
    )
    longitude, latitude = zip(*request.route.coordinates)
    x, y = TO_UTM.transform(longitude, latitude)
    vertices = np.column_stack((x, y))
    if not np.isfinite(vertices).all():
        raise TerrainCoverageError("The route contains invalid coordinates.")
    for vertex in vertices:
        grids.cell_at(*vertex)

    points = [vertices[0]]
    for start, end in zip(vertices, vertices[1:]):
        length = float(np.linalg.norm(end - start))
        if length:
            steps = ceil(length / SAMPLE_SPACING_M)
            points.extend(np.linspace(start, end, steps + 1)[1:])
    if len(points) < 2:
        raise TerrainCoverageError("The route must contain at least two distinct points.")

    projected = np.asarray(points)
    longitudes, latitudes = TO_UTM.transform(*projected.T, direction="INVERSE")
    coordinates = list(zip(longitudes, latitudes))
    elevations = [grids.elevation_at(*grids.cell_at(*point)) for point in projected]
    climb_ft = sum(max(0, end - start) for start, end in zip(elevations, elevations[1:]))
    lengths = np.linalg.norm(np.diff(projected, axis=0), axis=1)
    rose = [cell.value for cell in forecast.rose]
    samples = [
        grids.sample(*midpoint, rose, threshold)
        for midpoint in (projected[:-1] + projected[1:]) / 2
    ]

    features = []
    first = 0
    threshold_level = {"considerable": 3, "moderate": 2, "low": 1}[threshold]
    for (level, overhead), group in groupby(
        samples, key=lambda sample: (sample.level, sample.overhead_level)
    ):
        segment = list(group)
        end = first + len(segment)
        flagged = overhead is not None or level == 0 or (
            level is not None and level >= threshold_level
        )
        reason = None
        if flagged:
            reason = "unrated_terrain" if level == 0 else "steep_terrain"
        if overhead is not None:
            reason = "overhead_exposure"
        properties = SegmentProperties(
            id=len(features) + 1,
            length_m=float(lengths[first:end].sum()),
            slope_min_deg=min(sample.slope for sample in segment),
            slope_max_deg=max(sample.slope for sample in segment),
            elevation_min_ft=min(sample.elevation for sample in segment),
            elevation_max_ft=max(sample.elevation for sample in segment),
            aspects=[ASPECTS[index] for index in sorted({s.octant for s in segment})],
            danger=DANGERS[level if level is not None else overhead or 0],
            color=COLORS[level] if level is not None else "gray",
            flagged=flagged,
            flag_reason=reason,
        )
        features.append(SegmentFeature(
            geometry=LineString(coordinates=coordinates[first:end + 1]),
            properties=properties,
        ))
        first = end

    segments = [feature.properties for feature in features]
    steep = [segment for segment in segments if segment.color != "gray"]
    flagged_segments = [segment for segment in segments if segment.flagged]
    totals = RouteTotals(
        length_m=sum(segment.length_m for segment in segments),
        climb_ft=climb_ft,
        steep_segment_count=len(steep),
        steep_length_m=sum(segment.length_m for segment in steep),
        steep_ratings=sorted({segment.danger for segment in steep}, key=DANGERS.index),
        flagged_length_m=sum(segment.length_m for segment in flagged_segments),
        flagged_stretch_count=len(flagged_segments),
        max_flagged_danger=max(
            (segment.danger for segment in flagged_segments), key=DANGERS.index, default=None
        ),
    )
    return AnalyzeResponse(
        date=forecast.date,
        source=forecast.source,
        avoid_at_or_above=threshold,
        forced_by_warning=forced_by_warning,
        segments=SegmentCollection(features=features),
        totals=totals,
    )
