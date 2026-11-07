"use client";

import { useCallback, useState } from "react";
import type { RouteDrawing } from "@/hooks/useRouteDrawing";
import {
  rerouteRoute,
  type AvoidAtOrAbove,
  type RerouteResult,
} from "@/lib/analysis";

export type RerouteState =
  | { status: "idle" }
  | { status: "loading"; key: number }
  | { status: "done"; key: number; result: RerouteResult }
  | { status: "error"; key: number; message: string };

const IDLE: RerouteState = { status: "idle" };

type Options = {
  route: RouteDrawing;
  avoidAtOrAbove: AvoidAtOrAbove;
  date: string;
};

/**
 * The reroute for the route's current analysis. It belongs to one analysis: a new
 * one (Clear, a redraw, a setting or date change, "Use this route") drops it.
 */
export function useReroute({ route, avoidAtOrAbove, date }: Options) {
  const [state, setState] = useState<RerouteState>(IDLE);
  const { phase, points, requestKey } = route;
  const current = state.status !== "idle" && state.key === requestKey ? state : IDLE;

  const start = useCallback(async () => {
    if (phase !== "analyzed") return;
    const key = requestKey;
    setState({ status: "loading", key });
    const settle = (next: RerouteState) =>
      // Ignore the answer if Undo or a new analysis came first.
      setState((prev) => (prev.status === "loading" && prev.key === key ? next : prev));
    try {
      const result = await rerouteRoute(points, avoidAtOrAbove, date);
      settle({ status: "done", key, result });
    } catch (error) {
      settle({
        status: "error",
        key,
        message: error instanceof Error ? error.message : "Reroute failed",
      });
    }
  }, [phase, points, requestKey, avoidAtOrAbove, date]);

  const undo = useCallback(() => setState(IDLE), []);

  return { state: current, start, undo };
}

export type Reroute = ReturnType<typeof useReroute>;
