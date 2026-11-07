"""Terrain classification. Not implemented yet: tests/test_terrain.py defines the behavior.

Band and octant indexes match UAC's overall_danger_rose:
  band:   0 = upper, 1 = mid, 2 = lower
  octant: 0 = N, then clockwise to 7 = NW
"""

import numpy as np


def compute_aspect(dem: np.ndarray, cell_size_m: float) -> np.ndarray:
    """Aspect with the Horn method: degrees clockwise from north, the way a slope faces.

    `dem` is north-up: row 0 is the north edge and column 0 is the west edge.
    """
    raise NotImplementedError


def aspect_octant(aspect_deg: float) -> int:
    """Octant for an aspect. N covers 337.5 up to 22.5, NE covers 22.5 up to 67.5, and so on."""
    raise NotImplementedError


def candidate_bands(elevation_ft: float) -> tuple[int, ...]:
    """Bands whose rating can apply at this elevation, upper first.

    UAC Salt Lake bands: lower below 8,000 ft, mid 8,000 to 9,500 ft, upper above 9,500 ft.
    A point within 100 ft of 8,000 or 9,500 ft, inclusive, gets both adjacent bands.

    Takes feet. The DEM is in meters, so convert first.
    """
    raise NotImplementedError


def rose_index(band: int, octant: int) -> int:
    """Index into the 24-value danger rose: 8 * band + octant."""
    raise NotImplementedError


def rose_value(rose: list[int], elevation_ft: float, octant: int) -> int:
    """Raw rose value at a point, taking the higher rating of its candidate bands.

    Raw values sort by rating: 5 ("pockets of" Considerable) beats 4 (Moderate), and
    6 (Considerable) beats 5.

    If one candidate band is unrated (0), the other band decides:
      - Considerable or higher (5 and up): return that rated value.
      - Low or Moderate (1 to 4): return 0, so the point is treated as unrated and flagged.

    Use this for every rating lookup, including the cost grid and overhead exposure.
    """
    raise NotImplementedError


def is_reroute_target(value: int, avoid_at_or_above: str) -> bool:
    """Whether a reroute avoids a 30 degree or steeper point with this raw rose value.

    Unrated (0) is always avoided. Otherwise the point is avoided if its rating is at or
    above the threshold, and "pockets of" a level counts as that level:
      "considerable": 5 and up.  "moderate": 3 and up.  "low": 1 and up.
    """
    raise NotImplementedError
