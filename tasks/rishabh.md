# Rishabh: Forecast and AI, plus the pitch

You own the forecast, briefing and agent modules in `api/app/`, and `fixtures/demo_days.json`. Your full checklist is [forecast-ai.md](forecast-ai.md).

Nothing is built yet. The API returns made-up fixture data.

## Start here

1. Follow the setup under "Run" in [CLAUDE.md](../CLAUDE.md). This Mac has no Node and only Python 3.9, so install Node 20.9+ and Python 3.11+ first.
2. Fetch the UAC Salt Lake JSON with a real User-Agent and contact email, and confirm the rose decodes. Check what it returns before ratings start, since it should decode to `ratings_issued: false`.
3. Pick the demo day and copy its real rose, bottom line and problems into `fixtures/demo_days.json`, with `source: demo_replay`.
4. Replace the `GET /forecast` stub.

The forecast never blocks anyone: Karthik and Ali can use the fixtures until yours is live.

## Rulings to make

1. **What should Beginner mode say?** "Beginner mode: avoid all avalanche terrain" overstates what the app checks. It misses flat tracks under Low or Moderate slopes, slopes under 30 degrees, and runouts, and a reroute can leave steep terrain behind. Suggested: "Beginner mode: avoid all rated 30°+ terrain".
2. **Should overhead exposure follow `avoid_at_or_above`?** Karthik needs this before building overhead exposure. See [karthik.md](karthik.md).
3. **What should Beginner mode show on a route with nothing flagged?** Ali needs this before building the banner. See [ali.md](ali.md).

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
