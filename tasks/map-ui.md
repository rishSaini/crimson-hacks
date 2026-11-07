# Map and UI

Owns `web/`. Works against the fixture stubs until the real endpoints land.

## Hour 0 to 1: de-risk (gate: map working by hour 1)

- [ ] Get a Mapbox token and put it in `web/.env.local`
- [ ] Render the Cottonwoods in 3D satellite (`raster-dem` source + `setTerrain`)

## Hour 1 to 6: core loop

- [ ] Click to drop waypoints on the 3D map, double-click to finish; the line drapes on terrain
- [ ] Send the route and the user's current `avoid_at_or_above` to `POST /analyze`, and recolor it by segment on return
- [ ] Draw every `color`, with `unrated` as a dashed magenta line and a "?" pin

## Hour 6 to 12: demo features

- [ ] Slope-shading overlay with a toggle: yellow 27 to 29, orange 30 to 34, red 35 to 45, purple above 45 (PNG from terrain, added as an `image` source)
- [ ] Forecast card: rating, bottom line, and the danger rose drawn as an SVG
- [ ] Date picker to load a past day
- [ ] Show `source` on the card, so fixture and replayed days can't pass for today's forecast
- [ ] If `ratings_issued` is false, show the banner "No danger ratings issued today. Steep terrain is shown as unrated." (`forecast.no_ratings.response.json`)
- [ ] Segment panel: list every 30 degree or steeper segment with its rating, Low and Moderate included: "Segment 3: 310 m on 34 to 38 degree NE slopes, 9,700 to 10,100 ft. Rated Considerable today."
- [ ] Click a stretch to fly the camera to it
- [ ] Briefing panel, with the raw segment data beside it
- [ ] Link to the full UAC forecast and to avalanche courses

## Hour 12 to 18: stretch, in this order

- [ ] Overhead exposure markers
- [ ] Flagged state: thicker line, one pulse, numbered pins, sticky banner, camera frames the route
- [ ] Banner copy must name the ratings actually flagged, which depend on the setting, and must not describe unrated meters as "rated Considerable": word mixed routes separately (`analyze.unrated.response.json`)
- [ ] Reroute button at the bottom center of the map and the top of the side panel, the only filled button on screen, shown only if `flagged_stretch_count` is above 0. Start no later than hour 12: it's the demo's closing moment
- [ ] Settings control for `avoid_at_or_above`, sent with every `POST /analyze` and `POST /alternative` call: default `considerable`, "Also avoid Moderate" for `moderate`, and "Beginner mode: stay off and out from under slopes 30° and steeper" for `low`, with the subtitle "Checks slopes on your route and within 300 m uphill." Changing it re-analyzes the route. The chosen rating counts in the comparison
- [ ] No Beginner mode exception: read `flagged` from the server, and show the primary Reroute button if and only if flagged is above 0
- [ ] Always show the meters a reroute leaves behind (`alternative_flagged_m`): a stricter setting doesn't guarantee a line that avoids everything (`alternative.avoid_low.response.json`)
- [ ] Nothing to list: gray "No flags found on this route today." only if `steep_segment_count` is 0 and nothing is overhead-exposed
- [ ] Only Low or Moderate steep segments (`analyze.low_only`, `analyze.moderate_only` and `analyze.low_moderate` fixtures): banner "N stretches in avalanche terrain, rated Low today (X m). Not rerouted by default.", with N from `steep_segment_count`, X from `steep_length_m`, the rating from `steep_ratings` ("Low", "Moderate" or "Low to Moderate"), and the listed segments below it
- [ ] In that state, a secondary outline button "Avoid these too" that reruns the analysis and the reroute with `avoid_at_or_above` set to `steep_ratings[0]`, with no primary button. It shows on Low-only routes too. It applies to the current route only and never changes the saved setting
- [ ] After an "Avoid these too" reroute, show a text link "Make this my default" on the comparison card. It updates the saved setting only when tapped
- [ ] Rerouted state: original becomes a dashed gray ghost whatever its colors were, new line solid, comparison card, "Use this route" and "Undo"
- [ ] Corridor slider, 200 to 800 m
- [ ] No-line state (`alternative.no_line.response.json`): one plain sentence and the three one-tap choices, plus the "Show lowest-exposure line anyway" link with its red label
- [ ] Agent prompt box and streamed route cards; label generated lines "Computer-generated line, not a known skin track. Check it against a map."
- [ ] GPX import with `@tmcw/togeojson`, only if time remains (drop any elevation value: positions are `[lng, lat]`)

## Hour 18 to 22: polish and proof

- [ ] Add shadcn/ui and do the design pass
- [ ] Delete `components/ApiCheck.tsx`
- [ ] Deploy to Vercel and confirm the shared link works on a phone
- [ ] Fly the demo area once before judging to cache tiles

## Last 2 hours: freeze

- [ ] Code freeze: only fix crashes
