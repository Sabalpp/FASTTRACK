"use client";

import Link from "next/link";
import { RoleGate } from "@/components/RoleGate";
import { useAppData } from "@/lib/data-store";
import { money } from "@/lib/money";
import { ButtonLink, EmptyState, PageHeader, StatusPill } from "@/components/ui";

export default function PartsPage() {
  const data = useAppData();

  return (
    <RoleGate allowed={["owner"]}>
      <main className="page-shell">
        <PageHeader
          eyebrow="Owner only"
          title="Parts catalog"
          action={<ButtonLink href="/parts/new">Add part</ButtonLink>}
        />
        <div className="record-list">
          {data.parts.length === 0 ? (
            <EmptyState title="No parts yet" description="Add diagnostic, labor, HVAC, and plumbing items." />
          ) : (
            data.parts.map((part) => (
              <Link key={part.id} href="/parts" className="record-row part-row">
                <div className="record-main">
                  <strong>{part.name}</strong>
                  <span>{part.category}</span>
                </div>
                <div className="record-meta">
                  <span>{money(part.defaultPrice)} / {part.unit}</span>
                  <small>{part.sku ?? "No SKU"}</small>
                </div>
                <div className="record-side">
                  <StatusPill tone={part.active ? "good" : "neutral"}>{part.active ? "active" : "inactive"}</StatusPill>
                </div>
              </Link>
            ))
          )}
        </div>
      </main>
    </RoleGate>
  );
}
