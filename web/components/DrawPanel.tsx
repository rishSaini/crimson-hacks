"use client";

import { ComparisonCard } from "@/components/ComparisonCard";
import { RerouteButton } from "@/components/RerouteButton";
import { DrawControls } from "@/components/map/DrawControls";
import { RouteStatus } from "@/components/map/RouteStatus";
import type { Reroute } from "@/hooks/useReroute";
import type { RouteDrawing } from "@/hooks/useRouteDrawing";
import type { Fetched } from "@/lib/analysis";
import type { ForecastResponse } from "@/lib/api";
import type { LngLat } from "@/lib/geo";

type Props = {
  route: RouteDrawing;
  reroute: Reroute;
  forecast: Fetched<ForecastResponse> | null;
  forcedByWarning: boolean;
  /** Computed by the workspace from `flagged_stretch_count`, shared with the map's button. */
  showReroute: boolean;
};

/** Sidebar for draw mode: Reroute, controls, then the summary and the comparison card. */
export function DrawPanel({ route, reroute, forecast, forcedByWarning, showReroute }: Props) {
  const { phase, points, analysis, error } = route;
  const rerouteState = reroute.state;

  const adoptReroute = () => {
    if (rerouteState.status !== "done") return;
    const { alternative, analysis: newAnalysis } = rerouteState.result;
    if (!alternative.alternative || !newAnalysis) return;
    route.adopt(alternative.alternative.coordinates as LngLat[], newAnalysis);
  };

  return (
    <div className="space-y-3 text-sm" data-testid="draw-panel" aria-live="polite">
      {showReroute && (
        <RerouteButton
          loading={rerouteState.status === "loading"}
          onClick={reroute.start}
          className="w-full"
        />
      )}

      <DrawControls
        phase={phase}
        pointCount={points.length}
        onUndo={route.undo}
        onClear={route.clear}
        onFinish={route.finish}
        onRetry={route.reanalyze}
      />

      {phase === "drawing" && (
        <p className="text-neutral-600">
          Click the map to drop waypoints. Double-click or press Finish route to check it
          against the forecast.
        </p>
      )}
      {phase === "analyzing" && <p>Checking your route against the forecast…</p>}
      {phase === "error" && (
        <p className="text-red-700">Couldn&apos;t check this route: {error ?? "no response"}</p>
      )}
      {phase === "analyzed" && analysis && <RouteStatus analysis={analysis} />}

      {phase === "analyzed" && rerouteState.status !== "idle" && (
        <ComparisonCard
          state={rerouteState}
          forecast={forecast}
          forcedByWarning={forcedByWarning}
          onUse={adoptReroute}
          onUndo={reroute.undo}
          onRetry={reroute.start}
        />
      )}
    </div>
  );
}
