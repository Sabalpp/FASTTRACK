"use client";

import { PackageOpen } from "lucide-react";
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
            <div className="part-card-grid">
              {data.parts.map((part) => (
                <article key={part.id} className="part-card">
                  <div className="part-thumb" aria-hidden="true">
                    <PackageOpen size={24} />
                  </div>
                  <div className="part-card-main">
                    <div>
                      <strong>{part.name}</strong>
                      <span>{part.category}</span>
                    </div>
                    <StatusPill tone={part.active ? "good" : "neutral"}>{part.active ? "active" : "inactive"}</StatusPill>
                  </div>
                  <div className="part-card-meta">
                    <span>{money(part.defaultPrice)} / {part.unit}</span>
                    <small>{part.sku ?? "No SKU"}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </RoleGate>
  );
}
