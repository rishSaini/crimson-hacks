import type { ForecastResponse } from "@/lib/api";
import { dangerStyle } from "@/lib/danger";

type RoseCell = ForecastResponse["rose"][number];

const SIZE = 264;
const C = SIZE / 2;
// Upper elevation sits in the middle, lower on the outside, as UAC draws it.
const RINGS = { upper: [16, 46], mid: [46, 76], lower: [76, 106] } as const;
const ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const BAND_LABEL = { upper: "Upper", mid: "Mid", lower: "Lower" } as const;

function point(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)].map((n) => n.toFixed(2)).join(" ");
}

function sector(r0: number, r1: number, octant: number) {
  const a0 = octant * 45 - 22.5;
  const a1 = octant * 45 + 22.5;
  return [
    `M ${point(r0, a0)}`,
    `L ${point(r1, a0)}`,
    `A ${r1} ${r1} 0 0 1 ${point(r1, a1)}`,
    `L ${point(r0, a1)}`,
    `A ${r0} ${r0} 0 0 0 ${point(r0, a0)}`,
    "Z",
  ].join(" ");
}

/** Cell borders and the center hole use `gap`, so the rose sits on any background. Labels use currentColor. */
export function DangerRose({ rose, className, gap = "#fffefa", colorBlind = false }: {
  rose: RoseCell[];
  className?: string;
  gap?: string;
  /** Color-blind palette, with each cell's level number written in it. */
  colorBlind?: boolean;
}) {
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={className}
      role="img"
      aria-label="Danger rose: danger by aspect and elevation band, upper elevation in the center"
    >
      <defs>
        <pattern id="pockets" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2.5" height="6" fill="rgba(255,255,255,0.55)" />
        </pattern>
      </defs>

      {rose.map((cell) => {
        const [r0, r1] = RINGS[cell.band];
        const octant = ASPECTS.indexOf(cell.aspect);
        const d = sector(r0, r1, octant);
        const danger = dangerStyle(cell.danger, colorBlind);
        return (
          <g key={cell.index}>
            <path d={d} fill={danger.fill} stroke={gap} strokeWidth={2} strokeLinejoin="round">
              <title>
                {`${BAND_LABEL[cell.band]} elevation, ${cell.aspect}: ${cell.pockets ? "pockets of " : ""}${danger.label}`}
              </title>
            </path>
            {cell.pockets && <path d={d} fill="url(#pockets)" pointerEvents="none" />}
            {colorBlind && danger.level !== null && (() => {
              const [lx, ly] = point((r0 + r1) / 2, octant * 45).split(" ").map(Number);
              return (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fill={danger.text}
                  fontSize={12} fontWeight={700} pointerEvents="none">{danger.level}</text>
              );
            })()}
          </g>
        );
      })}

      <circle cx={C} cy={C} r={RINGS.upper[0]} fill={gap} />
      {ASPECTS.map((aspect, i) => {
        const [x, y] = point(121, i * 45).split(" ").map(Number);
        return (
          <text
            key={aspect}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fontSize={14}
            fontWeight={600}
          >
            {aspect}
          </text>
        );
      })}
    </svg>
  );
}
