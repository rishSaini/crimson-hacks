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
| Real Avalanche Warning forecast | `demo_days.json`, `2026-02-18` |
| Real Special Bulletin forecast, with `comparison_advice` and no `what_to_do` | `demo_days.json`, `2026-02-21` |
| Warning day analysis and reroute | `analyze.warning.response.json`, `alternative.warning.response.json` |
| No clean line | `alternative.no_line.response.json` |

## Plan mode

The Draw/Plan toggle and Plan mode are in `components/RouteWorkspace.tsx`, `PlanLayers.tsx`, `PlanPanel.tsx` and `lib/usePlan.ts`. Draw mode is empty, ready for your click-to-draw. A plan can come back flagged, so show its flags the same way as a drawn route: use `analysis.flagged_stretches` for pins and the banner, and show the Reroute button if there are any, once the real `/alternative` lands. Keep the "Planning" state visible, since plans take a few seconds. It uses a fixed date and setting for now, so connect it to your date picker and settings.

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
- **On days with `comparison_advice`, the comparison card shows it,** attributed to UAC. Feb 21 has it, and no threshold is forced that day.
- **UAC's text is shown verbatim,** in a block attributed to UAC with a link to the full forecast. It can contain words like "safer", which is the one exception to the "safe" rule. Your own copy still can't use them, and a test scans `web/` for them.

`POST /analyze` is now real, using Karthik's terrain code, so it returns real segments. It works for dates `GET /forecast` can serve: `2026-02-21` (main demo day), `2026-02-18` (Warning example) and `2026-01-15` (made-up sample). Other dates return 404. Real responses split into many short segments, so test your line drawing against them, not only the fixtures. Use `flagged_stretches` for the banner and pins, where flagged runs under 50 m apart are merged, and `segments` for the line colors, where every run is kept. `POST /alternative` is still a stub that ignores `avoid_at_or_above`, so use the `avoid_low` fixtures for those states. `POST /suggestions` is new: see `data/routes/README.md`.
