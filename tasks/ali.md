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
- The primary Reroute button only appears if `flagged_stretch_count` is above 0.
- "No flags found" only appears if `steep_segment_count` is 0 and nothing is flagged.
- Always show the meters a reroute leaves behind.

## Fixtures for each UI state

The stubs only return the default case. Import the rest from `fixtures/` directly.

| State | Fixture |
| --- | --- |
| Flagged route | `analyze.response.json` |
| No ratings issued | `forecast.no_ratings.response.json`, `analyze.unrated.response.json` |
| Low or Moderate only | `analyze.low_only`, `analyze.moderate_only`, `analyze.low_moderate` (`.response.json`) |
| "Avoid these too" result | `alternative.avoid_low.response.json` |
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

## Open question

**3. What should Beginner mode show on a route with nothing flagged?** It currently gets the "Not rerouted by default" banner and the secondary button, which reads oddly when the user already asked to avoid that terrain. The suggestion is to show the primary Reroute button there, as a small exception to the "only for actual flags" rule. Rishabh has the ruling.
