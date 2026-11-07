"""Core terrain logic. These fail until the terrain engine is implemented in app/terrain.py."""

import math

import numpy as np
import pytest

from app.models import FLAGGED_DANGERS
from app.terrain import (
    aspect_octant,
    candidate_bands,
    compute_aspect,
    is_reroute_target,
    rose_index,
    rose_value,
)

CELL_SIZE_M = 10.0
UPPER, MID, LOWER = 0, 1, 2
N, NE, E, SE, S, SW, W, NW = range(8)
DANGER_BY_LEVEL = ["no_rating", "low", "moderate", "considerable", "high", "extreme"]


def plane_facing(direction: str) -> np.ndarray:
    """A 30 degree plane on a north-up grid. A slope faces the way it runs downhill."""
    rows, cols = np.mgrid[0:20, 0:20]
    rise = CELL_SIZE_M * math.tan(math.radians(30))
    return {
        "north": rows * rise,  # rows increase southward, so high ground is to the south
        "south": -rows * rise,
        "east": -cols * rise,  # columns increase eastward, so high ground is to the west
        "west": cols * rise,
    }[direction]


def assert_aspect_close(aspect: np.ndarray, expected_deg: float) -> None:
    """Compare on a circle, so 359.9 and 0.1 both count as north. Skips edge cells."""
    interior = aspect[2:-2, 2:-2]
    difference = np.abs((interior - expected_deg + 180) % 360 - 180)
    assert difference.max() < 0.5


def test_north_facing_plane_has_north_aspect():
    aspect = compute_aspect(plane_facing("north"), CELL_SIZE_M)
    assert_aspect_close(aspect, 0)


@pytest.mark.parametrize(
    "direction, expected_deg", [("east", 90), ("south", 180), ("west", 270)]
)
def test_other_planes_are_clockwise_from_north(direction, expected_deg):
    # A north-facing plane alone can't catch an east/west mirror, which would send
    # every lookup to the wrong side of the danger rose.
    aspect = compute_aspect(plane_facing(direction), CELL_SIZE_M)
    assert_aspect_close(aspect, expected_deg)


@pytest.mark.parametrize(
    "aspect_deg, octant",
    [
        (0, N),
        (359.9, N),
        (337.5, N),
        (22.4, N),
        (22.5, NE),
        (90, E),
        (180, S),
        (270, W),
        (337.4, NW),
    ],
)
def test_aspect_octant(aspect_deg, octant):
    assert aspect_octant(aspect_deg) == octant


@pytest.mark.parametrize(
    "band, octant, index",
    [
        (UPPER, N, 0),
        (UPPER, NE, 1),
        (UPPER, NW, 7),
        (MID, N, 8),
        (MID, E, 10),
        (MID, NW, 15),
        (LOWER, N, 16),
        (LOWER, NW, 23),
    ],
)
def test_rose_index_examples(band, octant, index):
    assert rose_index(band, octant) == index


def test_rose_index_is_8_times_band_plus_octant_for_every_cell():
    indexes = [rose_index(band, octant) for band in range(3) for octant in range(8)]
    assert indexes == list(range(24))


@pytest.mark.parametrize(
    "elevation_ft, bands",
    [
        (5000, (LOWER,)),
        (7899, (LOWER,)),
        (7900, (MID, LOWER)),  # exactly 100 ft away counts as within 100 ft
        (7950, (MID, LOWER)),
        (8000, (MID, LOWER)),
        (8100, (MID, LOWER)),
        (8101, (MID,)),
        (8750, (MID,)),
        (9399, (MID,)),
        (9400, (UPPER, MID)),
        (9450, (UPPER, MID)),
        (9500, (UPPER, MID)),
        (9600, (UPPER, MID)),
        (9601, (UPPER,)),
        (11000, (UPPER,)),
    ],
)
def test_candidate_bands_near_boundaries(elevation_ft, bands):
    assert candidate_bands(elevation_ft) == bands


def rose_with(upper: int = 0, mid: int = 0, lower: int = 0, octant: int = NE) -> list[int]:
    """A rose with these raw values at one octant, and Extreme at every other octant."""
    rose = [10] * 24
    rose[8 * UPPER + octant] = upper
    rose[8 * MID + octant] = mid
    rose[8 * LOWER + octant] = lower
    return rose


