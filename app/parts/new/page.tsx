"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader, TwoColumn } from "@/components/ui";
import { unitOptions, useAppData } from "@/lib/data-store";
import type { Unit } from "@/lib/types";

export default function NewPartPage() {
  const router = useRouter();
  const data = useAppData();
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "HVAC",
    defaultPrice: "0",
    unit: "each" as Unit
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    data.createPart({
      name: form.name,
      sku: form.sku || undefined,
      category: form.category,
      defaultPrice: Number(form.defaultPrice),
      unit: form.unit
    });
    router.push("/parts");
  }

  return (
    <RoleGate allowed={["owner"]}>
      <main className="page-shell">
        <PageHeader eyebrow="Owner only" title="Add part" />
        <Card>
          <form className="stack" onSubmit={submit}>
            <TwoColumn>
              <Field label="Name"><input required value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
              <Field label="SKU"><input value={form.sku} onChange={(event) => update("sku", event.target.value)} /></Field>
            </TwoColumn>
            <TwoColumn>
              <Field label="Category"><input required value={form.category} onChange={(event) => update("category", event.target.value)} /></Field>
              <Field label="Unit">
                <select value={form.unit} onChange={(event) => update("unit", event.target.value)}>
                  {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </Field>
            </TwoColumn>
            <Field label="Default price"><input required type="number" min="0" step="0.01" value={form.defaultPrice} onChange={(event) => update("defaultPrice", event.target.value)} /></Field>
            <Button type="submit">Add part</Button>
          </form>
        </Card>
      </main>
    </RoleGate>
  );
}
