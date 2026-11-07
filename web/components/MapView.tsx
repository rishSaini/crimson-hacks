"use client";

import type { ReactNode } from "react";
import Map from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function MapView({ children }: { children?: ReactNode }) {
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
      mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
      initialViewState={{ longitude: -111.675, latitude: 40.595, zoom: 11.5, pitch: 60 }}
      style={{ width: "100%", height: "100%" }}
    >
      {children}
    </Map>
  );
}
