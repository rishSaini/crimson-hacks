"use client";

import type { PlanResponse } from "@/lib/api";
import type { PlanState } from "@/lib/usePlan";

const SOURCE_LABEL: Record<PlanResponse["source"], string> = {
  uac_live: "Today's UAC forecast",
  demo_replay: "Replaying a real past UAC forecast",
  fixture: "Sample data, not a real forecast",
};

function Details({ result }: { result: PlanResponse }) {
  const totals = result.analysis?.totals;
  const flagged = (totals?.flagged_stretch_count ?? 0) > 0;
  return (
    <>
      <p className={flagged ? "font-medium" : "text-neutral-600"} data-testid="plan-status">
        {result.message}
      </p>
      {totals && (
        <p>
          {Math.round(totals.length_m)} m, {Math.round(totals.climb_ft)} ft of climb
        </p>
      )}
      <ul className="space-y-1 text-xs text-neutral-600">
        <li>
          {SOURCE_LABEL[result.source]}, {result.date}.
        </li>
        {result.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
        <li>Trails and ski areas: {result.attribution}</li>
      </ul>
    </>
  );
}

export function PlanPanel({ plan }: { plan: PlanState }) {
  return (
    <div className="space-y-2 text-sm" data-testid="plan-panel" aria-live="polite">
      {plan.status === "planning" && <p>Planning a line…</p>}
      {plan.status === "error" && <p className="text-red-700">Couldn&apos;t plan this line: {plan.message}</p>}
      {plan.result && <Details result={plan.result} />}
    </div>
  );
}
