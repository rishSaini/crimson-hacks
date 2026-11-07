"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Check = { endpoint: string; result: string; ok: boolean };

// Any route will do: the stubs ignore the coordinates.
const SAMPLE_ROUTE = {
  type: "LineString" as const,
  coordinates: [
    [-111.6376, 40.5905],
    [-111.64, 40.58],
  ] as [number, number][],
};
const SAMPLE_DATE = "2026-01-15";

async function runChecks(): Promise<Check[]> {
  const forecast = await api.forecast(SAMPLE_DATE);
  const analysis = await api.analyze({ route: SAMPLE_ROUTE, date: SAMPLE_DATE });
  const alternative = await api.alternative({
    route: SAMPLE_ROUTE,
    date: SAMPLE_DATE,
    corridor_width_m: 400,
    avoid_at_or_above: "considerable",
  });
  const briefing = await api.briefing({ segments: analysis.segments, date: SAMPLE_DATE });

  return [
    {
      endpoint: "GET /forecast",
      result: `${forecast.overall_danger}, ${forecast.rose.length} rose cells`,
      ok: true,
    },
    {
      endpoint: "POST /analyze",
      result: `${analysis.segments.features.length} segments, ${analysis.totals.flagged_length_m} m flagged`,
      ok: true,
    },
    {
      endpoint: "POST /alternative",
      result: `${alternative.status}, ${alternative.comparison?.alternative_flagged_m} m flagged`,
      ok: true,
    },
    {
      endpoint: "POST /briefing",
      result: `${briefing.items.length} notes`,
      ok: true,
    },
  ];
}

/** Scaffold check that the web app can reach each stub. Delete once real panels exist. */
export function ApiCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    runChecks()
      .then(setChecks)
      .catch((error: Error) =>
        setChecks([{ endpoint: "API", result: error.message, ok: false }]),
      );
  }, []);

  return (
    <div className="space-y-4 text-sm">
      <h1 className="text-lg font-semibold">RedRun scaffold</h1>
      <p className="rounded bg-amber-100 p-2 text-amber-900">
        Fixture data for development. This is not a real forecast or route analysis.
      </p>
      {checks === null ? (
        <p>Calling API…</p>
      ) : (
        <ul className="space-y-2" data-testid="api-checks">
          {checks.map((check) => (
            <li key={check.endpoint}>
              <span className={check.ok ? "font-medium" : "font-medium text-red-600"}>
                {check.endpoint}
              </span>
              <br />
              {check.result}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
