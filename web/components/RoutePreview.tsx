"use client";

import { useRef, useState, type FormEvent } from "react";
import Map, { Layer, Marker, NavigationControl, ScaleControl, Source, type MapRef } from "react-map-gl/maplibre";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type EndpointSuggestionsResponse, type SuggestionsRequest, type SuggestionsResponse } from "@/lib/api";

setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

type Position = [number, number];

export type PreviewSample = {
  id: string;
  name: string;
  grade: string | null;
  source: string;
  url: string;
  license: string | null;
  lines: Position[][];
  points: number;
  gapCount: number | null;
  largestGapM: number | null;
  endpointGapM: number | null;
};

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: "raster",
      tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 16,
      attribution: "USGS The National Map",
    },
    elevation: {
      type: "raster-dem",
      url: "https://tiles.mapterhorn.com/tilejson.json",
      encoding: "terrarium",
      attribution: "© Mapterhorn",
    },
  },
  layers: [{ id: "topographic-map", type: "raster", source: "topo" }],
};

const GRADES = ["novice", "easy", "intermediate", "advanced", "expert", "extreme"] as const;
const EXCLUSIONS: Record<string, string> = {
  operating_status_unknown_or_closed: "Operating status",
  difficulty_unknown: "Missing grade",
  difficulty_limit: "Above grade limit",
  endpoints_too_far: "Endpoints too far",
  outside_corridor: "Outside corridor",
  incomplete_terrain_coverage: "Incomplete terrain data",
  distance_limit: "Above distance limit",
  climb_limit: "Above climb limit",
  forecast_exposure: "Flagged exposure",
};
const CONTROL = "rounded-md border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-45";
const INPUT = "mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm";

