"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { CustomerPicker } from "@/components/CustomerPicker";
import { Button, ButtonLink, Card, Field, PageHeader, TwoColumn } from "@/components/ui";
import type { Customer } from "@/lib/types";

export default function NewJobPage() {
  return (
    <Suspense fallback={<main className="page-shell"><p>Loading scheduler...</p></main>}>
      <NewJobClient />
    </Suspense>
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
    assignedTechId: currentUser.role === "tech" ? currentUser.id : techs[0]?.id ?? "",
    scheduledAt: "",
    serviceAddress: preselectedCustomer ? `${preselectedCustomer.addressLine1}${preselectedCustomer.addressLine2 ? ` ${preselectedCustomer.addressLine2}` : ""}, ${preselectedCustomer.city}, ${preselectedCustomer.state} ${preselectedCustomer.zip}` : "",
    description: "",
    notes: ""
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function pickCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setForm((current) => ({
      ...current,
      serviceAddress: `${customer.addressLine1}${customer.addressLine2 ? ` ${customer.addressLine2}` : ""}, ${customer.city}, ${customer.state} ${customer.zip}`
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCustomer) return;
    const job = data.createJob({
      customerId: selectedCustomer.id,
      assignedTechId: form.assignedTechId || undefined,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : new Date().toISOString(),
      serviceAddress: form.serviceAddress,
      description: form.description,
      notes: form.notes
    });
    router.push(`/jobs/${job.id}`);
  }

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Schedule"
        title="New service call"
        description="Find or create the customer first. History, photos, and invoices stay connected."
        action={<ButtonLink href="/customers/new?next=job" variant="secondary">Create customer</ButtonLink>}
      />
      <Card>
        <form className="stack" onSubmit={submit}>
          <div className="job-intake-grid">
            <CustomerPicker selectedCustomer={selectedCustomer} onPick={pickCustomer} />
            <div className="intake-guide compact-intake-guide">
              <p className="eyebrow">Scheduling</p>
              <h2>{selectedCustomer ? "Customer selected" : "No customer yet"}</h2>
              <p className="muted">{selectedCustomer ? "Confirm address, time, and job notes below." : "Search existing records or create a customer first."}</p>
              {!selectedCustomer ? <ButtonLink href="/customers/new?next=job" variant="secondary">Create customer</ButtonLink> : null}
            </div>
          </div>
          <TwoColumn>
            <Field label="Assigned tech">
              <select value={form.assignedTechId} onChange={(event) => update("assignedTechId", event.target.value)} disabled={currentUser.role === "tech"}>
                <option value="">Unassigned</option>
                {techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.displayName}</option>)}
              </select>
            </Field>
            <Field label="Scheduled date/time">
              <input required type="datetime-local" value={form.scheduledAt} onChange={(event) => update("scheduledAt", event.target.value)} />
            </Field>
          </TwoColumn>
          <Field label="Service address">
            <AddressAutocomplete
              required
              value={form.serviceAddress}
              onChange={(value) => update("serviceAddress", value)}
              onSelect={(address) => update("serviceAddress", address.formatted)}
            />
          </Field>
          <Field label="Description"><textarea required value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="No cooling upstairs, water heater not heating..." /></Field>
          <Field label="Scheduling notes"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
          <Button type="submit" disabled={!selectedCustomer}>Schedule service call</Button>
        </form>
      </Card>
    </main>
  );
}
