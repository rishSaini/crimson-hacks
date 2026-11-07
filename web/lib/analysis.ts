import {
  api,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type ForecastResponse,
} from "@/lib/api";
import type { LngLat } from "@/lib/geo";

// Shared-contract fixtures from the repo root (see turbopack.root in next.config.ts).
// api/tests/test_contract.py validates them against the models, so treating the
// JSON imports as the generated types is sound.
import analyzeFixture from "../../fixtures/analyze.response.json";
import forecastFixture from "../../fixtures/forecast.response.json";

export type AvoidAtOrAbove = AnalyzeRequest["avoid_at_or_above"];
export type Segment = AnalyzeResponse["segments"]["features"][number];
export type SegmentColor = Segment["properties"]["color"];
export type DataSource = AnalyzeResponse["source"];

/**
 * A response plus whether it came from the bundled fixture because the API was
 * unreachable. When `offline` is true the geometry is the fixture's sample route,
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
    console.warn("POST /analyze unreachable; using fixtures/analyze.response.json", error);
    return { data: analyzeFixture as unknown as AnalyzeResponse, offline: true };
  }
}

export async function loadForecast(date?: string): Promise<Fetched<ForecastResponse>> {
  try {
    return { data: await api.forecast(date), offline: false };
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    console.warn("GET /forecast unreachable; using fixtures/forecast.response.json", error);
    return { data: forecastFixture as unknown as ForecastResponse, offline: true };
  }
}
