"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ArrivalWindowField } from "@/components/ArrivalWindowField";
import { CustomerPicker } from "@/components/CustomerPicker";
import { RoleGate } from "@/components/RoleGate";
import { Button, Field } from "@/components/ui";
import { emptyArrivalWindowDraft, resolveArrivalWindow } from "@/lib/arrival-window";
import { dispatchJobConfirmations } from "@/lib/appointment-confirmations-client";
import { DEFAULT_SCHEDULING_SETTINGS } from "@/lib/scheduling-settings";
import { loadSchedulingSettings } from "@/lib/scheduling-settings-client";
import {
  findTechnicianWindowConflicts
} from "@/lib/service-window";
import type { Customer } from "@/lib/types";
import styles from "./new-job.module.css";

export default function NewJobPage() {
  return (
    <RoleGate allowed={["owner", "call_center"]}>
      <Suspense fallback={<main className="page-shell"><p>Loading scheduler...</p></main>}>
        <NewJobClient />
      </Suspense>
    </RoleGate>
  );
}

function NewJobClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { currentUser } = useAuth();
  const data = useAppData();
  const preselectedCustomer = data.customers.find((customer) => customer.id === params.get("customerId"));
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>(preselectedCustomer);
  const techs = useMemo(() => data.allowedUsers.filter((user) => user.role === "tech" && user.active), [data.allowedUsers]);
  const [form, setForm] = useState({
    assignedTechId: "",
    serviceAddress: preselectedCustomer ? `${preselectedCustomer.addressLine1}${preselectedCustomer.addressLine2 ? ` ${preselectedCustomer.addressLine2}` : ""}, ${preselectedCustomer.city}, ${preselectedCustomer.state} ${preselectedCustomer.zip}` : "",
    description: ""
  });
  const [arrivalWindow, setArrivalWindow] = useState(emptyArrivalWindowDraft);
  const arrivalWindowTouched = useRef(false);
  const [schedulingSettings, setSchedulingSettings] = useState({ ...DEFAULT_SCHEDULING_SETTINGS });
  const [settingsLoadError, setSettingsLoadError] = useState<string>();
  const [settingsRequestVersion, setSettingsRequestVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [scheduleWithoutConfirmation, setScheduleWithoutConfirmation] = useState(false);

  useEffect(() => {
    let active = true;
    setSettingsLoadError(undefined);
    void loadSchedulingSettings()
      .then((settings) => {
        if (!active) return;
        setSchedulingSettings(settings);
        if (!arrivalWindowTouched.current) {
          setArrivalWindow((current) => ({
            ...current,
            durationMinutes: settings.defaultArrivalWindowMinutes
          }));
        }
      })
      .catch((error) => {
        if (!active) return;
        setSettingsLoadError(error instanceof Error ? error.message : "Scheduling defaults could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [settingsRequestVersion]);

  const arrivalWindowResolution = resolveArrivalWindow(arrivalWindow, schedulingSettings.timeZone);
  const scheduledAtIso = arrivalWindowResolution.status === "valid" ? arrivalWindowResolution.startAt : undefined;
  const arrivalWindowEndAtIso = arrivalWindowResolution.status === "valid" ? arrivalWindowResolution.endAt : undefined;
  const validWindow = arrivalWindowResolution.status === "valid";
  const confirmationChannels = selectedCustomer ? [
    selectedCustomer.emailNotificationsEnabled && selectedCustomer.email ? `Email to ${selectedCustomer.email}` : undefined,
    selectedCustomer.smsConsentStatus === "opted_in" && selectedCustomer.phoneDigits.length === 10 ? `Text to ${selectedCustomer.phone}` : undefined
  ].filter(Boolean) as string[] : [];
  const conflicts = useMemo(
    () => findTechnicianWindowConflicts(data.jobs, {
      assignedTechId: form.assignedTechId || undefined,
      scheduledAt: scheduledAtIso,
      arrivalWindowEndAt: arrivalWindowEndAtIso
    }),
    [arrivalWindowEndAtIso, data.jobs, form.assignedTechId, scheduledAtIso]
  );

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateArrivalWindow(value: typeof arrivalWindow) {
    arrivalWindowTouched.current = true;
    setArrivalWindow(value);
  }

  function pickCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setScheduleWithoutConfirmation(false);
    setForm((current) => ({
      ...current,
      serviceAddress: `${customer.addressLine1}${customer.addressLine2 ? ` ${customer.addressLine2}` : ""}, ${customer.city}, ${customer.state} ${customer.zip}`
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCustomer || !scheduledAtIso || !arrivalWindowEndAtIso || !validWindow) return;
    if (confirmationChannels.length === 0 && !scheduleWithoutConfirmation) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const job = await data.createJob({
        customerId: selectedCustomer.id,
        assignedTechId: form.assignedTechId || undefined,
        scheduledAt: scheduledAtIso,
        arrivalWindowEndAt: arrivalWindowEndAtIso,
        serviceAddress: form.serviceAddress,
        description: form.description,
        notes: ""
      });
      let confirmationNeedsAttention = false;
      try {
        const result = await dispatchJobConfirmations(job.id, "pending");
        confirmationNeedsAttention = result.notifications.some((notification) => notification.status === "failed");
      } catch {
        confirmationNeedsAttention = true;
      }
      router.push(`/jobs/${job.id}${confirmationNeedsAttention ? "?confirmation=needs-attention" : ""}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The service call could not be scheduled.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={`page-shell ${styles.page}`}>
      <header className={styles.header}>
        <h1>Schedule service</h1>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <section className={styles.section} aria-labelledby="customer-heading">
          <div className={styles.sectionHeading}>
            <h2 id="customer-heading">Customer</h2>
          </div>
          <CustomerPicker selectedCustomer={selectedCustomer} onPick={pickCustomer} />
        </section>

        <section className={styles.section} aria-labelledby="window-heading">
          <div className={styles.sectionHeading}>
            <h2 id="window-heading">Arrival window</h2>
          </div>
          <div className={styles.windowLayout}>
            <Field label="Technician">
              <select value={form.assignedTechId} onChange={(event) => update("assignedTechId", event.target.value)} disabled={currentUser.role === "tech"}>
                <option value="">Unassigned</option>
                {techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.displayName}</option>)}
              </select>
            </Field>
            <ArrivalWindowField
              value={arrivalWindow}
              onChange={updateArrivalWindow}
              required
              hideLegend
              timeZone={schedulingSettings.timeZone}
              defaultDurationMinutes={schedulingSettings.defaultArrivalWindowMinutes}
              schedulingIncrementMinutes={schedulingSettings.schedulingIncrementMinutes}
            />
          </div>
          {settingsLoadError ? (
            <div className={styles.settingsNotice} role="status">
              <span>Using the standard 3-hour arrival window because owner defaults could not be loaded.</span>
              <button type="button" onClick={() => setSettingsRequestVersion((version) => version + 1)}>Try again</button>
            </div>
          ) : null}
          {conflicts.length > 0 ? (
            <div className={styles.windowConflict} role="status">
              <strong>Overlapping customer arrival windows</strong>
              <span>{conflicts.length === 1 ? "Another customer has an overlapping arrival promise for this technician." : `${conflicts.length} other customers have overlapping arrival promises for this technician.`}</span>
              <span>Review the route before scheduling. These windows do not represent planned service duration.</span>
            </div>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="details-heading">
          <div className={styles.sectionHeading}>
            <h2 id="details-heading">Job details</h2>
          </div>
          <div className={styles.detailFields}>
            <Field label="Service address">
              <AddressAutocomplete
                required
                value={form.serviceAddress}
                onChange={(value) => update("serviceAddress", value)}
                onSelect={(address) => update("serviceAddress", address.formatted)}
              />
            </Field>
            <Field label="Description">
              <textarea required value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="No cooling upstairs, water heater not heating..." />
            </Field>
          </div>
        </section>

        <section className={`${styles.section} ${styles.confirmation}`} aria-labelledby="confirmation-heading" data-warning={confirmationChannels.length === 0 || undefined}>
          <div className={styles.sectionHeading}>
            <h2 id="confirmation-heading">Confirmation</h2>
          </div>
          {confirmationChannels.length > 0 ? (
            <div className={styles.confirmationReady}>
              <strong>Send automatically after scheduling</strong>
              <span>{confirmationChannels.join(" · ")}</span>
            </div>
          ) : (
            <label className={styles.warningCheck}>
              <input
                type="checkbox"
                checked={scheduleWithoutConfirmation}
                onChange={(event) => setScheduleWithoutConfirmation(event.target.checked)}
              />
              <span>
                <strong>Schedule without confirmation</strong>
                <small>Add an email or record SMS consent on the customer profile to enable automatic updates.</small>
              </span>
            </label>
          )}
        </section>

        <div className={styles.actions}>
          {submitError ? <p className={styles.submitError} role="alert">{submitError}</p> : null}
          <Button type="submit" disabled={submitting || !selectedCustomer || !validWindow || (confirmationChannels.length === 0 && !scheduleWithoutConfirmation)}>
            {submitting ? "Scheduling & notifying..." : confirmationChannels.length > 0 ? "Schedule & send confirmation" : "Schedule service"}
          </Button>
        </div>
      </form>
    </main>
  );
}
