"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { LngLat, type CameraOptions, type Map as TerrainMap } from "maplibre-gl";
import type { MapRef } from "react-map-gl/maplibre";

type Position = [number, number];
type Path = { points: Position[]; distances: number[]; length: number };

function buildPath(points: Position[]): Path {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + new LngLat(...points[i - 1]).distanceTo(new LngLat(...points[i])));
  }
  return { points, distances, length: distances[distances.length - 1] };
}

function positionAt(path: Path, distance: number): Position {
  const end = path.distances.findIndex((value) => value >= distance);
  if (end <= 0) return end === 0 ? path.points[0] : path.points[path.points.length - 1];
  const fraction = (distance - path.distances[end - 1]) / (path.distances[end] - path.distances[end - 1] || 1);
  return [
    path.points[end - 1][0] + fraction * (path.points[end][0] - path.points[end - 1][0]),
    path.points[end - 1][1] + fraction * (path.points[end][1] - path.points[end - 1][1]),
  ];
}

const BUTTON = "rounded border border-slate-500 px-3 py-1.5 text-xs hover:bg-slate-700 disabled:opacity-40";

export function RouteRide({ mapRef, lines, name, ready }: {
  mapRef: RefObject<MapRef | null>;
  lines: Position[][];
  name: string;
  ready: boolean;
}) {
  const paths = useMemo(() => lines.filter((line) => line.length >= 2).map(buildPath).filter((path) => path.length > 1), [lines]);
  const [section, setSection] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(8);
  const [message, setMessage] = useState("");
  const animation = useRef(0);
  const generation = useRef(0);
  const distance = useRef(0);
  const velocity = useRef(speed);
  const snapshot = useRef<{
    map: TerrainMap; camera: CameraOptions; clamped: boolean; maxPitch: number;
    terrain: ReturnType<TerrainMap["getTerrain"]>;
    imageryVisibility: "visible" | "none";
  } | null>(null);
  const path = paths[section];

  function pause() {
    generation.current++;
    cancelAnimationFrame(animation.current);
    setPlaying(false);
    setPreparing(false);
  }

  function exit() {
    pause();
    const saved = snapshot.current;
    if (saved) {
      saved.map.setCenterClampedToGround(saved.clamped);
      saved.map.setMaxPitch(saved.maxPitch);
      saved.map.setTerrain(saved.terrain);
      saved.map.setLayoutProperty("satellite-map", "visibility", saved.imageryVisibility);
      saved.map.jumpTo(saved.camera);
      snapshot.current = null;
    }
    setActive(false);
  }

  useEffect(() => () => {
    generation.current++;
    cancelAnimationFrame(animation.current);
    const saved = snapshot.current;
    if (saved?.map.isStyleLoaded()) {
      saved.map.setCenterClampedToGround(saved.clamped);
      saved.map.setMaxPitch(saved.maxPitch);
      saved.map.setTerrain(saved.terrain);
      saved.map.setLayoutProperty("satellite-map", "visibility", saved.imageryVisibility);
    }
  }, []);

  function showPosition(map: TerrainMap, at: number) {
    const eye = positionAt(path, Math.min(at, path.length - 0.1));
    const ahead = positionAt(path, Math.min(at + 15, path.length));
    const eyeGround = map.queryTerrainElevation(eye);
    const aheadGround = map.queryTerrainElevation(ahead);
    if (eyeGround === null || aheadGround === null || eyeGround <= 0 || aheadGround <= 0) {
      throw new Error("Elevation tiles are loading. Pause and try Play again.");
    }
    map.jumpTo(map.calculateCameraOptionsFromTo(
      new LngLat(...eye), eyeGround + 1.7, new LngLat(...ahead), aheadGround + 1.7,
    ));
  }

  async function play() {
    const map = mapRef.current?.getMap();
    if (!map || !path || preparing) return;
    pause();
    const token = generation.current;
    setPreparing(true);
    setMessage("");
    if (!snapshot.current) {
      snapshot.current = {
        map, camera: {
          center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(),
          pitch: map.getPitch(), elevation: map.getCameraTargetElevation(),
        },
        clamped: map.getCenterClampedToGround(), maxPitch: map.getMaxPitch(), terrain: map.getTerrain(),
        imageryVisibility: map.getLayoutProperty("satellite-map", "visibility") as "visible" | "none",
      };
    }
    setActive(true);
    try {
      map.stop();
      map.setLayoutProperty("satellite-map", "visibility", "visible");
      map.setTerrain({ source: "elevation", exaggeration: 1 });
      map.setCenterClampedToGround(true);
      map.setMaxPitch(120);
      if (distance.current >= path.length) distance.current = 0;
      const start = positionAt(path, distance.current);
      map.jumpTo({ center: start, zoom: 15, pitch: 40 });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          map.off("idle", loaded);
          reject(new Error("Terrain took too long to load. Try Play again."));
        }, 12000);
        function loaded() { clearTimeout(timeout); resolve(); }
        map.once("idle", loaded);
      });
      if (generation.current !== token) return;
      map.setCenterClampedToGround(false);
      showPosition(map, distance.current);
      setActive(true);
      setPreparing(false);
      setPlaying(true);
      let last = performance.now();
      let lastDisplay = 0;
      function tick(now: number) {
        if (generation.current !== token) return;
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        distance.current = Math.min(path.length, distance.current + dt * velocity.current);
        try {
          showPosition(map!, distance.current);
        } catch (error) {
          pause();
          setMessage(error instanceof Error ? error.message : "Could not update the camera.");
          return;
        }
        if (now - lastDisplay > 100 || distance.current >= path.length) {
          setProgress(distance.current);
          lastDisplay = now;
        }
        if (distance.current >= path.length) {
          setPlaying(false);
          setMessage("End of this continuous section. Playback stops here.");
        } else {
          animation.current = requestAnimationFrame(tick);
        }
      }
      animation.current = requestAnimationFrame(tick);
    } catch (error) {
      if (generation.current !== token) return;
      setPreparing(false);
      setPlaying(false);
      setMessage(error instanceof Error ? error.message : "Could not start POV.");
    }
  }

  if (!path) return null;
  return (
    <div className="absolute bottom-10 left-3 z-10 w-[calc(100%-1.5rem)] max-w-lg rounded-lg border border-slate-600 bg-slate-950/95 p-3 text-white shadow-xl">
      <p className="text-sm font-semibold">POV demo · {name}</p>
      <p className="mt-1 text-xs text-slate-300">Terrain simulation · target eye height 1.7 m above the elevation model</p>
      {paths.length > 1 && (
        <label className="mt-2 block text-xs">Continuous section
          <select className="ml-2 rounded border border-slate-600 bg-slate-900 p-1" value={section}
            onChange={(event) => {
              exit();
              setSection(Number(event.target.value));
              distance.current = 0;
              setProgress(0);
              setMessage("");
            }}>
            {paths.map((item, index) => <option key={index} value={index}>{index + 1} · {Math.round(item.length)} m</option>)}
          </select>
        </label>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!ready || preparing || playing} onClick={() => void play()} className={BUTTON}>
          {preparing ? "Loading terrain…" : "Play POV"}
        </button>
        <button type="button" disabled={!playing && !preparing} onClick={pause} className={BUTTON}>Pause POV</button>
        <button type="button" disabled={!active && !preparing} onClick={exit} className={BUTTON}>Exit POV</button>
        <label className="text-xs">Speed
          <select className="ml-1 rounded bg-slate-800 p-1" value={speed}
            onChange={(event) => { const next = Number(event.target.value); velocity.current = next; setSpeed(next); }}>
            {[2, 4, 8, 12].map((value) => <option key={value} value={value}>{value} m/s</option>)}
          </select>
        </label>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <span>{Math.round(progress)} / {Math.round(path.length)} m</span>
        <input className="min-w-0 flex-1" aria-label="POV progress" type="range" min={0} max={path.length} step={1} value={progress}
          onChange={(event) => {
            pause();
            const next = Number(event.target.value);
            distance.current = next;
            setProgress(next);
            const map = mapRef.current?.getMap();
            if (map && active) {
              try { showPosition(map, next); }
              catch (error) { setMessage(error instanceof Error ? error.message : "Camera unavailable."); }
            }
          }} />
      </label>
      <p className="mt-1 text-xs text-amber-200" role="status">
        {message || "Playback follows this section only. Snow cover and obstacles remain unverified."}
      </p>
    </div>
  );
}
