"use client";

import { useState } from "react";
import { useMap } from "react-map-gl/mapbox";
import type { Segment } from "@/lib/analysis";
import { MAP_ID, flyToSegments } from "@/lib/camera";
import { DANGER_HEX, describeSegment, isListedSegment } from "@/lib/danger";
import { SEGMENT_HEX } from "@/lib/segment-style";

type Props = {
  segments: Segment[];
  heading: string;
};

/**
 * Every 30° or steeper segment with its rating, Low and Moderate included, plus any
 * segment flagged for what's above it. Click one to fly the camera to it.
 */
export function SegmentList({ segments, heading }: Props) {
  const maps = useMap();
  const map = maps[MAP_ID];
  const [selected, setSelected] = useState<number | null>(null);
  const listed = segments.filter(isListedSegment);

  return (
    <section className="space-y-2 text-sm" aria-label={heading} data-testid="segment-list">
      <h2 className="font-semibold">{heading}</h2>
      {listed.length === 0 ? (
        <p className="text-neutral-600">
          No segments 30° or steeper, and none flagged for slopes above them.
        </p>
      ) : (
        <ul className="space-y-1">
          {listed.map((segment) => {
            const p = segment.properties;
            const swatch = p.color === "gray" ? SEGMENT_HEX.gray : p.danger === "no_rating" ? SEGMENT_HEX.unrated : DANGER_HEX[p.danger];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={selected === p.id}
                  onClick={() => {
                    setSelected(p.id);
                    flyToSegments(map, [segment]);
                  }}
                  className={`flex w-full items-start gap-2 rounded border p-2 text-left transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-800 dark:hover:bg-neutral-800 ${
                    selected === p.id ? "border-neutral-800 dark:border-neutral-200" : "border-neutral-300 dark:border-neutral-700"
                  }`}
                  data-testid={`segment-${p.id}`}
                >
                  <span
                    aria-hidden
                    className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-sm border border-black/20 ${
                      p.color === "unrated" ? "border-dashed" : ""
                    }`}
                    style={{ backgroundColor: swatch }}
                  />
                  <span className="space-y-0.5">
                    <span className="block">{describeSegment(segment)}</span>
                    {p.flagged && (
                      <span className="block text-xs font-semibold text-red-800 dark:text-red-300">
                        Flagged at your setting
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-neutral-600">
        Segments under 30° with nothing flagged above them aren&apos;t listed: no
        avalanche-terrain flag.
      </p>
    </section>
  );
}
