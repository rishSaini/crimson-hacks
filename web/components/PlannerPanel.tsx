"use client";

import type { AlternativeResponse, ForecastResponse, PlanResponse } from "@/lib/api";
import { DANGER, SOURCE, dangerStyle, formatDay, routeMessage, stretchKind, type Danger } from "@/lib/danger";
import type { AnalyzeResponse } from "@/lib/api";
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

function RerouteResult({ planner, result, override, locked }: {
  planner: RoutePlanner;
  result: AlternativeResponse;
  override: AvoidSetting | null;
  locked: boolean;
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
            <li><button type="button" className={styles.secondary} disabled={locked}
              onClick={() => void planner.runReroute(wider, override ?? planner.effectiveSetting, override)}>
              Go further around ({wider.toLocaleString()} m)
            </button></li>
          )}
          {result.turnaround_point && <li>Stop short: the turnaround on the map is the highest point before the first flagged stretch.</li>}
          {fallbacks.includes("nearby_tours") && <li>Go somewhere else: try Mapped sections above for other routes.</li>}
        </ul>}
        <button type="button" className={styles.link} disabled={locked} onClick={planner.undoReroute}>Dismiss</button>
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
        <button type="button" className={styles.secondary} disabled={locked} onClick={planner.acceptReroute}>Use this route</button>
        <button type="button" className={styles.secondary} disabled={locked} onClick={planner.undoReroute}>Undo</button>
      </div>
      {override && !result.forced_by_warning && override !== planner.setting && (
        <button type="button" className={styles.link} disabled={locked} onClick={() => planner.makeDefault(override)}>Make this my default</button>
      )}
    </section>
  );
}

type Position = [number, number];

/** "34 to 38", or just "34" when both ends round the same. */
function range(min: number, max: number) {
  const [lo, hi] = [Math.round(min), Math.round(max)];
  return lo === hi ? lo.toLocaleString() : `${lo.toLocaleString()} to ${hi.toLocaleString()}`;
}

