import type { DrawPhase } from "@/hooks/useRouteDrawing";

type Props = {
  phase: DrawPhase;
  pointCount: number;
  onUndo: () => void;
  onClear: () => void;
  onFinish: () => void;
  onRetry: () => void;
};

// Outline buttons only: the primary filled button is reserved for Reroute.
const BUTTON =
  "rounded border border-neutral-400 px-3 py-1 text-sm font-medium transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800";

/** Waypoint counter plus Undo, Clear and Finish route for the sidebar. */
export function DrawControls({ phase, pointCount, onUndo, onClear, onFinish, onRetry }: Props) {
  const drawing = phase === "drawing";

  return (
    <div className="space-y-2">
      <p className="text-sm" data-testid="waypoint-count">
        <span className="font-medium tabular-nums">{pointCount}</span>{" "}
        {pointCount === 1 ? "waypoint" : "waypoints"}
        {drawing && pointCount < 2 && (
          <span className="text-neutral-600"> (at least 2 to finish)</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON}
          onClick={onUndo}
          disabled={!drawing || pointCount === 0}
        >
          Undo
        </button>
        <button type="button" className={BUTTON} onClick={onClear} disabled={pointCount === 0}>
          Clear
        </button>
        {phase === "error" ? (
          <button type="button" className={BUTTON} onClick={onRetry}>
            Try again
          </button>
        ) : (
          <button
            type="button"
            className={BUTTON}
            onClick={onFinish}
            disabled={!drawing || pointCount < 2}
          >
            {phase === "analyzing" ? "Checking…" : "Finish route"}
          </button>
        )}
      </div>
    </div>
  );
}
