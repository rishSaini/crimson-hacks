import type { Fetched } from "@/lib/analysis";
import type { AnalyzeResponse } from "@/lib/api";
import { formatDistance } from "@/lib/geo";
import { sourceLabel, summarizeRoute, type SummaryTone } from "@/lib/route-summary";
import type { DrawPhase } from "@/hooks/useRouteDrawing";

type Props = {
  phase: DrawPhase;
  pointCount: number;
  analysis: Fetched<AnalyzeResponse> | null;
  error: string | null;
};

const TONE_CLASSES: Record<SummaryTone, string> = {
  flagged: "border-red-500/60 bg-red-950/70 text-red-50",
  listed: "border-amber-400/60 bg-amber-950/70 text-amber-50",
  none: "border-neutral-500/60 bg-neutral-800/80 text-neutral-200",
};

const CARD = "pointer-events-auto w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-white/10 bg-neutral-950/80 p-3 text-sm text-neutral-100 shadow-lg backdrop-blur";

/** Floating card: drawing hints, then distance, steep segment count, banner and data source. */
export function RouteStatus({ phase, pointCount, analysis, error }: Props) {
  if (phase === "drawing") {
    return (
      <div className={CARD}>
        <p className="font-medium">Draw your tour</p>
        <p className="mt-1 text-neutral-300">
          {pointCount === 0
            ? "Click the map to drop waypoints. Double-click to finish."
            : `${pointCount} ${pointCount === 1 ? "waypoint" : "waypoints"}. Double-click or press Finish to check the route.`}
        </p>
      </div>
    );
  }

  if (phase === "analyzing") {
    return (
      <div className={CARD} role="status" aria-live="polite">
        <p className="font-medium">Checking route against the forecast…</p>
      </div>
    );
  }

  if (phase === "error" || !analysis) {
    return (
      <div className={`${CARD} border-red-500/60`} role="alert">
        <p className="font-medium text-red-300">Route analysis failed</p>
        <p className="mt-1 text-neutral-300">{error ?? "No response from the API."}</p>
      </div>
    );
  }

  const { data, offline } = analysis;
  const { totals } = data;
  const summary = summarizeRoute(totals);

  return (
    <div className={CARD} role="status" aria-live="polite">
      {offline && (
        <p className="mb-2 rounded border border-amber-400/60 bg-amber-900/60 p-2 text-amber-50">
          API unreachable. Showing the sample fixture route, not your line.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-neutral-400">Distance</dt>
        <dd className="text-right tabular-nums">{formatDistance(totals.length_m)}</dd>
        <dt className="text-neutral-400">Steep segments (30°+)</dt>
        <dd className="text-right tabular-nums">{totals.steep_segment_count}</dd>
      </dl>

      <p className={`mt-2 rounded border p-2 ${TONE_CLASSES[summary.tone]}`}>{summary.text}</p>

      <p className="mt-2 text-xs text-neutral-400">
        {sourceLabel(data.source, data.date)}{" "}
        <code className="rounded bg-white/10 px-1 font-mono">source: {data.source}</code>
      </p>
    </div>
  );
}
