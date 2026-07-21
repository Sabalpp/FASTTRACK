"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { formatPhoneInput, normalizePhone } from "@/lib/phone";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader, TwoColumn } from "@/components/ui";
import type { Customer } from "@/lib/types";

export default function NewCustomerPage() {
  return (
    <RoleGate allowed={["owner", "call_center"]}>
      <Suspense fallback={<main className="page-shell"><p>Loading customer intake...</p></main>}>
        <NewCustomerClient />
      </Suspense>
    </RoleGate>
  );
}

function NewCustomerClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { currentUser } = useAuth();
  const data = useAppData();
  const continueToJob = params.get("next") === "job";
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [smsConsentOptIn, setSmsConsentOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zip: "",
    notes: ""
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (normalizePhone(form.phone).length !== 10) {
      setSubmitError("Enter a valid 10-digit US phone number before saving the customer.");
      return;
    }
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const customer: Customer = await data.createCustomer({
        ...form,
        email: form.email || undefined,
        addressLine2: form.addressLine2 || undefined,
        state: form.state.trim().toUpperCase(),
        emailNotificationsEnabled,
        smsConsentStatus: smsConsentOptIn ? "opted_in" : "unknown",
        smsConsentAt: smsConsentOptIn ? new Date().toISOString() : undefined,
        smsConsentSource: smsConsentOptIn ? "staff_recorded" : undefined,
        createdBy: currentUser.id
      });
      router.push(continueToJob ? `/jobs/new?customerId=${customer.id}` : `/customers/${customer.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The customer could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Customer"
        title="Create customer"
        description={continueToJob ? "Add the customer record first. The next screen will schedule the job against this customer." : undefined}
      />
      <Card>
        <form className="stack" onSubmit={submit}>
          <TwoColumn>
            <Field label="Customer name"><input required value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
            <Field label="Phone">
              <input
                required
                inputMode="tel"
                value={form.phone}
                onChange={(event) => update("phone", formatPhoneInput(event.target.value))}
                placeholder="(703) 555-1234"
              />
            </Field>
          </TwoColumn>
          <Field label="Email"><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></Field>
          <div className="notification-preferences-panel">
            <div>
              <p className="eyebrow">Appointment updates</p>
              <h2>How should we contact this customer?</h2>
              <p className="muted">Choose only the channels the customer has approved.</p>
            </div>
            <label className="preference-check">
              <input
                type="checkbox"
                checked={emailNotificationsEnabled}
                onChange={(event) => setEmailNotificationsEnabled(event.target.checked)}
              />
              <span><strong>Email updates</strong><small>Uses the customer email above when available.</small></span>
            </label>
            <label className="preference-check">
              <input
                type="checkbox"
                checked={smsConsentOptIn}
                onChange={(event) => setSmsConsentOptIn(event.target.checked)}
                disabled={normalizePhone(form.phone).length !== 10}
              />
              <span>
                <strong>Customer agrees to automated appointment texts</strong>
                <small>Fast Track may send confirmations and schedule updates. Message frequency varies; message and data rates may apply. Reply STOP to opt out or HELP for help.</small>
              </span>
            </label>
          </div>
          <Field label="Street">
            <AddressAutocomplete
              required
              value={form.addressLine1}
              onChange={(value) => update("addressLine1", value)}
              onSelect={(address) => {
                setForm((current) => ({
                  ...current,
                  addressLine1: address.addressLine1,
                  city: address.city || current.city,
                  state: address.state || current.state,
                  zip: address.zip || current.zip
                }));
              }}
            />
          </Field>
          <TwoColumn>
            <Field label="Address line 2"><input value={form.addressLine2} onChange={(event) => update("addressLine2", event.target.value)} /></Field>
            <Field label="City"><input required value={form.city} onChange={(event) => update("city", event.target.value)} /></Field>
          </TwoColumn>
          <TwoColumn>
            <Field label="State"><input required value={form.state} onChange={(event) => update("state", event.target.value.toUpperCase())} placeholder="VA" maxLength={2} /></Field>
            <Field label="ZIP"><input required value={form.zip} onChange={(event) => update("zip", event.target.value)} /></Field>
          </TwoColumn>
          <Field label="Notes"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Gate code, preferred times, equipment notes..." /></Field>
          {submitError ? <p className="field-error" role="alert">{submitError}</p> : null}
          <Button type="submit" disabled={submitting}>{submitting ? "Creating..." : continueToJob ? "Create and schedule job" : "Create customer"}</Button>
        </form>
      </Card>
    </main>
  );
}
