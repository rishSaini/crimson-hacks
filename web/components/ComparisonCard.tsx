import type { RerouteState } from "@/hooks/useReroute";
import type { Fetched } from "@/lib/analysis";
import type { ForecastResponse } from "@/lib/api";
import { sourceLabel } from "@/lib/route-summary";

type Props = {
  state: Exclude<RerouteState, { status: "idle" }>;
  forecast: Fetched<ForecastResponse> | null;
  forcedByWarning: boolean;
  onUse: () => void;
  onUndo: () => void;
  onRetry: () => void;
};

const BUTTON =
  "rounded border border-neutral-400 px-3 py-1 text-sm font-medium transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800";

const meters = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;
const signed = (n: number, unit: string) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString("en-US")} ${unit}`;

/** Before-and-after for a reroute, with the meters it leaves behind always shown. */
export function ComparisonCard({ state, forecast, forcedByWarning, onUse, onUndo, onRetry }: Props) {
  if (state.status === "loading") {
    return <p className="text-sm">Finding a lower-exposure line…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2 text-sm" role="alert">
        <p className="text-red-700">Couldn&apos;t reroute: {state.message}</p>
        <div className="flex gap-2">
          <button type="button" className={BUTTON} onClick={onRetry}>
            Try again
          </button>
          <button type="button" className={BUTTON} onClick={onUndo}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const { alternative, analysis, analysisError, offline } = state.result;
  const comparison = alternative.comparison;
  const advice = forecast?.data.comparison_advice;

  return (
    <section
      className="space-y-3 rounded border border-neutral-300 p-3 text-sm dark:border-neutral-700"
      aria-label="Reroute comparison"
      data-testid="comparison-card"
    >
      <h2 className="font-semibold">Reroute</h2>

      {offline && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
          API unreachable. Showing the sample fixture reroute, not one for your line.
        </p>
      )}

      {forcedByWarning && (
        <p className="font-semibold text-red-800 dark:text-red-300" data-testid="warning-advice">
          UAC recommends avoiding all avalanche terrain today.
        </p>
      )}

      <p>{alternative.message}</p>

      {alternative.status === "found" && comparison && (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt className="text-neutral-600">Flagged on your route</dt>
            <dd className="text-right tabular-nums">{meters(comparison.original_flagged_m)}</dd>
            <dt className="font-medium">Still flagged on the new line</dt>
            <dd className="text-right font-medium tabular-nums" data-testid="meters-left">
              {meters(comparison.alternative_flagged_m)}
            </dd>
            <dt className="text-neutral-600">Added distance</dt>
            <dd className="text-right tabular-nums">{signed(comparison.added_distance_m, "m")}</dd>
            <dt className="text-neutral-600">Added climb</dt>
            <dd className="text-right tabular-nums">{signed(comparison.added_climb_ft, "ft")}</dd>
            <dt className="text-neutral-600">Farthest from your line</dt>
            <dd className="text-right tabular-nums">{meters(comparison.max_deviation_m)}</dd>
          </dl>

          <p className="text-xs text-neutral-600">
            Dashed gray is your original line. Computer-generated line, not a known skin track.
            Check it against a map.
          </p>
          {analysisError && <p className="text-xs text-neutral-600">{analysisError}</p>}
        </>
      )}

      {advice && forecast && (
        <figure className="space-y-1 border-l-2 border-neutral-400 pl-3">
          <blockquote>{advice}</blockquote>
          <figcaption className="text-xs text-neutral-600">
            Utah Avalanche Center, quoted verbatim.{" "}
            <a className="underline" href={forecast.data.forecast_url} target="_blank" rel="noreferrer">
              Full forecast
            </a>
          </figcaption>
        </figure>
      )}

      <div className="flex flex-wrap gap-2">
        {alternative.status === "found" && (
          <button
            type="button"
            className={BUTTON}
            onClick={onUse}
            disabled={!analysis}
            title={analysis ? undefined : "Needs the new line's analysis from the API"}
          >
            Use this route
          </button>
        )}
        <button type="button" className={BUTTON} onClick={onUndo}>
          Undo
        </button>
      </div>

      <p className="text-xs text-neutral-600">
        {sourceLabel(alternative.source, alternative.date)}{" "}
        <code className="rounded bg-neutral-100 px-1 font-mono dark:bg-neutral-800">
          source: {alternative.source}
        </code>
      </p>
    </section>
  );
}
