"use client";

import { useEffect, useMemo, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_SCHEDULING_SETTINGS,
  SCHEDULING_INCREMENT_OPTIONS,
  validateSchedulingSettings,
  type SchedulingSettings
} from "@/lib/scheduling-settings";
import {
  loadSchedulingSettings,
  updateSchedulingSettings
} from "@/lib/scheduling-settings-client";
import {
  buildSequentialArrivalWindows,
  formatClockLabel
} from "@/lib/scheduling-preview";
import { formatArrivalWindowDuration } from "@/lib/arrival-window";
import styles from "./scheduling-settings.module.css";

type SchedulingForm = {
  defaultArrivalWindowMinutes: string;
  businessDayStartTime: string;
  businessDayEndTime: string;
  schedulingIncrementMinutes: string;
};

export default function SchedulingSettingsPage() {
  return (
    <RoleGate allowed={["owner"]}>
      <SchedulingSettingsForm />
    </RoleGate>
  );
}

function SchedulingSettingsForm() {
  const { currentUser } = useAuth();
  const [savedSettings, setSavedSettings] = useState<SchedulingSettings>({ ...DEFAULT_SCHEDULING_SETTINGS });
  const [form, setForm] = useState<SchedulingForm>(() => formFromSettings(DEFAULT_SCHEDULING_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);

    void loadSchedulingSettings()
      .then((settings) => {
        if (!active) return;
        setSavedSettings(settings);
        setForm(formFromSettings(settings));
      })
      .catch((loadError) => {
        if (!active) return;
        setError(errorMessage(loadError, "Scheduling settings could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const validation = useMemo(() => {
    try {
      return {
        settings: validateSchedulingSettings({
          timeZone: savedSettings.timeZone,
          defaultArrivalWindowMinutes: Number(form.defaultArrivalWindowMinutes),
          businessDayStartTime: form.businessDayStartTime,
          businessDayEndTime: form.businessDayEndTime,
          schedulingIncrementMinutes: Number(form.schedulingIncrementMinutes),
          updatedAt: savedSettings.updatedAt
        })
      };
    } catch (validationError) {
      return { error: errorMessage(validationError, "Review the scheduling settings.") };
    }
  }, [form, savedSettings.timeZone, savedSettings.updatedAt]);

  const previewWindows = validation.settings ? buildSequentialArrivalWindows(validation.settings) : [];
  const dirty = !formsEqual(form, formFromSettings(savedSettings));
  const timeStepSeconds = Math.max(1, Number(form.schedulingIncrementMinutes) || 15) * 60;

  function update<K extends keyof SchedulingForm>(key: K, value: SchedulingForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSavedMessage(undefined);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.settings || saving) return;
    setSaving(true);
    setError(undefined);
    setSavedMessage(undefined);
    try {
      const settings = await updateSchedulingSettings({
        defaultArrivalWindowMinutes: validation.settings.defaultArrivalWindowMinutes,
        businessDayStartTime: validation.settings.businessDayStartTime,
        businessDayEndTime: validation.settings.businessDayEndTime,
        schedulingIncrementMinutes: validation.settings.schedulingIncrementMinutes
      }, currentUser.role);
      setSavedSettings(settings);
      setForm(formFromSettings(settings));
      setSavedMessage("Scheduling defaults saved. New jobs will use them automatically.");
    } catch (saveError) {
      setError(errorMessage(saveError, "Scheduling settings could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`page-shell ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Owner settings</p>
          <h1>Scheduling</h1>
          <p>Set the working day and the arrival-window defaults used when your team schedules a new job.</p>
        </div>
        <div className={styles.timeZone}>
          <span>Business timezone</span>
          <strong>{savedSettings.timeZone}</strong>
        </div>
      </header>

      {error ? (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          {loading ? null : <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Try again</button>}
        </div>
      ) : null}

      <form className={styles.settingsGrid} onSubmit={save}>
        <section className={styles.panel} aria-labelledby="defaults-heading" aria-busy={loading || undefined}>
          <div className={styles.panelHeading}>
            <div>
              <p>Job defaults</p>
              <h2 id="defaults-heading">Customer arrival windows</h2>
            </div>
            {loading ? <span className={styles.loadingLabel}>Loading…</span> : null}
          </div>

          <label className={styles.control}>
            <span>Default arrival-window length</span>
            <span className={styles.inputWithSuffix}>
              <input
                type="number"
                inputMode="numeric"
                required
                min={15}
                max={720}
                step={Number(form.schedulingIncrementMinutes) || 15}
                value={form.defaultArrivalWindowMinutes}
                disabled={loading || saving}
                onChange={(event) => update("defaultArrivalWindowMinutes", event.target.value)}
              />
              <small>minutes</small>
            </span>
            <small>Shown as the editable end time on each new job.</small>
          </label>

          <div className={styles.dayFields}>
            <label className={styles.control}>
              <span>Business day starts</span>
              <input
                type="time"
                required
                step={timeStepSeconds}
                value={form.businessDayStartTime}
                disabled={loading || saving}
                onChange={(event) => update("businessDayStartTime", event.target.value)}
              />
            </label>
            <label className={styles.control}>
              <span>Business day ends</span>
              <input
                type="time"
                required
                step={timeStepSeconds}
                value={form.businessDayEndTime}
                disabled={loading || saving}
                onChange={(event) => update("businessDayEndTime", event.target.value)}
              />
            </label>
          </div>

          <label className={styles.control}>
            <span>Time-picker increment</span>
            <select
              value={form.schedulingIncrementMinutes}
              disabled={loading || saving}
              onChange={(event) => update("schedulingIncrementMinutes", event.target.value)}
            >
              {SCHEDULING_INCREMENT_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} minutes</option>
              ))}
            </select>
            <small>Controls the steps available in the native start and end time pickers.</small>
          </label>

          {validation.error && !loading ? <p className={styles.validationError} role="alert">{validation.error}</p> : null}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.resetButton}
              disabled={!dirty || loading || saving}
              onClick={() => {
                setForm(formFromSettings(savedSettings));
                setError(undefined);
                setSavedMessage(undefined);
              }}
            >
              Discard changes
            </button>
            <Button type="submit" disabled={!dirty || loading || saving || Boolean(validation.error)}>
              {saving ? "Saving…" : "Save scheduling defaults"}
            </Button>
          </div>
          <p className={styles.saveStatus} aria-live="polite">{savedMessage ?? ""}</p>
        </section>

        <aside className={styles.previewPanel} aria-labelledby="preview-heading">
          <div className={styles.panelHeading}>
            <div>
              <p>Day preview</p>
              <h2 id="preview-heading">Sequential windows</h2>
            </div>
            <span className={styles.windowCount}>{previewWindows.length}</span>
          </div>

          {validation.settings ? (
            <>
              <p className={styles.previewSummary}>
                {previewWindows.length === 1 ? "1 complete window" : `${previewWindows.length} complete windows`} at {formatArrivalWindowDuration(validation.settings.defaultArrivalWindowMinutes)} each.
              </p>
              {previewWindows.length > 0 ? (
                <ol className={styles.windowList}>
                  {previewWindows.map((window, index) => (
                    <li key={`${window.startTime}-${window.endTime}`}>
                      <span>{index + 1}</span>
                      <strong>{formatClockLabel(window.startTime)}–{formatClockLabel(window.endTime)}</strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.emptyPreview}>The default window does not fit inside this business day.</p>
              )}
              <p className={styles.previewNote}>This preview does not change existing jobs or represent service duration.</p>
            </>
          ) : (
            <p className={styles.emptyPreview}>Fix the highlighted settings to preview the day.</p>
          )}
        </aside>
      </form>
    </main>
  );
}

function formFromSettings(settings: SchedulingSettings): SchedulingForm {
  return {
    defaultArrivalWindowMinutes: String(settings.defaultArrivalWindowMinutes),
    businessDayStartTime: settings.businessDayStartTime,
    businessDayEndTime: settings.businessDayEndTime,
    schedulingIncrementMinutes: String(settings.schedulingIncrementMinutes)
  };
}

function formsEqual(left: SchedulingForm, right: SchedulingForm) {
  return left.defaultArrivalWindowMinutes === right.defaultArrivalWindowMinutes
    && left.businessDayStartTime === right.businessDayStartTime
    && left.businessDayEndTime === right.businessDayEndTime
    && left.schedulingIncrementMinutes === right.schedulingIncrementMinutes;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
