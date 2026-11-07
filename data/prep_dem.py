"""Offline terrain prep. Run once, then commit the output in data/grids/.

Not implemented yet: see tasks/terrain.md for the steps.
"""

# Roughly the Cottonwoods. Widen west or north if Millcreek is added.
BBOX_WGS84 = (-111.80, 40.53, -111.55, 40.66)  # west, south, east, north
RESOLUTION_M = 10
TARGET_CRS = "EPSG:32612"  # UTM zone 12N, so cells are square meters


def main() -> None:
    raise NotImplementedError("DEM prep is not built yet: see tasks/terrain.md")


if __name__ == "__main__":
    main()
