"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canEditCustomers, canScheduleJobs, canViewCustomer, canViewJob } from "@/lib/access";
import { formatDateTime } from "@/lib/date";
import { formatPhone, formatPhoneInput, normalizePhone } from "@/lib/phone";
import { formatServiceWindow } from "@/lib/service-window";
import { useCurrentTime } from "@/lib/use-current-time";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ContactActions } from "@/components/ContactActions";
import { ServiceWindowBadge } from "@/components/ServiceWindowBadge";
import { Button, ButtonLink, Card, EmptyState, Field, PageHeader, StatusPill, TwoColumn } from "@/components/ui";
import type { Customer } from "@/lib/types";
import styles from "../customers.module.css";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const data = useAppData();
  const { currentUser } = useAuth();
  const now = useCurrentTime();
  const customer = data.customers.find((candidate) => candidate.id === params.id);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [draft, setDraft] = useState(() => ({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    emailNotificationsEnabled: customer?.emailNotificationsEnabled ?? true,
    smsConsentStatus: customer?.smsConsentStatus ?? "unknown",
    smsConsentAt: customer?.smsConsentAt ?? "",
    smsConsentSource: customer?.smsConsentSource ?? "",
    addressLine1: customer?.addressLine1 ?? "",
    addressLine2: customer?.addressLine2 ?? "",
    city: customer?.city ?? "",
    state: customer?.state ?? "",
    zip: customer?.zip ?? "",
    notes: customer?.notes ?? ""
  }));

  useEffect(() => {
    if (!customer) return;
    setDraft({
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? "",
      emailNotificationsEnabled: customer.emailNotificationsEnabled,
      smsConsentStatus: customer.smsConsentStatus,
      smsConsentAt: customer.smsConsentAt ?? "",
      smsConsentSource: customer.smsConsentSource ?? "",
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2 ?? "",
      city: customer.city,
      state: customer.state,
      zip: customer.zip,
      notes: customer.notes
    });
  }, [customer]);

  const customerJobs = useMemo(
    () => data.jobs.filter((job) => job.customerId === params.id && canViewJob(currentUser, job)),
    [currentUser, data.jobs, params.id]
  );

  if (!customer || !canViewCustomer(currentUser, customer, data.jobs)) {
    return (
      <main className="page-shell">
        <EmptyState title="Customer not available" description="This customer either does not exist or is outside this role's access." />
      </main>
    );
  }

  const editable = canEditCustomers(currentUser.role);
  const customerId = customer.id;
  const phoneChanged = normalizePhone(draft.phone) !== customer.phoneDigits;
  const serviceAddress = [
    customer.addressLine1,
    customer.addressLine2,
    `${customer.city}, ${customer.state} ${customer.zip}`
  ].filter(Boolean).join(", ");

  function updateDraft<Key extends keyof typeof draft>(key: Key, value: (typeof draft)[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function cancelEditing(source: Customer) {
    setDraft({
      name: source.name,
      phone: source.phone,
      email: source.email ?? "",
      emailNotificationsEnabled: source.emailNotificationsEnabled,
      smsConsentStatus: source.smsConsentStatus,
      smsConsentAt: source.smsConsentAt ?? "",
      smsConsentSource: source.smsConsentSource ?? "",
      addressLine1: source.addressLine1,
      addressLine2: source.addressLine2 ?? "",
      city: source.city,
      state: source.state,
      zip: source.zip,
      notes: source.notes
    });
    setSaveError(undefined);
    setEditing(false);
  }

  async function saveCustomer() {
    if (normalizePhone(draft.phone).length !== 10) {
      setSaveError("Enter a valid 10-digit US phone number before saving the customer.");
      return;
    }
    setSaveBusy(true);
    setSaveError(undefined);
    try {
      await data.updateCustomer(customerId, {
        ...draft,
        email: draft.email,
        addressLine2: draft.addressLine2,
        smsConsentAt: draft.smsConsentAt || null,
        smsConsentSource: draft.smsConsentSource || null
      });
      setSaved(true);
      setEditing(false);
      window.setTimeout(() => setSaved(false), 1400);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The customer could not be saved.");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <main className="page-shell">
      <PageHeader
        title={customer.name}
        description={serviceAddress}
        action={canScheduleJobs(currentUser.role) ? <ButtonLink href={`/jobs/new?customerId=${customer.id}`}>Schedule service</ButtonLink> : undefined}
      />
      <Card className={`customer-profile-card ${styles.profileCard}`}>
        <div className="section-head">
          <h2>Customer details</h2>
          {editable ? (
            editing ? (
              <div className="action-row">
                <Button variant="secondary" onClick={() => cancelEditing(customer)} disabled={saveBusy}>Cancel</Button>
                <Button onClick={saveCustomer} disabled={saveBusy}>{saveBusy ? "Saving..." : "Save changes"}</Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
            )
          ) : null}
        </div>
        {editing && editable ? (
          <div className="stack editable-panel">
              <TwoColumn>
                <Field label="Name"><input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></Field>
                <Field label="Phone"><input inputMode="tel" value={draft.phone} onChange={(event) => {
                  const phone = formatPhoneInput(event.target.value);
                  setDraft((current) => ({
                    ...current,
                    phone,
                    ...(normalizePhone(phone) !== customer.phoneDigits
                      ? { smsConsentStatus: "unknown", smsConsentAt: "", smsConsentSource: "" }
                      : {})
                  }));
                }} /></Field>
              </TwoColumn>
              <Field label="Email"><input value={draft.email} onChange={(event) => updateDraft("email", event.target.value)} /></Field>
              <div className="notification-preferences-panel">
                <div>
                  <p className="eyebrow">Appointment updates</p>
                  <h3>How should we contact this customer?</h3>
                  <p className="muted">Choose only the channels the customer has approved.</p>
                </div>
                <label className="preference-check">
                  <input
                    type="checkbox"
                    checked={draft.emailNotificationsEnabled}
                    onChange={(event) => updateDraft("emailNotificationsEnabled", event.target.checked)}
                  />
                  <span><strong>Email updates</strong><small>{draft.email ? draft.email : "Add an email address to enable this channel."}</small></span>
                </label>
                <label className="preference-check">
                  <input
                    type="checkbox"
                    checked={draft.smsConsentStatus === "opted_in"}
                    disabled={phoneChanged}
                    onChange={(event) => {
                      const now = new Date().toISOString();
                      setDraft((current) => ({
                        ...current,
                        smsConsentStatus: event.target.checked ? "opted_in" : "opted_out",
                        smsConsentAt: now,
                        smsConsentSource: "staff_recorded"
                      }));
                    }}
                  />
                  <span>
                    <strong>Customer agrees to automated appointment texts</strong>
                    <small>{phoneChanged
                      ? "Save the new phone number first. SMS consent resets whenever the number changes."
                      : "Fast Track may send confirmations and schedule updates. Message frequency varies; message and data rates may apply. Reply STOP to opt out or HELP for help."}</small>
                  </span>
                </label>
                <p className="customer-consent-status">
                  Text consent: {draft.smsConsentStatus.replace("_", " ")}
                  {draft.smsConsentAt ? ` · recorded ${formatDateTime(draft.smsConsentAt)}` : " · no consent recorded"}
                </p>
              </div>
              <TwoColumn>
                <Field label="Address">
                  <AddressAutocomplete
                    value={draft.addressLine1}
                    onChange={(value) => updateDraft("addressLine1", value)}
                    onSelect={(address) => {
                      setDraft((current) => ({
                        ...current,
                        addressLine1: address.addressLine1,
                        city: address.city || current.city,
                        state: address.state || current.state,
                        zip: address.zip || current.zip
                      }));
                    }}
                  />
                </Field>
                <Field label="Unit"><input value={draft.addressLine2} onChange={(event) => updateDraft("addressLine2", event.target.value)} /></Field>
              </TwoColumn>
              <TwoColumn>
                <Field label="City"><input value={draft.city} onChange={(event) => updateDraft("city", event.target.value)} /></Field>
                <Field label="State"><input value={draft.state} onChange={(event) => updateDraft("state", event.target.value)} /></Field>
              </TwoColumn>
              <Field label="Zip"><input value={draft.zip} onChange={(event) => updateDraft("zip", event.target.value)} /></Field>
              <Field label="Notes"><textarea value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} /></Field>
              {saveError ? <p className="field-error" role="alert">{saveError}</p> : null}
          </div>
        ) : (
          <div className={styles.readOnlySummary}>
            <ContactActions customer={customer} subject={`Service for ${customer.name}`} />
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span>Contact</span>
                <strong>{formatPhone(customer.phone)}</strong>
                <small>{customer.email ?? "No email address"}</small>
              </div>
              <div className={styles.summaryItem}>
                <span>Service address</span>
                <strong>{customer.addressLine1}{customer.addressLine2 ? `, ${customer.addressLine2}` : ""}</strong>
                <small>{customer.city}, {customer.state} {customer.zip}</small>
              </div>
            </div>
            {saved ? <p className={styles.savedNotice} role="status">Customer saved</p> : null}
          </div>
        )}
      </Card>

      <Card>
        <div className="section-head">
          <h2>Service history</h2>
        </div>
        {customerJobs.length === 0 ? (
          <EmptyState title="No jobs yet" description="Schedule the first visit." />
        ) : (
          <div className="record-list">
            {customerJobs.map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`} className="record-row job-row">
                <div className="record-main">
                  <strong>{job.description}</strong>
                  <span>{job.serviceAddress}</span>
                </div>
                <div className="record-meta">
                  <span>{formatServiceWindow(job.scheduledAt, job.arrivalWindowEndAt)}</span>
                </div>
                <div className="record-side">
                  <div className="window-status-stack">
                    <ServiceWindowBadge job={job} now={now} />
                    <StatusPill tone={job.status === "complete" ? "good" : "info"}>{job.status.replace("_", " ")}</StatusPill>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
