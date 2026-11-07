import type { ForecastResponse } from "./api";

export type Danger = ForecastResponse["overall_danger"];
export type Source = ForecastResponse["source"];
export type AlertLevel = ForecastResponse["alert"]["level"];

/** North American Public Avalanche Danger Scale colors, as UAC uses them. */
export const DANGER: Record<Danger, { label: string; level: number | null; fill: string; text: string }> = {
  no_rating: { label: "No rating", level: null, fill: "#64748b", text: "#ffffff" },
  low: { label: "Low", level: 1, fill: "#50b848", text: "#0b2a09" },
  moderate: { label: "Moderate", level: 2, fill: "#fff200", text: "#2b2900" },
  considerable: { label: "Considerable", level: 3, fill: "#f7941e", text: "#2e1600" },
  high: { label: "High", level: 4, fill: "#ed1c24", text: "#ffffff" },
  extreme: { label: "Extreme", level: 5, fill: "#231f20", text: "#ffffff" },
};

export const SOURCE: Record<Source, { label: string; tone: "live" | "replay" | "fixture" }> = {
  uac_live: { label: "Live UAC forecast", tone: "live" },
  demo_replay: { label: "Replayed past forecast", tone: "replay" },
  fixture: { label: "Sample data, not a real forecast", tone: "fixture" },
};

export const ALERT_TITLE: Record<Exclude<AlertLevel, "none">, string> = {
  watch: "Avalanche Watch",
  warning: "Avalanche Warning",
  special_bulletin: "Special Avalanche Bulletin",
};

/** "2026-02-21" as "Sat, Feb 21, 2026", without timezone drift. */
export function formatDay(isoDate: string, opts: { weekday?: boolean } = {}) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: opts.weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Route colors from the analysis, drawn in the legend exactly as the map will draw them. */
export const ROUTE_KEY = [
  { label: "Under 30°: no avalanche-terrain flag", color: "#94a3b8", thin: true },
  { label: "30°+, rated Low", color: DANGER.low.fill },
  { label: "30°+, rated Moderate", color: DANGER.moderate.fill },
  { label: "30°+, rated Considerable", color: DANGER.considerable.fill },
  { label: "30°+, rated High", color: DANGER.high.fill },
  { label: "30°+, rated Extreme", color: DANGER.extreme.fill, edge: true },
  { label: "30°+ with no rating", color: "#e11d9b", dashed: true },
] as const;

/**
 * Color-blind palette: a light-to-dark ramp, so levels stay apart by lightness for red-green
 * color blindness, with blue and yellow as the two lightest steps. Display only: the data and
 * UAC's forecast are unchanged, and the UI says the standard scale is UAC's.
 */
const CB_DANGER: Record<Danger, { fill: string; text: string }> = {
  no_rating: { fill: "#64748b", text: "#ffffff" },
  low: { fill: "#8fd3fe", text: "#06283d" },
  moderate: { fill: "#f6d55c", text: "#2b2300" },
  considerable: { fill: "#e07b39", text: "#2a1200" },
  high: { fill: "#a4243b", text: "#ffffff" },
  extreme: { fill: "#161616", text: "#ffffff" },
};

/** The danger style to draw, in the standard or the color-blind palette. */
export function dangerStyle(danger: Danger, colorBlind: boolean) {
  return colorBlind ? { ...DANGER[danger], ...CB_DANGER[danger] } : DANGER[danger];
}

/** Map colors for each analysis `color`, shared by the map line, legend and profile. */
export function routeColors(colorBlind: boolean): Record<string, string> {
  const d = (k: Danger) => dangerStyle(k, colorBlind).fill;
  return {
    gray: "#7b8794",
    unrated: "#e11d9b",
    green: d("low"),
    yellow: d("moderate"),
    orange: d("considerable"),
    red: d("high"),
    black: d("extreme"),
  };
}
