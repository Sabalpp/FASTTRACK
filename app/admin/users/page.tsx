"use client";

import {
  BriefcaseBusiness,
  Headset,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { useAuth } from "@/lib/auth";
import { roleLabels, roleOptions, useAppData } from "@/lib/data-store";
import type { Role } from "@/lib/types";
import styles from "./users.module.css";

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
  const [showAddUser, setShowAddUser] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    role: "tech" as Role,
    active: true
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const displayName = form.displayName.trim();
    const email = form.email.trim().toLowerCase();
    if (!displayName || !email) return;

    data.createAllowedUser({ ...form, displayName, email });
    setForm({ displayName: "", email: "", role: "tech", active: true });
    setShowAddUser(false);
  }

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return data.allowedUsers.filter((user) => {
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const searchable = `${user.displayName} ${user.email} ${roleLabels[user.role]} ${user.active ? "active" : "inactive"}`.toLowerCase();
      return matchesRole && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [data.allowedUsers, query, roleFilter]);

  const activeCount = data.allowedUsers.filter((user) => user.active).length;

  return (
    <RoleGate allowed={["owner"]}>
      <main className={`page-shell ${styles.page}`}>
        <header className={styles.hero}>
          <div>
            <h1>Team access</h1>
            <p className={styles.description}>Control which Google accounts can open Fast Track and what each person is allowed to do.</p>
          </div>
          <button
            type="button"
            className={showAddUser ? styles.closeAction : styles.primaryAction}
            aria-expanded={showAddUser}
            aria-controls="add-user-panel"
            onClick={() => setShowAddUser((current) => !current)}
          >
            {showAddUser ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
            {showAddUser ? "Close" : "Add user"}
          </button>
        </header>

        {showAddUser ? (
          <section id="add-user-panel" className={styles.addPanel} aria-labelledby="add-user-heading">
            <div className={styles.addPanelHeading}>
              <span aria-hidden="true"><UserRound size={20} /></span>
              <div>
                <h2 id="add-user-heading">Add a Google account</h2>
                <p>The person will have access as soon as this email signs in with Google.</p>
              </div>
            </div>
            <form className={styles.addForm} onSubmit={submit}>
              <label>
                <span>Person’s name</span>
                <input
                  required
                  autoComplete="name"
                  value={form.displayName}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="e.g. Carlos Rivera"
                />
              </label>
              <label>
                <span>Google account</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="name@company.com"
                />
              </label>
              <label>
                <span>Role</span>
                <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role }))}>
                  {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                </select>
              </label>
              <button type="submit" className={styles.addSubmit}>Add to team</button>
            </form>
          </section>
        ) : null}

        <section className={styles.accessPanel} aria-labelledby="team-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.sectionLabel}>Google access</p>
              <h2 id="team-heading">People</h2>
              <p>{activeCount} active of {data.allowedUsers.length} total</p>
            </div>
            <span className={styles.resultCount} aria-live="polite">{visibleUsers.length} shown</span>
          </div>

          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              <Search size={17} aria-hidden="true" />
              <span className={styles.srOnly}>Search people</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or Google account"
              />
            </label>
            <label className={styles.filterField}>
              <span>Role</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | "all")}>
                <option value="all">All roles</option>
                {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
            </label>
          </div>

          <div className={styles.userTable} role="table" aria-label="Team access">
            <div className={styles.tableHeader} role="row">
              <span role="columnheader">Person</span>
              <span role="columnheader">Google account</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">Access</span>
            </div>

            {visibleUsers.length === 0 ? (
              <div className={styles.emptyState}>
                <Search size={20} aria-hidden="true" />
                <strong>No people match this search</strong>
                <p>Try another name, email, or role.</p>
              </div>
            ) : visibleUsers.map((user) => {
              const isSelf = isCurrentUser(user, currentUser.email);
              const RoleIcon = roleIcons[user.role];

              return (
                <div key={user.id} className={styles.userRow} role="row">
                  <span className={styles.personCell} role="cell" data-label="Person">
                    <span className={styles.personAvatar} aria-hidden="true"><RoleIcon size={17} /></span>
                    <span>
                      <strong>{user.displayName}</strong>
                      <small>{isSelf ? "You · signed-in owner" : roleLabels[user.role]}</small>
                    </span>
                  </span>

                  <span className={styles.accountCell} role="cell" data-label="Google account">{user.email}</span>

                  <label className={styles.roleCell} data-label="Role">
                    <span className={styles.srOnly}>Role for {user.displayName}</span>
                    <select
                      value={user.role}
                      disabled={isSelf}
                      aria-label={`Role for ${user.displayName}`}
                      onChange={(event) => data.updateAllowedUser(user.id, { role: event.target.value as Role })}
                    >
                      {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                    </select>
                  </label>

                  <span className={styles.accessCell} role="cell" data-label="Access">
                    <button
                      type="button"
                      role="switch"
                      aria-label={`${user.active ? "Deactivate" : "Activate"} access for ${user.displayName}`}
                      aria-checked={user.active}
                      className={`${styles.accessSwitch} ${user.active ? styles.accessOn : styles.accessOff}`}
                      disabled={isSelf}
                      title={isSelf ? "Your signed-in owner access is protected" : undefined}
                      onClick={() => data.updateAllowedUser(user.id, { active: !user.active })}
                    >
                      <span className={styles.switchTrack} aria-hidden="true"><span /></span>
                      <span>{user.active ? "Active" : "Inactive"}</span>
                    </button>
                    {isSelf ? <small>Protected</small> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </RoleGate>
  );
}

function isCurrentUser(user: { id: string; email: string }, currentEmail: string) {
  return user.email.toLowerCase() === currentEmail.toLowerCase();
}
