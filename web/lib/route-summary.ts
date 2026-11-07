import type { DataSource } from "@/lib/analysis";
import type { AnalyzeResponse } from "@/lib/api";

type Totals = AnalyzeResponse["totals"];
type Rating = Totals["steep_ratings"][number];

export type SummaryTone = "flagged" | "listed" | "none";
export type RouteSummary = { tone: SummaryTone; text: string };

const RATING_LABELS: Record<Rating, string> = {
  no_rating: "Unrated",
  low: "Low",
  moderate: "Moderate",
  considerable: "Considerable",
  high: "High",
  extreme: "Extreme",
};

const meters = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Low", "Moderate" or "Low to Moderate" from the server's lowest-first list. */
export function ratingRangeLabel(ratings: readonly Rating[]): string {
  if (ratings.length === 0) return "";
  const first = RATING_LABELS[ratings[0]];
  const last = RATING_LABELS[ratings[ratings.length - 1]];
  return first === last ? first : `${first} to ${last}`;
}

/**
 * Banner state from CLAUDE.md. Flags always come from the server: the UI never
 * works out `flagged` itself.
 */
export function summarizeRoute(totals: Totals): RouteSummary {
  if (totals.flagged_stretch_count > 0) {
    const n = totals.flagged_stretch_count;
    return {
      tone: "flagged",
      text: `${n} flagged ${plural(n, "stretch", "stretches")} at your setting (${meters(totals.flagged_length_m)}).`,
    };
  }
  if (totals.steep_segment_count > 0) {
    // Segments under 50 m apart merge into one stretch for the banner.
    const n = totals.steep_stretch_count;
    return {
      tone: "listed",
      text: `${n} ${plural(n, "stretch", "stretches")} in avalanche terrain, rated ${ratingRangeLabel(totals.steep_ratings)} today (${meters(totals.steep_length_m)}). Not rerouted by default.`,
    };
  }
  return { tone: "none", text: "No flags found on this route today." };
}

export function sourceLabel(source: DataSource, date: string): string {
  switch (source) {
    case "uac_live":
      return `UAC forecast for ${date}`;
    case "demo_replay":
      return `Replayed UAC forecast from ${date}, not today's`;
    case "fixture":
      return "Fixture data, not a real forecast";
  }
}
