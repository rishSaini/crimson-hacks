# Ali: Map and UI

You own `web/`. Your full checklist is [map-ui.md](map-ui.md).

Nothing is built yet. The page shows a map placeholder and a temporary panel, `components/ApiCheck.tsx`, that confirms it can reach the API. The API returns made-up fixture data, so you can build the whole UI against it before the real endpoints exist.

## Start here

1. Follow the setup under "Run" in [CLAUDE.md](../CLAUDE.md). You need Node 20.9+ and Python 3.11+ to run the API.
2. Get a Mapbox token and put it in `web/.env.local`.
3. Render the Cottonwoods in 3D satellite. **This must work by hour 1.** The map has never been run with a real token, so check this first.
4. Build click-to-draw, send the route to `POST /analyze`, and recolor the line from the response.

Read `web/AGENTS.md` before writing Next.js code: this version has breaking changes, with docs in `node_modules/next/dist/docs/`.

## Rules that are easy to miss

The full rules are in `CLAUDE.md`.

- **Never call a route, segment or slope "safe".** Under 30 degrees is "no avalanche-terrain flag".
- Show `source`, so fixture or replayed data can't pass for today's forecast.
- Unrated terrain is a dashed magenta line with a "?" pin. A rerouted-away original line is always dashed gray, so the two can't be confused.
- The primary Reroute button appears if and only if `flagged_stretch_count` is above 0.
- Send the user's current `avoid_at_or_above` with every `POST /analyze` and `POST /alternative` call.
- "No flags found" only appears if `steep_segment_count` is 0 and nothing is flagged.
- Always show the meters a reroute leaves behind.

## Fixtures for each UI state

The stubs only return the default case. Import the rest from `fixtures/` directly.

| State | Fixture |
| --- | --- |
| Flagged route | `analyze.response.json` |
| No ratings issued | `forecast.no_ratings.response.json`, `analyze.unrated.response.json` |
| Low or Moderate only | `analyze.low_only`, `analyze.moderate_only`, `analyze.low_moderate` (`.response.json`) |
| Same route at `avoid_at_or_above: low` | `analyze.avoid_low.response.json` |
| Reroute at that setting | `alternative.avoid_low.response.json` |
| Real Avalanche Warning forecast | `demo_days.json` |
| Warning day analysis and reroute | `analyze.warning.response.json`, `alternative.warning.response.json` |
| No clean line | `alternative.no_line.response.json` |

## What you need from others

| From | What | When |
| --- | --- | --- |
| Karthik | Real `POST /analyze` results | Hour 6 |
| Karthik | Slope-shading PNG and its corner coordinates | Hour 12 |
| Karthik | Real `POST /alternative` results | After hour 12 |
| Rishabh | Real `GET /forecast` and `POST /briefing` | Hour 12 |

After anyone changes the API models, run `npm run gen:types` with the API running.

## Also yours

- Deploy to Vercel and confirm the shared link works on a phone.
- Fly the demo area once before judging, to cache map tiles.

## Rulings from Rishabh

- **Beginner mode label:** "Beginner mode: stay off and out from under slopes 30° and steeper". Subtitle: "Checks slopes on your route and within 300 m uphill."
- **No UI exception for Beginner mode.** `flagged` is computed server-side from the `avoid_at_or_above` you send, so in Beginner mode a Low-rated steep stretch comes back flagged and the primary Reroute button shows on its own. Don't work out flags in the UI.

- **"Avoid these too" applies to the current route only** and never changes the saved setting. After that reroute, the comparison card shows a text link, "Make this my default", which updates the saved setting only when tapped.
- **Alerts are a full-width banner above everything.** On a Warning day the server forces `low` and returns `forced_by_warning: true`. The banner explains why everything steep is flagged, and the saved setting doesn't change.
- **On Warning days the comparison card adds:** "UAC recommends avoiding all avalanche terrain today." Never imply a rerouted line makes going out okay.
- **UAC's text is shown verbatim,** in a block attributed to UAC with a link to the full forecast. It can contain words like "safer", which is the one exception to the "safe" rule. Your own copy still can't use them, and a test scans `web/` for them.

`POST /analyze` and `POST /alternative` both accept `avoid_at_or_above`, but the stubs ignore it and return the `considerable` fixture. Import the `avoid_low` fixtures to build the `low` states until the real endpoints land.
