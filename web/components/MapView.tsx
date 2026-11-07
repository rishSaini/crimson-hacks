"use client";

import { useCallback, useEffect, useRef } from "react";
import Map, {
  Layer,
  NavigationControl,
  Source,
  type MapMouseEvent,
  type MapRef,
} from "react-map-gl/mapbox";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { DrawControls } from "@/components/map/DrawControls";
import { AnalyzedRoute, DraftRoute } from "@/components/map/RouteLayers";
import { RouteStatus } from "@/components/map/RouteStatus";
import { useRouteDrawing } from "@/hooks/useRouteDrawing";
import type { AvoidAtOrAbove } from "@/lib/analysis";
import { boundsOf, type LngLat } from "@/lib/geo";
import { DEM_SOURCE_ID, basemap } from "@/lib/basemap";
import { skyLayer } from "@/lib/segment-style";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Global token as a backstop for every Mapbox request. The Map below also gets it via
// mapboxAccessToken. Mapbox GL needs a valid token even with the USGS basemap.
if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}

const INITIAL_VIEW = { longitude: -111.675, latitude: 40.595, zoom: 11.5, pitch: 60, bearing: 0 };
const TERRAIN = { source: DEM_SOURCE_ID, exaggeration: 1.5 };
const FOG = {
  range: [0.8, 8] as [number, number],
  color: "#dce6f0",
  "horizon-blend": 0.1,
  "high-color": "#245bde",
  "space-color": "#000000",
  "star-intensity": 0.1,
};

/**
 * A double-click fires two clicks first. A click this close (screen pixels) to the
 * last waypoint is treated as the same point, so finishing doesn't add a duplicate.
 */
const SAME_POINT_PX = 8;

type MapViewProps = {
  /** Sent with every POST /analyze. The settings control will own this later. */
  avoidAtOrAbove?: AvoidAtOrAbove;
  /** YYYY-MM-DD forecast day. Defaults to today; the date picker will own this later. */
  date?: string;
};

export function MapView(props: MapViewProps) {
  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
        Map needs a token: set NEXT_PUBLIC_MAPBOX_TOKEN in web/.env.local, then restart.
      </div>
    );
  }
  return <RouteMap token={MAPBOX_TOKEN} {...props} />;
}

function RouteMap({
  token,
  avoidAtOrAbove = "considerable",
  date,
}: MapViewProps & { token: string }) {
  const mapRef = useRef<MapRef>(null);
  const route = useRouteDrawing({ avoidAtOrAbove, date });
  const { phase, points, analysis, error, addPoint, finish } = route;
  const isDrawing = phase === "drawing";
  const offline = analysis?.offline ?? false;

  const handleClick = useCallback(
    (event: MapMouseEvent) => {
      if (!isDrawing) return;
      const last = points.at(-1);
      if (last) {
        const p = event.target.project(last);
        if (Math.hypot(p.x - event.point.x, p.y - event.point.y) < SAME_POINT_PX) return;
      }
      addPoint([event.lngLat.lng, event.lngLat.lat]);
    },
    [isDrawing, points, addPoint],
  );

  const handleDoubleClick = useCallback(
    (event: MapMouseEvent) => {
      if (!isDrawing) return;
      event.preventDefault();
      finish();
    },
    [isDrawing, finish],
  );

  // Offline, the fixture's sample route replaces the user's line, so bring it into view.
  useEffect(() => {
    if (phase !== "analyzed" || !analysis?.offline) return;
    const coords = analysis.data.segments.features.flatMap(
      (f) => f.geometry.coordinates as LngLat[],
    );
    if (coords.length > 0) {
      mapRef.current?.fitBounds(boundsOf(coords), { padding: 96, duration: 1200 });
    }
  }, [phase, analysis]);

  const segments = phase === "analyzed" && analysis ? analysis.data.segments.features : null;

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        mapboxAccessToken={token}
        mapStyle={basemap.mapStyle}
        initialViewState={INITIAL_VIEW}
        maxPitch={85}
        terrain={TERRAIN}
        fog={FOG}
        doubleClickZoom={!isDrawing}
        cursor={isDrawing ? "crosshair" : undefined}
        onClick={handleClick}
        onDblClick={handleDoubleClick}
        style={{ width: "100%", height: "100%" }}
      >
        <Source {...basemap.dem} />
        <Layer {...skyLayer} />
        <NavigationControl position="top-right" visualizePitch />

        {(!segments || offline) && (
          <DraftRoute
            points={points}
            showWaypoints={isDrawing}
            unanalyzed={offline && !!segments}
          />
        )}
        {segments && <AnalyzedRoute segments={segments} />}
      </Map>

      <div className="pointer-events-none absolute top-3 left-3 z-10">
        <RouteStatus phase={phase} pointCount={points.length} analysis={analysis} error={error} />
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-8 z-10 flex justify-center">
        <DrawControls
          phase={phase}
          pointCount={points.length}
          onUndo={route.undo}
          onFinish={finish}
          onRetry={route.reanalyze}
          onClear={route.clear}
        />
      </div>
    </div>
  );
}
