# RedRun

Avalanche-aware route checker for backcountry tours in the Wasatch, built at a hackathon. You draw a tour on a 3D map, and RedRun shows which stretches cross terrain rated dangerous by the Utah Avalanche Center (UAC) forecast, then offers a lower-exposure line.

RedRun does not predict avalanches. It computes terrain (slope, aspect, elevation) from a 10 m USGS DEM and looks up the danger rating UAC publishes for that aspect and elevation band. It never re-derives or adjusts the forecast.

Target user: a Salt Lake skier or splitboarder new to touring in Big Cottonwood, Little Cottonwood or Millcreek.

## Safety language (hard rule)

**The UI never calls a route, segment or slope "safe".** This covers RedRun's own UI copy, fixtures, LLM output and pitch material. The models and tests reject "safe", "safer", "safest" and "safely" in these.

**The one exception is UAC's own text.** `bottom_line`, `comparison_advice`, `problems` and `alert` hold it verbatim, including words like "safer". Never trim or reword it, and always show it in a block attributed to UAC with a link to the full forecast. LLM output still can't use the word, even when quoting UAC.

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

A point's slope is the steepest cell in its 3 by 3 window, and its rating is the worst among the 30 degree or steeper cells in that window, so a point on a ridge can't take the milder side's rating. Unrated follows the same rule as band ties.

Overhead exposure: a gray point is flagged by a cell within 300 m that is 30 degrees or steeper, rated at or above `avoid_at_or_above` or unrated, higher than the point, and facing it: the bearing from the cell to the point is within 60 degrees of the cell's aspect. More "no clean line" results at `low` are expected, and the fallback options handle them.

Every flagged run stays in `segments`, however short. For the banner and pins, runs less than 50 m apart along the route merge into one entry in `flagged_stretches`, and `flagged_stretch_count` counts those.

What the route shows depends on these totals:

| Route | Banner | Button |
| --- | --- | --- |
| `flagged_stretch_count` above 0 | Flagged stretches | Primary filled "Reroute" |
| Nothing flagged, `steep_segment_count` above 0 | "N stretches in avalanche terrain, rated Low today (X m), with N from `steep_stretch_count`. Not rerouted by default." The rating names what's in `steep_ratings`: "Low", "Moderate" or "Low to Moderate" | Secondary outline "Avoid these too", which reruns the analysis and reroute at the lowest rating present (`steep_ratings[0]`) |
| Both 0 | Gray "No flags found on this route today." | None |

The primary Reroute button shows if and only if `flagged_stretch_count` is above 0.

"Avoid these too" applies to the current route only and never changes the saved setting. After that reroute, the comparison card shows a text link, "Make this my default", which updates the saved setting only when tapped.

### Alerts

`ForecastResponse.alert` has a `level` (`none`, `watch`, `warning` or `special_bulletin`) and `what`, `where`, `impacts`, `what_to_do`, `valid_from` and `valid_to`. Special bulletins have no "What to do" section, so `what_to_do` can be null there, and we never write one for UAC. Any level but `none` shows as a full-width banner above everything.

On a forecast day with a `warning`:

- The server forces `avoid_at_or_above` to `low` for that forecast day only, using `effective_avoid_at_or_above`, and returns `forced_by_warning: true`. The saved setting never changes.
- The banner explains why everything steep is flagged.
- The comparison card adds: "UAC recommends avoiding all avalanche terrain today."
- Nothing may imply that a rerouted line makes going out okay.

A forecast day can also set `comparison_advice`, UAC's own words quoted from its bottom line. The comparison card shows it, attributed to UAC, on any day that has it. Feb 21, 2026 uses this: it isn't a Warning, so nothing is forced, but UAC still says to stay off and out from under slopes steeper than 30 degrees.

If `ratings_issued` is false (all 24 rose values are 0), show the banner "No danger ratings issued today. Steep terrain is shown as unrated."

A rerouted-away original line is always dashed **gray**, whatever its colors were, so it can't be confused with dashed magenta.

## Plan mode

Plan, flag and reroute are three separate steps:

1. **Plan:** `POST /plan` takes `start`, `end`, `date` and `avoid_at_or_above`, and finds a sensible line from terrain alone. The forecast never changes the line. The search covers the points' bounding box plus 1.5 km.
2. **Flag:** the line goes through route analysis, and the response carries that result, flags included. `status` is `found` even if flagged. `no_route` only means slopes of 45 degrees or more block every way through.
3. **Reroute:** only this step avoids flagged terrain. Pass `avoid=(rose, threshold)` to `build_cost_grid`, which makes flagged terrain near-blocking. If no clean line exists, the reroute says "no clean line" and offers fallbacks, and never loosens a threshold.

Terrain cost per cell is 1, plus a skinning penalty per degree above 25, a penalty at 30 degrees or more and for OSM `landuse=winter_sports` areas, and a bonus on OSM paths. Cells at 45 degrees or more are blocked. A plan must always say it's a computer-generated line, not a known skin track.

OSM data comes from `data/prep_osm.py`, fetched once and committed in `data/osm/`. Keep its ODbL attribution.

## Route assistant

`POST /agent` takes a plain-language `prompt`, `date` and `avoid_at_or_above`. The code is in `api/app/route_agent.py`, and the tours in `api/app/tours.json`.

- The server plans and flags every library tour first, then makes one model call. The model reads the request into `constraints` and shortlists tour ids with a sentence each. It never outputs coordinates.
- The server decides everything else. Flagged terrain is always a miss, so a tour only counts as a match with no flags. Cards rank by the named canyon, then other stated limits met, then flagged meters, and the top-ranked tour always gets a card, so a shortlist can't hide it.
- Each sentence is checked for banned words, verdicts and numbers that aren't in the tour's facts or the user's request. If it fails, the card uses a RedRun template. `reason_source` says which.
- Every tour point is a vertex of a named OSM way, so don't add one from memory. A test enforces this.
- Millcreek's trailheads are outside the DEM, so the library has no Millcreek tours and the response says so.

## Conventions

- Positions are GeoJSON `[lng, lat]`. Distances are meters; elevation and climb are feet; the DEM is in meters, so convert.
- The analysis uses only the 3DEP grids. Mapbox terrain is for display.
- The server holds only the grids and forecast cache, so a restart costs nothing.
- UAC's forecast JSON needs an API token (`UAC_API_TOKEN`). Cache requests for 15 minutes and send a real User-Agent with a contact email.
- Avalanche.org only has one overall rating per zone. Never apply it to every aspect as a stand-in for the rose.
- Fixtures are made up and marked `source: fixture`. Real demo days go in `fixtures/demo_days.json`, copied from a published forecast.
- Secrets go in `.env` files, which are ignored by git. The DEM grids are committed.
- Model for the LLM features: OpenAI `gpt-6.1-sol`, through the Responses API. The key is `OPENAI_API_KEY`.
