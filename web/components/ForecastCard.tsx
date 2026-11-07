import { DangerRose } from "@/components/DangerRose";
import type { Fetched } from "@/lib/analysis";
import type { ForecastResponse } from "@/lib/api";
import { DANGER_HEX, DANGER_LABEL, DANGER_TEXT } from "@/lib/danger";
import { sourceLabel } from "@/lib/route-summary";

type Props = {
  forecast: Fetched<ForecastResponse> | null;
  loading: boolean;
  error: string | null;
};

/** Overall rating, danger rose and UAC's own words for the selected forecast day. */
export function ForecastCard({ forecast, loading, error }: Props) {
  if (loading) {
    return <p className="text-sm text-neutral-600">Loading the forecast…</p>;
  }
  if (error || !forecast) {
    return (
      <p className="text-sm text-red-700" role="alert">
        Couldn&apos;t load the forecast: {error ?? "no response"}
      </p>
    );
  }

  const { data, offline } = forecast;
  const overall = data.overall_danger;

  return (
    <section
      className="space-y-3 rounded border border-neutral-300 p-3 text-sm dark:border-neutral-700"
      aria-label="Avalanche forecast"
      data-testid="forecast-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Forecast, {data.date}</h2>
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: DANGER_HEX[overall], color: DANGER_TEXT[overall] }}
          data-testid="overall-danger"
        >
          {overall === "no_rating" ? "No rating" : `${DANGER_LABEL[overall]} overall`}
        </span>
      </div>

      {!data.ratings_issued && (
        <p className="rounded border border-neutral-300 bg-neutral-100 p-2 dark:bg-neutral-800">
          No danger ratings issued today. Steep terrain is shown as unrated.
        </p>
      )}

      <DangerRose rose={data.rose} />

      <div className="space-y-2 border-l-2 border-neutral-400 pl-3">
        <p>
          <span className="font-semibold">Bottom line: </span>
          {data.bottom_line}
        </p>
        {data.problems.length > 0 && (
          <ul className="space-y-1">
            {data.problems.map((problem) => (
              <li key={problem.name}>
                <span className="font-semibold">{problem.name}: </span>
                {problem.description}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-neutral-600">
          Utah Avalanche Center, quoted verbatim.{" "}
          <a className="underline" href={data.forecast_url} target="_blank" rel="noreferrer">
            Read the full forecast
          </a>
        </p>
      </div>

      <p className="text-xs text-neutral-600">
        {sourceLabel(data.source, data.date)}
        {offline && " (saved copy: API unreachable)"}{" "}
        <code className="rounded bg-neutral-100 px-1 font-mono dark:bg-neutral-800">
          source: {data.source}
        </code>
      </p>
    </section>
  );
}
