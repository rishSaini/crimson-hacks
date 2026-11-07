# RedRun

Avalanche-aware route checker for backcountry tours in the Wasatch, built at a hackathon. You draw a tour on a 3D map, and RedRun shows which stretches cross terrain rated dangerous by the Utah Avalanche Center (UAC) forecast, then offers a lower-exposure line.

RedRun does not predict avalanches. It computes terrain (slope, aspect, elevation) from a 10 m USGS DEM and looks up the danger rating UAC publishes for that aspect and elevation band. It never re-derives or adjusts the forecast.

Target user: a Salt Lake skier or splitboarder new to touring in Big Cottonwood, Little Cottonwood or Millcreek.

## Safety language (hard rule)

**The UI never calls a route, segment or slope "safe".** This covers UI copy, fixtures, LLM output and pitch material.

- Under 30 degrees is "no avalanche-terrain flag", never "safe" or "clear".
- A reroute "avoids terrain flagged by today's forecast", never "has no avalanche risk".
- No go/no-go verdicts. RedRun is a planning and learning aid, and it shows its data.
- LLM text only uses the forecast and computed segments, and is validated before display.
- The LLM never outputs coordinates, and every number on screen comes from a tool result.
- Never loosen thresholds silently to make a route look clean.
- Show `source` in the UI, so fixture or replayed data can't pass for today's forecast.

## Run

Needs Node 20.9+ and Python 3.11+. Tested on Node 26 and Python 3.12.

```sh
# First time, from the repo root
python3.12 -m venv .venv
.venv/bin/pip install -r api/requirements-dev.txt -r data/requirements.txt
cp web/.env.example web/.env.local   # then add a Mapbox token
(cd web && npm install)

# API on http://localhost:8000 (docs at /docs)
cd api && ../.venv/bin/uvicorn app.main:app --reload --port 8000

# Web on http://localhost:3000
cd web && npm run dev

# Tests
cd api && ../.venv/bin/pytest                 # test_terrain.py fails until terrain is built
cd web && npm run lint && npm run build

# Regenerate web/lib/api-types.ts after changing models (API must be running)
cd web && npm run gen:types
```

## Layout and ownership

Stay inside your folders. Ask the owner before changing theirs.

| Path | Owner | Task list |
| --- | --- | --- |
| `web/` | Ali (Map and UI) | `tasks/ali.md`, `tasks/map-ui.md` |
| `data/`, terrain modules in `api/app/` | Karthik (Terrain engine) | `tasks/karthik.md`, `tasks/terrain.md` |
| Forecast, briefing and agent modules in `api/app/`, `fixtures/demo_days.json` | Rishabh (Forecast and AI, pitch) | `tasks/rishabh.md`, `tasks/forecast-ai.md` |
| `api/app/models.py`, `api/app/main.py`, `fixtures/`, `web/lib/api-types.ts` | Shared contract | Tell the team first |

To change the contract, update `models.py` and the fixtures together, run the tests, regenerate `api-types.ts`, and commit all of it at once. Each owner replaces a stub in `main.py` by calling their own module, and leaves the other routes alone.

## Core logic

Rose lookup: `index = 8 * band + octant`, with band 0 upper, 1 mid, 2 lower, and octant 0 N clockwise to 7 NW. Raw values run 0 to 10, and `level = ceil(value / 2)`: 1 Low, 2 Moderate, 3 Considerable, 4 High, 5 Extreme. Odd values mean "pockets of" that level, and 0 means no rating.

Elevation bands: lower below 8,000 ft, mid 8,000 to 9,500 ft, upper above 9,500 ft. **Band ties:** a point within 100 ft of 8,000 or 9,500 ft, inclusive (so 9,600 ft is in the zone), uses the higher rating of the two adjacent bands. If one of those bands is unrated, a Low or Moderate neighbor makes the point unrated and flagged, while a Considerable or higher neighbor (raw value 5 and up) supplies the rating. Every rating lookup goes through `rose_value`, including the cost grid and overhead exposure.

| Slope | Forecast danger | `color` | Drawn as | `flagged` |
| --- | --- | --- | --- | --- |
| Under 30 degrees | Any | `gray` | Thin gray | Only if overhead-exposed |
| 30 degrees or more | No rating | `unrated` | Dashed magenta, "?" pin | Yes |
| 30 degrees or more | Low | `green` | Green | Only at `low` |
| 30 degrees or more | Moderate | `yellow` | Yellow | At `moderate` or `low` |
| 30 degrees or more | Considerable | `orange` | Orange | Yes |
| 30 degrees or more | High | `red` | Red | Yes |
| 30 degrees or more | Extreme | `black` | Black, white edge | Yes |

There are two levels:

- **Listed:** every segment of 30 degrees or more appears in the summary with its rating, Moderate and Low included.
- **Flagged:** reroute targets under the user's `avoid_at_or_above` setting: `considerable` (default), `moderate` or `low`. These are 30 degree or steeper segments at or above that rating, unrated 30 degrees or more at every setting, and overhead exposure. `flagged` drives the banner, the Reroute button and the flagged-meter counts.

`flagged` is computed server-side, and the UI never works it out itself. The UI sends the setting with every `POST /analyze` and `POST /alternative` call.

Settings exposes `moderate` as "Also avoid Moderate" and `low` as "Beginner mode: stay off and out from under slopes 30° and steeper", with the subtitle "Checks slopes on your route and within 300 m uphill."

Overhead exposure: a gray point is flagged if uphill cells within 300 m are 30 degrees or steeper and rated at or above `avoid_at_or_above`, or unrated. More "no clean line" results at `low` are expected, and the fallback options handle them.

What the route shows depends on these totals:

| Route | Banner | Button |
| --- | --- | --- |
| `flagged_stretch_count` above 0 | Flagged stretches | Primary filled "Reroute" |
| Nothing flagged, `steep_segment_count` above 0 | "N stretches in avalanche terrain, rated Low today (X m). Not rerouted by default." The rating names what's in `steep_ratings`: "Low", "Moderate" or "Low to Moderate" | Secondary outline "Avoid these too", which reruns the analysis and reroute at the lowest rating present (`steep_ratings[0]`) |
| Both 0 | Gray "No flags found on this route today." | None |

The primary Reroute button shows if and only if `flagged_stretch_count` is above 0.

"Avoid these too" applies to the current route only and never changes the saved setting. After that reroute, the comparison card shows a text link, "Make this my default", which updates the saved setting only when tapped.

If `ratings_issued` is false (all 24 rose values are 0), show the banner "No danger ratings issued today. Steep terrain is shown as unrated."

A rerouted-away original line is always dashed **gray**, whatever its colors were, so it can't be confused with dashed magenta.

## Conventions

- Positions are GeoJSON `[lng, lat]`. Distances are meters; elevation and climb are feet; the DEM is in meters, so convert.
- The analysis uses only the 3DEP grids. Mapbox terrain is for display.
- The server holds only the grids and forecast cache, so a restart costs nothing.
- Cache UAC requests for 15 minutes and send a real User-Agent with a contact email.
- Fixtures are made up and marked `source: fixture`. Real demo days go in `fixtures/demo_days.json`, copied from a published forecast.
- Secrets go in `.env` files, which are ignored by git. The DEM grids are committed.
- Model for the LLM features: `claude-sonnet-5-5`.
