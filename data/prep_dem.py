"""Download USGS 3DEP elevation and prepare aligned terrain grids."""

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import py3dep
import rasterio
from rasterio.enums import Resampling

# Use the same Horn implementation as the API.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))
from app.terrain import compute_slope_and_aspect

# Roughly the Cottonwoods. Widen west or north if Millcreek is added.
BBOX_WGS84 = (-111.80, 40.53, -111.55, 40.66)  # west, south, east, north
RESOLUTION_M = 10
TARGET_CRS = "EPSG:32612"  # UTM zone 12N, so cells are square meters
GRID_DIR = Path(__file__).resolve().parent / "grids"


def main() -> None:
    source = py3dep.get_dem(BBOX_WGS84, RESOLUTION_M)
    dem = source.rio.reproject(
        TARGET_CRS, resolution=RESOLUTION_M, resampling=Resampling.bilinear, nodata=np.nan
    )
    elevation = dem.values
    if elevation.ndim != 2 or not np.isfinite(elevation).any():
        raise ValueError("3DEP returned no usable elevation grid")
    slope, aspect = compute_slope_and_aspect(elevation, RESOLUTION_M)

    GRID_DIR.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=GRID_DIR) as temp:
        for name, grid in (("dem", elevation), ("slope", slope), ("aspect", aspect)):
            with rasterio.open(
                Path(temp) / f"{name}.tif", "w", driver="GTiff",
                height=dem.rio.height, width=dem.rio.width, count=1,
                dtype="float32", crs=dem.rio.crs, transform=dem.rio.transform(),
                nodata=np.nan, compress="deflate", predictor=3,
            ) as output:
                output.write(grid.astype("float32"), 1)
                output.update_tags(source="USGS 3DEP 1/3 arc-second DEM")
        for path in Path(temp).iterdir():
            path.replace(GRID_DIR / path.name)


if __name__ == "__main__":
    main()
