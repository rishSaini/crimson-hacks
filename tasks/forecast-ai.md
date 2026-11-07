# Forecast and AI

Owns the forecast, briefing and agent modules in `api/app/`, plus `fixtures/demo_days.json`. On a 3-person team, also owns the pitch.

## Hour 0 to 1: de-risk (never blocks: the forecast can always be hard-coded)

- [ ] Request a UAC API token at `utahavalanchecenter.org/api-access`. The forecast JSON returned 401 without one on 2026-11-06, despite the design doc's "no key"
- [ ] Fetch `utahavalanchecenter.org/forecast/salt-lake/json` with the token, a real User-Agent and a contact email, and confirm the rose's real format decodes
- [ ] Check what the feed returns before daily ratings start, and that it decodes to `ratings_issued: false`
- [ ] If the token doesn't arrive in time, enter the demo day's values from the forecast page by hand. Avalanche.org can't replace it: it has one overall rating per zone, with no rose, problems or bottom line
- [x] Pick the Warning example: Feb 18, 2026, with High on E-N-NW above 8,000 ft and an Avalanche Warning
- [x] Save the main demo day, Feb 21, 2026: its rose screenshot matches the written summary in the archived forecast
- [x] Serve saved days from `GET /forecast`, and return 404 for dates with no forecast
- [x] Save its real rose, bottom line, problems and alert to `fixtures/demo_days.json`, with `source: demo_replay`
- [x] Confirm the `forecast_url` in `demo_days.json` opens the Feb 18 forecast in a browser
- [ ] Start hand-tracing the 10 to 15 Cottonwood tours as GeoJSON, each with trailhead, objective, distance and climb (share with Terrain)
- [ ] Check whether UAC observation data includes coordinates before promising a past-slides layer

## Hour 1 to 6: core loop

- [x] Rose decoding: `app/forecast.py`, from a list of 24 values. Adapt it once the real feed format is confirmed
- [ ] Replace the `GET /forecast` stub: `httpx` with a 15-minute in-memory cache, and `demo_days.json` for past days. If the feed is down, say so rather than applying Avalanche.org's overall rating to every aspect
- [ ] Fill `alert` from the feed, with UAC's text verbatim

## Hour 6 to 12: demo features

- [ ] Replace the `POST /briefing` stub: OpenAI Responses API (`gpt-6.1-sol`) with structured JSON output
- [ ] Pass only the forecast text and computed segments
- [ ] Prompt: cite the segment and avalanche problem in each sentence, never say a route is safe, and describe unrated segments as unrated, not as low danger
- [ ] Validate the JSON before returning it. `BriefingItem` rejects "safe" and its variants, even when quoting UAC, so catch that and fall back to a template sentence

## Hour 12 to 18: stretch, in this order

Reroute comes first (see `tasks/terrain.md`). Then:

- [x] Add `POST /agent` and its models: plain-language request and date in, route cards out. Not streamed: it's one model call after about 4 s of planning
- [x] Parse the request into constraints: canyon, max climb, max distance. Flagged terrain is always a miss, so there's no max flagged meters
- [x] Check all 18 library tours on the server, then make one model call. Planning takes about 0.2 s per tour, so this replaced the planned tool loop and 8-call cap
- [x] Pass the user's `avoid_at_or_above` to planning, so "nothing flagged" means the same thing as on the map
- [x] Ids only: tour ids are an enum in the schema, and the model never outputs coordinates
- [x] Every candidate passes analysis in the same request and must meet the constraints to be called a match
- [x] Rank by constraint fit, then flagged meters, then the model's order. A named canyon counts ahead of other limits
- [x] Render card numbers from analysis; check numbers in the LLM sentence against computed facts, and fall back to a template sentence
- [x] "Nothing fits" is a valid answer: offer the closest options
- [x] Try it against the real model, with a normal request, a Warning day, out of scope, Millcreek, impossible limits and a prompt injection
- [ ] Offer rerouted lines on cards, once `POST /alternative` is real. On Feb 21 every tour is flagged, and avoiding flagged terrain cuts Little Cottonwood Creek from 3,098 to 120 flagged meters
- [ ] Run the rest of the 15 to 20 scripted prompts, including impossible ones, and confirm the agent declines them
- [ ] Ask Karthik to extend the DEM north so the Millcreek trailheads are covered
- [ ] Back the "Go somewhere else" fallback with the agent

## Hour 18 to 22: polish and proof

- [ ] Choose and test the demo route: a sunny low-angle stretch and a steep north-facing bowl
- [ ] Record a 90-second backup demo video
- [ ] Rehearse the 3-minute pitch at least 5 times with a timer
- [ ] Verify the deaths cited in the hook against UAC's report and the February 2026 source
- [ ] Prepare for the demo days' weight: Feb 18 and Feb 21, 2026 are both archived in relation to fatalities. Decide how to acknowledge that on stage
- [ ] Explain in the demo script why Feb 21's bulletin says HIGH while its rose shows Considerable. Both are shown word for word
- [ ] Say in the pitch that UAC recommended avoiding all avalanche terrain that day, and that RedRun shows where a route crosses it rather than clearing anyone to go

## Last 2 hours: freeze

- [ ] Code freeze: only fix crashes
- [ ] Submit early, then rehearse again
