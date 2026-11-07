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
