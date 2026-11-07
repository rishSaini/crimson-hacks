"use client";

import { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { AnalyzeResponse } from "@/lib/api";
import type { LngLat, PlanEnd, PlanPoints } from "@/lib/usePlan";

const SEGMENT_COLOR = [
  "match",
  ["get", "color"],
  "gray", "#9ca3af",
  "unrated", "#d946ef",
  "green", "#16a34a",
  "yellow", "#facc15",
  "orange", "#f97316",
  "red", "#dc2626",
  "black", "#111111",
  "#9ca3af",
] as const;

function PlanMarker({
  end,
  position,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  end: PlanEnd;
  position: LngLat;
  onDragStart: () => void;
  onDrag: (end: PlanEnd, position: LngLat) => void;
  onDragEnd: (end: PlanEnd, position: LngLat) => void;
}) {
  return (
    <Marker
      draggable
      longitude={position[0]}
      latitude={position[1]}
      onDragStart={onDragStart}
      onDrag={(event) => onDrag(end, [event.lngLat.lng, event.lngLat.lat])}
      onDragEnd={(event) => onDragEnd(end, [event.lngLat.lng, event.lngLat.lat])}
    >
      <div
        aria-label={end === "start" ? "Plan start" : "Plan end"}
        data-testid={`plan-marker-${end}`}
        className="flex h-7 w-7 cursor-grab items-center justify-center rounded-full border-2 border-white bg-blue-700 text-xs font-bold text-white shadow"
      >
        {end === "start" ? "A" : "B"}
      </div>
    </Marker>
  );
}

/** The two draggable points and the planned line, colored by its analysis. */
export function PlanLayers({
  points,
  analysis,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  points: PlanPoints;
  analysis: AnalyzeResponse | null;
  onDragStart: () => void;
  onDrag: (end: PlanEnd, position: LngLat) => void;
  onDragEnd: (end: PlanEnd, position: LngLat) => void;
}) {
  return (
    <>
      {analysis && (
        <Source id="plan-route" type="geojson" data={analysis.segments as never}>
          <Layer
            id="plan-route-solid"
            type="line"
            filter={["!=", ["get", "color"], "unrated"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-width": 4, "line-color": SEGMENT_COLOR as never }}
          />
          <Layer
            id="plan-route-unrated"
            type="line"
            filter={["==", ["get", "color"], "unrated"]}
            paint={{
              "line-width": 4,
              "line-color": SEGMENT_COLOR as never,
              "line-dasharray": [2, 2],
            }}
          />
        </Source>
      )}
      {(["start", "end"] as const).map((end) => (
        <PlanMarker
          key={end}
          end={end}
          position={points[end]}
          onDragStart={onDragStart}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
        />
      ))}
    </>
  );
}
