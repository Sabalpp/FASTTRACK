"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { Suspense, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { canScheduleJobs } from "@/lib/access";
import { useAppData } from "@/lib/data-store";
import { formatPhoneInput, normalizePhone } from "@/lib/phone";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader, TwoColumn } from "@/components/ui";
import { branding } from "@/lib/branding";
import type { Customer } from "@/lib/types";
import styles from "./NewCustomer.module.css";

export default function NewCustomerPage() {
  return (
    <RoleGate allowed={["owner", "call_center", "tech"]}>
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
  const technicianIntake = currentUser.role === "tech";
  const continueToJob = params.get("next") === "job" && canScheduleJobs(currentUser.role);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [smsConsentOptIn, setSmsConsentOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [serviceRequest, setServiceRequest] = useState("");
  const [completedCustomer, setCompletedCustomer] = useState<Customer | undefined>();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "VA",
    zip: "",
    notes: ""
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (normalizePhone(form.phone).length !== 10) {
      setSubmitError("Enter a valid 10-digit US phone number before saving.");
      return;
    }

    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const customer: Customer = await data.createCustomer({
        ...form,
        notes: technicianIntake
          ? [
              serviceRequest.trim() ? `Service request: ${serviceRequest.trim()}` : "",
              form.notes.trim() ? `Access note: ${form.notes.trim()}` : ""
            ].filter(Boolean).join("\n")
          : form.notes,
        email: form.email || undefined,
        addressLine2: form.addressLine2 || undefined,
        state: form.state.trim().toUpperCase(),
        emailNotificationsEnabled,
        smsConsentStatus: smsConsentOptIn ? "opted_in" : "unknown",
        smsConsentAt: smsConsentOptIn ? new Date().toISOString() : undefined,
        smsConsentSource: smsConsentOptIn ? technicianIntake ? "customer_intake" : "staff_recorded" : undefined,
        createdBy: currentUser.id
      });

      if (technicianIntake) {
        setCompletedCustomer(customer);
        return;
      }

      router.replace(continueToJob ? `/jobs/new?customerId=${customer.id}` : `/customers/${customer.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Your information could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  if (technicianIntake && completedCustomer) {
    return (
      <main className={`${styles.intakePage} ${styles.completePage}`}>
        <section className={styles.completeCard} aria-live="polite">
          <span className={styles.completeIcon} aria-hidden="true"><CheckCircle2 size={34} /></span>
          <p className={styles.eyebrow}>Information saved</p>
          <h1>Thank you, {completedCustomer.name.split(" ")[0]}.</h1>
          <p>Your contact information and service request are ready for the Fast Track team.</p>
          <div className={styles.handoffMessage}>
            <strong>Please return this iPad to your technician.</strong>
            <span>Your technician can safely return to their private workspace.</span>
          </div>
          <Link className={styles.returnButton} href="/dashboard">Technician: return to jobs</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={technicianIntake ? styles.intakePage : "page-shell"}>
      {technicianIntake ? (
        <header className={styles.intakeHeader}>
          <span className={styles.brand}>
            <Image src={branding.logoPath} alt="" width={44} height={34} priority />
            <span><strong>Fast Track</strong><small>Customer intake</small></span>
          </span>
          <span className={styles.privateLabel}><LockKeyhole size={16} aria-hidden="true" /> Private form</span>
        </header>
      ) : null}

      <div className={technicianIntake ? styles.intakeContent : undefined}>
        <PageHeader
          eyebrow="Customer"
          title={technicianIntake ? "Tell us how we can help" : "Create customer"}
          description={continueToJob
            ? "Add the customer record first. The next screen will schedule the job against this customer."
            : technicianIntake
              ? "Enter your contact details and service address. Fast Track uses this information only to coordinate your service."
              : undefined}
        />

        <Card className={technicianIntake ? styles.intakeCard : ""}>
          <form className={`stack ${technicianIntake ? styles.intakeForm : ""}`} onSubmit={submit}>
            {technicianIntake ? (
              <section className={styles.formSection} aria-labelledby="contact-heading">
                <SectionTitle number="1" id="contact-heading">Your contact details</SectionTitle>
                <div className={styles.sectionFields}>
                  <TwoColumn>
                    <Field label="Full name"><input autoComplete="name" required value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
                    <Field label="Phone"><input autoComplete="tel" required inputMode="tel" value={form.phone} onChange={(event) => update("phone", formatPhoneInput(event.target.value))} placeholder="(703) 555-1234" /></Field>
                  </TwoColumn>
                  <Field label="Email"><input autoComplete="email" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></Field>
                </div>
              </section>
            ) : (
              <>
                <TwoColumn>
                  <Field label="Customer name"><input required value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
                  <Field label="Phone"><input required inputMode="tel" value={form.phone} onChange={(event) => update("phone", formatPhoneInput(event.target.value))} placeholder="(703) 555-1234" /></Field>
                </TwoColumn>
                <Field label="Email"><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></Field>
                <div className="notification-preferences-panel">
                  <div><p className="eyebrow">Appointment updates</p><h2>How should we contact this customer?</h2><p className="muted">Choose only the channels the customer approved.</p></div>
                  <label className="preference-check"><input type="checkbox" checked={emailNotificationsEnabled} onChange={(event) => setEmailNotificationsEnabled(event.target.checked)} /><span><strong>Email updates</strong><small>Uses the customer email above when available.</small></span></label>
                  <label className="preference-check"><input type="checkbox" checked={smsConsentOptIn} onChange={(event) => setSmsConsentOptIn(event.target.checked)} disabled={normalizePhone(form.phone).length !== 10} /><span><strong>Customer agrees to automated appointment texts</strong><small>Fast Track may send confirmations and schedule updates. Message frequency varies; message and data rates may apply. Reply STOP to opt out.</small></span></label>
                </div>
              </>
            )}

            <section className={technicianIntake ? styles.formSection : undefined} aria-labelledby={technicianIntake ? "address-heading" : undefined}>
              {technicianIntake ? <SectionTitle number="2" id="address-heading">Service address</SectionTitle> : null}
              <div className={technicianIntake ? styles.sectionFields : "stack"}>
                <Field label={technicianIntake ? "Street address" : "Street"}>
                  <AddressAutocomplete
                    required
                    value={form.addressLine1}
                    onChange={(value) => update("addressLine1", value)}
                    onSelect={(address) => {
                      setForm((current) => ({ ...current, addressLine1: address.addressLine1, city: address.city || current.city, state: address.state || current.state, zip: address.zip || current.zip }));
                    }}
                  />
                </Field>
                <TwoColumn>
                  <Field label="Unit (optional)"><input autoComplete="address-line2" value={form.addressLine2} onChange={(event) => update("addressLine2", event.target.value)} /></Field>
                  <Field label="City"><input autoComplete="address-level2" required value={form.city} onChange={(event) => update("city", event.target.value)} /></Field>
                </TwoColumn>
                <TwoColumn>
                  <Field label="State"><input autoComplete="address-level1" required value={form.state} onChange={(event) => update("state", event.target.value.toUpperCase())} placeholder="VA" maxLength={2} /></Field>
                  <Field label="ZIP"><input autoComplete="postal-code" inputMode="numeric" required value={form.zip} onChange={(event) => update("zip", event.target.value)} /></Field>
                </TwoColumn>
              </div>
            </section>

            {technicianIntake ? (
              <section className={styles.formSection} aria-labelledby="request-heading">
                <SectionTitle number="3" id="request-heading">What can we help with?</SectionTitle>
                <div className={styles.sectionFields}>
                  <Field label="Describe the issue"><textarea required value={serviceRequest} onChange={(event) => setServiceRequest(event.target.value)} placeholder="For example: no cooling upstairs or a leaking water heater" /></Field>
                  <Field label="Access note (optional)"><input value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Gate code, parking, pets, or other instructions" /></Field>
                </div>
              </section>
            ) : <Field label="Access notes (optional)"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Gate code, preferred times, equipment notes..." /></Field>}

            {technicianIntake ? (
              <section className={styles.permissionPanel} aria-labelledby="updates-heading">
                <div><h2 id="updates-heading">Appointment updates</h2><p>Choose only the messages you agree to receive.</p></div>
                <label><input type="checkbox" checked={emailNotificationsEnabled} onChange={(event) => setEmailNotificationsEnabled(event.target.checked)} /><span><strong>Email updates</strong><small>Confirmations and schedule changes.</small></span></label>
                <label><input type="checkbox" checked={smsConsentOptIn} onChange={(event) => setSmsConsentOptIn(event.target.checked)} disabled={normalizePhone(form.phone).length !== 10} /><span><strong>Text updates</strong><small>Message frequency varies. Message and data rates may apply. Reply STOP to opt out.</small></span></label>
              </section>
            ) : null}

            {submitError ? <p className="field-error" role="alert">{submitError}</p> : null}
            <div className={technicianIntake ? styles.submitArea : "customer-intake-actions"}>
              <Button type="submit" disabled={submitting}>{submitting ? "Saving information…" : continueToJob ? "Create and schedule job" : technicianIntake ? "Save my information" : "Create customer"}</Button>
              {technicianIntake ? <p><LockKeyhole size={14} aria-hidden="true" /> This form does not expose private customer or company records.</p> : null}
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}

function SectionTitle({ number, id, children }: { number: string; id: string; children: React.ReactNode }) {
  return <div className={styles.sectionTitle}><span>{number}</span><h2 id={id}>{children}</h2></div>;
}
