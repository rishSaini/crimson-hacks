import type { Fetched } from "@/lib/analysis";
import type { ForecastResponse } from "@/lib/api";
import { sourceLabel } from "@/lib/route-summary";

type Level = ForecastResponse["alert"]["level"];

const LEVEL_LABEL: Record<Exclude<Level, "none">, string> = {
  watch: "Avalanche Watch",
  warning: "Avalanche Warning",
  special_bulletin: "Special Avalanche Bulletin",
};

const LEVEL_CLASSES: Record<Exclude<Level, "none">, string> = {
  warning: "border-red-800 bg-red-700 text-white",
  watch: "border-amber-500 bg-amber-100 text-amber-950",
  special_bulletin: "border-orange-600 bg-orange-100 text-orange-950",
};

const VALID_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Denver",
});

const formatTime = (iso: string) => VALID_TIME.format(new Date(iso));

type Props = {
  forecast: Fetched<ForecastResponse> | null;
  /** The route came back with `forced_by_warning`, or the day has a Warning. */
  forced: boolean;
};

/**
 * Full-width alert above everything when UAC has issued one for the selected day.
 * UAC's text is shown verbatim and attributed, never trimmed or reworded.
 */
export function AlertBanner({ forecast, forced }: Props) {
  const data = forecast?.data;
  const alert = data?.alert;
  const level = alert && alert.level !== "none" ? alert.level : null;
  if (!level && !forced) return null;

  const fields = alert
    ? ([
        ["What", alert.what],
        ["Where", alert.where],
        ["Impacts", alert.impacts],
        // Special bulletins have no "What to do", so the label only shows with text.
        ["What to do", alert.what_to_do],
      ] as const)
    : [];

  return (
    <section
      aria-label={level ? LEVEL_LABEL[level] : "Avalanche Warning"}
      className={`max-h-64 shrink-0 overflow-y-auto border-b-2 px-4 py-3 text-sm ${
        LEVEL_CLASSES[level ?? "warning"]
      }`}
      data-testid="alert-banner"
    >
      <div className="mx-auto max-w-5xl space-y-2">
        <p className="text-base font-semibold">
          {level ? LEVEL_LABEL[level] : "Avalanche Warning"} from the Utah Avalanche Center
          {alert?.valid_from && alert.valid_to && (
            <span className="font-normal">
              {" "}
              · valid {formatTime(alert.valid_from)} to {formatTime(alert.valid_to)} MT
            </span>
          )}
        </p>

        {forced && (
          <p className="font-medium" data-testid="forced-note">
            All slopes 30° and steeper are flagged for this forecast day, whatever your setting.
            The Warning sets the threshold to Low for this day only; your saved setting is
            unchanged.
          </p>
        )}

        {level && (
          <blockquote className="space-y-1 border-l-2 border-current/40 pl-3">
            {fields.map(([label, text]) =>
              text ? (
                <p key={label}>
                  <span className="font-semibold">{label}: </span>
                  {text}
                </p>
              ) : null,
            )}
          </blockquote>
        )}

        {data && (
          <p className="text-xs opacity-90">
            Utah Avalanche Center text, quoted verbatim.{" "}
            <a className="underline" href={data.forecast_url} target="_blank" rel="noreferrer">
              Read the full forecast
            </a>
            . {sourceLabel(data.source, data.date)}
            {forecast?.offline && " (saved copy: API unreachable)"}.
          </p>
        )}
      </div>
    </section>
  );
}
