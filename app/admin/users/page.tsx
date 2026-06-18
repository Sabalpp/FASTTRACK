"use client";

import { BriefcaseBusiness, Headset, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { Button, Card, Field, PageHeader, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { roleLabels, roleOptions, useAppData } from "@/lib/data-store";
import type { Role } from "@/lib/types";

const roleIcons = {
  owner: ShieldCheck,
  tech: BriefcaseBusiness,
  call_center: Headset
};

export default function AdminUsersPage() {
  const data = useAppData();
  const { currentUser } = useAuth();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
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

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return data.allowedUsers.filter((user) => {
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const searchable = `${user.displayName} ${user.email} ${roleLabels[user.role]} ${user.active ? "active" : "inactive"}`.toLowerCase();
      return matchesRole && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [data.allowedUsers, query, roleFilter]);

  return (
    <RoleGate allowed={["owner"]}>
      <main className="page-shell users-page">
        <PageHeader eyebrow="Owner only" title="Users" description="Control which Google accounts can access the app and what role they receive." />
        <section className="user-role-summary-grid" aria-label="Active users by role">
          {roleOptions.map((role) => {
            const Icon = roleIcons[role];
            return (
              <Card key={role} className="user-role-card">
                <div className="user-role-card-head">
                  <p className="eyebrow">{roleLabels[role]}</p>
                  <span aria-hidden="true">
                    <Icon size={20} />
                  </span>
                </div>
                <h2>{data.allowedUsers.filter((user) => user.role === role && user.active).length}</h2>
                <p className="muted">Active users</p>
              </Card>
            );
          })}
        </section>
        <Card className="add-user-card">
          <p className="eyebrow">Add user</p>
          <form className="add-user-form" onSubmit={submit}>
            <Field label="Display name"><input required value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></Field>
            <Field label="Email"><input required type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></Field>
            <Field label="Role">
              <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role }))}>
                {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
            </Field>
            <Button type="submit">Add to allowlist</Button>
          </form>
        </Card>
        <Card className="access-management-card">
          <div className="section-head access-management-head">
            <div>
              <p className="eyebrow">Allowlist</p>
              <h2>Team access</h2>
            </div>
            <span className="muted small">{visibleUsers.length} shown</span>
          </div>
          <div className="access-toolbar">
            <label className="user-search-field">
              <span>Search users</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, role, status" />
            </label>
            <div className="role-filter-tabs" aria-label="Filter users by role">
              <button type="button" className={roleFilter === "all" ? "active" : ""} onClick={() => setRoleFilter("all")}>All</button>
              {roleOptions.map((role) => (
                <button key={role} type="button" className={roleFilter === role ? "active" : ""} onClick={() => setRoleFilter(role)}>
                  {roleLabels[role]}
                </button>
              ))}
            </div>
          </div>
          <div className="user-access-list" aria-label="Allowed users">
            {visibleUsers.length === 0 ? (
              <div className="user-access-empty">No users match this filter.</div>
            ) : visibleUsers.map((user) => {
              const isSelf = isCurrentUser(user, currentUser.email);

              return (
                <div key={user.id} className="user-access-row">
                  <div className="user-access-identity">
                    <strong>{user.displayName}</strong>
                    <span>{user.email}</span>
                    {isSelf ? <small>Current signed-in owner</small> : null}
                  </div>
                  <label className="field compact-user-role">
                    <span>Role</span>
                    <select
                      value={user.role}
                      disabled={isSelf}
                      onChange={(event) => data.updateAllowedUser(user.id, { role: event.target.value as Role })}
                    >
                      {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                    </select>
                  </label>
                  <div className="user-access-status">
                    <StatusPill tone={user.active ? "good" : "bad"}>{user.active ? "Active" : "Inactive"}</StatusPill>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={user.active}
                      className={`access-toggle ${user.active ? "on" : ""}`}
                      disabled={isSelf}
                      onClick={() => data.updateAllowedUser(user.id, { active: !user.active })}
                    >
                      <span aria-hidden="true" />
                      {user.active ? "On" : "Off"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </main>
    </RoleGate>
  );
}

function isCurrentUser(user: { id: string; email: string }, currentEmail: string) {
  return user.email.toLowerCase() === currentEmail.toLowerCase();
}
