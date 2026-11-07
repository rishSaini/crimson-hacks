"use client";

import { useState } from "react";
import {
  ASPECTS,
  BANDS,
  DANGER_HEX,
  cellRating,
  type RoseCell,
} from "@/lib/danger";

const SIZE = 240;
const C = SIZE / 2;
// Upper elevation is the inner ring, as on UAC's rose: the summit is the middle.
const RING_RADII: [number, number][] = [
  [16, 42],
  [42, 70],
  [70, 98],
];
const LABEL_R = 110;

function point(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)];
}

/** Annular sector centered on an octant, clockwise from north. */
function sectorPath(inner: number, outer: number, octant: number): string {
  const start = octant * 45 - 22.5;
  const end = start + 45;
  const [ox1, oy1] = point(outer, start);
  const [ox2, oy2] = point(outer, end);
  const [ix2, iy2] = point(inner, end);
  const [ix1, iy1] = point(inner, start);
  const f = (n: number) => n.toFixed(2);
  return [
    `M ${f(ox1)} ${f(oy1)}`,
    `A ${outer} ${outer} 0 0 1 ${f(ox2)} ${f(oy2)}`,
    `L ${f(ix2)} ${f(iy2)}`,
    `A ${inner} ${inner} 0 0 0 ${f(ix1)} ${f(iy1)}`,
    "Z",
  ].join(" ");
}

function describe(cell: RoseCell): string {
  const band = BANDS.find((b) => b.band === cell.band);
  return `${band?.label} (${band?.range}), ${cell.aspect}-facing: ${cellRating(cell)}`;
}

/**
 * UAC's 24-cell danger rose: 3 elevation bands by 8 aspects, each cell colored by
 * its rating. Hover, focus or tap a cell to read it. Hatched cells are "pockets of".
 */
export function DangerRose({ rose }: { rose: RoseCell[] }) {
  const [active, setActive] = useState<RoseCell | null>(null);
  const cells = [...rose].sort((a, b) => a.index - b.index);

  return (
    <figure className="space-y-2" data-testid="danger-rose">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto block w-full max-w-60"
        role="group"
        aria-label="Danger rose: elevation bands by aspect"
      >
        <defs>
          <pattern id="rose-pockets" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {cells.map((cell) => {
          const bandIndex = BANDS.findIndex((b) => b.band === cell.band);
          const octant = ASPECTS.indexOf(cell.aspect);
          if (bandIndex < 0 || octant < 0) return null;
          const [inner, outer] = RING_RADII[bandIndex];
          const d = sectorPath(inner, outer, octant);
          const label = describe(cell);
          const isActive = active?.index === cell.index;
          return (
            <g key={cell.index}>
              <path
                d={d}
                fill={DANGER_HEX[cell.danger]}
                stroke={isActive ? "#171717" : "#ffffff"}
                strokeWidth={isActive ? 2.5 : 1}
                tabIndex={0}
                role="img"
                aria-label={label}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setActive(cell)}
                onFocus={() => setActive(cell)}
                onClick={() => setActive(cell)}
                data-testid={`rose-cell-${cell.index}`}
              >
                <title>{label}</title>
              </path>
              {cell.pockets && (
                <path d={d} fill="url(#rose-pockets)" pointerEvents="none" aria-hidden />
              )}
            </g>
          );
        })}

        {ASPECTS.map((aspect, i) => {
          const [x, y] = point(LABEL_R, i * 45);
          return (
            <text
              key={aspect}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-current text-[11px] font-semibold"
              aria-hidden
            >
              {aspect}
            </text>
          );
        })}
      </svg>

      <figcaption className="min-h-10 text-center text-xs" aria-live="polite">
        {active ? (
          <span className="font-medium">{describe(active)}</span>
        ) : (
          <span className="text-neutral-600">
            Inner ring upper elevation, middle ring mid, outer ring lower. Hover or tap a cell.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
