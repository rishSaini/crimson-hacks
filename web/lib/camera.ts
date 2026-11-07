import type { MapRef } from "react-map-gl/mapbox";
import type { Segment } from "@/lib/analysis";
import { boundsOf, type LngLat } from "@/lib/geo";

/** Id of the workspace map, so sidebar components can reach it through MapProvider. */
export const MAP_ID = "workspace";

/**
 * Fly to a stretch of terrain, keeping the current 3D tilt and heading so the
 * slope stays readable. Short stretches are capped so the camera doesn't dive in.
 */
export function flyToSegments(map: MapRef | undefined, segments: Segment[]): void {
  const coords = segments.flatMap((s) => s.geometry.coordinates as LngLat[]);
  if (!map || coords.length === 0) return;
  map.fitBounds(boundsOf(coords), {
    padding: 120,
    maxZoom: 15.5,
    duration: 1400,
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  });
}
