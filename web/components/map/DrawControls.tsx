import type { DrawPhase } from "@/hooks/useRouteDrawing";

type Props = {
  phase: DrawPhase;
  pointCount: number;
  onUndo: () => void;
  onFinish: () => void;
  onRetry: () => void;
  onClear: () => void;
};

// Outline buttons only: the primary filled button is reserved for Reroute.
const BUTTON =
  "rounded-md border border-white/70 bg-neutral-950/70 px-3 py-1.5 text-sm font-medium text-white shadow backdrop-blur transition hover:bg-neutral-800/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40";

export function DrawControls({ phase, pointCount, onUndo, onFinish, onRetry, onClear }: Props) {
  if (phase === "drawing" && pointCount === 0) return null;

  return (
    <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
      {phase === "drawing" && (
        <>
          <button type="button" className={BUTTON} onClick={onUndo}>
            Undo point
          </button>
          {/* Also the way to finish on touch screens, where double-tap zooms. */}
          <button type="button" className={BUTTON} onClick={onFinish} disabled={pointCount < 2}>
            Finish route
          </button>
        </>
      )}
      {phase === "error" && (
        <button type="button" className={BUTTON} onClick={onRetry}>
          Try again
        </button>
      )}
      <button type="button" className={BUTTON} onClick={onClear}>
        Clear / Redraw
      </button>
    </div>
  );
}
