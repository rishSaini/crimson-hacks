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
- **`POST /analyze` takes `avoid_at_or_above`** (same enum, default `considerable`), and `flagged` is computed server-side from that setting. The models, fixtures and tests already reflect this, but the stub ignores the setting. Your real `/analyze` has to apply it and echo it back. The response model rejects flags that don't match the setting.
