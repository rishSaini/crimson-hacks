"use client";

import { useEffect, useState } from "react";
import { loadForecast, type Fetched } from "@/lib/analysis";
import type { ForecastResponse } from "@/lib/api";

type Loaded = {
  date: string;
  forecast: Fetched<ForecastResponse> | null;
  error: string | null;
};

/** GET /forecast for a date, falling back to the saved demo day when the API is unreachable. */
export function useForecast(date: string) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadForecast(date)
      .then((forecast) => {
        if (!cancelled) setLoaded({ date, forecast, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Forecast failed to load";
        setLoaded({ date, forecast: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // A result for an earlier date never stands in for the selected one.
  const current = loaded?.date === date ? loaded : null;
  return {
    forecast: current?.forecast ?? null,
    error: current?.error ?? null,
    loading: current === null,
  };
}
