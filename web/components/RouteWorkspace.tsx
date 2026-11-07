"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiCheck } from "@/components/ApiCheck";
import { MapView } from "@/components/MapView";
import { PlanLayers } from "@/components/PlanLayers";
import { PlanPanel } from "@/components/PlanPanel";
import { usePlan, type LngLat } from "@/lib/usePlan";

type Mode = "draw" | "plan";

const DEMO_DATE = "2026-02-21";
const INITIAL_POINTS = {
  start: [-111.72, 40.572] as LngLat,
  end: [-111.68, 40.578] as LngLat,
};

export function RouteWorkspace() {
  const [mode, setMode] = useState<Mode>("draw");
  const { points, plan, onDragStart, onDrag, onDragEnd } = usePlan({
    enabled: mode === "plan",
    date: DEMO_DATE,
    avoidAtOrAbove: "considerable",
    initialPoints: INITIAL_POINTS,
  });
  const result = plan.result;

  return (
    <main className="flex h-screen flex-col md:flex-row">
      <div className="min-h-0 flex-1">
        <MapView>
          {mode === "plan" && (
            <PlanLayers
              points={points}
              analysis={result?.analysis ?? null}
              onDragStart={onDragStart}
              onDrag={onDrag}
              onDragEnd={onDragEnd}
            />
          )}
        </MapView>
      </div>
      <aside className="space-y-4 overflow-y-auto border-t p-4 md:w-96 md:border-t-0 md:border-l">
        <Link className="block text-sm font-medium underline" href="/preview">
          Open route preview
        </Link>
        <div role="group" aria-label="Route mode" className="inline-flex rounded border text-sm">
          {(["draw", "plan"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`px-3 py-1 capitalize ${mode === option ? "bg-neutral-800 text-white" : ""}`}
            >
              {option}
            </button>
          ))}
        </div>
        {mode === "draw" ? (
          <p className="text-sm text-neutral-600">Click-to-draw isn&apos;t built yet.</p>
        ) : (
          <PlanPanel plan={plan} />
        )}
        <ApiCheck />
      </aside>
    </main>
  );
}
