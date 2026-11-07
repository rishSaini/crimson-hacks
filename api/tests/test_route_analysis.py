"""Rating and overhead rules in route analysis, on synthetic terrain."""

import numpy as np
import pytest
from affine import Affine

from app.route_analysis import TerrainGrids

# The sample point falls in the center of cell (100, 100), which is 2,700 m high.
POINT = (431005, 4498995)
UPPER_OR_MID_ONLY = 2700.0
NORTH_FACE, SOUTH_FACE = 0.0, 180.0
HIGH, CONSIDERABLE, MODERATE, UNRATED = 8, 6, 4, 0


def flat_grids() -> TerrainGrids:
    elevation = np.full((201, 201), UPPER_OR_MID_ONLY)
    return TerrainGrids(
        Affine(10, 0, 430000, 0, -10, 4500000), elevation,
        np.zeros_like(elevation), np.zeros_like(elevation),
    )


def rose(north: int = HIGH, south: int = MODERATE) -> list[int]:
    """North-half aspects get one value, and south-half aspects the other."""
    return [south if index % 8 in (3, 4, 5) else north for index in range(24)]


def steep_cell(grids: TerrainGrids, row: int, col: int, slope: float, aspect: float) -> None:
    grids.slope[row, col] = slope
    grids.aspect[row, col] = aspect


def test_ridge_point_takes_the_worst_rating_among_steep_cells():
    # The steepest cell faces south and is Moderate. The steep north face next to it is High.
    grids = flat_grids()
    steep_cell(grids, 100, 100, 31, NORTH_FACE)
    steep_cell(grids, 101, 100, 33, SOUTH_FACE)
    sample = grids.sample(*POINT, rose(), "considerable")
    assert sample.slope == 33
    assert sample.level == 4
    assert sample.octant == 0


def test_neighbor_under_30_degrees_does_not_rate_the_point():
    grids = flat_grids()
    steep_cell(grids, 100, 100, 28, NORTH_FACE)
    steep_cell(grids, 101, 100, 33, SOUTH_FACE)
    assert grids.sample(*POINT, rose(), "considerable").level == 2


def test_single_steep_cell_uses_its_own_rating():
    grids = flat_grids()
    steep_cell(grids, 100, 100, 35, SOUTH_FACE)
    assert grids.sample(*POINT, rose(), "considerable").level == 2


@pytest.mark.parametrize(
    "north, south, level",
    [
        (UNRATED, MODERATE, 0),  # unrated beats Low and Moderate, so it stays flagged
        (UNRATED, CONSIDERABLE, 3),  # Considerable or higher still supplies the rating
        (UNRATED, UNRATED, 0),
    ],
)
def test_window_with_an_unrated_cell_follows_the_tie_rule(north, south, level):
    grids = flat_grids()
    steep_cell(grids, 100, 100, 31, NORTH_FACE)
    steep_cell(grids, 101, 100, 33, SOUTH_FACE)
    assert grids.sample(*POINT, rose(north, south), "considerable").level == level


def test_missing_aspect_on_a_steep_neighbor_stops_the_analysis():
    grids = flat_grids()
    steep_cell(grids, 100, 100, 35, NORTH_FACE)
    steep_cell(grids, 101, 100, 31, np.nan)
    with pytest.raises(ValueError):
        grids.sample(*POINT, rose(), "considerable")


def overhead_cell(row=95, col=100, aspect=SOUTH_FACE, rise=20.0, slope=35.0) -> TerrainGrids:
    """One steep cell near the sample point. Row 95 is 50 m due north of it, and uphill."""
    grids = flat_grids()
    grids.elevation[row, col] += rise
    steep_cell(grids, row, col, slope, aspect)
    return grids


def overhead_flag(grids: TerrainGrids, value: int = HIGH, threshold: str = "considerable") -> bool:
    sample = grids.sample(*POINT, [value] * 24, threshold)
    assert sample.level is None
    return sample.overhead_level is not None


def test_slope_above_the_route_and_facing_it_flags():
    assert overhead_flag(overhead_cell(aspect=SOUTH_FACE))


def test_slope_below_the_route_does_not_flag():
    assert not overhead_flag(overhead_cell(aspect=SOUTH_FACE, rise=-20.0))


def test_slope_at_the_same_height_as_the_route_does_not_flag():
    assert not overhead_flag(overhead_cell(aspect=SOUTH_FACE, rise=0.0))


def test_slope_above_the_route_but_facing_away_does_not_flag():
    assert not overhead_flag(overhead_cell(aspect=NORTH_FACE))


@pytest.mark.parametrize(
    "aspect, flagged",
    [(120, True), (119, False), (240, True), (241, False), (150, True), (210, True)],
)
def test_slope_must_face_within_60_degrees_of_the_route(aspect, flagged):
    # The point is due south of the cell, so the bearing from the cell to it is 180 degrees.
    assert overhead_flag(overhead_cell(aspect=aspect)) is flagged


@pytest.mark.parametrize(
    "row, col, aspect",
    [
        (100, 95, 90),  # cell to the west, faces east
        (100, 105, 270),  # cell to the east, faces west
        (105, 100, 0),  # cell to the south, faces north
        (95, 95, 135),  # cell to the northwest, faces southeast
    ],
)
def test_facing_works_from_every_direction(row, col, aspect):
    assert overhead_flag(overhead_cell(row, col, aspect))
    assert not overhead_flag(overhead_cell(row, col, (aspect + 180) % 360))


def test_facing_wraps_around_north():
    # The cell is due south of the point, so the bearing from it to the point is 0 degrees.
    assert overhead_flag(overhead_cell(105, 100, 350))
    assert overhead_flag(overhead_cell(105, 100, 50))
    assert not overhead_flag(overhead_cell(105, 100, 70))


@pytest.mark.parametrize("row, flagged", [(70, True), (69, False)])
def test_distance_limit_stays_300_m(row, flagged):
    # Row 70 is exactly 300 m from the point, and row 69 is 310 m.
    assert overhead_flag(overhead_cell(row=row)) is flagged


def test_slope_under_30_degrees_does_not_flag():
    assert not overhead_flag(overhead_cell(slope=29.0))


@pytest.mark.parametrize(
    "value, threshold, flagged",
    [
        (MODERATE, "considerable", False),
        (MODERATE, "moderate", True),
        (2, "moderate", False),
        (2, "low", True),
        (UNRATED, "considerable", True),
    ],
)
def test_facing_slope_still_follows_the_setting(value, threshold, flagged):
    assert overhead_flag(overhead_cell(), value, threshold) is flagged


def test_missing_aspect_on_a_higher_steep_slope_stops_the_analysis():
    grids = overhead_cell(aspect=np.nan)
    with pytest.raises(ValueError):
        grids.sample(*POINT, [HIGH] * 24, "considerable")
