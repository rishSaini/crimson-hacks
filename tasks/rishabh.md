# Rishabh: Forecast and AI, plus the pitch

You own the forecast, briefing and agent modules in `api/app/`, and `fixtures/demo_days.json`. Your full checklist is [forecast-ai.md](forecast-ai.md).

Nothing is built yet. The API returns made-up fixture data.

## Start here

1. Follow the setup under "Run" in [CLAUDE.md](../CLAUDE.md). This Mac has no Node and only Python 3.9, so install Node 20.9+ and Python 3.11+ first.
2. **Request a UAC API token at https://utahavalanchecenter.org/api-access.** The forecast JSON now requires one, which the design doc gets wrong, and nothing else provides the rose.
3. Fetch the UAC Salt Lake JSON with the token, a real User-Agent and contact email, and confirm the rose decodes with `app/forecast.py`. Check what it returns before ratings start, since it should decode to `ratings_issued: false`.
4. Done: Feb 18, 2026 is saved in `fixtures/demo_days.json`, and its `forecast_url` opens that forecast.
5. Replace the `GET /forecast` stub, serving past days from `demo_days.json`.

The forecast never blocks anyone: Karthik and Ali can use the fixtures until yours is live.

## Rulings made

1. **Beginner mode label:** "Beginner mode: stay off and out from under slopes 30° and steeper". Subtitle: "Checks slopes on your route and within 300 m uphill." Ali builds this: see [ali.md](ali.md).
2. **Overhead exposure follows `avoid_at_or_above`,** and unrated always counts. More "no clean line" results in `low` mode are expected, and the fallback options handle them. Karthik builds this: see [karthik.md](karthik.md).
3. **No UI exception for Beginner mode.** `POST /analyze` takes `avoid_at_or_above` (same enum, default `considerable`), `flagged` is computed server-side from it, and the primary Reroute button shows if and only if flagged is above 0. The UI sends the current setting with every `POST /analyze` and `POST /alternative` call. The models, fixtures and tests are updated, and the real logic is Karthik's.
4. **"Avoid these too" applies to the current route only** and never changes the saved setting. After that reroute, the comparison card shows a text link, "Make this my default", which updates the saved setting only when tapped. Ali builds this.
5. **Alerts:** a full-width banner above everything. A Warning forces `avoid_at_or_above` to `low` for that forecast day only, and the saved setting doesn't change. Karthik applies it on the server, and Ali builds the banner.
6. **UAC's text is stored and shown verbatim,** attributed to UAC with a link. The "safe" check only applies to RedRun's own strings and LLM output.
7. **Warning days:** the comparison card adds "UAC recommends avoiding all avalanche terrain today." Nothing may imply a rerouted line makes going out okay.
8. **Worst rating in the window:** a point takes the worst rating among steep cells in its 3 by 3 window. Karthik reviews this on `terrain-review-rulings`.
9. **Overhead direction:** a cell counts only if it's higher than the point and faces it, within 60 degrees. The distance limit stays 300 m.
10. **Short runs:** all flagged runs stay in the data, and runs under 50 m apart merge for the banner and pins. The 30 m drop rule is gone.
11. **Main demo day:** Feb 21, 2026, with a Special Bulletin and no forced threshold. Feb 18 stays as the Warning example. Feb 21 isn't saved yet: its rose still has to be checked against the written summary.

## What others need from you

| For | What | When |
| --- | --- | --- |
| Karthik | The forecast rose, through `GET /forecast` or `demo_days.json` | Hour 6 |
| Ali | Real `GET /forecast` and `POST /briefing` | Hour 12 |

## What you need from others

- **Karthik:** terrain functions for the agent's tools, by hour 12.
- **Karthik:** the hand-traced tour library is shared, so split that work.

## Also yours

- Add `POST /agent` and its models. It isn't stubbed yet, and it's a contract change, so tell the team first.
- Record the backup demo video and rehearse the 3-minute pitch.
- Verify the deaths cited in the pitch's hook against UAC's report and the February 2026 source.
- Decide how to acknowledge Feb 18 and Feb 21 on stage. Both archived forecasts are kept in relation to fatalities, and Feb 21's text describes the two that week.
- Add the design doc to the repo. It isn't committed yet, so Karthik and Ali don't have it here.
