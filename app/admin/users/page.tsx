"use client";

import { useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader, StatusPill, ThreeColumn, TwoColumn } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { roleLabels, roleOptions, useAppData } from "@/lib/data-store";
import type { Role } from "@/lib/types";

export default function AdminUsersPage() {
  const data = useAppData();
  const { currentUser } = useAuth();
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    role: "tech" as Role,
    active: true
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    data.createAllowedUser({
      ...form,
      displayName: form.displayName.trim(),
      email: form.email.trim().toLowerCase()
    });
    setForm({ displayName: "", email: "", role: "tech", active: true });
  }

  return (
    <RoleGate allowed={["owner"]}>
      <main className="page-shell users-page">
        <PageHeader eyebrow="Owner only" title="Users" description="Control which Google accounts can access the app and what role they receive." />
        <ThreeColumn>
          {roleOptions.map((role) => (
            <Card key={role} className="user-role-card">
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
        <div className="stack user-card-list">
          {data.allowedUsers.map((user) => (
            <Card key={user.id} className="user-card">
              <div className="section-head">
                <div>
                  <strong>{user.displayName}</strong>
                  <p>{user.email}</p>
                </div>
                <StatusPill tone={user.active ? "good" : "bad"}>{roleLabels[user.role]} · {user.active ? "active" : "inactive"}</StatusPill>
              </div>
              <div className="user-admin-actions">
                <Field label="Role">
                  <select
                    value={user.role}
                    disabled={isCurrentUser(user, currentUser.email)}
                    onChange={(event) => data.updateAllowedUser(user.id, { role: event.target.value as Role })}
                  >
                    {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                  </select>
                </Field>
                <Button
                  type="button"
                  variant={user.active ? "danger" : "secondary"}
                  disabled={isCurrentUser(user, currentUser.email)}
                  onClick={() => data.updateAllowedUser(user.id, { active: !user.active })}
                >
                  {user.active ? "Deactivate" : "Reactivate"}
                </Button>
                {isCurrentUser(user, currentUser.email) ? <p className="muted small">You cannot change your own owner access here.</p> : null}
              </div>
            </Card>
          ))}
        </div>
      </main>
    </RoleGate>
  );
}

function isCurrentUser(user: { id: string; email: string }, currentEmail: string) {
  return user.email.toLowerCase() === currentEmail.toLowerCase();
}