/** Every 30°+ segment with its rating, Low and Moderate included, in the panel's own words. */
function SteepSegments({ analysis, colorBlind, onFocus }: {
  analysis: AnalyzeResponse;
  colorBlind: boolean;
  onFocus?: (points: Position[]) => void;
}) {
  const steep = analysis.segments.features
    .filter((f) => f.properties.color !== "gray")
    .sort((a, b) => a.properties.id - b.properties.id);
  if (steep.length === 0) return null;
  return (
    <details className={styles.problem}>
      <summary>
        <span className={styles.problemNumber}>{steep.length}</span>
        Steep segments (30° and up)
        <PreviewIcon name="chevron" size={15} />
      </summary>
      <ol className={styles.segmentList}>
        {steep.map((f) => {
          const p = f.properties;
          const d = dangerStyle(p.danger, colorBlind);
          const unrated = p.color === "unrated";
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onFocus?.(f.geometry.coordinates as Position[])}>
                <i className={styles.swatch} style={{ background: unrated ? "#e11d9b" : d.fill }} />
                <span>
                  Segment {p.id}: {meters(p.length_m)} on {range(p.slope_min_deg, p.slope_max_deg)} degree{" "}
                  {p.aspects.join("/")} slopes, {range(p.elevation_min_ft, p.elevation_max_ft)} ft.{" "}
                  {unrated ? "No rating issued for this aspect and elevation." : `Rated ${DANGER[p.danger].label} today.`}
                  {p.flagged ? " Flagged." : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ForecastSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy aria-label="Loading the UAC forecast">
      <div><i style={{ width: 46, height: 46, borderRadius: 12 }} /><span><i style={{ width: 90 }} /><i style={{ width: 140, height: 18 }} /></span></div>
      <i style={{ height: 140, borderRadius: 12 }} />
      <i style={{ height: 70 }} />
    </div>
  );
}

export function PlannerPanel({ planner, onFocus, locked = false }: {
  planner: RoutePlanner;
  /** True during terrain playback: changing the route mid-ride would strand the camera. */
  locked?: boolean;
  /** Frames these points on the map. */
  onFocus?: (points: Position[]) => void;
}) {
  const { plan, current, reroute, planning } = planner;
  // Before a route exists, the forecast's Warning is what will force Low; after, the server says.
  const forced = plan?.forced_by_warning ?? planner.forecast?.alert.level === "warning";
  // A found reroute is previewed on the map, so the panel describes that line.
  const rerouted = planner.alternative !== null;
  const shown = planner.activeAnalysis;
  const totals = shown?.totals;
  const flagged = current?.totals.flagged_stretch_count ?? 0;
  const steep = current?.totals.steep_stretch_count ?? 0;
  const busy = planning || reroute.status === "loading" || locked;
  // A client-side line (accepted or previewed reroute) is worded exactly as the API would.
  const message = shown && plan && shown !== plan.analysis ? routeMessage(shown.totals) : plan?.message;
  const shownFlagged = totals?.flagged_stretch_count ?? 0;
  const { colorBlind } = useDisplayPrefs();
  const worst = totals?.max_flagged_danger ? dangerStyle(totals.max_flagged_danger, colorBlind) : null;

  return (
    <div className={styles.panel}>
      <p className={styles.intro}>
        Click two points. See where the forecast flags the route, then reroute around those stretches.
      </p>

      <div className={styles.dayPicker} role="group" aria-label="Forecast day">
        {DEMO_DAYS.map((day) => {
          const [date, note] = splitDayLabel(day.label);
          return (
            <button key={day.date} type="button" className={styles.day} aria-pressed={planner.date === day.date} disabled={locked}
              onClick={() => planner.setDate(day.date)}>
              <strong>{date}</strong><span>{note}</span>
            </button>
          );
        })}
      </div>

      <label className={styles.field}>Flag and avoid
        {/* On a Warning day the server forces Low for this day only; show that, never save it. */}
        <select value={forced ? "low" : planner.effectiveSetting} disabled={forced || locked}
          onChange={(event) => planner.setSetting(event.target.value as AvoidSetting)}>
          <option value="considerable">Considerable and up</option>
          <option value="moderate">Also avoid Moderate</option>
          <option value="low">Beginner mode: stay off and out from under slopes 30° and steeper</option>
        </select>
      </label>
      {forced && <p className={styles.hint}>Overridden by today&apos;s Avalanche Warning. Your saved setting is unchanged.</p>}
      {!forced && planner.effectiveSetting !== planner.setting && (
        <p className={styles.hint}>Applied to this route only. Your saved setting is unchanged.</p>
      )}
      {(forced || planner.effectiveSetting === "low") && <p className={styles.hint}>Checks slopes on your route and within 300 m uphill.</p>}
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
      {locked && <p className={styles.hint}>Route controls are paused during playback.</p>}
      {planning && <p className={styles.planning} role="status"><span className={styles.spinner} aria-hidden />Planning a route…</p>}
      {planner.planError && (
        <p role="alert" className={`${styles.notice} ${styles.noticeRed}`}>Couldn&apos;t plan this route: {planner.planError}</p>
      )}

      {plan && (
        <section data-testid="plan-result" className={styles.result}>
          <h2 className={styles.resultTitle}>Your line</h2>
          {rerouted && <p className={styles.hint}>Showing the reroute preview. Undo below to go back to your line.</p>}
          <p data-testid="plan-status" className={styles.status} aria-live="polite">
            <span className={styles.statusDot} style={{ background: shownFlagged > 0 && worst ? worst.fill : "#9aa79b" }} aria-hidden />
            <span style={{ fontWeight: shownFlagged > 0 ? 600 : 400 }}>{message}</span>
          </p>
          {totals && (
            <dl className={styles.stats}>
              <div><dt>Distance</dt><dd>{km(totals.length_m)}</dd></div>
              <div><dt>Climb</dt><dd>{Math.round(totals.climb_ft).toLocaleString()} ft</dd></div>
              <div><dt>Flagged</dt><dd className={shownFlagged > 0 ? styles.statFlagged : undefined}>{meters(totals.flagged_length_m)}</dd></div>
            </dl>
          )}
          {planner.activeAnalysis && <RouteProfile analysis={planner.activeAnalysis} onFocus={onFocus} />}
          {current && current.flagged_stretches.length > 0 && !rerouted && (
            <ol className={styles.stretches}>
              {current.flagged_stretches.map((stretch) => {
                const d = dangerStyle(stretch.max_danger, colorBlind);
                const runs = current.segments.features.filter((f) => stretch.segment_ids.includes(f.properties.id));
                const kind = stretchKind(runs.map((f) => f.properties.flag_reason));
                const unrated = kind === "unrated" || stretch.max_danger === "no_rating";
                const focus = () => onFocus?.(runs.flatMap((f) => f.geometry.coordinates as Position[]));
                const label = kind === "overhead"
                  ? stretch.max_danger === "no_rating" ? "Below unrated steep slopes" : `Below ${d.label} slopes`
                  : kind === "mixed" ? `Rated ${d.label}, part unrated`
                    : unrated ? "Unrated" : `Rated ${d.label}`;
                return (
                  <li key={stretch.id}>
                    <button type="button" className={styles.stretchButton} onClick={focus}
                      aria-label={`Show flagged stretch ${stretch.id} on the map`}>
                    <span className={`${styles.stretchPin} ${kind === "overhead" ? styles.stretchPinOverhead : ""}`}
                      style={kind === "overhead"
                        ? { borderColor: unrated ? "#e11d9b" : d.fill }
                        : { background: unrated ? "#e11d9b" : d.fill, color: unrated ? "#fff" : d.text }}>
                      {unrated && kind === "unrated" ? "?" : stretch.id}
                    </span>
                    {meters(stretch.flagged_length_m)} flagged
                    <span className={styles.stretchRating}>{label}</span>
                    <PreviewIcon name="focus" size={14} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {shown && <SteepSegments analysis={shown} colorBlind={colorBlind} onFocus={onFocus} />}
          {flagged > 0 && !rerouted && (
            <>
              <button type="button" disabled={busy} className={styles.primary} onClick={() => void planner.runReroute(planner.corridor)}>
                {reroute.status === "loading" ? "Finding a way around…" : `Reroute around ${flagged} flagged ${flagged === 1 ? "stretch" : "stretches"}`}
                <PreviewIcon name="arrow" size={18} />
              </button>
              <label className={styles.slider}>
                <span>Stay within <strong>{planner.corridor} m</strong> of this line</span>
                <input type="range" min={200} max={800} step={100} value={planner.corridor} disabled={locked}
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
            <RerouteResult planner={planner} result={reroute.result} override={reroute.override} locked={locked} />
          )}
          <ul className={styles.meta}>
            <li>{SOURCE_LABEL[plan.source]}, {formatDay(plan.date)}.</li>
            {plan.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            <li>Trails and ski areas: {plan.attribution}</li>
          </ul>
        </section>
      )}

      {planner.forecast ? <ForecastCard key={planner.forecast.date} forecast={planner.forecast} />
        : planner.forecastFailed ? (
          <p role="alert" className={`${styles.notice} ${styles.noticeRed}`}>
            Couldn&apos;t load the UAC forecast for this day. Check the API connection and try again.
          </p>
        ) : <ForecastSkeleton />}

      <a className={styles.courses} href="https://utahavalanchecenter.org/" target="_blank" rel="noreferrer">
        <PreviewIcon name="info" size={16} />
        <span><strong>New to avalanche terrain?</strong> Find an avalanche course and the daily forecast at the Utah Avalanche Center ↗</span>
      </a>
    </div>
  );
}
