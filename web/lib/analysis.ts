import {
  api,
  type AlternativeResponse,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type ForecastResponse,
} from "@/lib/api";
import type { LngLat } from "@/lib/geo";

// Shared-contract fixtures from the repo root (see turbopack.root in next.config.ts).
// api/tests/test_contract.py validates them against the models, so treating the
// JSON imports as the generated types is sound.
import analyzeFixture from "../../fixtures/analyze.response.json";
import analyzeAvoidLowFixture from "../../fixtures/analyze.avoid_low.response.json";
import analyzeWarningFixture from "../../fixtures/analyze.warning.response.json";
import alternativeFixture from "../../fixtures/alternative.response.json";
import alternativeAvoidLowFixture from "../../fixtures/alternative.avoid_low.response.json";
import alternativeWarningFixture from "../../fixtures/alternative.warning.response.json";
import forecastFixture from "../../fixtures/forecast.response.json";
// Real UAC forecasts replayed for demo days, keyed by date. The API serves the same file.
import demoDays from "../../fixtures/demo_days.json";

export type AvoidAtOrAbove = AnalyzeRequest["avoid_at_or_above"];
export type Segment = AnalyzeResponse["segments"]["features"][number];
export type SegmentColor = Segment["properties"]["color"];
export type DataSource = AnalyzeResponse["source"];

/** Corridor the reroute searches in, either side of the route. The slider comes later. */
export const DEFAULT_CORRIDOR_M = 400;

/**
 * A response plus whether it came from a bundled fixture because the API was
 * unreachable. When `offline` is true the geometry is a fixture's sample route,
 * not the user's line, and the UI must say so.
 */
export type Fetched<T> = { data: T; offline: boolean };

/**
 * fetch rejects with a TypeError only when no response arrived (server down,
 * DNS, CORS). HTTP errors such as a 422 are real bugs and are re-thrown rather
 * than hidden behind fixture data.
 */
function isUnreachable(error: unknown): boolean {
  return error instanceof TypeError;
}

const asType = <T>(fixture: unknown) => fixture as T;

const savedDays = demoDays as unknown as Record<string, ForecastResponse>;

/**
 * Whether the saved forecast for this date is an Avalanche Warning, when the
 * server would force `low`. Read from the saved day, so the offline fallback never
 * depends on whether the forecast request has finished.
 */
function isSavedWarningDay(date: string): boolean {
  return savedDays[date]?.alert.level === "warning";
}

function analyzeFallback(avoid: AvoidAtOrAbove, date: string) {
  if (isSavedWarningDay(date)) return asType<AnalyzeResponse>(analyzeWarningFixture);
  if (avoid === "low") return asType<AnalyzeResponse>(analyzeAvoidLowFixture);
  return asType<AnalyzeResponse>(analyzeFixture);
}

function alternativeFallback(avoid: AvoidAtOrAbove, date: string) {
  if (isSavedWarningDay(date)) return asType<AlternativeResponse>(alternativeWarningFixture);
  if (avoid === "low") return asType<AlternativeResponse>(alternativeAvoidLowFixture);
  return asType<AlternativeResponse>(alternativeFixture);
}

/** Today's date in the browser's time zone, as YYYY-MM-DD. Call at request time, not render. */
export function localDateIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function analyzeRoute(
  coordinates: LngLat[],
  avoidAtOrAbove: AvoidAtOrAbove,
  date: string,
): Promise<Fetched<AnalyzeResponse>> {
  try {
    const data = await api.analyze({
      route: { type: "LineString", coordinates },
      date,
      avoid_at_or_above: avoidAtOrAbove,
    });
    return { data, offline: false };
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    console.warn("POST /analyze unreachable; using an analyze fixture", error);
    return { data: analyzeFallback(avoidAtOrAbove, date), offline: true };
  }
}

export type RerouteResult = {
  alternative: AlternativeResponse;
  /** POST /analyze on the new line, which gives it segment colors. */
  analysis: AnalyzeResponse | null;
  /** Why the new line has no segment colors, if it doesn't. */
  analysisError: string | null;
  /** The API was unreachable and `alternative` is a fixture. */
  offline: boolean;
};

const UNREACHABLE_NOTE = "API unreachable, so the new line isn't colored by segment.";

/**
 * POST /alternative, then POST /analyze on the line it returns, so the new line is
 * colored by the same rules as the original. Both calls send the same setting.
 */
export async function rerouteRoute(
  coordinates: LngLat[],
  avoidAtOrAbove: AvoidAtOrAbove,
  date: string,
): Promise<RerouteResult> {
  let alternative: AlternativeResponse;
  try {
    alternative = await api.alternative({
      route: { type: "LineString", coordinates },
      date,
      corridor_width_m: DEFAULT_CORRIDOR_M,
      avoid_at_or_above: avoidAtOrAbove,
    });
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    console.warn("POST /alternative unreachable; using an alternative fixture", error);
    return {
      alternative: alternativeFallback(avoidAtOrAbove, date),
      analysis: null,
      analysisError: UNREACHABLE_NOTE,
      offline: true,
    };
  }

  if (alternative.status !== "found" || !alternative.alternative) {
    return { alternative, analysis: null, analysisError: null, offline: false };
  }

  try {
    const analysis = await api.analyze({
      route: alternative.alternative,
      date,
      avoid_at_or_above: avoidAtOrAbove,
    });
    return { alternative, analysis, analysisError: null, offline: false };
  } catch (error) {
    const note = isUnreachable(error)
      ? UNREACHABLE_NOTE
      : `The new line couldn't be analyzed: ${error instanceof Error ? error.message : "unknown error"}`;
    return { alternative, analysis: null, analysisError: note, offline: false };
  }
}

/** Offline forecast: the replayed demo day if there is one, else the sample fixture for its own date. */
function forecastFallback(date: string): ForecastResponse | null {
  if (savedDays[date]) return savedDays[date];
  const sample = asType<ForecastResponse>(forecastFixture);
  return sample.date === date ? sample : null;
}

export async function loadForecast(date: string): Promise<Fetched<ForecastResponse>> {
  try {
    return { data: await api.forecast(date), offline: false };
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    const data = forecastFallback(date);
    if (!data) throw new Error(`API unreachable, and no saved forecast for ${date}.`);
    console.warn(`GET /forecast unreachable; using the saved forecast for ${date}`, error);
    return { data, offline: true };
  }
}
