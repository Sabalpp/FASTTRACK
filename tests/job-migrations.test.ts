import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const additiveMigration = read("../supabase/migrations/20260720235000_add_job_arrival_windows.sql");
const protectionMigration = read("../supabase/migrations/20260720235500_protect_job_arrival_workflow.sql");
const canonicalSchema = read("../supabase/schema.sql");

describe("arrival-window database rollout", () => {
  it("keeps the first migration additive and installs the server-time arrival RPC", () => {
    expect(additiveMigration).toContain("add column if not exists arrival_window_end_at timestamptz");
    expect(additiveMigration).toContain("create or replace function public.mark_job_arrived");
    expect(additiveMigration).toContain("statement_timestamp()");
    expect(additiveMigration).not.toContain("protect_job_workflow_fields");
  });

  it("installs insert/update protections only in the post-deploy migration", () => {
    expect(protectionMigration).toContain("before insert or update on public.jobs");
    expect(protectionMigration).toContain("The recorded arrival time is immutable.");
    expect(protectionMigration).toContain("Dispatch fields are locked after arrival is recorded.");
    expect(protectionMigration).toContain("old.arrival_window_end_at + (new.scheduled_at - old.scheduled_at)");
  });

  it("keeps the canonical schema aligned with the final migrated contract", () => {
    expect(canonicalSchema).toContain("arrival_window_end_at timestamptz,");
    expect(canonicalSchema).toContain("arrival_window_end_at is null or arrival_window_end_at > scheduled_at");
    expect(canonicalSchema).toContain("create or replace function public.mark_job_arrived");
    expect(canonicalSchema).toContain("before insert or update on public.jobs");
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
