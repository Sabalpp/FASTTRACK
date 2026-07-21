"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ArrivalWindowField } from "@/components/ArrivalWindowField";
import { CustomerPicker } from "@/components/CustomerPicker";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader } from "@/components/ui";
import { emptyArrivalWindowDraft, resolveArrivalWindow } from "@/lib/arrival-window";
import { dispatchJobConfirmations } from "@/lib/appointment-confirmations-client";
import {
  findTechnicianWindowConflicts
} from "@/lib/service-window";
import type { Customer } from "@/lib/types";

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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [scheduleWithoutConfirmation, setScheduleWithoutConfirmation] = useState(false);

  const arrivalWindowResolution = resolveArrivalWindow(arrivalWindow);
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
    <main className="page-shell">
      <PageHeader
        eyebrow="Dispatch"
        title="Schedule service"
        description="Confirm the customer, set a clear arrival window, then assign the technician."
      />
      <Card className="schedule-call-card">
        <form className="stack" onSubmit={submit}>
          <div className="service-call-layout">
            <section className="service-call-panel customer-search-panel">
              <p className="eyebrow">Customer</p>
              <h2>Find caller</h2>
              <CustomerPicker selectedCustomer={selectedCustomer} onPick={pickCustomer} />
            </section>

            <section className="service-call-panel dispatch-panel">
              <p className="eyebrow">Dispatch</p>
              <h2>Schedule</h2>
              <Field label="Assigned tech">
                <select value={form.assignedTechId} onChange={(event) => update("assignedTechId", event.target.value)} disabled={currentUser.role === "tech"}>
                  <option value="">Unassigned</option>
                  {techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.displayName}</option>)}
                </select>
              </Field>
              <ArrivalWindowField value={arrivalWindow} onChange={updateArrivalWindow} required />
              {conflicts.length > 0 ? (
                <div className="window-conflict" role="status">
                  <strong>Overlapping customer arrival windows</strong>
                  <span>{conflicts.length === 1 ? "Another customer has an overlapping arrival promise for this technician." : `${conflicts.length} other customers have overlapping arrival promises for this technician.`}</span>
                  <span>Review the route before scheduling. These windows do not represent planned service duration.</span>
                </div>
              ) : null}
            </section>
          </div>

          <div className="service-details-panel">
            <div>
              <p className="eyebrow">Call details</p>
              <h2>What is the issue?</h2>
            </div>
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
          <div className="notification-review-panel">
            <div>
              <p className="eyebrow">Customer confirmation</p>
              <h2>{confirmationChannels.length > 0 ? "Sends automatically after scheduling" : "No eligible delivery channel"}</h2>
              <p className="muted">
                The confirmation uses the exact arrival window and explains that arrival may occur at any time during that window.
              </p>
            </div>
            {confirmationChannels.length > 0 ? (
              <div className="notification-channel-preview">
                {confirmationChannels.map((channel) => <span key={channel}>{channel}</span>)}
              </div>
            ) : (
              <label className="preference-check warning-check">
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
          </div>
          {submitError ? <p className="field-error" role="alert">{submitError}</p> : null}
          <Button type="submit" disabled={submitting || !selectedCustomer || !validWindow || (confirmationChannels.length === 0 && !scheduleWithoutConfirmation)}>
            {submitting ? "Scheduling & notifying..." : confirmationChannels.length > 0 ? "Schedule & send confirmation" : "Schedule service"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
