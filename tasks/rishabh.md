# Rishabh: Forecast and AI, plus the pitch

You own the forecast, briefing and agent modules in `api/app/`, and `fixtures/demo_days.json`. Your full checklist is [forecast-ai.md](forecast-ai.md).

Nothing is built yet. The API returns made-up fixture data.

## Start here

1. Follow the setup under "Run" in [CLAUDE.md](../CLAUDE.md). This Mac has no Node and only Python 3.9, so install Node 20.9+ and Python 3.11+ first.
2. Fetch the UAC Salt Lake JSON with a real User-Agent and contact email, and confirm the rose decodes. Check what it returns before ratings start, since it should decode to `ratings_issued: false`.
3. Pick the demo day and copy its real rose, bottom line and problems into `fixtures/demo_days.json`, with `source: demo_replay`.
4. Replace the `GET /forecast` stub.

The forecast never blocks anyone: Karthik and Ali can use the fixtures until yours is live.

## Rulings made

1. **Beginner mode label:** "Beginner mode: stay off and out from under slopes 30° and steeper". Subtitle: "Checks slopes on your route and within 300 m uphill." Ali builds this: see [ali.md](ali.md).
2. **Overhead exposure follows `avoid_at_or_above`,** and unrated always counts. More "no clean line" results in `low` mode are expected, and the fallback options handle them. Karthik builds this: see [karthik.md](karthik.md).
3. **No UI exception for Beginner mode.** `POST /analyze` takes `avoid_at_or_above` (same enum, default `considerable`), `flagged` is computed server-side from it, and the primary Reroute button shows if and only if flagged is above 0. The UI sends the current setting with every `POST /analyze` and `POST /alternative` call. The models, fixtures and tests are updated, and the real logic is Karthik's.
4. **"Avoid these too" applies to the current route only** and never changes the saved setting. After that reroute, the comparison card shows a text link, "Make this my default", which updates the saved setting only when tapped. Ali builds this.

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
- Add the design doc to the repo. It isn't committed yet, so Karthik and Ali don't have it here.
