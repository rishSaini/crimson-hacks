# Karthik: Terrain engine

You own `data/` and the terrain modules in `api/app/`. Your full checklist is [terrain.md](terrain.md).

Nothing is built yet. The API returns made-up fixture data, and the terrain functions in `api/app/terrain.py` raise `NotImplementedError`.

## Start here

1. Follow the setup under "Run" in [CLAUDE.md](../CLAUDE.md). You need Python 3.11+.
2. Pull the 10 m DEM in `data/prep_dem.py` and save it as a GeoTIFF. **This must work by hour 1.**
3. Run `cd api && ../.venv/bin/pytest tests/test_terrain.py`. All of them fail for now.
4. Implement `api/app/terrain.py` until they pass. They set the rules for aspect direction, rose index, band ties, and which ratings a reroute avoids.
5. Compute the slope and aspect grids, then replace the `POST /analyze` stub.

Read "Core logic" in `CLAUDE.md` first. Some of its rules are stricter than the design doc:

- Every rating lookup goes through `rose_value`, including the cost grid and overhead exposure.
- Unrated slopes of 30 degrees or more count as flagged, and as overhead exposure when they're above the route.

## What others need from you

| For | What | When |
| --- | --- | --- |
| Ali | Real `POST /analyze` results | Hour 6 |
| Ali | Slope-shading PNG and its corner coordinates | Hour 12 |
| Rishabh | Terrain functions the agent's tools can call | Hour 12 |

## What you need from others

- **Rishabh:** the forecast rose, through `GET /forecast` or `fixtures/demo_days.json`. Use `fixtures/forecast.response.json` until then.

## Also yours

- Spot-check 3 slopes you know against a published slope-angle map in hour 2.
- Start the reroute no later than hour 12. It's the demo's closing moment.
- Share the hand-traced tour library with Rishabh.
- Deploy the backend to Railway or Render.

## Rulings from Rishabh

- **Overhead exposure follows `avoid_at_or_above`,** and unrated always counts. More "no clean line" results in `low` mode are expected, and the fallback options handle them, so don't loosen anything to avoid them.
- **`POST /analyze` takes `avoid_at_or_above`** (same enum, default `considerable`), and `flagged` is computed server-side from that setting. Your `/analyze` applies it and echoes it back, and the response model rejects flags that don't match the setting.
- **An Avalanche Warning forces `low` for that forecast day.** `/analyze` and `/suggestions` now do this through `effective_avoid_at_or_above` in `app/forecast.py`. `/alternative` still needs it when you build the reroute. Ali's UI never works this out.

## Follow-ups from the review of your first terrain pass

These are from merging `karthik/nearby-route-suggestions`, and Rishabh has the rulings on the first three.

- **Ridgeline under-rating:** `sample` rates only the aspect of the steepest cell in the 3 by 3 window. A point on a 31 degree High-rated north face next to a 33 degree Moderate-rated south face comes out Moderate and unflagged. On Feb 18's rose, about 6% of steep points rate below their worst steep neighbor, and about 3% would lose a flag at the default setting.
- **Short runs:** flagged runs under 30 m are kept. The demo route splits into 27 segments and 18 flagged stretches, 10 of them under 30 m, so the banner count is noisy.
- **Overhead reach:** any higher steep cell within 300 m counts, in any direction. That flags 1,916 m of the 2,227 m demo route by default, and all of it on Feb 18, so a reroute may have little room.
- **Startup:** `load_grids` runs on the first request, not at server start. Load it at startup so the first request on stage isn't the slow one.
- **Gray segments:** unflagged gray segments return `danger: no_rating`, which reads like unrated terrain. Return the forecast's rating there, or make sure the UI never shows it.
- **Spot check:** still compare 3 known slopes against a published slope-angle map.