export function RoutePreview({ samples, demo, matchSketch }: {
  samples: PreviewSample[];
  demo: SuggestionsRequest;
  matchSketch: Position[];
}) {
  const map = useRef<MapRef>(null);
  const mapSection = useRef<HTMLElement>(null);
  const [sample, setSample] = useState(samples[0]);
  const [sketch, setSketch] = useState<Position[]>([]);
  const [mode, setMode] = useState<"pins" | "sketch">("pins");
  const [drawing, setDrawing] = useState(false);
  const [terrain, setTerrain] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [grade, setGrade] = useState(demo.max_difficulty);
  const [threshold, setThreshold] = useState<NonNullable<SuggestionsRequest["avoid_at_or_above"]>>("considerable");
  const [distance, setDistance] = useState(demo.max_distance_m);
  const [climb, setClimb] = useState(demo.max_climb_ft);
  const [result, setResult] = useState<SuggestionsResponse | EndpointSuggestionsResponse | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function frame(points: Position[]) {
    if (!points.length) return;
    const [first, ...rest] = points;
    const bounds: [Position, Position] = [[...first], [...first]];
    for (const [lng, lat] of rest) {
      bounds[0][0] = Math.min(bounds[0][0], lng);
      bounds[0][1] = Math.min(bounds[0][1], lat);
      bounds[1][0] = Math.max(bounds[1][0], lng);
      bounds[1][1] = Math.max(bounds[1][1], lat);
    }
    map.current?.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 350 });
  }

  function updateSketch(points: Position[]) {
    setSketch(points);
    setResult(null);
    setError("");
  }

  function loadSketch(points: Position[]) {
    const selected = mode === "pins" ? [points[0], points[points.length - 1]] : points;
    updateSketch(selected);
    setDrawing(false);
    frame(selected);
    mapSection.current?.scrollIntoView({ block: "nearest" });
  }

  async function findSuggestions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sketch.length < 2 || busy) return;
    setBusy(true);
    setDrawing(false);
    setResult(null);
    setError("");
    try {
      const limits = {
        date: demo.date,
        endpoint_tolerance_m: demo.endpoint_tolerance_m,
        limit: demo.limit,
        max_difficulty: grade,
        max_distance_m: distance,
        max_climb_ft: climb,
        avoid_at_or_above: threshold,
      };
      const response = mode === "pins"
        ? await api.endpointSuggestions({ ...limits, start: sketch[0], destination: sketch[1] })
        : await api.suggestions({
          ...limits, corridor_width_m: demo.corridor_width_m,
          route: { type: "LineString", coordinates: sketch },
        });
      setActiveSuggestion(0);
      setResult(response);
      frame([...sketch, ...(response.suggestions[0]?.route.coordinates ?? [])]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load suggestions.");
    } finally {
      setBusy(false);
    }
  }

  const suggestion = result?.suggestions[activeSuggestion];
  const original = result && "original_analysis" in result ? result.original_analysis : null;
  const forcedByWarning = result && (
    "forced_by_warning" in result ? result.forced_by_warning : original?.forced_by_warning
  );
  const sampleData = {
    type: "FeatureCollection" as const,
    features: sample.lines.map((line) => ({
      type: "Feature" as const,
      properties: {},
      geometry: line.length === 1
        ? { type: "Point" as const, coordinates: line[0] }
        : { type: "LineString" as const, coordinates: line },
    })),
  };

  return (
    <main className="grid min-h-dvh bg-slate-950 text-slate-100 md:h-dvh md:grid-cols-[minmax(0,1fr)_24rem]">
      <section ref={mapSection} aria-label="Route map" className="relative h-[54dvh] min-h-80 md:h-full">
        <Map
          ref={map}
          mapStyle={MAP_STYLE}
          initialViewState={{ longitude: -111.681, latitude: 40.5585, zoom: 12.8 }}
          style={{ width: "100%", height: "100%" }}
          cursor={drawing ? "crosshair" : "grab"}
          onLoad={() => {
            frame(sample.lines.flat());
            setMapReady(true);
          }}
          onClick={(event) => {
            if (drawing && !busy) {
              const points: Position[] = [...sketch, [event.lngLat.lng, event.lngLat.lat]];
              updateSketch(points);
              if (mode === "pins" && points.length === 2) setDrawing(false);
            }
          }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <ScaleControl position="bottom-left" unit="metric" />
          <Source id="source-sample" type="geojson" data={sampleData}>
            <Layer id="source-outline" type="line" paint={{ "line-color": "#172554", "line-width": 6 }} />
            <Layer id="source-line" type="line" paint={{ "line-color": "#38bdf8", "line-width": 3.5 }} />
            <Layer id="source-points" type="circle" filter={["==", ["geometry-type"], "Point"]} paint={{
              "circle-color": "#38bdf8", "circle-radius": 4, "circle-stroke-color": "#172554", "circle-stroke-width": 2,
            }} />
          </Source>
          {mode === "pins" && sketch.map(([longitude, latitude], index) => (
            <Marker key={index} longitude={longitude} latitude={latitude} anchor="bottom">
              <span className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-violet-700 text-xs font-bold text-white shadow"
                aria-label={index === 0 ? "Start pin" : "Destination pin"}>{index === 0 ? "A" : "B"}</span>
            </Marker>
          ))}
          {mode === "sketch" && sketch.length > 0 && (
            <Source id="sketch" type="geojson" data={{
              type: "Feature",
              properties: {},
              geometry: sketch.length === 1
                ? { type: "Point", coordinates: sketch[0] }
                : { type: "LineString", coordinates: sketch },
            }}>
              <Layer id="sketch-line" type="line" paint={{ "line-color": "#7c3aed", "line-width": 4, "line-dasharray": [2, 1] }} />
              <Layer id="sketch-point" type="circle" filter={["==", ["geometry-type"], "Point"]} paint={{
                "circle-color": "#7c3aed", "circle-radius": 5,
              }} />
            </Source>
          )}
          {original && (
            <Source id="flagged-sketch" type="geojson" data={{
              ...original.segments,
              features: original.segments.features.filter((segment) => segment.properties.flagged),
            }}>
              <Layer id="flagged-sketch-line" type="line" paint={{ "line-color": "#e11d48", "line-width": 5 }} />
            </Source>
          )}
          {suggestion && (
            <Source id="suggestion" type="geojson" data={{ type: "Feature", properties: {}, geometry: suggestion.route }}>
              <Layer id="suggestion-line" type="line" paint={{ "line-color": "#fb923c", "line-width": 4 }} />
            </Source>
          )}
        </Map>
        <div className="pointer-events-none absolute left-3 top-3 max-w-[70%] rounded-lg bg-slate-950/90 p-3 text-xs shadow-lg">
          <p className="font-semibold">Little Cottonwood Canyon</p>
          {!mapReady && <p className="mt-1">Loading terrain map…</p>}
          <p className="mt-1 text-sky-300">Blue · Source sample</p>
          {sketch.length > 0 && <p className="text-violet-300">{mode === "pins" ? "A · Start    B · Destination" : "Purple dash · Your sketch"}</p>}
          {!!original?.totals.flagged_stretch_count && <p className="text-rose-300">Rose · Flagged sketch sections</p>}
          {suggestion && <p className="text-orange-300">Orange · Mapped match</p>}
          {drawing && <p className="mt-1">{mode === "pins"
            ? sketch.length === 0 ? "Click to place the start." : "Click to place the destination."
            : "Click the map to add points."}</p>}
        </div>
        <button type="button" disabled={!mapReady} aria-pressed={terrain} className="absolute right-3 top-24 rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white shadow disabled:opacity-45"
          onClick={() => {
            map.current?.getMap().setTerrain(terrain ? null : { source: "elevation", exaggeration: 1 });
            setTerrain(!terrain);
            map.current?.easeTo({ pitch: terrain ? 0 : 55, bearing: terrain ? 0 : -20, duration: 600 });
          }}>{terrain ? "Back to 2D" : "View in 3D"}</button>
      </section>
      <aside className="space-y-5 overflow-y-auto border-slate-800 p-5 md:border-l">
        <header>
          <p className="text-xs font-semibold tracking-wider text-sky-300">REDRUN · LOCAL PREVIEW</p>
          <h1 className="mt-1 text-2xl font-semibold">Route explorer</h1>
          <p className="mt-1 text-sm text-slate-300">Pick two points, check mapped ski sections, and preview the terrain.</p>
        </header>
        <section aria-labelledby="sample-label" className="space-y-3">
          <div>
            <label id="sample-label" htmlFor="source-sample" className="block text-sm font-semibold">
              Source sample
            </label>
            <select id="source-sample" disabled={!mapReady} className={INPUT} value={sample.id} onChange={(event) => {
              const selected = samples.find((item) => item.id === event.target.value);
              if (selected) {
                setSample(selected);
                frame(selected.lines.flat());
              }
            }}>
              {samples.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
            <p className="font-medium">{sample.grade ? `Skitour ski grade ${sample.grade}` : "Ski grade unavailable"}</p>
            <p className="mt-1 text-slate-300">{sample.points.toLocaleString()} source points</p>
            {sample.gapCount !== null ? (
              <p className="mt-2 text-amber-200">
                Breaks over 100 m: {sample.gapCount}. Largest interval: {sample.largestGapM} m.
                Endpoint gap: {sample.endpointGapM} m.
              </p>
            ) : (
              <p className="mt-2 text-amber-200">Forest Service centerline. Winter use and skiing difficulty are unknown.</p>
            )}
            <a href={sample.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sky-300 underline">
              {sample.source}
            </a>
            {sample.license && <span className="ml-2 text-xs text-slate-300">{sample.license}</span>}
          </div>
        </section>
        <form onSubmit={findSuggestions} className="space-y-3 border-t border-slate-800 pt-4">
          <div>
            <h2 className="font-semibold">Find nearby sections</h2>
            <p className="mt-1 text-xs text-slate-300">Forecast fixture · {demo.date}. Source samples are for inspection.</p>
          </div>
          <div className="flex gap-2">
            {(["pins", "sketch"] as const).map((option) => (
              <button type="button" key={option} disabled={busy} aria-pressed={mode === option}
                className={`${CONTROL} ${mode === option ? "bg-slate-700" : ""}`}
                onClick={() => {
                  if (mode !== option) {
                    setMode(option);
                    setDrawing(false);
                    updateSketch([]);
                  }
                }}>{option === "pins" ? "Two points" : "Sketch"}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !mapReady} className={CONTROL}
              onClick={() => loadSketch(demo.route.coordinates)}>Load no-match example</button>
            <button type="button" disabled={busy || !mapReady} className={CONTROL}
              onClick={() => loadSketch(matchSketch)}>Load match example</button>
            <button type="button" disabled={busy || !mapReady} aria-pressed={drawing} className={CONTROL}
              onClick={() => {
                if (!drawing) {
                  if (mode === "pins") updateSketch([]);
                  mapSection.current?.scrollIntoView({ block: "start" });
                }
                setDrawing(!drawing);
              }}>{drawing ? "Finish selection" : mode === "pins" ? "Pick start and destination" : "Draw on map"}</button>
            {sketch.length > 0 && <button type="button" disabled={busy} className={CONTROL}
              onClick={() => updateSketch(sketch.slice(0, -1))}>Undo point</button>}
            {sketch.length > 0 && <button type="button" disabled={busy} className={CONTROL}
              onClick={() => updateSketch([])}>{mode === "pins" ? "Clear pins" : "Clear sketch"}</button>}
          </div>
          <p className="text-xs text-slate-300">{mode === "pins"
            ? `${sketch.length} of 2 pins placed`
            : `${sketch.length} sketch ${sketch.length === 1 ? "point" : "points"}`}</p>
          <fieldset disabled={busy} className="grid grid-cols-2 gap-3 text-xs">
            <label>Maximum OSM difficulty
              <select className={INPUT} value={grade} onChange={(event) => {
                setGrade(event.target.value as SuggestionsRequest["max_difficulty"]);
                setResult(null);
              }}>{GRADES.map((value) => <option key={value}>{value}</option>)}</select>
            </label>
            <label>Flag slopes at or above
              <select className={INPUT} value={threshold} onChange={(event) => {
                setThreshold(event.target.value as typeof threshold);
                setResult(null);
              }}>
                <option value="considerable">Considerable</option>
                <option value="moderate">Moderate</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label>Maximum distance (m)
              <input className={INPUT} type="number" min={1} max={100000} required value={distance || ""}
                onChange={(event) => { setDistance(Number(event.target.value)); setResult(null); }} />
            </label>
            <label>Maximum climb (ft)
              <input className={INPUT} type="number" min={0} max={30000} required value={climb}
                onChange={(event) => { setClimb(Number(event.target.value)); setResult(null); }} />
            </label>
          </fieldset>
          <button type="submit" disabled={sketch.length < 2 || busy}
            className="w-full rounded-md bg-sky-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-45">
            {busy ? "Checking sections…" : "Check nearby sections"}
          </button>
        </form>
        <div aria-live="polite" className="space-y-3 text-sm">
          {error && <p role="alert" className="rounded-md bg-red-950 p-3 text-red-200">{error}</p>}
          {result && (
            <section className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
              <p className="font-semibold">{result.status === "found" ? "Mapped matches" : "No match"}</p>
              <p>{result.message}</p>
              <p className="text-xs text-slate-300">
                Forecast: {result.source} · {result.date}
                {original && ` · ${Math.round(original.totals.flagged_length_m)} m flagged on sketch`}
              </p>
              {forcedByWarning && <p>Warning applied the Low threshold.</p>}
              {result.suggestions.map((item, index) => (
                <button key={item.id} type="button" aria-pressed={index === activeSuggestion}
                  className={`${CONTROL} block w-full text-left`}
                  onClick={() => { setActiveSuggestion(index); frame([...sketch, ...item.route.coordinates]); }}>
                  {item.name ?? "Unnamed section"} · {item.difficulty}
                  <span className="block text-xs text-slate-300">
                    {Math.round(item.analysis.totals.length_m)} m · {Math.round(item.analysis.totals.climb_ft)} ft climb
                    {"comparison" in item && ` · ${Math.round(item.comparison.max_deviation_m)} m from sketch`}
                  </span>
                </button>
              ))}
              {suggestion && <p className="text-xs">Endpoint gaps: {Math.round(suggestion.start_distance_m)} m at start and {Math.round(suggestion.end_distance_m)} m at end.</p>}
              {Object.entries(result.excluded).map(([reason, count]) => (
                <p key={reason} className="text-xs text-slate-300">{EXCLUSIONS[reason] ?? reason}: {count}</p>
              ))}
              <p className="text-xs text-slate-400">{result.catalog.attribution}</p>
              {suggestion && <p className="text-xs text-amber-200">Mapped section. Confirm the full itinerary and current conditions.</p>}
            </section>
          )}
        </div>
      </aside>
    </main>
  );
}
