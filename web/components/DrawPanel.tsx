"use client";

import { DrawControls } from "@/components/map/DrawControls";
import { RouteStatus } from "@/components/map/RouteStatus";
import type { RouteDrawing } from "@/hooks/useRouteDrawing";

/** Sidebar for draw mode: controls, then progress or the analysis summary. */
export function DrawPanel({ route }: { route: RouteDrawing }) {
  const { phase, points, analysis, error } = route;

  return (
    <div className="space-y-3 text-sm" data-testid="draw-panel" aria-live="polite">
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
    </div>
  );
}
