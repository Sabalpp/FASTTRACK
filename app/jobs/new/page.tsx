"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { CustomerPicker } from "@/components/CustomerPicker";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader } from "@/components/ui";
import { dateInputValue } from "@/lib/date";
import {
  defaultServiceWindowEndAt,
  findTechnicianWindowConflicts,
  formatServiceWindow,
  isValidServiceWindow
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
    scheduledAt: "",
    arrivalWindowEndAt: "",
    serviceAddress: preselectedCustomer ? `${preselectedCustomer.addressLine1}${preselectedCustomer.addressLine2 ? ` ${preselectedCustomer.addressLine2}` : ""}, ${preselectedCustomer.city}, ${preselectedCustomer.state} ${preselectedCustomer.zip}` : "",
    description: ""
  });
  const [conflictConfirmed, setConflictConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const scheduledAtIso = localDateTimeIso(form.scheduledAt);
  const arrivalWindowEndAtIso = localDateTimeIso(form.arrivalWindowEndAt);
  const validWindow = isValidServiceWindow(scheduledAtIso, arrivalWindowEndAtIso);
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
    if (key === "assignedTechId" || key === "arrivalWindowEndAt") setConflictConfirmed(false);
  }

  function updateWindowStart(value: string) {
    const startIso = localDateTimeIso(value);
    const defaultEnd = defaultServiceWindowEndAt(startIso);
    setForm((current) => ({
      ...current,
      scheduledAt: value,
      arrivalWindowEndAt: dateInputValue(defaultEnd)
    }));
    setConflictConfirmed(false);
  }

  function pickCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setForm((current) => ({
      ...current,
      serviceAddress: `${customer.addressLine1}${customer.addressLine2 ? ` ${customer.addressLine2}` : ""}, ${customer.city}, ${customer.state} ${customer.zip}`
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCustomer || !scheduledAtIso || !arrivalWindowEndAtIso || !validWindow) return;
    if (conflicts.length > 0 && !conflictConfirmed) return;
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
      router.push(`/jobs/${job.id}`);
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
              <div className="date-time-grid arrival-window-grid">
                <Field label="Window starts">
                  <input required type="datetime-local" value={form.scheduledAt} onChange={(event) => updateWindowStart(event.target.value)} />
                </Field>
                <Field label="Window ends">
                  <input required type="datetime-local" value={form.arrivalWindowEndAt} onChange={(event) => update("arrivalWindowEndAt", event.target.value)} />
                </Field>
              </div>
              {form.scheduledAt && form.arrivalWindowEndAt ? (
                validWindow ? (
                  <div className="service-window-preview">
                    <span>Customer arrival window</span>
                    <strong>{formatServiceWindow(scheduledAtIso, arrivalWindowEndAtIso)}</strong>
                    <small>The end defaults to three hours after the start. After this time, an unstarted assignment turns late.</small>
                  </div>
                ) : (
                  <p className="field-error" role="alert">The window must end after it starts.</p>
                )
              ) : null}
              {conflicts.length > 0 ? (
                <div className="window-conflict" role="alert">
                  <strong>Technician schedule overlap</strong>
                  <span>{conflicts.length === 1 ? "This technician already has a job during this window." : `This technician has ${conflicts.length} jobs during this window.`}</span>
                  <label>
                    <input type="checkbox" checked={conflictConfirmed} onChange={(event) => setConflictConfirmed(event.target.checked)} />
                    Schedule anyway
                  </label>
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
          {submitError ? <p className="field-error" role="alert">{submitError}</p> : null}
          <Button type="submit" disabled={submitting || !selectedCustomer || !validWindow || (conflicts.length > 0 && !conflictConfirmed)}>
            {submitting ? "Scheduling..." : "Schedule service"}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function localDateTimeIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
