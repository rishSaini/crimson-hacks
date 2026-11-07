/** GeoJSON position: [lng, lat]. */
export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters. */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthM(coords: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distanceM(coords[i - 1], coords[i]);
  return total;
}

/** Point at `fraction` (0 to 1) of the way along a line, by distance. */
export function pointAlongLine(coords: readonly LngLat[], fraction = 0.5): LngLat {
  if (coords.length === 0) throw new Error("pointAlongLine needs at least one position");
  if (coords.length === 1) return coords[0];

  let remaining = lineLengthM(coords) * Math.min(1, Math.max(0, fraction));
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const step = distanceM(a, b);
    if (remaining <= step && step > 0) {
      const t = remaining / step;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= step;
  }
  return coords[coords.length - 1];
}

/** [[west, south], [east, north]] for fitBounds. */
export function boundsOf(coords: readonly LngLat[]): [LngLat, LngLat] {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lng, lat] of coords) {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

export function formatDistance(meters: number): string {
  const km = meters / 1000;
  const mi = meters / 1609.344;
  return `${km.toFixed(2)} km (${mi.toFixed(2)} mi)`;
}
