"use client";

import Link from "next/link";
import { useState } from "react";
import { MapProvider } from "react-map-gl/mapbox";
import { AlertBanner } from "@/components/AlertBanner";
import { ApiCheck } from "@/components/ApiCheck";
import { DrawPanel } from "@/components/DrawPanel";
import { ForecastCard } from "@/components/ForecastCard";
import { MapView } from "@/components/MapView";
import { DrawRouteLayers } from "@/components/map/RouteLayers";
import { PlanLayers } from "@/components/PlanLayers";
import { PlanPanel } from "@/components/PlanPanel";
import { RerouteButton } from "@/components/RerouteButton";
import { DEFAULT_DEMO_DATE, RouteSettings, type DemoDate } from "@/components/RouteSettings";
import { useForecast } from "@/hooks/useForecast";
import { useReroute } from "@/hooks/useReroute";
import { useRouteDrawing } from "@/hooks/useRouteDrawing";
import type { AvoidAtOrAbove } from "@/lib/analysis";
import { MAP_ID } from "@/lib/camera";
import { usePlan, type LngLat } from "@/lib/usePlan";

type Mode = "draw" | "plan";

const INITIAL_POINTS = {
  start: [-111.72, 40.572] as LngLat,
  end: [-111.68, 40.578] as LngLat,
};

export function RouteWorkspace() {
  const [mode, setMode] = useState<Mode>("draw");
  const [date, setDate] = useState<DemoDate>(DEFAULT_DEMO_DATE);
  // The saved setting. A Warning day overrides it server-side and never changes it.
  const [avoidAtOrAbove, setAvoidAtOrAbove] = useState<AvoidAtOrAbove>("considerable");

  const { forecast, loading: forecastLoading, error: forecastError } = useForecast(date);
  const warningDay = forecast?.data.alert.level === "warning";

  const { points, plan, onDragStart, onDrag, onDragEnd } = usePlan({
    enabled: mode === "plan",
    date,
    avoidAtOrAbove,
    initialPoints: INITIAL_POINTS,
  });
  const route = useRouteDrawing({ enabled: mode === "draw", date, avoidAtOrAbove });
  const reroute = useReroute({ route, avoidAtOrAbove, date });

  const analysis = route.phase === "analyzed" ? route.analysis?.data : undefined;
  const forcedByWarning = warningDay || (analysis?.forced_by_warning ?? false);
  // Reroute shows if and only if the current route has flagged stretches. While a
  // reroute is on screen, the comparison card's Use this route / Undo take over.
  const showReroute =
    mode === "draw" &&
    (analysis?.totals.flagged_stretch_count ?? 0) > 0 &&
    reroute.state.status !== "done";

  // Settings and date apply to the current route straight away.
  const changeDate = (next: DemoDate) => {
    setDate(next);
    route.reanalyze();
  };
  const changeAvoid = (next: AvoidAtOrAbove) => {
    setAvoidAtOrAbove(next);
    route.reanalyze();
  };

  return (
    <MapProvider>
      <div className="flex h-screen flex-col">
        <AlertBanner forecast={forecast} forced={forcedByWarning} />

        <main className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative min-h-0 flex-1">
            <MapView
              id={MAP_ID}
              drawing={route.isDrawing}
              onClick={route.handleMapClick}
              onDblClick={route.handleMapDblClick}
            >
              {mode === "draw" && <DrawRouteLayers route={route} reroute={reroute} />}
              {mode === "plan" && (
                <PlanLayers
                  points={points}
                  analysis={plan.result?.analysis ?? null}
                  onDragStart={onDragStart}
                  onDrag={onDrag}
                  onDragEnd={onDragEnd}
                />
              )}
            </MapView>
            {showReroute && (
              <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center">
                <RerouteButton
                  loading={reroute.state.status === "loading"}
                  onClick={reroute.start}
                />
              </div>
            )}
          </div>

          <aside className="space-y-4 overflow-y-auto border-t p-4 md:w-96 md:border-t-0 md:border-l">
            <Link className="block text-sm font-medium underline" href="/preview">
              Open route preview
            </Link>
            <RouteSettings
              date={date}
              onDateChange={changeDate}
              avoidAtOrAbove={avoidAtOrAbove}
              onAvoidChange={changeAvoid}
              forcedByWarning={forcedByWarning}
            />
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
              <DrawPanel
                route={route}
                reroute={reroute}
                forecast={forecast}
                forcedByWarning={forcedByWarning}
                showReroute={showReroute}
              />
            ) : (
              <PlanPanel plan={plan} />
            )}
            <ForecastCard forecast={forecast} loading={forecastLoading} error={forecastError} />
            <ApiCheck />
          </aside>
        </main>
      </div>
    </MapProvider>
  );
}
