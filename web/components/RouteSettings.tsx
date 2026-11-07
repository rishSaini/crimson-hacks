"use client";

import { useId } from "react";
import type { AvoidAtOrAbove } from "@/lib/analysis";

/** Forecast days the API can serve: two replayed UAC days and the sample fixture. */
export const DEMO_DATES = [
  { value: "2026-02-21", label: "Feb 21, 2026: Special Bulletin (main demo)" },
  { value: "2026-02-18", label: "Feb 18, 2026: Avalanche Warning" },
  { value: "2026-01-15", label: "Jan 15, 2026: sample data, not a real forecast" },
] as const;

export type DemoDate = (typeof DEMO_DATES)[number]["value"];
export const DEFAULT_DEMO_DATE: DemoDate = "2026-02-21";

/** The three settings the API accepts. Beginner mode is `low`; the server computes flags. */
const AVOID_OPTIONS: { value: AvoidAtOrAbove; label: string; subtitle?: string }[] = [
  { value: "considerable", label: "Avoid Considerable and above (default)" },
  { value: "moderate", label: "Also avoid Moderate" },
  {
    value: "low",
    label: "Beginner mode: stay off and out from under slopes 30° and steeper",
    subtitle: "Checks slopes on your route and within 300 m uphill.",
  },
];

type Props = {
  date: DemoDate;
  onDateChange: (date: DemoDate) => void;
  avoidAtOrAbove: AvoidAtOrAbove;
  onAvoidChange: (value: AvoidAtOrAbove) => void;
  /** An Avalanche Warning overrides the setting for this forecast day. */
  forcedByWarning: boolean;
};

export function RouteSettings({
  date,
  onDateChange,
  avoidAtOrAbove,
  onAvoidChange,
  forcedByWarning,
}: Props) {
  const dateId = useId();
  const groupName = useId();

  return (
    <div className="space-y-3 text-sm" data-testid="route-settings">
      <div className="space-y-1">
        <label htmlFor={dateId} className="block font-medium">
          Forecast day
        </label>
        <select
          id={dateId}
          value={date}
          onChange={(event) => onDateChange(event.target.value as DemoDate)}
          className="w-full rounded border border-neutral-400 bg-transparent px-2 py-1"
        >
          {DEMO_DATES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-1">
        <legend className="font-medium">What to flag on your route</legend>
        {AVOID_OPTIONS.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={avoidAtOrAbove === option.value}
              onChange={() => onAvoidChange(option.value)}
              className="mt-1"
            />
            <span>
              {option.label}
              {option.subtitle && (
                <span className="block text-xs text-neutral-600">{option.subtitle}</span>
              )}
            </span>
          </label>
        ))}
        {forcedByWarning && (
          <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
            Overridden for this forecast day: the Avalanche Warning flags every slope 30° and
            steeper. Your saved setting above is unchanged.
          </p>
        )}
      </fieldset>
    </div>
  );
}
