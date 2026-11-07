# Forecast and AI

Owns the forecast, briefing and agent modules in `api/app/`, plus `fixtures/demo_days.json`. On a 3-person team, also owns the pitch.

## Hour 0 to 1: de-risk (never blocks: the forecast can always be hard-coded)

- [ ] Fetch `utahavalanchecenter.org/forecast/salt-lake/json` with a real User-Agent and contact email, and confirm the rose decodes
- [ ] Check what the feed returns before daily ratings start, and that it decodes to `ratings_issued: false`
- [ ] Pick the demo day: Considerable or High on north and east upper aspects. UAC's February 2026 cycle is a strong candidate
- [ ] Save its real rose, bottom line and problems to `fixtures/demo_days.json`, with `source: demo_replay`
- [ ] Start hand-tracing the 10 to 15 Cottonwood tours as GeoJSON, each with trailhead, objective, distance and climb (share with Terrain)
- [ ] Check whether UAC observation data includes coordinates before promising a past-slides layer

## Hour 1 to 6: core loop

- [ ] Rose decoding: level = ceil(value / 2), odd values are "pockets of", 0 is no rating, and `ratings_issued` is false if all 24 values are 0
- [ ] Replace the `GET /forecast` stub: `httpx` with a 15-minute in-memory cache, Avalanche.org as backup, `demo_days.json` for past days

## Hour 6 to 12: demo features

- [ ] Replace the `POST /briefing` stub: Claude API (`claude-sonnet-5-5`) with structured JSON output
- [ ] Pass only the forecast text and computed segments
- [ ] Prompt: cite the segment and avalanche problem in each sentence, never say a route is safe, and describe unrated segments as unrated, not as low danger
- [ ] Validate the JSON before returning it, and reject any note that calls terrain safe

## Hour 12 to 18: stretch, in this order

Reroute comes first (see `tasks/terrain.md`). Then:

- [ ] Add `POST /agent` and its models: plain-language request and date in, streamed route cards out
- [ ] Parse the request into a constraint object: canyon, max climb, max distance, max flagged meters, date
- [ ] Tools: `get_forecast`, `search_tours`, `analyze_route`, `reroute`, `plan_route`, capped at about 8 calls per request
- [ ] Ids only: tour, trailhead and objective ids are enums in the schemas, and the model never outputs coordinates
- [ ] Every candidate passes analysis in the same request and must meet the constraints to be called a match
- [ ] Rank by constraint fit, then flagged meters, then distance from the user's wording
- [ ] Render card numbers from tool JSON; check numbers in the LLM sentence against tool results, and fall back to a template sentence
- [ ] "Nothing fits" is a valid answer: offer the closest options
- [ ] Run 15 to 20 scripted prompts, including impossible ones, and confirm the agent declines them
- [ ] Back the "Go somewhere else" fallback with the agent

## Hour 18 to 22: polish and proof

- [ ] Choose and test the demo route: a sunny low-angle stretch and a steep north-facing bowl
- [ ] Record a 90-second backup demo video
- [ ] Rehearse the 3-minute pitch at least 5 times with a timer
- [ ] Verify the deaths cited in the hook against UAC's report and the February 2026 source

## Last 2 hours: freeze

- [ ] Code freeze: only fix crashes
- [ ] Submit early, then rehearse again
