"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Map, { Layer, Marker, NavigationControl, ScaleControl, Source, type MapRef } from "react-map-gl/maplibre";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type EndpointSuggestionsResponse, type SuggestionsRequest, type SuggestionsResponse } from "@/lib/api";
import { RouteRide } from "@/components/RouteRide";
import { PreviewIcon } from "@/components/PreviewIcon";
import styles from "./RoutePreview.module.css";

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
  sky: { "sky-color": "#b5d9f0", "horizon-color": "#edf4f8" },
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
      maxzoom: 16,
      tileSize: 512,
      attribution: "© Mapterhorn",
    },
    imagery: {
      type: "raster",
      tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 16,
      attribution: "USDA, USGS The National Map imagery",
    },
  },
  layers: [
    { id: "topographic-map", type: "raster", source: "topo" },
    { id: "satellite-map", type: "raster", source: "imagery", layout: { visibility: "none" } },
  ],
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

export function RoutePreview({ samples, demo, matchSketch }: {
  samples: PreviewSample[];
  demo: SuggestionsRequest;
  matchSketch: Position[];
}) {
  const map = useRef<MapRef>(null);
  const mapSection = useRef<HTMLElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [sample, setSample] = useState(samples.find((item) => item.id === "skitour-8618") ?? samples[0]);
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

  useEffect(() => {
    if (result || error) feedback.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [result, error]);

  const [plannerCollapsed, setPlannerCollapsed] = useState(false);
  const [rideActive, setRideActive] = useState(false);
  const handleRideActive = useCallback((active: boolean) => {
    setRideActive(active);
    if (active) {
      setPlannerCollapsed(true);
      setDrawing(false);
    }
  }, []);

  function frame(points: Position[], panelOpen = !plannerCollapsed) {
    if (!points.length) return;
    const [first, ...rest] = points;
    const bounds: [Position, Position] = [[...first], [...first]];
    for (const [lng, lat] of rest) {
      bounds[0][0] = Math.min(bounds[0][0], lng);
      bounds[0][1] = Math.min(bounds[0][1], lat);
      bounds[1][0] = Math.max(bounds[1][0], lng);
      bounds[1][1] = Math.max(bounds[1][1], lat);
    }
    const desktop = (mapSection.current?.clientWidth ?? 0) >= 900;
    const mobileBottom = panelOpen ? Math.min(window.innerHeight * 0.49 + 45, (mapSection.current?.clientHeight ?? 700) - 200) : 110;
    map.current?.fitBounds(bounds, {
      padding: desktop ? { left: 420, right: 80, top: 100, bottom: 300 } : { left: 36, right: 36, top: 150, bottom: mobileBottom },
      maxZoom: 17, duration: 500,
    });
  }

  function updateSketch(points: Position[]) {
    setSketch(points);
    setResult(null);
    setError("");
  }

  function placePoint(point: Position) {
    if (!drawing || busy) return;
    const points = [...sketch, point];
    updateSketch(points);
    if (mode === "pins" && points.length === 2) {
      setDrawing(false);
      setPlannerCollapsed(false);
    }
  }

  function loadSketch(points: Position[]) {
    const selected = mode === "pins" ? [points[0], points[points.length - 1]] : points;
    updateSketch(selected);
    setDrawing(false);
    frame(selected, true);
    setPlannerCollapsed(false);
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
      setRideActive(false);
      setActiveSuggestion(0);
      setResult(response);
      frame([...sketch, ...(response.suggestions[0]?.route.coordinates ?? [])], true);
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
    <main className={styles.explorer} data-ride-active={rideActive}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="RedRun home">
          <span className={styles.brandMark}><PreviewIcon name="mountain" size={24} /></span>
          <span>redrun<span className={styles.brandPeriod}>.</span></span>
        </Link>
        <div className={styles.location}><PreviewIcon name="pin" size={17} /><span>Little Cottonwood Canyon<span>Utah, United States</span></span></div>
        <div className={styles.sourcePicker}>
          <label htmlFor="source-sample">Source track</label>
          <select id="source-sample" aria-label="Source sample" disabled={!mapReady} value={sample.id} onChange={(event) => {
            const selected = samples.find((item) => item.id === event.target.value);
            if (selected) {
              setSample(selected);
              updateSketch([]);
              setDrawing(false);
              setRideActive(false);
              frame(selected.lines.flat());
            }
          }}>
            {samples.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <span className={styles.prototype}>Local preview</span>
      </header>
      <section ref={mapSection} aria-label="Route map" aria-describedby="map-keyboard-help" className={styles.map}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.target instanceof HTMLCanvasElement) || !drawing) return;
          const center = map.current?.getCenter();
          if (center) {
            event.preventDefault();
            placePoint([center.lng, center.lat]);
          }
        }}>
        <p id="map-keyboard-help" className={styles.srOnly}>Use arrow keys to move the map. During selection, press Enter to place a point at the map center.</p>
        <Map
          ref={map}
          mapStyle={MAP_STYLE}
          initialViewState={{ longitude: -111.681, latitude: 40.5585, zoom: 12.8 }}
          style={{ width: "100%", height: "100%" }}
          cursor={drawing ? "crosshair" : "grab"}
          onLoad={() => {
            frame(sample.lines.flat());
            map.current?.getCanvas().setAttribute("aria-describedby", "map-keyboard-help");
            setMapReady(true);
          }}
          onClick={(event) => placePoint([event.lngLat.lng, event.lngLat.lat])}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <ScaleControl position="bottom-right" unit="metric" />
          <Source id="source-sample" type="geojson" data={sampleData}>
            <Layer id="source-outline" type="line" paint={{ "line-color": "#172554", "line-width": 6, "line-opacity": suggestion ? 0.25 : 1 }} />
            <Layer id="source-line" type="line" paint={{ "line-color": "#38bdf8", "line-width": 3.5, "line-opacity": suggestion ? 0.25 : 1 }} />
            <Layer id="source-points" type="circle" filter={["==", ["geometry-type"], "Point"]} paint={{
              "circle-color": "#38bdf8", "circle-radius": 4, "circle-stroke-color": "#172554", "circle-stroke-width": 2,
            }} />
          </Source>
          {mode === "pins" && sketch.map(([longitude, latitude], index) => (
            <Marker key={index} longitude={longitude} latitude={latitude} anchor="bottom">
              <span className={styles.pin}
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
        <div className={styles.mapTools}>
          <button type="button" disabled={!mapReady || rideActive} aria-pressed={terrain} className={styles.mapButton}
            onClick={() => {
              map.current?.getMap().setTerrain(terrain ? null : { source: "elevation", exaggeration: 1 });
              setTerrain(!terrain);
              map.current?.easeTo({ pitch: terrain ? 0 : 55, bearing: terrain ? 0 : -20, duration: 600 });
            }}><PreviewIcon name="layers" />{terrain ? "2D" : "3D"}</button>
          <button type="button" disabled={!mapReady || rideActive} className={styles.mapButton} aria-label="Fit route on map"
            onClick={() => frame(suggestion?.route.coordinates ?? sample.lines.flat())}><PreviewIcon name="focus" /></button>
        </div>
        <div className={styles.legend} aria-label="Map legend">
          <span><i className={styles.sourceSwatch} />Source track</span>
          {sketch.length > 0 && <span><i className={styles.sketchSwatch} />{mode === "pins" ? "A: Start · B: Destination" : "Your sketch"}</span>}
          {!!original?.totals.flagged_stretch_count && <span><i className={styles.flagSwatch} />Flagged section</span>}
          {suggestion && <span><i className={styles.matchSwatch} />Mapped match</span>}
        </div>
        {(!mapReady || drawing) && <div className={styles.mapPrompt} role="status">
          <span className={styles.promptDot} />
          {!mapReady ? "Loading terrain map…" : mode === "pins"
            ? sketch.length === 0 ? "Click the map to place your start." : "Click the map to place your destination."
            : "Click the map to add points to your sketch."}
        </div>}
        <RouteRide key={suggestion?.id ?? sample.id} mapRef={map}
          lines={suggestion ? [suggestion.route.coordinates] : sample.lines}
          name={suggestion?.name ?? sample.name} ready={mapReady} onActiveChange={handleRideActive} />
      </section>
      <aside className={`${styles.planner} ${plannerCollapsed ? styles.collapsed : ""}`} aria-label="Route planner">
        <header className={styles.plannerHeader}>
          <div><p className={styles.eyebrow}><span />Route planner</p><h1>Find your line.</h1></div>
          <button type="button" className={styles.collapseButton} aria-expanded={!plannerCollapsed}
            aria-label={plannerCollapsed ? "Expand route planner" : "Collapse route planner"}
            onClick={() => setPlannerCollapsed(!plannerCollapsed)}><PreviewIcon name="chevron" /></button>
        </header>
        <div className={styles.plannerBody}>
          <p className={styles.intro}>Choose two points. Find mapped ski sections that match your level.</p>
          <form id="route-planner-form" onSubmit={findSuggestions} className={styles.routeForm}>
            <div className={styles.segmented} aria-label="Route selection method">
              {(["pins", "sketch"] as const).map((option) => (
                <button type="button" key={option} disabled={busy || rideActive} aria-pressed={mode === option}
                  onClick={() => {
                    if (mode !== option) {
                      setMode(option);
                      setDrawing(false);
                      updateSketch([]);
                    }
                  }}><PreviewIcon name={option === "pins" ? "pin" : "route"} size={16} />{option === "pins" ? "Two points" : "Sketch a route"}</button>
              ))}
            </div>
            {mode === "pins" && <div className={styles.endpoints}>
              {[0, 1].map((index) => <div className={styles.endpoint} key={index}>
                <span className={`${styles.endpointLetter} ${index === 1 ? styles.destinationLetter : ""}`}>{index === 0 ? "A" : "B"}</span>
                <div><span>{index === 0 ? "Start" : "Destination"}</span>
                  <p>{sketch[index] ? `${sketch[index][1].toFixed(4)}, ${sketch[index][0].toFixed(4)}` : "Choose on the map"}</p></div>
                {sketch[index] && <span className={styles.placed}>Placed</span>}
              </div>)}
            </div>}
            <button type="button" disabled={busy || !mapReady || rideActive} aria-pressed={drawing} className={styles.pickButton}
              onClick={() => {
                if (!drawing) {
                  if (mode === "pins") updateSketch([]);
                  setPlannerCollapsed(true);
                }
                setDrawing(!drawing);
              }}><PreviewIcon name={drawing ? "close" : "pin"} size={16} />
              {drawing ? "Finish selection" : mode === "pins" ? "Pick start and destination" : "Draw on map"}</button>
            <div className={styles.selectionStatus}>
              <span>{mode === "pins" ? `${sketch.length} of 2 pins placed` : `${sketch.length} sketch points`}</span>
              {sketch.length > 0 && <div>
                <button type="button" disabled={busy || rideActive} onClick={() => updateSketch(sketch.slice(0, -1))}>Undo point</button>
                <button type="button" disabled={busy || rideActive} onClick={() => { updateSketch([]); setDrawing(false); }}>
                  {mode === "pins" ? "Clear pins" : "Clear sketch"}</button>
              </div>}
            </div>
            <fieldset disabled={busy || rideActive} className={styles.filters}>
              <label className={styles.field}><span>Ski level <span className={styles.fieldHint}>OSM difficulty limit</span></span>
                <select aria-label="Maximum OSM difficulty" value={grade} onChange={(event) => {
                  setGrade(event.target.value as SuggestionsRequest["max_difficulty"]);
                  setResult(null);
                }}>{GRADES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select>
              </label>
              <details className={styles.details}>
                <summary>Distance, climb & exposure <PreviewIcon name="chevron" size={15} /></summary>
                <div className={styles.filterGrid}>
                  <label className={styles.field}>Maximum distance (m)
                    <input type="number" min={1} max={100000} required value={distance || ""}
                      onChange={(event) => { setDistance(Number(event.target.value)); setResult(null); }} />
                  </label>
                  <label className={styles.field}>Maximum climb (ft)
                    <input type="number" min={0} max={30000} required value={climb}
                      onChange={(event) => { setClimb(Number(event.target.value)); setResult(null); }} />
                  </label>
                  <label className={`${styles.field} ${styles.fullWidth}`}>Flag slopes at or above
                    <select value={threshold} onChange={(event) => {
                      setThreshold(event.target.value as typeof threshold);
                      setResult(null);
                    }}><option value="considerable">Considerable</option><option value="moderate">Moderate</option><option value="low">Low</option></select>
                  </label>
                </div>
              </details>
            </fieldset>
            <button type="submit" disabled={sketch.length < 2 || busy || rideActive} className={`${styles.primaryButton} ${styles.formSubmit}`}>
              {busy ? "Checking sections…" : "Find mapped sections"}<PreviewIcon name="arrow" size={18} />
            </button>
            <details className={`${styles.details} ${styles.examples}`}>
              <summary>Try an example <PreviewIcon name="chevron" size={15} /></summary>
              <p>Test the route search with known sample points.</p>
              <div className={styles.exampleButtons}>
                <button type="button" disabled={busy || !mapReady || rideActive} onClick={() => loadSketch(matchSketch)}>Load match example</button>
                <button type="button" disabled={busy || !mapReady || rideActive} onClick={() => loadSketch(demo.route.coordinates)}>Load no-match example</button>
              </div>
            </details>
          </form>
          <div className={styles.fixtureNote}><PreviewIcon name="info" size={16} />
            <p><strong>Demo forecast · {demo.date}</strong><span>Saved test data. Current conditions are not included.</span></p>
          </div>
          <div ref={feedback} aria-live="polite" aria-busy={busy}>
            {error && <p role="alert" className={styles.error}>{error} Check the API connection and try again.</p>}
            {result && <section className={styles.results} aria-label="Route search results">
              <div className={styles.resultHeading}><span className={styles.eyebrow}>Search results</span>
                <span className={styles.resultCount}>{result.suggestions.length} {result.suggestions.length === 1 ? "match" : "matches"}</span></div>
              <h2>{result.status === "found" ? "A line to explore." : "No mapped match."}</h2>
              <p>{result.message}</p>
              {result.suggestions.map((item, index) => (
                <button key={item.id} type="button" disabled={rideActive} aria-pressed={index === activeSuggestion} className={styles.resultCard}
                  onClick={() => { setActiveSuggestion(index); frame([...sketch, ...item.route.coordinates]); }}>
                  <span><i className={styles.matchSwatch} />{item.name ?? "Unnamed section"}</span>
                  <span className={styles.resultStats}>{Math.round(item.analysis.totals.length_m)} m<span>·</span>{Math.round(item.analysis.totals.climb_ft)} ft climb<span>·</span>{item.difficulty}</span>
                  {"comparison" in item && <span className={styles.resultStats}>{Math.round(item.comparison.max_deviation_m)} m from sketch</span>}
                </button>
              ))}
              {suggestion && <p className={styles.warning}>Mapped section only. Check the full route and current conditions.</p>}
              <details className={styles.details}><summary>Match details <PreviewIcon name="chevron" size={15} /></summary>
                <p>Forecast: {result.source} · {result.date}</p>
                {original && <p>{Math.round(original.totals.flagged_length_m)} m flagged on sketch.</p>}
                {forcedByWarning && <p>Warning applied the Low threshold.</p>}
                {suggestion && <p>Endpoint gaps: {Math.round(suggestion.start_distance_m)} m at start and {Math.round(suggestion.end_distance_m)} m at end.</p>}
                {Object.entries(result.excluded).map(([reason, count]) => <p key={reason}>{EXCLUSIONS[reason] ?? reason}: {count}</p>)}
                <p>{result.catalog.attribution}</p>
              </details>
            </section>}
          </div>
          <details className={`${styles.details} ${styles.sourceDetails}`}>
            <summary>About this source track <span className={styles.dataBadge}>{sample.gapCount !== null ? `${sample.gapCount} data ${sample.gapCount === 1 ? "gap" : "gaps"}` : "Grade unknown"}</span><PreviewIcon name="chevron" size={15} /></summary>
            <p><strong>{sample.name}</strong></p>
            <p>{sample.grade ? `Skitour ski grade ${sample.grade}` : "Ski grade unavailable"} · {sample.points.toLocaleString()} source points</p>
            {sample.gapCount !== null
              ? <p>Breaks over 100 m: {sample.gapCount}. Largest interval: {sample.largestGapM} m. Endpoint gap: {sample.endpointGapM} m.</p>
              : <p>Forest Service centerline. Winter use and skiing difficulty are unknown.</p>}
            <p><a href={sample.url} target="_blank" rel="noreferrer">{sample.source}</a>{sample.license && ` · ${sample.license}`}</p>
            <p>Source tracks are for inspection. Playback stops at each data gap.</p>
          </details>
        </div>
        <div className={styles.mobileActions}>
          <span>Demo forecast · {demo.date}</span>
          <button type="submit" form="route-planner-form" disabled={sketch.length < 2 || busy || rideActive} className={styles.primaryButton}>
            {busy ? "Checking sections…" : "Find mapped sections"}<PreviewIcon name="arrow" size={18} />
          </button>
        </div>
      </aside>
      <span className={styles.regionLabel}>WASATCH RANGE <span>40.56° N / 111.68° W</span></span>
    </main>
  );
}
