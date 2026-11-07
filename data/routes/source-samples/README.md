# Little Cottonwood route source samples

These are raw source downloads for route coverage review. The suggestions API reads a separate catalog.

| File | Source | What the file contains |
| --- | --- | --- |
| `lake-peak-east-chute.gpx` | [Skitour topo 8619 by pierregr](https://skitour.fr/topos/8619) · [Original GPX](https://skitour.fr/downloadGPX/topos/8619) | Ski grade 3.3 E1. The GPX contains 28 points over 5.97 km and covers the outward leg. The longest interval between points is 454 m. |
| `lake-peak-north-couloir.gpx` | [Skitour topo 8618 by pierregr](https://skitour.fr/topos/8618) · [Original GPX](https://skitour.fr/downloadGPX/topos/8618) | Ski grade 4.2 E2. The GPX contains 3,205 points over 12.96 km. The endpoints are 106 m apart. The longest interval between points is 670 m. |
| `usfs-white-pine-trails.geojson` | [USDA Forest Service TrailNFS layer](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0) | Six line features for trail numbers 1002, 1003, and 1004. These represent White Pine, Red Pine, and Maybird Gulch. The selected records lack skiing grades and winter use attributes. |

Lengths and intervals use WGS84 geodesic distances between consecutive source points.
A long interval leaves uncertainty about the actual path between the two points.
Skitour documents a return along the same route for Lake Chute. The downloaded file ends near Lake Peak.
The north couloir file represents a near-loop with a large internal interval.
Both GPX files fall within the configured DEM bounding box.

The Forest Service geometry for White Pine is one connected line.
Red Pine has two connected components. Maybird Gulch is one line for its own trail number.
The USDA lines represent trail centerlines and need review against the corresponding winter itinerary.
The [UAC White Pine page](https://utahavalanchecenter.org/route/white-pine-white-pine-lake-route-rating) supplies an avalanche terrain rating.

## Source terms

Skitour lists collaborative guidebook content under CC BY-SA 4.0.
Credit pierregr and link to the source topo when reusing its guidebook data. [Skitour terms](https://skitour.fr/confidentialite#licence)
The GPX files contain no separate license field.

Credit the USDA Forest Service for the trail centerlines. [Forest Service dataset terms](https://data.fs.usda.gov/geodata/edw/)

## Forest Service query

The extract filters trail numbers within the configured DEM area. The service returns the full intersecting features.

```sh
curl -fsSLG 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query' \
  --data-urlencode "where=trail_no IN ('1002','1003','1004')" \
  --data-urlencode 'geometry=-111.80,40.53,-111.55,40.66' \
  --data-urlencode 'geometryType=esriGeometryEnvelope' \
  --data-urlencode 'inSR=4326' \
  --data-urlencode 'outSR=4326' \
  --data-urlencode 'outFields=trail_name,trail_no,trail_cn,bmp,emp,gis_miles,trail_type,xcountry_ski_managed,allowed_snow_use' \
  --data-urlencode 'f=geojson' -o usfs-white-pine-trails.geojson
```

## Map preview

Run `.venv/bin/python data/prep_route_previews.py` from the repository root.
This regenerates `previews.json` from the raw files.
The preview splits GPX lines at intervals over 100 m and shows isolated points as dots.
Forest Service line features retain their original endpoints.

With the web and API servers running, open `http://localhost:3000/preview`.
Select a source file to inspect it. Draw a separate sketch or load the demo to test suggestions.
