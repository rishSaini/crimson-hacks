"use client";

import { useCallback, useEffect, useReducer } from "react";
import {
  analyzeRoute,
  localDateIso,
  type AvoidAtOrAbove,
  type Fetched,
} from "@/lib/analysis";
import type { AnalyzeResponse } from "@/lib/api";
import type { LngLat } from "@/lib/geo";

export type DrawPhase = "drawing" | "analyzing" | "analyzed" | "error";

type State = {
  points: LngLat[];
  phase: DrawPhase;
  analysis: Fetched<AnalyzeResponse> | null;
  error: string | null;
  /** Bumped on every new request or reset, so a late response for an old line is dropped. */
  requestKey: number;
};

type Action =
  | { type: "add"; point: LngLat }
  | { type: "undo" }
  | { type: "finish" }
  | { type: "reanalyze" }
  | { type: "resolved"; key: number; analysis: Fetched<AnalyzeResponse> }
  | { type: "failed"; key: number; error: string }
  | { type: "clear" };

const initialState: State = {
  points: [],
  phase: "drawing",
  analysis: null,
  error: null,
  requestKey: 0,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "add":
      return state.phase === "drawing"
        ? { ...state, points: [...state.points, action.point] }
        : state;
    case "undo":
      return state.phase === "drawing"
        ? { ...state, points: state.points.slice(0, -1) }
        : state;
    case "finish":
      if (state.phase !== "drawing" || state.points.length < 2) return state;
      return { ...state, phase: "analyzing", error: null, requestKey: state.requestKey + 1 };
    case "reanalyze":
      if (state.phase !== "analyzed" && state.phase !== "error") return state;
      return { ...state, phase: "analyzing", error: null, requestKey: state.requestKey + 1 };
    case "resolved":
      if (action.key !== state.requestKey) return state;
      return { ...state, phase: "analyzed", analysis: action.analysis };
    case "failed":
      if (action.key !== state.requestKey) return state;
      return { ...state, phase: "error", error: action.error };
    case "clear":
      return { ...initialState, requestKey: state.requestKey + 1 };
  }
}

type Options = {
  avoidAtOrAbove: AvoidAtOrAbove;
  /** YYYY-MM-DD. Defaults to today in the browser's time zone, read at request time. */
  date?: string;
};

/**
 * Click-to-draw route state: drop waypoints, finish, then POST /analyze with the
 * current `avoid_at_or_above`. Falls back to the analyze fixture only when the
 * API can't be reached at all.
 */
export function useRouteDrawing({ avoidAtOrAbove, date }: Options) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { phase, points, requestKey } = state;

  useEffect(() => {
    if (phase !== "analyzing") return;
    let cancelled = false;
    const key = requestKey;

    analyzeRoute(points, avoidAtOrAbove, date ?? localDateIso())
      .then((analysis) => {
        if (!cancelled) dispatch({ type: "resolved", key, analysis });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Route analysis failed";
        dispatch({ type: "failed", key, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [phase, points, requestKey, avoidAtOrAbove, date]);

  return {
    ...state,
    addPoint: useCallback((point: LngLat) => dispatch({ type: "add", point }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    finish: useCallback(() => dispatch({ type: "finish" }), []),
    /** Re-run /analyze on the same line, e.g. after the avoid setting changes, or to retry. */
    reanalyze: useCallback(() => dispatch({ type: "reanalyze" }), []),
    clear: useCallback(() => dispatch({ type: "clear" }), []),
  };
}
