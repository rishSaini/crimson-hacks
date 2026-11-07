import type { StyleSpecification } from "mapbox-gl";
import type { SourceProps } from "react-map-gl/mapbox";

/**
 * Display basemap. The analysis never uses these tiles: it runs on the 3DEP grids.
 *
 * - `mapbox`: Mapbox satellite-streets style and Mapbox terrain DEM. Needs an account
 *   that Mapbox serves raster tiles to.
 * - `usgs`: USGS National Map imagery (public domain) and AWS Terrain Tiles
 *   (Terrarium encoding; USGS 3DEP in the US). No Mapbox raster tiles needed, so it
 *   keeps working when Mapbox returns 429 for raster.
 *
 * Set NEXT_PUBLIC_BASEMAP=usgs in web/.env.local to switch. Restart `npm run dev` after.
 */
export type BasemapId = "mapbox" | "usgs";

export const BASEMAP: BasemapId = process.env.NEXT_PUBLIC_BASEMAP === "usgs" ? "usgs" : "mapbox";

export const DEM_SOURCE_ID = "dem";

type DemSourceProps = Extract<SourceProps, { type: "raster-dem" }>;

type Basemap = {
  mapStyle: string | StyleSpecification;
  dem: DemSourceProps;
};

const USGS_IMAGERY_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "usgs-imagery": {
      type: "raster",
      tiles: [
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution:
        'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noreferrer">USGS The National Map</a>',
    },
  },
  layers: [{ id: "usgs-imagery", type: "raster", source: "usgs-imagery" }],
};

const BASEMAPS: Record<BasemapId, Basemap> = {
  mapbox: {
    mapStyle: "mapbox://styles/mapbox/satellite-streets-v12",
    dem: {
      id: DEM_SOURCE_ID,
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    },
  },
  usgs: {
    mapStyle: USGS_IMAGERY_STYLE,
    dem: {
      id: DEM_SOURCE_ID,
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
      attribution:
        'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain Tiles</a> (USGS 3DEP)',
    },
  },
};

export const basemap: Basemap = BASEMAPS[BASEMAP];
