"use client";

import { useState } from "react";
import type { AnalyzeResponse } from "@/lib/api";
import { DANGER, routeColors } from "@/lib/danger";
import { useDisplayPrefs } from "@/lib/useDisplayPrefs";
import styles from "./Planner.module.css";

type Feature = AnalyzeResponse["segments"]["features"][number];
type Position = [number, number];

const W = 320;
const H = 116;
const PAD = { top: 10, right: 6, bottom: 20, left: 6 };

function rating(f: Feature) {
  const p = f.properties;
  if (p.color === "gray") return "Under 30°: no avalanche-terrain flag";
  if (p.color === "unrated") return "30°+ with no rating";
  return `30°+, rated ${DANGER[p.danger].label}`;
}

/**
 * Each segment drawn where it sits along the route, spanning its own lowest to highest
 * elevation. These are the analysis numbers as they are: no smoothing or interpolation.
 */
export function RouteProfile({ analysis, onFocus }: {
  analysis: AnalyzeResponse;
  onFocus?: (points: Position[]) => void;
}) {
  const features = [...analysis.segments.features].sort((a, b) => a.properties.id - b.properties.id);
  const [hover, setHover] = useState<number | null>(null);
  const { colorBlind } = useDisplayPrefs();
  const colors = routeColors(colorBlind);
  if (features.length === 0) return null;

  const total = features.reduce((sum, f) => sum + f.properties.length_m, 0);
  const lo = Math.min(...features.map((f) => f.properties.elevation_min_ft));
  const hi = Math.max(...features.map((f) => f.properties.elevation_max_ft));
  const span = Math.max(hi - lo, 50);
  const x = (m: number) => PAD.left + (m / total) * (W - PAD.left - PAD.right);
  const y = (ft: number) => PAD.top + (1 - (ft - lo) / span) * (H - PAD.top - PAD.bottom);

  const ends = features.map((_, i) => features.slice(0, i + 1).reduce((sum, f) => sum + f.properties.length_m, 0));
  const bars = features.map((f, i) => ({ f, x0: x(ends[i] - f.properties.length_m), x1: x(ends[i]) }));
  const active = hover === null ? null : bars[hover]?.f;

  return (
    <figure className={styles.profile}>
      <figcaption className={styles.profileHead}>
        <span>Route profile</span>
        <span>{active
          ? `${Math.round(active.properties.length_m).toLocaleString()} m · ${Math.round(active.properties.slope_min_deg)}–${Math.round(active.properties.slope_max_deg)}° ${active.properties.aspects.join("/")}`
          : "Elevation range of each segment"}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.profileChart} role="img"
        aria-label={`Route profile, ${Math.round(lo).toLocaleString()} to ${Math.round(hi).toLocaleString()} ft over ${(total / 1000).toFixed(1)} km`}
        onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + t * (H - PAD.top - PAD.bottom)}
            y2={PAD.top + t * (H - PAD.top - PAD.bottom)} className={styles.profileGrid} />
        ))}
        {bars.map(({ f, x0, x1 }, i) => {
          const top = y(f.properties.elevation_max_ft);
          const height = Math.max(y(f.properties.elevation_min_ft) - top, 3);
          const color = colors[f.properties.color] ?? colors.gray;
          return (
            <g key={f.properties.id} className={styles.profileBar} data-dim={hover !== null && hover !== i}
              onMouseEnter={() => setHover(i)}
              onClick={() => onFocus?.(f.geometry.coordinates as Position[])}>
              <rect x={x0} y={PAD.top} width={Math.max(x1 - x0, 1)} height={H - PAD.top - PAD.bottom} fill="transparent" />
              <rect x={x0 + 0.5} y={top} width={Math.max(x1 - x0 - 1, 1.5)} height={height} rx={1.5} fill={color}
                stroke={f.properties.color === "black" ? "#fff" : "none"} strokeWidth={1}
                strokeDasharray={f.properties.color === "unrated" ? "3 2" : undefined} />
              {f.properties.flagged && (
                <rect x={x0 + 0.5} y={H - PAD.bottom + 3} width={Math.max(x1 - x0 - 1, 1.5)} height={3} rx={1.5} fill={color} />
              )}
              <title>{`${rating(f)}. ${Math.round(f.properties.length_m)} m, ${Math.round(f.properties.elevation_min_ft).toLocaleString()}–${Math.round(f.properties.elevation_max_ft).toLocaleString()} ft${f.properties.flagged ? ". Flagged." : ""}`}</title>
            </g>
          );
        })}
        <text x={PAD.left} y={PAD.top - 2} className={styles.profileLabel}>{Math.round(hi).toLocaleString()} ft</text>
        <text x={PAD.left} y={H - 3} className={styles.profileLabel}>{Math.round(lo).toLocaleString()} ft</text>
        <text x={W - PAD.right} y={H - 3} textAnchor="end" className={styles.profileLabel}>{(total / 1000).toFixed(1)} km</text>
      </svg>
      <p className={styles.profileFoot}>Underline marks flagged segments. Click a segment to show it on the map.</p>
    </figure>
  );
}
