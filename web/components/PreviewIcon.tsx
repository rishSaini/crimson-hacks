import type { CSSProperties } from "react";

const paths = {
  mountain: <><path d="m2 20 7-14 4 7 3-5 6 12H2Z" /><path d="m6.5 11 2.5 2 2.2-2M14 12l2 2 1.8-1" /></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  route: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 6h9a4 4 0 0 1 0 8H8a2 2 0 0 0 0 4h9" /></>,
  play: <path d="m9 5 11 7-11 7V5Z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M5 12h14M12 5v14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  layers: <><path d="m12 3 10 6-10 6L2 9l10-6Z" /><path d="m2 13 10 6 10-6M2 17l10 6 10-6" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.01" /></>,
  focus: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
} as const;

export function PreviewIcon({ name, size = 18, style }: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
