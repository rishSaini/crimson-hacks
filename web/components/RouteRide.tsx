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
const BASE_SPEED_MPS = 8;

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

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
  const [speed, setSpeed] = useState(1);
  const [jumpTime, setJumpTime] = useState("0:00");
  const [message, setMessage] = useState("");
  const animation = useRef(0);
  const generation = useRef(0);
  const distance = useRef(0);
  const velocity = useRef(BASE_SPEED_MPS);
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
    setProgress(distance.current);
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

  function stop() {
    exit();
    distance.current = 0;
    setProgress(0);
    setJumpTime("0:00");
    setMessage("");
  }

  function changeSpeed(next: number) {
    const multiplier = Math.max(1, Math.min(10, next));
    velocity.current = BASE_SPEED_MPS * multiplier;
    setSpeed(multiplier);
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
      throw new Error("Elevation tiles are loading. Try Start or Resume again.");
    }
    map.setCenterClampedToGround(false);
    map.jumpTo(map.calculateCameraOptionsFromTo(
      new LngLat(...eye), eyeGround + 1.7, new LngLat(...ahead), aheadGround + 1.7,
    ));
  }

  async function play(autoPlay = true) {
    const map = mapRef.current?.getMap();
    if (!map || !path) return;
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
      if (autoPlay && distance.current >= path.length) distance.current = 0;
      const start = positionAt(path, distance.current);
      map.jumpTo({ center: start, zoom: 15, pitch: 40 });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          map.off("idle", loaded);
          reject(new Error("Terrain took too long to load. Try Start or Resume again."));
        }, 12000);
        function loaded() { clearTimeout(timeout); resolve(); }
        map.once("idle", loaded);
      });
      if (generation.current !== token) return;
      showPosition(map, distance.current);
      setActive(true);
      setPreparing(false);
      setProgress(distance.current);
      if (!autoPlay) return;
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

  function seek(next: number) {
    pause();
    const position = Math.max(0, Math.min(path.length, next));
    distance.current = position;
    setProgress(position);
    const seconds = position / BASE_SPEED_MPS;
    setJumpTime(formatTime(position >= path.length ? Math.ceil(seconds) : seconds));
    setMessage("");
    const map = mapRef.current?.getMap();
    if (map && active && !preparing) {
      try {
        showPosition(map, position);
        return;
      } catch {
        // Load terrain around a distant seek position before showing it.
      }
    }
    void play(false);
  }

  if (!path) return null;
  const totalSeconds = Math.ceil(path.length / BASE_SPEED_MPS);
  const elapsedSeconds = progress >= path.length ? totalSeconds : progress / BASE_SPEED_MPS;
  const startLabel = progress >= path.length ? "Replay" : progress > 0 ? "Resume" : "Start";
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
              setJumpTime("0:00");
              setMessage("");
            }}>
            {paths.map((item, index) => <option key={index} value={index}>{index + 1} · {Math.round(item.length)} m</option>)}
          </select>
        </label>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!ready || preparing || playing} onClick={() => void play()} className={BUTTON}>
          {preparing ? "Loading terrain…" : startLabel}
        </button>
        <button type="button" disabled={!playing && !preparing} onClick={pause} className={BUTTON}>Pause</button>
        <button type="button" disabled={!active && !preparing && progress === 0} onClick={stop} className={BUTTON}>Stop</button>
        <button type="button" disabled={!active && !preparing} onClick={exit} className={BUTTON}>Map overview</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={speed <= 1} onClick={() => changeSpeed(speed - 1)} className={BUTTON}>Slower</button>
        <label className="text-xs">Playback speed
          <select className="ml-1 rounded bg-slate-800 p-1" value={speed}
            onChange={(event) => changeSpeed(Number(event.target.value))}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
        </label>
        <button type="button" disabled={speed >= 10} onClick={() => changeSpeed(speed + 1)} className={BUTTON}>Faster</button>
      </div>
      <p className="mt-1 text-xs text-slate-300">Simulated time · 1× = 8 m/s</p>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <span className="whitespace-nowrap">{formatTime(elapsedSeconds)} / {formatTime(totalSeconds)}</span>
        <input className="min-w-0 flex-1" aria-label="POV progress" type="range" min={0} max={path.length} step="any" value={progress}
          disabled={!ready}
          aria-valuetext={`${formatTime(elapsedSeconds)}, ${Math.round(progress)} meters`}
          onChange={(event) => seek(Number(event.target.value))} />
      </label>
      <form className="mt-2 flex flex-wrap items-center gap-2 text-xs" onSubmit={(event) => {
        event.preventDefault();
        const match = /^(\d+):([0-5]\d)$/.exec(jumpTime.trim());
        const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
        if (!Number.isFinite(seconds) || seconds > totalSeconds) {
          setMessage(`Enter a time from 0:00 to ${formatTime(totalSeconds)} using m:ss.`);
          return;
        }
        seek(seconds * BASE_SPEED_MPS);
      }}>
        <label>Jump to time
          <input className="ml-2 w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1"
            value={jumpTime} onChange={(event) => setJumpTime(event.target.value)} placeholder="m:ss" />
        </label>
        <button type="submit" disabled={!ready} className={BUTTON}>Go to time</button>
        <span className="text-slate-300">{Math.round(progress)} / {Math.round(path.length)} m</span>
      </form>
      <p className="mt-1 text-xs text-amber-200" role="status">
        {message || "Playback follows this section only. Snow cover and obstacles remain unverified."}
      </p>
    </div>
  );
}
