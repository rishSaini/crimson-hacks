import type { Fetched } from "@/lib/analysis";
import type { AnalyzeResponse } from "@/lib/api";
import { formatDistance } from "@/lib/geo";
import { sourceLabel, summarizeRoute, type SummaryTone } from "@/lib/route-summary";
import { SEGMENT_HEX } from "@/lib/segment-style";

const TONE_CLASSES: Record<SummaryTone, string> = {
  flagged: "border-red-300 bg-red-50 text-red-900",
  listed: "border-amber-300 bg-amber-50 text-amber-900",
  none: "border-neutral-300 bg-neutral-100 text-neutral-700",
};

const meters = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;

/** Route summary after POST /analyze: banner, totals, legend and data source. */
export function RouteStatus({ analysis }: { analysis: Fetched<AnalyzeResponse> }) {
  const { data, offline } = analysis;
  const { totals } = data;
  const summary = summarizeRoute(totals);

  return (
    <div className="space-y-3 text-sm" data-testid="route-summary">
      {offline && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
          API unreachable. Showing the sample fixture route, not your line.
        </p>
      )}

      {data.forced_by_warning && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-red-900">
          An Avalanche Warning is in effect for this forecast day, so every slope 30° and
          steeper is flagged.
        </p>
      )}

      <p className={`rounded border p-2 ${TONE_CLASSES[summary.tone]}`} data-testid="route-banner">
        {summary.text}
      </p>

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt className="text-neutral-600">Distance</dt>
        <dd className="text-right tabular-nums">{formatDistance(totals.length_m)}</dd>
        <dt className="text-neutral-600">Climb</dt>
        <dd className="text-right tabular-nums">
          {Math.round(totals.climb_ft).toLocaleString("en-US")} ft
        </dd>
        <dt className="text-neutral-600">Steep segments (30°+)</dt>
        <dd className="text-right tabular-nums">{totals.steep_segment_count}</dd>
        <dt className="text-neutral-600">Flagged stretches</dt>
        <dd className="text-right tabular-nums">
          {totals.flagged_stretch_count}
          {totals.flagged_stretch_count > 0 && ` (${meters(totals.flagged_length_m)})`}
        </dd>
      </dl>

      <ul className="space-y-1 text-xs text-neutral-600" aria-label="Line legend">
        <LegendItem color={SEGMENT_HEX.gray} label="Under 30°: no avalanche-terrain flag" />
        <LegendItem color={SEGMENT_HEX.unrated} dashed label="30°+ with no rating today (? pin)" />
        <li>Colored lines are 30°+, by today&apos;s rating. Thicker lines are flagged at your setting.</li>
      </ul>

      <p className="text-xs text-neutral-600">
        {sourceLabel(data.source, data.date)}{" "}
        <code className="rounded bg-neutral-100 px-1 font-mono dark:bg-neutral-800">
          source: {data.source}
        </code>
      </p>
    </div>
  );
}

function LegendItem({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block w-6 border-t-[3px]"
        style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
      />
      {label}
    </li>
  );
}
