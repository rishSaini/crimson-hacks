"use client";

import type { AlternativeResponse, ForecastResponse, PlanResponse } from "@/lib/api";
import { DANGER, SOURCE, dangerStyle, formatDay, type Danger } from "@/lib/danger";
import { useDisplayPrefs } from "@/lib/useDisplayPrefs";
import { DEMO_DAYS, type AvoidSetting, type RoutePlanner } from "@/lib/useRoutePlanner";
import { DangerRose } from "@/components/DangerRose";
import { PreviewIcon } from "@/components/PreviewIcon";
import { RouteProfile } from "@/components/RouteProfile";
import styles from "./Planner.module.css";

const SOURCE_LABEL: Record<PlanResponse["source"], string> = {
  uac_live: "Today's UAC forecast",
  demo_replay: "Replaying a real past UAC forecast",
  fixture: "Sample data, not a real forecast",
};
const WIDER = [800, 1500];

function feet(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value)).toLocaleString()} ft`;
}

function meters(value: number) {
  return `${Math.round(value).toLocaleString()} m`;
}

function km(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : meters(value);
}

/** "Feb 21, 2026 (Special Bulletin)" → ["Feb 21, 2026", "Special Bulletin"] */
function splitDayLabel(label: string): [string, string] {
  const match = label.match(/^(.*?)\s*\((.*)\)$/);
  return match ? [match[1], match[2]] : [label, ""];
}

function ForecastCard({ forecast }: { forecast: ForecastResponse }) {
  const { dark, colorBlind } = useDisplayPrefs();
  const danger = dangerStyle(forecast.overall_danger, colorBlind);
  const present = (Object.keys(DANGER) as Danger[]).filter((k) => forecast.rose.some((c) => c.danger === k));
  const hasPockets = forecast.rose.some((c) => c.pockets);
  const source = SOURCE[forecast.source];
  const sourceClass = { live: styles.sourceLive, replay: styles.sourceReplay, fixture: styles.sourceFixture }[source.tone];

  return (
    <section aria-label="UAC forecast" data-testid="uac-forecast" className={styles.forecast}>
      <span className={`${styles.sourceBadge} ${sourceClass}`}>{source.label}</span>
      <div className={styles.forecastHead}>
        <span className={styles.dangerBadge} style={{ background: danger.fill, color: danger.text }}>
          {danger.level ?? "–"}
        </span>
        <div>
          <p className={styles.forecastLabel}>UAC overall danger</p>
          <p className={styles.forecastDanger}>{danger.label}</p>
          <p className={styles.forecastDate}>Salt Lake · {formatDay(forecast.date, { weekday: true })}</p>
        </div>
      </div>

      {!forecast.ratings_issued && (
        <p className={`${styles.notice} ${styles.noRatings}`}>
          No danger ratings issued today. Steep terrain is shown as unrated.
        </p>
      )}

      <div className={styles.roseRow}>
        <DangerRose rose={forecast.rose} className={styles.rose} gap={dark ? "#1a2528" : "#f1f4f1"} colorBlind={colorBlind} />
        <div className={styles.roseKey}>
          <span>Aspect around the ring. Upper elevation in the center.</span>
          <ul>
            {present.map((k) => (
              <li key={k}><i className={styles.swatch} style={{ background: dangerStyle(k, colorBlind).fill }} />{DANGER[k].label}</li>
            ))}
            {hasPockets && <li><i className={`${styles.swatch} ${styles.swatchPockets}`} />Pockets of that level</li>}
          </ul>
          <span>Upper &gt; 9,500 ft · Lower &lt; 8,000 ft</span>
        </div>
      </div>
      {colorBlind && (
        <p className={styles.cbNote}>
          Color-blind palette on. UAC&apos;s forecast uses the standard green, yellow, orange, red and black scale.
        </p>
      )}

      <blockquote className={styles.quote}>{forecast.bottom_line}</blockquote>
      <div className={styles.attribution}>
        <span>Utah Avalanche Center, quoted verbatim</span>
        <a href={forecast.forecast_url} target="_blank" rel="noreferrer">Read the full forecast ↗</a>
      </div>

      {forecast.problems.map((problem, index) => (
        <details key={problem.name} className={styles.problem}>
          <summary>
            <span className={styles.problemNumber}>{index + 1}</span>
            {problem.name}
            <PreviewIcon name="chevron" size={15} />
          </summary>
          <p>{problem.description}</p>
        </details>
      ))}
    </section>
  );
}

function RerouteResult({ planner, result, override }: {
  planner: RoutePlanner;
  result: AlternativeResponse;
  override: AvoidSetting | null;
}) {
  const comparison = result.comparison;
  if (!comparison) {
    const wider = WIDER.find((width) => width > result.corridor_width_m);
    const fallbacks = result.fallbacks ?? [];
    return (
      <section data-testid="reroute-result" className={styles.card}>
        <p className={styles.cardTitle}>{result.message}</p>
        {fallbacks.length > 0 && <ul className={styles.fallbacks}>
          {wider && fallbacks.includes("widen_corridor") && (
            <li><button type="button" className={styles.secondary}
              onClick={() => void planner.runReroute(wider, override ?? planner.setting, override)}>
              Go further around ({wider.toLocaleString()} m)
            </button></li>
          )}
          {result.turnaround_point && <li>Stop short: the turnaround on the map is the highest point before the first flagged stretch.</li>}
          {fallbacks.includes("nearby_tours") && <li>Go somewhere else: try Mapped sections above for other routes.</li>}
        </ul>}
      </section>
    );
  }
  return (
    <section data-testid="reroute-result" className={`${styles.card} ${styles.cardHighlight}`}>
      <p className={styles.cardTitle}>{result.message}</p>
      <dl className={styles.compare}>
        <dt>Flagged before</dt><dd>{meters(comparison.original_flagged_m)}</dd>
        <dt>Flagged after</dt><dd className={styles.compareStrong}>{meters(comparison.alternative_flagged_m)}</dd>
        <dt>Distance change</dt><dd>{comparison.added_distance_m >= 0 ? "+" : "−"}{meters(Math.abs(comparison.added_distance_m))}</dd>
        <dt>Climb change</dt><dd>{feet(comparison.added_climb_ft)}</dd>
        <dt>Strays from your line</dt><dd>{meters(comparison.max_deviation_m)}</dd>
      </dl>
      {result.forced_by_warning && (
        <p className={`${styles.notice} ${styles.noticeRed}`}>UAC recommends avoiding all avalanche terrain today.</p>
      )}
      {planner.forecast?.comparison_advice && (
        <p className={`${styles.notice} ${styles.noticeAmber}`}>UAC: “{planner.forecast.comparison_advice}”</p>
      )}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.secondary} onClick={planner.acceptReroute}>Use this route</button>
        <button type="button" className={styles.secondary} onClick={planner.undoReroute}>Undo</button>
      </div>
      {override && !result.forced_by_warning && override !== planner.setting && (
        <button type="button" className={styles.link} onClick={() => planner.setSetting(override)}>Make this my default</button>
      )}
    </section>
  );
}

type Position = [number, number];

function ForecastSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy aria-label="Loading the UAC forecast">
      <div><i style={{ width: 46, height: 46, borderRadius: 12 }} /><span><i style={{ width: 90 }} /><i style={{ width: 140, height: 18 }} /></span></div>
      <i style={{ height: 140, borderRadius: 12 }} />
      <i style={{ height: 70 }} />
    </div>
  );
}

export function PlannerPanel({ planner, onFocus }: {
  planner: RoutePlanner;
  /** Frames these points on the map. */
  onFocus?: (points: Position[]) => void;
}) {
  const { plan, current, reroute, planning } = planner;
  const totals = current?.totals;
  const forced = plan?.forced_by_warning ?? false;
  const flagged = totals?.flagged_stretch_count ?? 0;
  const steep = totals?.steep_stretch_count ?? 0;
  const rerouted = reroute.status === "done";
  const busy = planning || reroute.status === "loading";
  const message = current && plan && current !== plan.analysis
    ? flagged > 0 ? `${flagged} ${flagged === 1 ? "stretch crosses" : "stretches cross"} flagged terrain (${meters(totals?.flagged_length_m ?? 0)}).` : "No flags found on this route today."
    : plan?.message;
  const { colorBlind } = useDisplayPrefs();
  const worst = totals?.max_flagged_danger ? dangerStyle(totals.max_flagged_danger, colorBlind) : null;

  return (
    <div className={styles.panel} aria-live="polite">
      <p className={styles.intro}>
        Click two points. See where the forecast flags the route, then reroute around those stretches.
      </p>

      <div className={styles.dayPicker} role="group" aria-label="Forecast day">
        {DEMO_DAYS.map((day) => {
          const [date, note] = splitDayLabel(day.label);
          return (
            <button key={day.date} type="button" className={styles.day} aria-pressed={planner.date === day.date}
              onClick={() => planner.setDate(day.date)}>
              <strong>{date}</strong><span>{note}</span>
            </button>
          );
        })}
      </div>

      <label className={styles.field}>Flag and avoid
        <select value={planner.setting} disabled={forced}
          onChange={(event) => planner.setSetting(event.target.value as AvoidSetting)}>
          <option value="considerable">Considerable and up</option>
          <option value="moderate">Also avoid Moderate</option>
          <option value="low">Beginner mode: stay off and out from under slopes 30° and steeper</option>
        </select>
      </label>
      {planner.setting === "low" && <p className={styles.hint}>Checks slopes on your route and within 300 m uphill.</p>}
      {forced && <p className={`${styles.notice} ${styles.noticeRed}`}>
        <PreviewIcon name="info" size={15} />
        Avalanche Warning in effect. All slopes 30° and steeper are flagged for this forecast day, whatever your setting.
      </p>}

      {planner.points.length < 2 && (
        <div className={styles.empty}>
          <div className={styles.emptySteps} aria-hidden>
            <span data-done={planner.points.length > 0}>A</span><i /><span>B</span>
          </div>
          {planner.points.length === 0 ? "Click the map to place your start." : "Click the map to place your destination."}
        </div>
      )}
      {planning && <p className={styles.planning}><span className={styles.spinner} aria-hidden />Planning a route…</p>}
      {planner.planError && (
        <p role="alert" className={`${styles.notice} ${styles.noticeRed}`}>Couldn&apos;t plan this route: {planner.planError}</p>
      )}

      {plan && (
        <section data-testid="plan-result" className={styles.result}>
          <h2 className={styles.resultTitle}>Your line</h2>
          <p data-testid="plan-status" className={styles.status}>
            <span className={styles.statusDot} style={{ background: flagged > 0 && worst ? worst.fill : "#9aa79b" }} aria-hidden />
            <span style={{ fontWeight: flagged > 0 ? 600 : 400 }}>{message}</span>
          </p>
          {totals && (
            <dl className={styles.stats}>
              <div><dt>Distance</dt><dd>{km(totals.length_m)}</dd></div>
              <div><dt>Climb</dt><dd>{Math.round(totals.climb_ft).toLocaleString()} ft</dd></div>
              <div><dt>Flagged</dt><dd className={flagged > 0 ? styles.statFlagged : undefined}>{meters(totals.flagged_length_m)}</dd></div>
            </dl>
          )}
          {planner.activeAnalysis && <RouteProfile analysis={planner.activeAnalysis} onFocus={onFocus} />}
          {current && current.flagged_stretches.length > 0 && !rerouted && (
            <ol className={styles.stretches}>
              {current.flagged_stretches.map((stretch) => {
                const d = dangerStyle(stretch.max_danger, colorBlind);
                const unrated = stretch.max_danger === "no_rating";
                const focus = () => onFocus?.(current.segments.features
                  .filter((f) => stretch.segment_ids.includes(f.properties.id))
                  .flatMap((f) => f.geometry.coordinates as Position[]));
                return (
                  <li key={stretch.id}>
                    <button type="button" className={styles.stretchButton} onClick={focus}
                      aria-label={`Show flagged stretch ${stretch.id} on the map`}>
                    <span className={styles.stretchPin}
                      style={{ background: unrated ? "#e11d9b" : d.fill, color: unrated ? "#fff" : d.text }}>
                      {unrated ? "?" : stretch.id}
                    </span>
                    {meters(stretch.flagged_length_m)} flagged
                    <span className={styles.stretchRating}>{unrated ? "Unrated" : `Rated ${d.label}`}</span>
                    <PreviewIcon name="focus" size={14} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {flagged > 0 && !rerouted && (
            <>
              <button type="button" disabled={busy} className={styles.primary} onClick={() => void planner.runReroute(planner.corridor)}>
                {reroute.status === "loading" ? "Finding a way around…" : `Reroute around ${flagged} flagged ${flagged === 1 ? "stretch" : "stretches"}`}
                <PreviewIcon name="arrow" size={18} />
              </button>
              <label className={styles.slider}>
                <span>Stay within <strong>{planner.corridor} m</strong> of this line</span>
                <input type="range" min={200} max={800} step={100} value={planner.corridor}
                  onChange={(event) => planner.setCorridor(Number(event.target.value))} />
              </label>
            </>
          )}
          {flagged === 0 && steep > 0 && !rerouted && (
            <button type="button" disabled={busy} className={styles.secondary} onClick={() => {
              const lowest = totals?.steep_ratings[0] as AvoidSetting | undefined;
              if (lowest) void planner.runReroute(planner.corridor, lowest, lowest);
            }}>{reroute.status === "loading" ? "Finding a way around…" : "Avoid these too"}</button>
          )}
          {reroute.status === "error" && (
            <p role="alert" className={`${styles.notice} ${styles.noticeRed}`}>Couldn&apos;t reroute: {reroute.message}</p>
          )}
          {reroute.status === "done" && (
            <RerouteResult planner={planner} result={reroute.result} override={reroute.override} />
          )}
          <ul className={styles.meta}>
            <li>{SOURCE_LABEL[plan.source]}, {formatDay(plan.date)}.</li>
            {plan.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            <li>Trails and ski areas: {plan.attribution}</li>
          </ul>
        </section>
      )}

      {planner.forecast ? <ForecastCard key={planner.forecast.date} forecast={planner.forecast} /> : <ForecastSkeleton />}
    </div>
  );
}