@pytest.mark.parametrize(
    "elevation_ft, values, expected",
    [
        # Inside a tie zone, the higher rating applies.
        (9450, {"upper": 6, "mid": 4}, 6),
        (9500, {"upper": 6, "mid": 4}, 6),
        (9600, {"upper": 6, "mid": 4}, 6),
        (7950, {"mid": 6, "lower": 2}, 6),
        # It's the higher rating, not the higher ground.
        (8000, {"mid": 2, "lower": 4}, 4),
        (9450, {"upper": 2, "mid": 6}, 6),
        # Outside a tie zone, only the point's own band applies.
        (9601, {"upper": 4, "mid": 6}, 4),
        (9399, {"upper": 6, "mid": 4}, 4),
        (8101, {"mid": 2, "lower": 6}, 2),
        (7899, {"mid": 6, "lower": 2}, 2),
        # "Pockets of" values rank between full ratings.
        (9500, {"upper": 5, "mid": 4}, 5),
        (9500, {"upper": 5, "mid": 6}, 6),
    ],
)
def test_rose_value_takes_higher_rating_in_tie_zones(elevation_ft, values, expected):
    assert rose_value(rose_with(**values), elevation_ft, NE) == expected


@pytest.mark.parametrize(
    "rated_value",
    [
        1,  # pockets of Low
        2,  # Low
        3,  # pockets of Moderate
        4,  # Moderate
    ],
)
def test_tie_between_unrated_and_low_or_moderate_is_unrated(rated_value):
    assert rose_value(rose_with(upper=0, mid=rated_value), 9500, NE) == 0
    assert rose_value(rose_with(upper=rated_value, mid=0), 9500, NE) == 0
    assert rose_value(rose_with(mid=0, lower=rated_value), 8000, NE) == 0
    assert rose_value(rose_with(mid=rated_value, lower=0), 8000, NE) == 0


@pytest.mark.parametrize(
    "rated_value",
    [
        5,  # pockets of Considerable
        6,  # Considerable
        8,  # High
        10,  # Extreme
    ],
)
def test_tie_between_unrated_and_considerable_or_higher_uses_the_rated_band(rated_value):
    assert rose_value(rose_with(upper=0, mid=rated_value), 9500, NE) == rated_value
    assert rose_value(rose_with(upper=rated_value, mid=0), 9500, NE) == rated_value
    assert rose_value(rose_with(mid=0, lower=rated_value), 8000, NE) == rated_value
    assert rose_value(rose_with(mid=rated_value, lower=0), 8000, NE) == rated_value


def test_tie_between_two_unrated_bands_is_unrated():
    assert rose_value(rose_with(upper=0, mid=0), 9500, NE) == 0


@pytest.mark.parametrize(
    "elevation_ft, values, expected",
    [
        # Own band rated, the unrated neighbor is out of reach.
        (9601, {"upper": 4, "mid": 0}, 4),
        (8101, {"mid": 2, "lower": 0}, 2),
        # Own band unrated, the rated neighbor is out of reach.
        (9601, {"upper": 0, "mid": 6}, 0),
        (7899, {"mid": 6, "lower": 0}, 0),
    ],
)
def test_unrated_neighbor_is_ignored_outside_tie_zones(elevation_ft, values, expected):
    assert rose_value(rose_with(**values), elevation_ft, NE) == expected


@pytest.mark.parametrize(
    "threshold, lowest_avoided",
    [
        ("considerable", 5),  # pockets of Considerable
        ("moderate", 3),  # pockets of Moderate
        ("low", 1),  # pockets of Low
    ],
)
@pytest.mark.parametrize("value", range(1, 11))
def test_reroute_avoids_ratings_at_or_above_the_threshold(value, threshold, lowest_avoided):
    assert is_reroute_target(value, threshold) == (value >= lowest_avoided)


@pytest.mark.parametrize("threshold", ["considerable", "moderate", "low"])
def test_reroute_always_avoids_unrated_terrain(threshold):
    assert is_reroute_target(0, threshold) is True


@pytest.mark.parametrize("threshold", ["considerable", "moderate", "low"])
@pytest.mark.parametrize("value", range(0, 11))
def test_reroute_targets_agree_with_the_contract(value, threshold):
    # /analyze responses are validated against FLAGGED_DANGERS, so scoring must match it.
    danger = DANGER_BY_LEVEL[math.ceil(value / 2)]
    assert is_reroute_target(value, threshold) == (danger in FLAGGED_DANGERS[threshold])
