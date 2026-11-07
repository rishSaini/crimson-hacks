"use client";

import { Marker, useMap } from "react-map-gl/mapbox";
import type { Segment } from "@/lib/analysis";
import type { AnalyzeResponse } from "@/lib/api";
import { flyToSegments } from "@/lib/camera";
import { DANGER_HEX, DANGER_LABEL } from "@/lib/danger";
import { SEGMENT_HEX } from "@/lib/segment-style";

type Stretch = AnalyzeResponse["flagged_stretches"][number];

type Props = {
  stretches: Stretch[];
  segments: Segment[];
};

const m = (n: number) => Math.round(n).toLocaleString("en-US");

/** One numbered pin per flagged stretch, at the server's `pin`. Click to fly to it. */
export function StretchPins({ stretches, segments }: Props) {
  const { current: map } = useMap();

  return (
    <>
      {stretches.map((stretch) => {
        const [lng, lat] = stretch.pin;
        const ring = stretch.max_danger === "no_rating" ? SEGMENT_HEX.unrated : DANGER_HEX[stretch.max_danger];
        const rating = stretch.max_danger === "no_rating" ? "unrated terrain" : `up to ${DANGER_LABEL[stretch.max_danger]}`;
        const label = `Flagged stretch ${stretch.id}: ${m(stretch.flagged_length_m)} m, ${rating}`;
        const members = segments.filter((s) => stretch.segment_ids.includes(s.properties.id));
        return (
          <Marker key={stretch.id} longitude={lng} latitude={lat} anchor="bottom" style={{ zIndex: 2 }}>
            <button
              type="button"
              aria-label={label}
              title={label}
              onClick={(event) => {
                event.stopPropagation();
                flyToSegments(map, members);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] bg-neutral-950 text-sm font-bold text-white shadow-lg transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-white"
              style={{ borderColor: ring }}
              data-testid={`stretch-pin-${stretch.id}`}
            >
              {stretch.id}
            </button>
          </Marker>
        );
      })}
    </>
  );
}
