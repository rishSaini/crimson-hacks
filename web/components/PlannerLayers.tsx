"use client";

import { Layer, Marker, Source } from "react-map-gl/maplibre";
import { dangerStyle, routeColors, stretchKind } from "@/lib/danger";
import { useDisplayPrefs } from "@/lib/useDisplayPrefs";
import type { RoutePlanner } from "@/lib/useRoutePlanner";
import styles from "./Planner.module.css";

const GRAY = "#7b8794";
const UNRATED = "#e11d9b";

/** The danger-scale colors, so the line, the legend and the forecast card agree. */
function segmentColor(colorBlind: boolean) {
  const c = routeColors(colorBlind);
  return ["match", ["get", "color"],
    "gray", c.gray, "unrated", c.unrated, "green", c.green, "yellow", c.yellow,
    "orange", c.orange, "red", c.red, "black", c.black, c.gray];
}

// Under 30 degrees is thin gray; flagged runs are thickest.
const WIDTH = ["case", ["get", "flagged"], 6, ["==", ["get", "color"], "gray"], 3, 4.5] as const;
const CASING_WIDTH = ["case", ["get", "flagged"], 10, ["==", ["get", "color"], "gray"], 6, 8] as const;

function legend(colorBlind: boolean) {
  const c = routeColors(colorBlind);
  return [
    { label: "Under 30°", color: GRAY, thin: true },
    { label: "Low", color: c.green },
    { label: "Moderate", color: c.yellow },
    { label: "Considerable", color: c.orange },
    { label: "High", color: c.red },
    { label: "Extreme", color: c.black, edge: true },
    { label: "Unrated 30°+", color: UNRATED, dashed: true },
    { label: "Below steep slopes", color: GRAY, overhead: true },
  ];
}

/** Map key for the planned route's colors. */
export function PlanLegend() {
  const { colorBlind } = useDisplayPrefs();
  return (
    <div className={styles.planLegend} aria-label="Map legend">
      {legend(colorBlind).map((item) => (
        <span key={item.label}>
          <i
            className={`${styles.legendLine} ${"thin" in item ? styles.legendThin : ""} ${"dashed" in item ? styles.legendDashed : ""} ${"edge" in item ? styles.legendEdge : ""} ${"overhead" in item ? styles.legendOverhead : ""}`}
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** The route colored by its analysis, its pins, and the original line after a reroute. */
export function PlannerLayers({ planner }: { planner: RoutePlanner }) {
  const { activeAnalysis, ghost, points, reroute } = planner;
  const { dark, colorBlind } = useDisplayPrefs();
  const SEGMENT_COLOR = segmentColor(colorBlind);
  const turnaround = reroute.status === "done" ? reroute.result.turnaround_point : null;
  return (
    <>
      {ghost && (
        // A rerouted-away line is always dashed gray, whatever its colors were.
        <Source id="plan-ghost" type="geojson" data={ghost.segments as never}>
          <Layer id="plan-ghost-line" type="line" paint={{
            "line-color": "#6b7280", "line-width": 3, "line-opacity": 0.85, "line-dasharray": [2, 2],
          }} />
        </Source>
      )}
      {activeAnalysis && (
        <Source id="plan-route" type="geojson" data={activeAnalysis.segments as never}>
          <Layer id="plan-route-shadow" type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "rgba(15,30,40,0.35)", "line-width": 14, "line-blur": 8, "line-translate": [0, 3] }} />
          <Layer id="plan-route-casing" type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              // Extreme is black with a white edge; everything else gets a soft white halo on the topo map.
              "line-color": ["match", ["get", "color"], "black", "#ffffff", dark ? "rgba(8,14,16,0.9)" : "rgba(255,255,255,0.85)"] as never,
              "line-width": CASING_WIDTH as never,
            }} />
          <Layer id="plan-route-solid" type="line"
            filter={["!=", ["get", "color"], "unrated"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": SEGMENT_COLOR as never, "line-width": WIDTH as never }} />
          <Layer id="plan-route-unrated" type="line"
            filter={["==", ["get", "color"], "unrated"]}
            paint={{ "line-color": SEGMENT_COLOR as never, "line-width": 6, "line-dasharray": [2, 1.5] }} />
        </Source>
      )}
      {activeAnalysis?.flagged_stretches.map((stretch) => {
        const runs = activeAnalysis.segments.features.filter((f) => stretch.segment_ids.includes(f.properties.id));
        const kind = stretchKind(runs.map((f) => f.properties.flag_reason));
        const unrated = stretch.max_danger === "no_rating";
        const d = dangerStyle(stretch.max_danger, colorBlind);
        const fill = unrated ? UNRATED : d.fill;
        return (
          <Marker key={stretch.id} longitude={stretch.pin[0]} latitude={stretch.pin[1]}>
            {kind === "overhead" ? (
              // Overhead: gentle ground below steep slopes. Hollow pin ringed in the slope's rating.
              <span data-testid="stretch-pin" className={`${styles.stretchMarker} ${styles.stretchMarkerOverhead}`}
                style={{ borderColor: fill }} title="Below steep slopes that face the route">
                {stretch.id}
              </span>
            ) : (
              <span data-testid="stretch-pin" className={styles.stretchMarker}
                style={{ background: fill, color: unrated ? "#fff" : d.text }}>
                {kind === "unrated" ? "?" : stretch.id}
              </span>
            )}
          </Marker>
        );
      })}
      {turnaround && (
        <Marker longitude={turnaround[0]} latitude={turnaround[1]} anchor="bottom">
          <span title="Highest point on your route before its first flagged stretch" className={styles.turnaround}>
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
            className={`${styles.routePin} ${index === 0 ? styles.routePinStart : styles.routePinEnd}`}>
            <span>{index === 0 ? "A" : "B"}</span>
          </span>
        </Marker>
      ))}
    </>
  );
}
