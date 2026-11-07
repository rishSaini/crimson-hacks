# Nearby ski route suggestions

The terrain branch adds `POST /suggestions` for selecting existing mapped ski sections near a drawn line.
The API returns the source geometry, terrain analysis, source links, and comparison values.

## Request

Send an `AnalyzeRequest` with these additional fields.

| Field | Meaning |
| --- | --- |
| `max_difficulty` | Highest accepted OpenStreetMap piste grade. Values are `novice`, `easy`, `intermediate`, `advanced`, `expert`, or `extreme`. |
| `max_distance_m` | Maximum total section length in meters. |
| `max_climb_ft` | Maximum accumulated climb in feet. |
| `corridor_width_m` | Maximum separation between the drawing and suggested section. Default is 400 m. |
| `endpoint_tolerance_m` | Maximum gap at each endpoint. Default is 200 m. |
| `limit` | Maximum results. Default is three. |

`avoid_at_or_above` applies to the drawing and every candidate.
The grade is the user's declared comfort limit. The API does not infer skiing ability.

Start the API from the repository root.

```sh
cd api
../.venv/bin/uvicorn app.main:app --port 8000
```

Then run this command from the repository root.

```sh
curl -s http://localhost:8000/suggestions \
  -H 'Content-Type: application/json' \
  --data-binary @fixtures/suggestions.request.json
```

## Selection rules

1. Exclude unknown operating status, unknown difficulty, and grades above the selected limit.
2. Require both endpoints to remain within the selected endpoint tolerance.
3. Require both complete lines to fit within each other's corridor.
4. Check candidate terrain using the same forecast and exposure setting as the drawing.
5. Exclude candidates above the distance or climb limits, or with any flagged exposure.
6. Rank remaining sections by maximum path deviation, endpoint gaps, added distance, and added climb.

The geometry keeps its recorded direction unless the source explicitly marks it as bidirectional.
The API shows endpoint gaps separately. It does not draw connecting paths across those gaps.
A `no_match` response includes exclusion counts and preserves the selected limits.

## Team integration

Ali can draw `suggestions[].route` and display its name, grade, endpoint gaps, comparison, and `limitations`.
The `analysis` field contains the colored segments for each suggestion.
Show the forecast `source` and catalog attribution beside the result.
Show `route_scope` so users can see that a result represents a mapped section.
Rishabh can call `suggest_routes` with the same forecast object used for the requested date.
The `/alternative` endpoint still returns its existing fixture. The UI must call `/suggestions` for this feature.

## Dataset coverage and limits

The committed catalog contains 20 ski touring sections inside the DEM bounds.
Two sections have no difficulty grade. The selector excludes those sections.
Some sections belong to resort terrain, and the catalog does not establish a complete backcountry itinerary.
OpenSkiData explains that one named run can contain several features. [Dataset documentation](https://www.openskidata.org/)

The original demo drawing currently returns `no_match` with the forecast fixture.
A 59 m White Pine Winter Trail section passes the current checks when used as the input drawing.
This confirms the real catalog path through the API. It provides limited evidence for complete tour recommendations.

The forecast remains `source: fixture` until the forecast owner connects published forecasts.
The overhead check follows the team's rule for higher steep cells within 300 m that face the route.
It does not model avalanche flow or runout.
Access, current closures, obstacles, snow coverage, and route completeness require separate confirmation.
The analysis keeps every flagged run, and `flagged_stretches` merges runs under 50 m apart for the banner and pins.

## Rebuild the catalog

Download the GeoJSON export at most once per day, as required by the source.
The export is large. Keep the downloaded file outside the repository.

```sh
curl -fL --compressed https://tiles.openskimap.org/geojson/runs.geojson -o /tmp/runs.geojson
.venv/bin/python data/prep_routes.py /tmp/runs.geojson
```

The extractor keeps `skitour` features whose full geometry lies within the DEM bounding box.
It preserves source IDs, difficulty, operating status, and direction tags.
It records missing grades as `null` and labels every feature as `mapped_section`.

## Attribution and license

Data from OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL), Skimap.org, Who's On First, © Mapterhorn.

The derived catalog uses ODbL-1.0. Preserve its attribution and comply with the database sharing requirements.
[OpenSkiData licensing](https://www.openskidata.org/#license) · [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/)
