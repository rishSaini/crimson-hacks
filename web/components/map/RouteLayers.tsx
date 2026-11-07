"use client";

import { useMemo } from "react";
import { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { Segment } from "@/lib/analysis";
import type { AnalyzeResponse } from "@/lib/api";
import { pointAlongLine, type LngLat } from "@/lib/geo";
import {
  SEGMENT_HEX,
  SOURCE_IDS,
  draftLineLayer,
  segmentCasingLayer,
  segmentSolidLayer,
  segmentUnratedLayer,
  unanalyzedLineLayer,
} from "@/lib/segment-style";

type DraftProps = {
  points: LngLat[];
  /** Show waypoint dots (while drawing). */
  showWaypoints: boolean;
  /** The line was not analyzed because the fixture route is shown instead. */
  unanalyzed: boolean;
};

/** The user's line before analysis: dashed white, draped on terrain, with waypoint dots. */
export function DraftRoute({ points, showWaypoints, unanalyzed }: DraftProps) {
  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        points.length >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates: points },
              },
            ]
          : [],
    }),
    [points],
  );

  return (
    <>
      <Source id={SOURCE_IDS.draft} type="geojson" data={data}>
        <Layer {...(unanalyzed ? unanalyzedLineLayer : draftLineLayer)} />
      </Source>
      {showWaypoints &&
        points.map(([lng, lat], i) => (
          <Marker key={`${i}-${lng}-${lat}`} longitude={lng} latitude={lat} anchor="center">
            <span
              aria-hidden
              className={`block rounded-full border-2 border-white bg-sky-500 shadow ${
                i === 0 ? "h-4 w-4" : "h-3 w-3"
              }`}
            />
          </Marker>
        ))}
    </>
  );
}

type SegmentsProps = { segments: Segment[] };

/** Analyzed segments colored by the server's `color`, with a "?" pin on each unrated stretch. */
export function AnalyzedRoute({ segments }: SegmentsProps) {
  const data = useMemo<AnalyzeResponse["segments"]>(
    () => ({ type: "FeatureCollection", features: segments }),
    [segments],
  );

  const unratedPins = useMemo(
    () =>
      segments
        .filter((s) => s.properties.color === "unrated")
        .map((s) => ({ id: s.properties.id, at: pointAlongLine(s.geometry.coordinates) })),
    [segments],
  );

  return (
    <>
      <Source id={SOURCE_IDS.segments} type="geojson" data={data}>
        <Layer {...segmentCasingLayer} />
        <Layer {...segmentSolidLayer} />
        <Layer {...segmentUnratedLayer} />
      </Source>
      {unratedPins.map(({ id, at: [lng, lat] }) => (
        <Marker key={id} longitude={lng} latitude={lat} anchor="bottom">
          <span
            role="img"
            aria-label={`Segment ${id}: unrated terrain, 30 degrees or steeper`}
            title="Unrated terrain, 30° or steeper"
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-sm font-bold text-white shadow-md"
            style={{ backgroundColor: SEGMENT_HEX.unrated }}
          >
            ?
          </span>
        </Marker>
      ))}
    </>
  );
}
