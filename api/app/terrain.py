"""Terrain classification using USGS elevation and UAC forecast ratings.

Band and octant indexes match UAC's overall_danger_rose:
  band:   0 = upper, 1 = mid, 2 = lower
  octant: 0 = N, then clockwise to 7 = NW
"""

import numpy as np


def _horn_gradients(dem: np.ndarray, cell_size_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Return elevation gradients toward the east and south."""
    grid = np.pad(np.asarray(dem, dtype=float), 1, constant_values=np.nan)
    northwest, north, northeast = grid[:-2, :-2], grid[:-2, 1:-1], grid[:-2, 2:]
    west, center, east = grid[1:-1, :-2], grid[1:-1, 1:-1], grid[1:-1, 2:]
    southwest, south, southeast = grid[2:, :-2], grid[2:, 1:-1], grid[2:, 2:]
    scale = 8 * cell_size_m
    eastward = (northeast + 2 * east + southeast - northwest - 2 * west - southwest) / scale
    southward = (southwest + 2 * south + southeast - northwest - 2 * north - northeast) / scale
    valid = np.isfinite(center)
    return np.where(valid, eastward, np.nan), np.where(valid, southward, np.nan)


def compute_slope_and_aspect(
    dem: np.ndarray, cell_size_m: float
) -> tuple[np.ndarray, np.ndarray]:
    """Return Horn slope and downslope aspect in degrees on a north-up grid."""
    eastward, southward = _horn_gradients(dem, cell_size_m)
    slope = np.degrees(np.arctan(np.hypot(eastward, southward)))
    aspect = np.degrees(np.arctan2(-eastward, southward)) % 360
    return slope, np.where(slope == 0, 0, aspect)


def compute_aspect(dem: np.ndarray, cell_size_m: float) -> np.ndarray:
    """Aspect with the Horn method: degrees clockwise from north, the way a slope faces.

    `dem` is north-up: row 0 is the north edge and column 0 is the west edge.
    """
    return compute_slope_and_aspect(dem, cell_size_m)[1]


def aspect_octant(aspect_deg: float) -> int:
    """Octant for an aspect. N covers 337.5 up to 22.5, NE covers 22.5 up to 67.5, and so on."""
    return int(((aspect_deg + 22.5) % 360) // 45)


def candidate_bands(elevation_ft: float) -> tuple[int, ...]:
    """Bands whose rating can apply at this elevation, upper first.

    UAC Salt Lake bands: lower below 8,000 ft, mid 8,000 to 9,500 ft, upper above 9,500 ft.
    A point within 100 ft of 8,000 or 9,500 ft, inclusive, gets both adjacent bands.

    Takes feet. The DEM is in meters, so convert first.
    """
    if elevation_ft > 9600:
        return (0,)
    if elevation_ft >= 9400:
        return (0, 1)
    if elevation_ft > 8100:
        return (1,)
    if elevation_ft >= 7900:
        return (1, 2)
    return (2,)


def rose_index(band: int, octant: int) -> int:
    """Index into the 24-value danger rose: 8 * band + octant."""
    return 8 * band + octant


def rose_value(rose: list[int], elevation_ft: float, octant: int) -> int:
    """Raw rose value at a point, taking the higher rating of its candidate bands.

    Raw values sort by rating: 5 ("pockets of" Considerable) beats 4 (Moderate), and
    6 (Considerable) beats 5.

    If one candidate band is unrated (0), the other band decides:
      - Considerable or higher (5 and up): return that rated value.
      - Low or Moderate (1 to 4): return 0, so the point is treated as unrated and flagged.

    Use this for every rating lookup, including the cost grid and overhead exposure.
    """
    values = [rose[rose_index(band, octant)] for band in candidate_bands(elevation_ft)]
    highest = max(values)
    return 0 if 0 in values and highest < 5 else highest


def is_reroute_target(value: int, avoid_at_or_above: str) -> bool:
    """Whether a reroute avoids a 30 degree or steeper point with this raw rose value.

    Unrated (0) is always avoided. Otherwise the point is avoided if its rating is at or
    above the threshold, and "pockets of" a level counts as that level:
      "considerable": 5 and up.  "moderate": 3 and up.  "low": 1 and up.
    """
    threshold = {"considerable": 5, "moderate": 3, "low": 1}[avoid_at_or_above]
    return value == 0 or value >= threshold
