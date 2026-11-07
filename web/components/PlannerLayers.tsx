"use client";

import { Layer, Marker, Source } from "react-map-gl/maplibre";
import type { RoutePlanner } from "@/lib/useRoutePlanner";

const SEGMENT_COLOR = [
  "match",
  ["get", "color"],
  "gray", "#64748b",
  "unrated", "#d946ef",
  "green", "#16a34a",
  "yellow", "#eab308",
  "orange", "#f97316",
  "red", "#dc2626",
  "black", "#111111",
  "#64748b",
] as const;

/** The route colored by its analysis, its pins, and the original line after a reroute. */
export function PlannerLayers({ planner }: { planner: RoutePlanner }) {
  const { activeAnalysis, ghost, points, reroute } = planner;
  const turnaround = reroute.status === "done" ? reroute.result.turnaround_point : null;
  return (
    <>
      {ghost && (
        <Source id="plan-ghost" type="geojson" data={ghost.segments as never}>
          <Layer id="plan-ghost-line" type="line" paint={{
            "line-color": "#6b7280", "line-width": 3, "line-opacity": 0.8, "line-dasharray": [2, 2],
          }} />
        </Source>
      )}
      {activeAnalysis && (
        <Source id="plan-route" type="geojson" data={activeAnalysis.segments as never}>
          <Layer id="plan-route-solid" type="line"
            filter={["!=", ["get", "color"], "unrated"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": SEGMENT_COLOR as never,
              "line-width": ["case", ["get", "flagged"], 6, 3.5] as never,
            }} />
          <Layer id="plan-route-unrated" type="line"
            filter={["==", ["get", "color"], "unrated"]}
            paint={{ "line-color": SEGMENT_COLOR as never, "line-width": 6, "line-dasharray": [2, 2] }} />
        </Source>
      )}
      {activeAnalysis?.flagged_stretches.map((stretch) => (
        <Marker key={stretch.id} longitude={stretch.pin[0]} latitude={stretch.pin[1]}>
          <span data-testid="stretch-pin"
            className="flex size-5 items-center justify-center rounded-full border border-white bg-slate-950 text-[10px] font-bold text-white">
            {stretch.max_danger === "no_rating" ? "?" : stretch.id}
          </span>
        </Marker>
      ))}
      {turnaround && (
        <Marker longitude={turnaround[0]} latitude={turnaround[1]} anchor="bottom">
          <span title="Highest point on your route before its first flagged stretch"
            className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-900 shadow">
            Turnaround
          </span>
        </Marker>
      )}
      {points.map(([longitude, latitude], index) => (
        <Marker key={index} draggable longitude={longitude} latitude={latitude} anchor="bottom"
          onDragStart={planner.cancel}
          onDrag={(event) => planner.movePoint(index, [event.lngLat.lng, event.lngLat.lat])}
          onDragEnd={(event) => planner.dropPoint(index, [event.lngLat.lng, event.lngLat.lat])}>
          <span data-testid={`plan-pin-${index}`} aria-label={index === 0 ? "Start pin" : "Destination pin"}
            className="flex size-7 cursor-grab items-center justify-center rounded-full border-2 border-white bg-violet-700 text-xs font-bold text-white shadow">
            {index === 0 ? "A" : "B"}
          </span>
        </Marker>
      ))}
    </>
  );
}
