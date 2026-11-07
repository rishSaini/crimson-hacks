# Fixtures

Example requests and responses for each endpoint. The API stubs return the `*.response.json` files, except `POST /analyze` and `POST /suggestions`, which now compute real results.

**This is made-up data for building the UI. It is not a real forecast, and the route's colors don't reflect the real terrain under it.** Every response carries `"source": "fixture"` so the UI can say so.

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /forecast` | `forecast.request.json` (query parameters) | `forecast.response.json` |
| `POST /analyze` | `analyze.request.json` | `analyze.response.json` |
| `POST /alternative` | `alternative.request.json` | `alternative.response.json` |
| `POST /briefing` | `briefing.request.json` | `briefing.response.json` |

The stubs don't return these other states, so import them directly when building the UI:

- `alternative.no_line.response.json`: the "no clean line" case.
- `forecast.no_ratings.response.json`: all 24 rose values are 0, which triggers the no-ratings banner.
- `analyze.unrated.response.json`: the same route on that no-ratings day, with unrated segments and overhead exposure.
- `analyze.low_only.response.json`, `analyze.moderate_only.response.json`, `analyze.low_moderate.response.json`: steep segments with nothing flagged, one for each banner wording. Their ratings don't match `forecast.response.json`.
- `analyze.avoid_low.request.json`, `analyze.avoid_low.response.json`: that Low to Moderate route at `avoid_at_or_above: low`, where its steep segments and the track below them come back flagged.
- `alternative.avoid_low.request.json`, `alternative.avoid_low.response.json`: the reroute at that setting. Some flagged terrain remains, so the UI has to show the leftover meters.

- `analyze.warning.response.json`, `alternative.warning.response.json`: an Avalanche Warning day, with `avoid_at_or_above` forced to `low` and `forced_by_warning: true`.

`demo_days.json` holds real replayed forecast days, keyed by date, with `"source": "demo_replay"`. **Unlike the other files, this is real UAC data.** Its `bottom_line`, `problems` and `alert` text is verbatim, including any typos, so don't edit it. Copy new days from a published UAC forecast, and never write them from memory.

`2026-02-18` was checked against UAC's forecast page and its written danger summary. It's archived in relation to a fatality that day, so treat it with care.

`api/tests/test_contract.py` checks these files against the models.

`SuggestionsRequest` and `SuggestionsResponse` examples are in `suggestions.request.json` and `suggestions.response.json`.
They use the real local catalog and terrain grids with the forecast fixture.
The current demo drawing returns `no_match`. See `data/routes/README.md` for the coverage limits.
