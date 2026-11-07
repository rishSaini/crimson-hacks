"use client";

import { useState } from "react";
import type { ForecastResponse } from "@/lib/api";
import { ALERT_TITLE, formatDateTime } from "@/lib/danger";
import { PreviewIcon } from "@/components/PreviewIcon";
import styles from "./Planner.module.css";

/**
 * Full-width UAC alert under the top bar. Every field is UAC's text, shown whole when
 * expanded. Special bulletins have no "What to do", so that label only shows when UAC wrote one.
 */
export function AlertStrip({ alert, forecastUrl }: { alert: ForecastResponse["alert"]; forecastUrl: string }) {
  const [open, setOpen] = useState(false);
  if (alert.level === "none") return null;

  const tone = { warning: styles.alertWarning, special_bulletin: styles.alertBulletin, watch: styles.alertWatch }[alert.level];
  const details = [
    { label: "Where", text: alert.where },
    { label: "Impacts", text: alert.impacts },
    { label: "What to do", text: alert.what_to_do },
  ].filter((d): d is { label: string; text: string } => Boolean(d.text));

  return (
    <section role="alert" aria-label={ALERT_TITLE[alert.level]} className={`${styles.alert} ${tone}`}>
      <div className={styles.alertBar}>
        <span className={styles.alertLevel}>{ALERT_TITLE[alert.level]}</span>
        {(alert.valid_from || alert.valid_to) && (
          <span className={styles.alertTimes}>
            {alert.valid_from && <>From {formatDateTime(alert.valid_from)}</>}
            {alert.valid_from && alert.valid_to && " · "}
            {alert.valid_to && <>until {formatDateTime(alert.valid_to)}</>}
          </span>
        )}
        <span className={styles.alertActions}>
          <a href={forecastUrl} target="_blank" rel="noreferrer">Utah Avalanche Center ↗</a>
          <button type="button" className={styles.alertToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide alert" : "Read alert"}<PreviewIcon name="chevron" size={13} />
          </button>
        </span>
      </div>
      {open && (
        <div className={styles.alertBody}>
          {alert.what && <p>{alert.what}</p>}
          {details.length > 0 && (
            <dl>
              {details.map((d) => <div key={d.label}><dt>{d.label}</dt><dd>{d.text}</dd></div>)}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
