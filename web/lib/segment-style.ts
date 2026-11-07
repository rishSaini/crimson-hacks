import type { ExpressionSpecification, FilterSpecification } from "mapbox-gl";
import type { LayerProps } from "react-map-gl/mapbox";
import type { SegmentColor } from "@/lib/analysis";

/** Hex for each server `color`. The server picks the color; the UI only draws it. */
export const SEGMENT_HEX: Record<SegmentColor, string> = {
  gray: "#d4d4d4",
  unrated: "#ff00ff",
  green: "#22c55e",
  yellow: "#facc15",
  orange: "#f97316",
  red: "#dc2626",
  black: "#0a0a0a",
};

export const SOURCE_IDS = {
  draft: "route-draft",
  segments: "route-segments",
} as const;

export const LAYER_IDS = {
  sky: "sky",
  draft: "route-draft-line",
  casing: "route-segments-casing",
  solid: "route-segments-solid",
  unrated: "route-segments-unrated",
} as const;

// Under-30-degree gray is thin, steep terrain is wider, and anything the server
// flagged is thickest, so a flagged stretch reads at a glance whatever its color.
const WIDTH: ExpressionSpecification = [
  "case",
  ["boolean", ["get", "flagged"], false],
  8,
  ["==", ["get", "color"], "gray"],
  3,
  5,
];

const CASING_WIDTH: ExpressionSpecification = [
  "case",
  ["boolean", ["get", "flagged"], false],
  12,
  ["==", ["get", "color"], "gray"],
  6,
  8,
];

const COLOR: ExpressionSpecification = [
  "match",
  ["get", "color"],
  "unrated",
  SEGMENT_HEX.unrated,
  "green",
  SEGMENT_HEX.green,
  "yellow",
  SEGMENT_HEX.yellow,
  "orange",
  SEGMENT_HEX.orange,
  "red",
  SEGMENT_HEX.red,
  "black",
  SEGMENT_HEX.black,
  SEGMENT_HEX.gray,
];

const IS_UNRATED: FilterSpecification = ["==", ["get", "color"], "unrated"];
const NOT_UNRATED: FilterSpecification = ["!=", ["get", "color"], "unrated"];

export const skyLayer: LayerProps = {
  id: LAYER_IDS.sky,
  type: "sky",
  paint: {
    "sky-type": "atmosphere",
    "sky-atmosphere-sun": [0, 75],
    "sky-atmosphere-sun-intensity": 12,
  },
};

/** The line being drawn, before analysis. */
export const draftLineLayer: LayerProps = {
  id: LAYER_IDS.draft,
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: {
    "line-color": "#ffffff",
    "line-width": 3,
    "line-opacity": 0.9,
    "line-dasharray": [1, 1.5],
  },
};

/**
 * The user's own line when the API was unreachable and the fixture's sample route
 * is shown instead. Thin solid white so it can't be read as an analyzed segment,
 * an unrated (dashed magenta) stretch or a rerouted-away ghost (dashed gray).
 */
export const unanalyzedLineLayer: LayerProps = {
  id: LAYER_IDS.draft,
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0.7 },
};

/** Dark outline under every segment; white under black (Extreme) so it shows on rock. */
export const segmentCasingLayer: LayerProps = {
  id: LAYER_IDS.casing,
  type: "line",
  layout: { "line-join": "round", "line-cap": "round" },
  paint: {
    "line-color": ["case", ["==", ["get", "color"], "black"], "#ffffff", "rgba(0,0,0,0.55)"],
    "line-width": CASING_WIDTH,
  },
};

export const segmentSolidLayer: LayerProps = {
  id: LAYER_IDS.solid,
  type: "line",
  filter: NOT_UNRATED,
  layout: { "line-join": "round", "line-cap": "round" },
  paint: {
    "line-color": COLOR,
    "line-width": WIDTH,
  },
};

/** Unrated 30 degree or steeper terrain: dashed magenta, paired with a "?" pin. */
export const segmentUnratedLayer: LayerProps = {
  id: LAYER_IDS.unrated,
  type: "line",
  filter: IS_UNRATED,
  layout: { "line-join": "round", "line-cap": "butt" },
  paint: {
    "line-color": SEGMENT_HEX.unrated,
    "line-width": WIDTH,
    "line-dasharray": [1.5, 1],
  },
};
