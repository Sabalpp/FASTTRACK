"use client";

import { useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader, StatusPill, ThreeColumn, TwoColumn } from "@/components/ui";
import { roleLabels, roleOptions, useAppData } from "@/lib/data-store";
import type { Role } from "@/lib/types";

export default function AdminUsersPage() {
  const data = useAppData();
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    role: "tech" as Role,
    active: true
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    data.createAllowedUser(form);
    setForm({ displayName: "", email: "", role: "tech", active: true });
  }

  return (
    <RoleGate allowed={["owner"]}>
      <main className="page-shell">
        <PageHeader eyebrow="Owner only" title="Users" />
        <ThreeColumn>
          {roleOptions.map((role) => (
            <Card key={role}>
              <p className="eyebrow">{roleLabels[role]}</p>
              <h2>{data.allowedUsers.filter((user) => user.role === role && user.active).length}</h2>
              <p className="muted">Active users</p>
            </Card>
          ))}
        </ThreeColumn>
        <Card>
          <p className="eyebrow">Add user</p>
          <form className="stack" onSubmit={submit}>
            <TwoColumn>
              <Field label="Display name"><input required value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></Field>
              <Field label="Email"><input required type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></Field>
            </TwoColumn>
            <Field label="Role">
              <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role }))}>
                {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
            </Field>
            <Button type="submit">Add to allowlist</Button>
          </form>
        </Card>
        <div className="stack">
          {data.allowedUsers.map((user) => (
            <Card key={user.id}>
              <div className="section-head">
                <div>
                  <strong>{user.displayName}</strong>
                  <p>{user.email}</p>
                </div>
                <StatusPill tone={user.active ? "good" : "bad"}>{roleLabels[user.role]} · {user.active ? "active" : "inactive"}</StatusPill>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </RoleGate>
  );
}
