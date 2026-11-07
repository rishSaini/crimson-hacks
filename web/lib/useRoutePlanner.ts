"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type AlternativeResponse,
  type AnalyzeResponse,
  type ForecastResponse,
  type PlanRequest,
  type PlanResponse,
} from "@/lib/api";
import { useStoredChoice } from "@/lib/useDisplayPrefs";

const SETTINGS = ["considerable", "moderate", "low"] as const;

export type LngLat = [number, number];
export type AvoidSetting = NonNullable<PlanRequest["avoid_at_or_above"]>;
export type RerouteState =
  | { status: "idle" }
  | { status: "loading"; setting: AvoidSetting }
  | { status: "done"; result: AlternativeResponse; override: AvoidSetting | null }
  | { status: "error"; message: string };

export const REPLAN_DELAY_MS = 400;
export const DEMO_DAYS = [
  { date: "2026-02-21", label: "Feb 21, 2026 (Special Bulletin)" },
  { date: "2026-02-18", label: "Feb 18, 2026 (Avalanche Warning)" },
] as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

/** Two clicked points, the route planned between them, its flags, and the reroute. */
export function useRoutePlanner() {
  const [points, setPoints] = useState<LngLat[]>([]);
  const [date, setDate] = useState<string>(DEMO_DAYS[0].date);
  // The saved default, remembered per browser. Changing it re-rates the route.
  const [setting, setSetting] = useStoredChoice<AvoidSetting>("redrun:avoid", "considerable", SETTINGS);
  const [corridor, setCorridor] = useState(400);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [accepted, setAccepted] = useState<AnalyzeResponse | null>(null);
  // An accepted "Avoid these too" line was flagged at this stricter level, for this route only.
  const [acceptedOverride, setAcceptedOverride] = useState<AvoidSetting | null>(null);
  const [planError, setPlanError] = useState("");
  const [reroute, setReroute] = useState<RerouteState>({ status: "idle" });
  // Keyed by date, so a day switch never shows the previous day's forecast or alert.
  const [loadedForecast, setLoadedForecast] = useState<
    { date: string; forecast: ForecastResponse | null } | null
  >(null);
  const pointsRef = useRef(points);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "Make this my default" saves the setting without re-planning the line on screen.
  const skipReplan = useRef(false);
  const stale = useRef(false);
  const inFlight = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const start = useCallback(() => {
    cancel();
    const controller = new AbortController();
    inFlight.current = controller;
    return controller;
  }, [cancel]);

  const runPlan = useCallback(async () => {
    const [from, to] = pointsRef.current;
    if (!from || !to) return;
    const controller = start();
    setPlanning(true);
    setPlanError("");
    setReroute({ status: "idle" });
    setAccepted(null);
    setAcceptedOverride(null);
    stale.current = false;
    try {
      const result = await api.plan(
        { start: from, end: to, date, avoid_at_or_above: setting },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPlan(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPlan(null);
      setPlanError(message(error));
    }
    setPlanning(false);
  }, [date, setting, start]);

  // A new day or setting re-rates the route. The date and setting are in runPlan's identity.
  useEffect(() => {
    if (skipReplan.current) {
      skipReplan.current = false;
      stale.current = true;
      return;
    }
    timer.current = setTimeout(() => void runPlan(), 0);
    return cancel;
  }, [cancel, runPlan]);

  useEffect(() => {
    let current = true;
    api.forecast(date).then(
      (loaded) => { if (current) setLoadedForecast({ date, forecast: loaded }); },
      () => { if (current) setLoadedForecast({ date, forecast: null }); },
    );
    return () => { current = false; };
  }, [date]);

  const placePoint = useCallback((point: LngLat) => {
    // A third click starts over, since a route only has two ends.
    const next = pointsRef.current.length >= 2 ? [point] : [...pointsRef.current, point];
    pointsRef.current = next;
    setPoints(next);
    if (next.length === 2) {
      void runPlan();
    } else {
      cancel();
      setPlan(null);
      setAccepted(null);
      setAcceptedOverride(null);
      setPlanError("");
      setPlanning(false);
      setReroute({ status: "idle" });
    }
  }, [cancel, runPlan]);

  const movePoint = useCallback((index: number, point: LngLat) => {
    const next = pointsRef.current.map((existing, i) => (i === index ? point : existing));
    pointsRef.current = next;
    setPoints(next);
  }, []);

  const dropPoint = useCallback((index: number, point: LngLat) => {
    movePoint(index, point);
    cancel();
    // Pending from the drop, so Reroute can't run on (and cancel) the line being replaced.
    if (pointsRef.current.length >= 2) setPlanning(true);
    timer.current = setTimeout(() => void runPlan(), REPLAN_DELAY_MS);
  }, [cancel, movePoint, runPlan]);

  const current = accepted ?? plan?.analysis ?? null;
  const baseLine = accepted
    ? accepted.segments.features.flatMap((feature, index) =>
      index === 0 ? feature.geometry.coordinates : feature.geometry.coordinates.slice(1))
    : plan?.route?.coordinates ?? null;

  // The level the line on screen was flagged at: an accepted override, else the saved setting.
  const effectiveSetting = acceptedOverride ?? setting;

  const runReroute = useCallback(async (
    width: number, avoid: AvoidSetting = effectiveSetting, override: AvoidSetting | null = acceptedOverride,
  ) => {
    if (!baseLine) return;
    const controller = start();
    setReroute({ status: "loading", setting: avoid });
    try {
      const result = await api.alternative(
        {
          route: { type: "LineString", coordinates: baseLine },
          date,
          corridor_width_m: width,
          avoid_at_or_above: avoid,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setReroute({ status: "done", result, override });
    } catch (error) {
      if (!controller.signal.aborted) setReroute({ status: "error", message: message(error) });
    }
  }, [acceptedOverride, baseLine, date, effectiveSetting, start]);

  const undoReroute = useCallback(() => {
    setReroute({ status: "idle" });
    // The default changed while the card was open, so the original line needs re-rating.
    if (stale.current) void runPlan();
  }, [runPlan]);

  const acceptReroute = useCallback(() => {
    if (reroute.status === "done" && reroute.result.analysis) {
      setAccepted(reroute.result.analysis);
      setAcceptedOverride(reroute.override);
      setReroute({ status: "idle" });
      stale.current = false;
    }
  }, [reroute]);

  /** Saves `value` as the default without re-planning the line on screen. */
  const makeDefault = useCallback((value: AvoidSetting) => {
    if (value === setting) return;
    skipReplan.current = true;
    setSetting(value);
  }, [setSetting, setting]);

  const alternative = reroute.status === "done" && reroute.result.status === "found"
    ? reroute.result : null;
  const activeAnalysis = alternative?.analysis ?? current;

  return {
    points,
    date,
    setDate,
    setting,
    setSetting,
    makeDefault,
    /** The level the line on screen is flagged at (an accepted "Avoid these too" can be stricter). */
    effectiveSetting,
    corridor,
    setCorridor,
    planning,
    plan,
    planError,
    forecast: loadedForecast?.date === date ? loadedForecast.forecast : null,
    /** True once the forecast for this day failed to load. */
    forecastFailed: loadedForecast?.date === date && loadedForecast.forecast === null,
    reroute,
    current,
    alternative,
    /** The line now shown as the route. */
    activeAnalysis,
    /** The line a found reroute would replace, drawn as a gray ghost. */
    ghost: alternative ? current : null,
    line: alternative?.alternative?.coordinates ?? baseLine,
    placePoint,
    movePoint,
    dropPoint,
    cancel,
    runReroute,
    undoReroute,
    acceptReroute,
  };
}

export type RoutePlanner = ReturnType<typeof useRoutePlanner>;
