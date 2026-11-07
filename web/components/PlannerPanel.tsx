"use client";

import type { AlternativeResponse, PlanResponse } from "@/lib/api";
import { DEMO_DAYS, type AvoidSetting, type RoutePlanner } from "@/lib/useRoutePlanner";

const OUTLINE = "rounded-md border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-45";
const FILLED = "w-full rounded-md bg-sky-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-45";
const INPUT = "mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm";
const SOURCE_LABEL: Record<PlanResponse["source"], string> = {
  uac_live: "Today's UAC forecast",
  demo_replay: "Replaying a real past UAC forecast",
  fixture: "Sample data, not a real forecast",
};
const WIDER = [800, 1500];

function feet(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value)).toLocaleString()} ft`;
}

function meters(value: number) {
  return `${Math.round(value).toLocaleString()} m`;
}

function ForecastCard({ planner }: { planner: RoutePlanner }) {
  const forecast = planner.forecast;
  if (!forecast) return null;
  const alert = forecast.alert;
  return (
    <section aria-label="UAC forecast" data-testid="uac-forecast"
      className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs">
      <p className="font-semibold">From the Utah Avalanche Center</p>
      {alert.level !== "none" && (
        <div className="space-y-1 rounded bg-amber-950 p-2 text-amber-100">
          <p className="font-semibold">
            {alert.level === "warning" ? "Avalanche Warning" : alert.level === "watch" ? "Avalanche Watch" : "Special Avalanche Bulletin"}
          </p>
          <p>{alert.what}</p>
          <p>{alert.where}</p>
          {alert.impacts && <p>{alert.impacts}</p>}
          {alert.what_to_do && <p>{alert.what_to_do}</p>}
        </div>
      )}
      <p className="whitespace-pre-line text-slate-300">{forecast.bottom_line}</p>
      <a href={forecast.forecast_url} target="_blank" rel="noreferrer" className="inline-block text-sky-300 underline">
        Read the full forecast
      </a>
    </section>
  );
}

function RerouteResult({ planner, result, override }: {
  planner: RoutePlanner;
  result: AlternativeResponse;
  override: AvoidSetting | null;
}) {
  const comparison = result.comparison;
  if (!comparison) {
    const wider = WIDER.find((width) => width > result.corridor_width_m);
    const fallbacks = result.fallbacks ?? [];
    return (
      <section data-testid="reroute-result" className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
        <p className="font-medium">{result.message}</p>
        {fallbacks.length > 0 && <ul className="space-y-2 text-xs">
          {wider && fallbacks.includes("widen_corridor") && (
            <li><button type="button" className={OUTLINE} onClick={() => void planner.runReroute(wider, override ?? planner.setting, override)}>
              Go further around ({wider.toLocaleString()} m)
            </button></li>
          )}
          {result.turnaround_point && <li>Stop short: the turnaround on the map is the highest point before the first flagged stretch.</li>}
          {fallbacks.includes("nearby_tours") && <li>Go somewhere else: try Mapped sections above for other routes.</li>}
        </ul>}
      </section>
    );
  }
  return (
    <section data-testid="reroute-result" className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
      <p className="font-medium">{result.message}</p>
      <dl className="grid grid-cols-2 gap-1 text-xs">
        <dt className="text-slate-300">Flagged before</dt><dd>{meters(comparison.original_flagged_m)}</dd>
        <dt className="text-slate-300">Flagged after</dt><dd>{meters(comparison.alternative_flagged_m)}</dd>
        <dt className="text-slate-300">Distance change</dt><dd>{comparison.added_distance_m >= 0 ? "+" : "−"}{meters(Math.abs(comparison.added_distance_m))}</dd>
        <dt className="text-slate-300">Climb change</dt><dd>{feet(comparison.added_climb_ft)}</dd>
        <dt className="text-slate-300">Strays from your line</dt><dd>{meters(comparison.max_deviation_m)}</dd>
      </dl>
      {result.forced_by_warning && <p className="font-medium text-amber-200">UAC recommends avoiding all avalanche terrain today.</p>}
      {planner.forecast?.comparison_advice && (
        <p className="text-xs text-amber-200">UAC: “{planner.forecast.comparison_advice}”</p>
      )}
      <div className="flex gap-2">
        <button type="button" className={OUTLINE} onClick={planner.acceptReroute}>Use this route</button>
        <button type="button" className={OUTLINE} onClick={planner.undoReroute}>Undo</button>
      </div>
      {override && !result.forced_by_warning && override !== planner.setting && (
        <button type="button" className="text-xs text-sky-300 underline" onClick={() => planner.setSetting(override)}>Make this my default</button>
      )}
    </section>
  );
}

export function PlannerPanel({ planner }: { planner: RoutePlanner }) {
  const { plan, current, reroute, planning } = planner;
  const totals = current?.totals;
  const forced = plan?.forced_by_warning ?? false;
  const flagged = totals?.flagged_stretch_count ?? 0;
  const steep = totals?.steep_stretch_count ?? 0;
  const rerouted = reroute.status === "done";
  const busy = planning || reroute.status === "loading";
  const message = current && plan && current !== plan.analysis
    ? flagged > 0 ? `${flagged} ${flagged === 1 ? "stretch crosses" : "stretches cross"} flagged terrain (${meters(totals?.flagged_length_m ?? 0)}).` : "No flags found on this route today."
    : plan?.message;

  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label>Forecast day
          <select className={INPUT} value={planner.date} onChange={(event) => planner.setDate(event.target.value)}>
            {DEMO_DAYS.map((day) => <option key={day.date} value={day.date}>{day.label}</option>)}
          </select>
        </label>
        <label>Flag and avoid
          <select className={INPUT} value={planner.setting} disabled={forced}
            onChange={(event) => planner.setSetting(event.target.value as AvoidSetting)}>
            <option value="considerable">Considerable and up</option>
            <option value="moderate">Also avoid Moderate</option>
            <option value="low">Beginner mode: stay off and out from under slopes 30° and steeper</option>
          </select>
        </label>
      </div>
      {planner.setting === "low" && <p className="text-xs text-slate-300">Checks slopes on your route and within 300 m uphill.</p>}
      {forced && <p className="rounded bg-amber-950 p-2 text-xs text-amber-100">
        Avalanche Warning in effect. All slopes 30° and steeper are flagged for this forecast day, whatever your setting.
      </p>}

      {planner.points.length < 2 && <p className="text-slate-300">
        {planner.points.length === 0 ? "Click the map to place your start." : "Click the map to place your destination."}
      </p>}
      {planning && <p>Planning a route…</p>}
      {planner.planError && <p role="alert" className="rounded-md bg-red-950 p-3 text-red-200">Couldn&apos;t plan this route: {planner.planError}</p>}

      {plan && (
        <section data-testid="plan-result" className="space-y-2">
          <p data-testid="plan-status" className={flagged > 0 ? "font-semibold" : "text-slate-300"}>{message}</p>
          {totals && <p className="text-xs text-slate-300">{meters(totals.length_m)} · {Math.round(totals.climb_ft).toLocaleString()} ft of climb</p>}
          {current && current.flagged_stretches.length > 0 && !rerouted && (
            <ol className="space-y-1 text-xs">
              {current.flagged_stretches.map((stretch) => (
                <li key={stretch.id}>
                  {stretch.id}. {meters(stretch.flagged_length_m)} flagged, rated {stretch.max_danger === "no_rating" ? "unrated" : stretch.max_danger}
                </li>
              ))}
            </ol>
          )}
          {flagged > 0 && !rerouted && (
            <>
              <button type="button" disabled={busy} className={FILLED} onClick={() => void planner.runReroute(planner.corridor)}>
                {reroute.status === "loading" ? "Finding a way around…" : `Reroute around ${flagged} flagged ${flagged === 1 ? "stretch" : "stretches"}`}
              </button>
              <label className="block text-xs">Stay within {planner.corridor} m of this line
                <input className="mt-1 w-full" type="range" min={200} max={800} step={100} value={planner.corridor}
                  onChange={(event) => planner.setCorridor(Number(event.target.value))} />
              </label>
            </>
          )}
          {flagged === 0 && steep > 0 && !rerouted && (
            <button type="button" disabled={busy} className={OUTLINE} onClick={() => {
              const lowest = totals?.steep_ratings[0] as AvoidSetting | undefined;
              if (lowest) void planner.runReroute(planner.corridor, lowest, lowest);
            }}>{reroute.status === "loading" ? "Finding a way around…" : "Avoid these too"}</button>
          )}
          {reroute.status === "error" && <p role="alert" className="rounded-md bg-red-950 p-3 text-red-200">Couldn&apos;t reroute: {reroute.message}</p>}
          {reroute.status === "done" && (
            <RerouteResult planner={planner} result={reroute.result} override={reroute.override} />
          )}
          <ul className="space-y-1 text-xs text-slate-400">
            <li>{SOURCE_LABEL[plan.source]}, {plan.date}.</li>
            {plan.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            <li>Trails and ski areas: {plan.attribution}</li>
          </ul>
        </section>
      )}
      <ForecastCard planner={planner} />
    </div>
  );
}
