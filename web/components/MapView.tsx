"use client";

import type { ReactNode } from "react";
import Map, { Layer, NavigationControl, Source, type MapMouseEvent } from "react-map-gl/mapbox";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

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

type MapViewProps = {
  /** Route layers and markers for the current mode. */
  children?: ReactNode;
  /** Crosshair cursor and no double-click zoom, so clicks can drop waypoints. */
  drawing?: boolean;
  onClick?: (event: MapMouseEvent) => void;
  onDblClick?: (event: MapMouseEvent) => void;
};

/** The 3D terrain map. Modes put their layers inside it as children. */
export function MapView({ children, drawing = false, onClick, onDblClick }: MapViewProps) {
  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
        Map needs a token: set NEXT_PUBLIC_MAPBOX_TOKEN in web/.env.local, then restart.
      </div>
    );
  }

  return (
    <Map
      mapboxAccessToken={MAPBOX_TOKEN}
      mapStyle={basemap.mapStyle}
      initialViewState={INITIAL_VIEW}
      maxPitch={85}
      terrain={TERRAIN}
      fog={FOG}
      doubleClickZoom={!drawing}
      cursor={drawing ? "crosshair" : undefined}
      onClick={onClick}
      onDblClick={onDblClick}
      style={{ width: "100%", height: "100%" }}
    >
      <Source {...basemap.dem} />
      <Layer {...skyLayer} />
      <NavigationControl position="top-right" visualizePitch />
      {children}
    </Map>
  );
}
