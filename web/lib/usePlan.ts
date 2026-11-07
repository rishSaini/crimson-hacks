"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PlanRequest, type PlanResponse } from "@/lib/api";

export type LngLat = [number, number];
export type PlanEnd = "start" | "end";
export type PlanPoints = Record<PlanEnd, LngLat>;
export type PlanState =
  | { status: "planning"; result: PlanResponse | null }
  | { status: "done"; result: PlanResponse }
  | { status: "error"; message: string; result: null };

export const REPLAN_DELAY_MS = 400;

type Options = {
  enabled: boolean;
  date: string;
  avoidAtOrAbove: PlanRequest["avoid_at_or_above"];
  initialPoints: PlanPoints;
};

/** Plans a line between two points, again 400 ms after a marker is dropped. */
export function usePlan({ enabled, date, avoidAtOrAbove, initialPoints }: Options) {
  const [points, setPoints] = useState<PlanPoints>(initialPoints);
  const [plan, setPlan] = useState<PlanState>({ status: "planning", result: null });
  const pointsRef = useRef(points);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const run = useCallback(async () => {
    cancel();
    const controller = new AbortController();
    inFlight.current = controller;
    // Plans take a few seconds, so keep the last line visible while the next one loads.
    setPlan((previous) => ({ status: "planning", result: previous.result }));
    try {
      const result = await api.plan(
        {
          start: pointsRef.current.start,
          end: pointsRef.current.end,
          date,
          avoid_at_or_above: avoidAtOrAbove,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setPlan({ status: "done", result });
    } catch (error) {
      if (!controller.signal.aborted) {
        setPlan({ status: "error", message: (error as Error).message, result: null });
      }
    }
  }, [avoidAtOrAbove, cancel, date]);

  useEffect(() => {
    if (!enabled) return cancel;
    timer.current = setTimeout(run, 0);
    return cancel;
  }, [cancel, enabled, run]);

  const move = useCallback((end: PlanEnd, position: LngLat) => {
    pointsRef.current = { ...pointsRef.current, [end]: position };
    setPoints(pointsRef.current);
  }, []);

  const onDragEnd = useCallback(
    (end: PlanEnd, position: LngLat) => {
      move(end, position);
      cancel();
      timer.current = setTimeout(run, REPLAN_DELAY_MS);
    },
    [cancel, move, run],
  );

  return { points, plan, onDragStart: cancel, onDrag: move, onDragEnd };
}
