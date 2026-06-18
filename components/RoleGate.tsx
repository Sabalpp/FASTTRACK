"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { Card } from "@/components/ui";

export function RoleGate({ allowed, children }: { allowed: Role[]; children: React.ReactNode }) {
  const { currentUser } = useAuth();
  if (allowed.includes(currentUser.role)) return <>{children}</>;
  return (
    <main className="page-shell">
      <Card>
        <p className="eyebrow">Access limited</p>
        <h1>This screen is not available for {currentUser.displayName}.</h1>
        <p className="muted">This role does not have access to this workflow.</p>
        <Link href="/dashboard" className="button">Back home</Link>
      </Card>
    </main>
  );
}
