"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canEditCustomers, canScheduleJobs, canViewCustomer, canViewJob } from "@/lib/access";
import { formatDateTime } from "@/lib/date";
import { formatPhone } from "@/lib/phone";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ContactActions } from "@/components/ContactActions";
import { Button, ButtonLink, Card, EmptyState, Field, PageHeader, StatusPill, TwoColumn } from "@/components/ui";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const data = useAppData();
  const { currentUser } = useAuth();
  const customer = data.customers.find((candidate) => candidate.id === params.id);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState(() => ({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
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

  const callHistory = data.callLogs.filter((call) => call.customerId === customer.id);
  const editable = canEditCustomers(currentUser.role);
  const customerId = customer.id;

  function updateDraft(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function saveCustomer() {
    data.updateCustomer(customerId, {
      ...draft,
      email: draft.email || undefined,
      addressLine2: draft.addressLine2 || undefined
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  }

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Customer"
        title={customer.name}
        description={`${formatPhone(customer.phone)} · ${customer.email ?? "No email"}`}
        action={canScheduleJobs(currentUser.role) ? <ButtonLink href={`/jobs/new?customerId=${customer.id}`}>New job</ButtonLink> : undefined}
      />
      <TwoColumn>
        <Card>
          <div className="section-head">
            <div>
              <p className="eyebrow">Contact</p>
              <h2>{customer.name}</h2>
            </div>
            {editable ? <Button onClick={saveCustomer}>{saved ? "Saved" : "Save"}</Button> : null}
          </div>
          <ContactActions customer={customer} subject={`Service for ${customer.name}`} />
          {editable ? (
            <div className="stack editable-panel">
              <TwoColumn>
                <Field label="Name"><input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></Field>
                <Field label="Phone"><input value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} /></Field>
              </TwoColumn>
              <Field label="Email"><input value={draft.email} onChange={(event) => updateDraft("email", event.target.value)} /></Field>
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
            </div>
          ) : (
            <p className="muted">{customer.notes || "No notes yet."}</p>
          )}
        </Card>
        <Card>
          <p className="eyebrow">Calls</p>
          <h2>History</h2>
          {callHistory.length === 0 ? (
            <p className="muted">No calls yet.</p>
          ) : (
            <div className="stack">
              {callHistory.map((call) => (
                <div key={call.id} className="call-card">
                  <strong>{call.summary ?? "Call summary pending"}</strong>
                  <span>{formatDateTime(call.startedAt)} · {call.durationSeconds}s</span>
                  <small>{call.transcript}</small>
                </div>
              ))}
            </div>
          )}
        </Card>
      </TwoColumn>

      <Card>
        <div className="section-head">
          <div>
            <h2>History</h2>
          </div>
          {canScheduleJobs(currentUser.role) ? <Link href={`/jobs/new?customerId=${customer.id}`} className="text-link">New job</Link> : null}
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
                  <span>{formatDateTime(job.scheduledAt)}</span>
                </div>
                <div className="record-side">
                  <StatusPill tone={job.status === "complete" ? "good" : "info"}>{job.status.replace("_", " ")}</StatusPill>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
