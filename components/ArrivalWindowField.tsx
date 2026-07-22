"use client";

import { useId } from "react";
import {
  ARRIVAL_WINDOW_TIME_ZONE,
  STANDARD_ARRIVAL_WINDOW_MINUTES,
  arrivalWindowDurationFromTimes,
  arrivalWindowEndTime,
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
  timeZone = ARRIVAL_WINDOW_TIME_ZONE,
  defaultDurationMinutes = STANDARD_ARRIVAL_WINDOW_MINUTES,
  schedulingIncrementMinutes = 15
}: {
  value: ArrivalWindowDraft;
  onChange?: (value: ArrivalWindowDraft) => void;
  editable?: boolean;
  required?: boolean;
  hideLegend?: boolean;
  minDate?: string;
  timeZone?: string;
  defaultDurationMinutes?: number;
  schedulingIncrementMinutes?: number;
}) {
  const id = useId();
  const dateId = `${id}-date`;
  const startTimeId = `${id}-start-time`;
  const endTimeId = `${id}-end-time`;
  const summaryId = `${id}-summary`;
  const errorId = `${id}-error`;
  const resolution = resolveArrivalWindow(value, timeZone);
  const describedBy = resolution.status === "invalid" ? `${summaryId} ${errorId}` : summaryId;
  const effectiveDefaultDuration = Number.isInteger(defaultDurationMinutes) && defaultDurationMinutes > 0
    ? defaultDurationMinutes
    : STANDARD_ARRIVAL_WINDOW_MINUTES;
  const effectiveIncrement = Number.isInteger(schedulingIncrementMinutes) && schedulingIncrementMinutes > 0
    ? schedulingIncrementMinutes
    : 15;
  const endTime = arrivalWindowEndTime(value);
  const customDuration = value.durationMinutes !== effectiveDefaultDuration;

  function update(patch: Partial<ArrivalWindowDraft>) {
    onChange?.({ ...value, ...patch });
  }

  function updateStartTime(localStartTime: string) {
    if (!localStartTime || !value.localStartTime || !endTime) {
      update({ localStartTime });
      return;
    }

    update({
      localStartTime,
      durationMinutes: arrivalWindowDurationFromTimes(localStartTime, endTime) ?? value.durationMinutes
    });
  }

  function updateEndTime(localEndTime: string) {
    update({
      durationMinutes: localEndTime
        ? arrivalWindowDurationFromTimes(value.localStartTime, localEndTime) ?? 0
        : 0
    });
  }

  return (
    <fieldset className={styles.fieldset} data-time-zone={timeZone} data-compact={hideLegend || undefined}>
      <legend className={`${styles.legend} ${hideLegend ? styles.legendHidden : ""}`}>Arrival window</legend>
      {editable ? (
        <div className={styles.controls}>
          <label className={`${styles.field} ${styles.dateField}`} htmlFor={dateId}>
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
          <label className={styles.field} htmlFor={startTimeId}>
            <span>Starts at</span>
            <input
              id={startTimeId}
              type="time"
              required={required}
              step={effectiveIncrement * 60}
              value={value.localStartTime}
              aria-describedby={describedBy}
              aria-invalid={resolution.status === "invalid" || undefined}
              onChange={(event) => updateStartTime(event.target.value)}
            />
          </label>
          <label className={styles.field} htmlFor={endTimeId}>
            <span>Ends at</span>
            <input
              id={endTimeId}
              type="time"
              required={required}
              step={effectiveIncrement * 60}
              value={endTime}
              disabled={!value.localStartTime}
              aria-describedby={describedBy}
              aria-invalid={resolution.status === "invalid" || undefined}
              onChange={(event) => updateEndTime(event.target.value)}
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
          <span className={styles.emptySummary}>Choose a date and start time, then adjust the end if needed.</span>
        )}
      </div>

      {resolution.status === "invalid" ? <p id={errorId} className={styles.error} role="alert">{resolution.error}</p> : null}

      {editable && customDuration ? (
        <div className={styles.existingWindowNote}>
          <span>This window is {formatArrivalWindowDuration(value.durationMinutes)}.</span>
          <button type="button" onClick={() => update({ durationMinutes: effectiveDefaultDuration })}>
            Use default {formatArrivalWindowDuration(effectiveDefaultDuration)}
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
