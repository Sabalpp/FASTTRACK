"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { CustomerPicker } from "@/components/CustomerPicker";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader } from "@/components/ui";
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
    assignedTechId: currentUser.role === "tech" ? currentUser.id : techs[0]?.id ?? "",
    scheduledDate: "",
    scheduledTime: "",
    serviceAddress: preselectedCustomer ? `${preselectedCustomer.addressLine1}${preselectedCustomer.addressLine2 ? ` ${preselectedCustomer.addressLine2}` : ""}, ${preselectedCustomer.city}, ${preselectedCustomer.state} ${preselectedCustomer.zip}` : "",
    description: ""
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
      scheduledAt: form.scheduledDate && form.scheduledTime ? new Date(`${form.scheduledDate}T${form.scheduledTime}`).toISOString() : new Date().toISOString(),
      serviceAddress: form.serviceAddress,
      description: form.description,
      notes: ""
    });
    router.push(`/jobs/${job.id}`);
  }

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Dispatch"
        title="Schedule service"
        description="Find the caller, confirm the address, assign the tech, then schedule."
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
              <div className="date-time-grid">
                <Field label="Date">
                  <input required type="date" value={form.scheduledDate} onChange={(event) => update("scheduledDate", event.target.value)} />
                </Field>
                <Field label="Time">
                  <input required type="time" value={form.scheduledTime} onChange={(event) => update("scheduledTime", event.target.value)} />
                </Field>
              </div>
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
          <Button type="submit" disabled={!selectedCustomer}>Schedule service</Button>
        </form>
      </Card>
    </main>
  );
}
