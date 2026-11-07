# Terrain engine

Owns `data/` and the terrain modules in `api/app/`. Turn `api/tests/test_terrain.py` green first.

## Hour 0 to 1: de-risk (gate: DEM working by hour 1)

- [ ] Pull a 10 m DEM for lat 40.53 to 40.66, lon -111.80 to -111.55 with `py3dep` in `data/prep_dem.py`
- [ ] Reproject to UTM 12N (EPSG:32612) and save as a GeoTIFF in `data/grids/`
- [ ] Install GDAL for `gdaldem` (it isn't in `requirements.txt`)

## Hour 1 to 6: core loop

- [ ] Compute slope and aspect grids with the Horn method, save as GeoTIFFs, and commit them
- [ ] Implement `app/terrain.py` until `test_terrain.py` passes
- [ ] Load the grids into memory at server start
- [ ] Densify the route to one point every 15 m and convert lat/lon to UTM with `shapely` and `pyproj`
- [ ] Read elevation, slope and aspect per point, using the max slope in a 3 by 3 cell window
- [ ] Rate each point with `rose_value`, so points within 100 ft of a band boundary take the higher adjacent rating
- [ ] Score each point by the table in `CLAUDE.md`, with `flagged` from `is_reroute_target` and the request's `avoid_at_or_above`. Unrated 30 degrees or more is always flagged, with `flag_reason: unrated_terrain`
- [x] Merge same-color points into segments and compute totals. Keep every flagged run, and merge runs under 50 m apart into `flagged_stretches` for the banner and pins
- [ ] Replace the `POST /analyze` stub, with `source` taken from the forecast it used
- [ ] Apply `effective_avoid_at_or_above` from `app/forecast.py` to the request's setting and that day's `alert.level`, then return the applied value and `forced_by_warning`. Do the same in `POST /alternative`
- [ ] Spot-check 3 known slopes against a published slope-angle map (hour 2)

## Hour 6 to 12: demo features

- [ ] Slope-shading PNG: `gdaldem slope`, reproject to EPSG:4326, `gdaldem color-relief` with steps at 27, 30, 35, 45 degrees
- [ ] Hand the PNG and its corner coordinates to Map and UI

## Hour 12 to 18: stretch, in this order

- [x] Overhead exposure: for each gray point, flag it if a cell within 300 m is 30 degrees or steeper, higher than the point, facing it (bearing from the cell to the point within 60 degrees of its aspect), and `is_reroute_target` is true for it under `avoid_at_or_above`. Unrated always counts. Expect more "no clean line" results at `low`, and let the fallbacks handle them
- [ ] Reroute, starting no later than hour 12. Replace the `POST /alternative` stub:
  - [ ] Take anchors about 100 m outside each flagged stretch and keep the rest of the line
  - [ ] Fence a corridor: buffer the stretch by `corridor_width_m`, off-limits outside it
  - [ ] Cost grid, rated with `rose_value`: 1 per cell, near-blocking for 30 degrees or more at Considerable or higher or unrated and for overhead-exposed cells, heavy for steep Low or Moderate cells, small penalty per degree above 25
  - [ ] `avoid_at_or_above`: use `is_reroute_target` so steep cells at or above the threshold become near-blocking and their stretches become reroute targets, and the comparison counts them. Unrated is always a target
  - [ ] Reuse `build_cost_grid(..., avoid=(rose, threshold))`, `least_cost_line` and `highest_clean_point` from `app/route_search.py`, with your corridor fenced off. They're tested but nothing calls them with `avoid` yet. Simplify at about 10 m, and fall back to the raw line if smoothing crosses a flag
  - [ ] Run the result back through analysis and only return it if flagged meters dropped
  - [ ] Comparison: added distance, added climb, Hausdorff deviation, flagged meters before and after
  - [ ] No clean line: say so, and return the fallbacks. Never loosen thresholds silently
  - [ ] Fallbacks: widen to 800 m then 1.5 km, turnaround point, least-exposure line
- [ ] Least-cost generated routes from a named trailhead to a named objective, for the agent

## Hour 18 to 22: polish and proof

- [ ] Deploy the backend to Railway or Render with `fixtures/` and `data/grids/` included, and set `CORS_ORIGINS`
- [ ] Confirm a server restart costs nothing on stage

## Last 2 hours: freeze

- [ ] Code freeze: only fix crashes
