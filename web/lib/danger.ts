import type { Segment } from "@/lib/analysis";
import type { ForecastResponse } from "@/lib/api";

export type Danger = ForecastResponse["overall_danger"];
export type RoseCell = ForecastResponse["rose"][number];
export type Band = RoseCell["band"];
export type Aspect = RoseCell["aspect"];

export const DANGER_LABEL: Record<Danger, string> = {
  no_rating: "No rating",
  low: "Low",
  moderate: "Moderate",
  considerable: "Considerable",
  high: "High",
  extreme: "Extreme",
};

/** North American Avalanche Danger Scale colors, as UAC uses them. */
export const DANGER_HEX: Record<Danger, string> = {
  no_rating: "#d4d4d4",
  low: "#50b848",
  moderate: "#fff200",
  considerable: "#f7941e",
  high: "#ed1c24",
  extreme: "#231f20",
};

/** Text color that reads on each danger fill. */
export const DANGER_TEXT: Record<Danger, string> = {
  no_rating: "#171717",
  low: "#ffffff",
  moderate: "#171717",
  considerable: "#171717",
  high: "#ffffff",
  extreme: "#ffffff",
};

/** Octant order of the rose: index = 8 * band + octant, N clockwise to NW. */
export const ASPECTS: Aspect[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Band order of the rose, with the elevation ranges from CLAUDE.md. */
export const BANDS: { band: Band; label: string; range: string }[] = [
  { band: "upper", label: "Upper elevation", range: "above 9,500 ft" },
  { band: "mid", label: "Mid elevation", range: "8,000 to 9,500 ft" },
  { band: "lower", label: "Lower elevation", range: "below 8,000 ft" },
];

/** "Considerable", or "Pockets of Considerable" for odd raw values. */
export function cellRating(cell: RoseCell): string {
  if (cell.danger === "no_rating") return "No rating";
  return cell.pockets ? `Pockets of ${DANGER_LABEL[cell.danger]}` : DANGER_LABEL[cell.danger];
}

const ft = (n: number) => Math.round(n).toLocaleString("en-US");
const m = (n: number) => Math.round(n).toLocaleString("en-US");

function aspectList(aspects: readonly Aspect[]): string {
  if (aspects.length <= 1) return aspects.join("");
  return `${aspects.slice(0, -1).join(", ")} and ${aspects[aspects.length - 1]}`;
}

/** A segment is listed if it's 30° or steeper, or flagged for what's above it. */
export function isListedSegment(segment: Segment): boolean {
  const p = segment.properties;
  return p.color !== "gray" || p.flag_reason === "overhead_exposure";
}

/**
 * One line per listed segment, from the server's numbers only. Never calls terrain
 * "safe": under 30° with nothing above it isn't listed at all.
 */
export function describeSegment(segment: Segment): string {
  const p = segment.properties;
  const where = `${ft(p.elevation_min_ft)} to ${ft(p.elevation_max_ft)} ft`;
  const slope = `${p.slope_min_deg}°–${p.slope_max_deg}°`;

  if (p.color === "gray") {
    return `Segment ${p.id}: ${m(p.length_m)} m on ${slope} slopes, ${where}, below slopes 30° and steeper. Flagged for overhead exposure.`;
  }

  const head = `Segment ${p.id}: ${m(p.length_m)} m on ${slope} ${aspectList(p.aspects)} slopes, ${where}.`;
  if (p.danger === "no_rating") return `${head} No danger rating issued for it today.`;
  return `${head} Rated ${DANGER_LABEL[p.danger]} today.`;
}
