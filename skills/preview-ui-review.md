# Route preview design review

Date: 2026-11-06.
Branch: `karthik/outdoor-ui`.
Skill: [frontend-design-review](../.agents/skills/frontend-design-review/SKILL.md).

## Purpose and direction

Users select two points, set their ski level, and inspect matching mapped sections.
The design uses a light outdoor map with a compact route panel.
Forest green marks primary actions. Blue marks source tracks. Orange marks mapped matches.
The panel groups extra filters and source details into expandable sections.
The mobile panel collapses during point selection and terrain playback.

The project has no supplied Figma design or component library.
The preview uses scoped CSS tokens and a shared SVG icon component.
Geist provides body text. Georgia provides display text.

## Review result

The design passes the local demo review.

| Area | Verification |
| --- | --- |
| Main task | Two pins and sketch examples reach the existing backend. Both endpoints return HTTP 200. |
| Search states | Matching sections, no matches, and a simulated API failure show clear feedback. |
| Map framing | Search results remain visible above the mobile panel. |
| Playback | Start, Pause, Resume, Stop, speed changes, seeking, and Replay work in the browser. |
| Time input | Invalid times show the allowed range. The final slider position reaches the exact endpoint. |
| Keyboard | Arrow keys move the map. Enter places pins during selection. Controls have visible focus styles. |
| Responsive layout | Widths of 320, 390, 768, 1024, and 1440 pixels show no page overflow. |
| Theme | The preview keeps its light theme when the system uses dark mode. |
| Source labels | The source grade, license, data gaps, and saved forecast date remain available. |
| Loading | Playback distances match between server output and browser hydration. |
| Build | ESLint, TypeScript, and the Webpack production build pass. |

## Data limits

The default source track is Lake Peak North Couloir, which has more recorded points than East Chute.
The UI labels the saved forecast date as 2026-01-15.
Matches represent mapped sections, which can have endpoint gaps.
Terrain playback uses an elevation model and imagery. Snow cover and obstacles remain unverified.
Playback follows each continuous section separately.
