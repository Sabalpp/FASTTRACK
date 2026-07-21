import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { jobFromRow, jobPatchToRow, jobToRow } from "@/lib/supabase-mappers";
import type { Job } from "@/lib/types";

const migration = read("supabase/migrations/20260721180000_add_job_en_route.sql");
const schema = read("supabase/schema.sql");

describe("technician en-route persistence contract", () => {
  it("maps a recorded server value into the application job", () => {
    const mapped = jobFromRow({
      id: "job-1",
      customer_id: "customer-1",
      assigned_tech_id: "tech-1",
      status: "scheduled",
      scheduled_at: "2026-07-21T20:30:00.000Z",
      arrival_window_end_at: "2026-07-21T23:30:00.000Z",
      en_route_at: "2026-07-21T20:00:00.000Z",
      arrived_at: null,
      service_address: "123 Main St",
      description: "No cooling upstairs",
      notes: "",
      originating_call_id: null,
      created_at: "2026-07-21T18:00:00.000Z",
      completed_at: null
    });

    expect(mapped.enRouteAt).toBe("2026-07-21T20:00:00.000Z");
  });

  it("keeps en-route server-owned outside generic create and patch payloads", () => {
    const job: Job = {
      id: "job-1",
      customerId: "customer-1",
      assignedTechId: "tech-1",
      status: "scheduled",
      scheduledAt: "2026-07-21T20:30:00.000Z",
      arrivalWindowEndAt: "2026-07-21T23:30:00.000Z",
      enRouteAt: "2026-07-21T20:00:00.000Z",
      serviceAddress: "123 Main St",
      description: "No cooling upstairs",
      notes: "",
      createdAt: "2026-07-21T18:00:00.000Z"
    };

    expect(jobToRow(job)).not.toHaveProperty("en_route_at");
    expect(jobPatchToRow({ enRouteAt: job.enRouteAt })).not.toHaveProperty("en_route_at");
  });

  it("uses a server timestamp, enforces immutability, and restricts the RPC to owner or assigned tech", () => {
    expect(migration).toContain("add column if not exists en_route_at timestamptz");
    expect(migration).toContain("The recorded en-route time is immutable.");
    expect(migration).toContain("new.en_route_at := statement_timestamp()");
    expect(migration).toContain("create or replace function public.mark_job_en_route(p_job_id uuid)");
    expect(migration).toContain("public.jobs.status = 'scheduled'");
    expect(migration).toContain("public.jobs.arrived_at is null");
    expect(migration).toContain("public.jobs.assigned_tech_id = public.current_allowed_user_id()");
    expect(migration).toContain("revoke all on function public.mark_job_en_route(uuid) from public");
    expect(migration).toContain("grant execute on function public.mark_job_en_route(uuid) to authenticated");
  });

  it("keeps the canonical schema aligned with the migration", () => {
    expect(schema).toContain("en_route_at timestamptz,");
    expect(schema).toContain("create or replace function public.protect_job_en_route_at()");
    expect(schema).toContain("create or replace function public.mark_job_en_route(p_job_id uuid)");
    expect(schema).toContain("before insert or update on public.jobs");
  });
});

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}
