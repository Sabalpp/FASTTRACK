"use client";

import { useId } from "react";
import {
  ARRIVAL_WINDOW_TIME_ZONE,
  STANDARD_ARRIVAL_WINDOW_MINUTES,
  formatArrivalWindowDuration,
  formatArrivalWindowRange,
  formatArrivalWindowTimeZone,
  resolveArrivalWindow,
  type ArrivalWindowDraft
} from "@/lib/arrival-window";
import styles from "./ArrivalWindowField.module.css";

export function ArrivalWindowField({
  value,
  onChange,
  editable = true,
  required = false,
  hideLegend = false,
  minDate,
  timeZone = ARRIVAL_WINDOW_TIME_ZONE
}: {
  value: ArrivalWindowDraft;
  onChange?: (value: ArrivalWindowDraft) => void;
  editable?: boolean;
  required?: boolean;
  hideLegend?: boolean;
  minDate?: string;
  timeZone?: string;
}) {
  const id = useId();
  const dateId = `${id}-date`;
  const timeId = `${id}-time`;
  const summaryId = `${id}-summary`;
  const errorId = `${id}-error`;
  const resolution = resolveArrivalWindow(value, timeZone);
  const describedBy = resolution.status === "invalid" ? `${summaryId} ${errorId}` : summaryId;
  const customDuration = value.durationMinutes !== STANDARD_ARRIVAL_WINDOW_MINUTES;

  function update(patch: Partial<ArrivalWindowDraft>) {
    onChange?.({ ...value, ...patch });
  }

  return (
    <fieldset className={styles.fieldset} data-time-zone={timeZone} data-compact={hideLegend || undefined}>
      <legend className={`${styles.legend} ${hideLegend ? styles.legendHidden : ""}`}>Arrival window</legend>
      {editable ? (
        <div className={styles.controls}>
          <label className={styles.field} htmlFor={dateId}>
            <span>Date</span>
            <input
              id={dateId}
              type="date"
              required={required}
              min={minDate}
              value={value.localDate}
              aria-describedby={describedBy}
              aria-invalid={resolution.status === "invalid" || undefined}
              onChange={(event) => update({ localDate: event.target.value })}
            />
          </label>
          <label className={styles.field} htmlFor={timeId}>
            <span>Starts at</span>
            <input
              id={timeId}
              type="time"
              required={required}
              step={15 * 60}
              value={value.localStartTime}
              aria-describedby={describedBy}
              aria-invalid={resolution.status === "invalid" || undefined}
              onChange={(event) => update({ localStartTime: event.target.value })}
            />
          </label>
        </div>
      ) : null}

      <div id={summaryId} className={styles.summary} aria-live="polite" aria-atomic="true">
        <span className={styles.summaryLabel}>Customer arrival window</span>
        {resolution.status === "valid" ? (
          <>
            <strong>{formatArrivalWindowRange(resolution.startAt, resolution.endAt, timeZone)}</strong>
            <small>{formatArrivalWindowTimeZone(resolution.startAt, timeZone)} · {formatArrivalWindowDuration(resolution.durationMinutes)}</small>
          </>
        ) : (
          <span className={styles.emptySummary}>Choose a date and start time. The end is calculated automatically.</span>
        )}
      </div>

      {resolution.status === "invalid" ? <p id={errorId} className={styles.error} role="alert">{resolution.error}</p> : null}

      {editable && customDuration ? (
        <div className={styles.existingWindowNote}>
          <span>This job has an existing window length of {formatArrivalWindowDuration(value.durationMinutes)}.</span>
          <button type="button" onClick={() => update({ durationMinutes: STANDARD_ARRIVAL_WINDOW_MINUTES })}>
            Use standard 3 hours
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
