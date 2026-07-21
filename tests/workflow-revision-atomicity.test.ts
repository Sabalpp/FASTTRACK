import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = read("../supabase/migrations/20260721220000_add_two_signature_workflow.sql");
const signatureServer = read("../lib/signature-server.ts");
const types = read("../lib/types.ts");
const mappers = read("../lib/supabase-mappers.ts");

describe("field-work signature revision serialization", () => {
  it("adds and maps a monotonic workflow revision", () => {
    expect(migration).toMatch(/add column if not exists workflow_revision bigint not null default 0/i);
    expect(types).toContain("workflowRevision?: number");
    expect(mappers).toContain("workflow_revision?: string | number | null");
    expect(mappers).toContain("workflowRevision: Number(row.workflow_revision ?? 0)");
  });

  it("locks the parent job and bumps its revision for every line-item mutation", () => {
    const protection = section(
      "create or replace function public.protect_signed_invoice_line_items()",
      "create or replace function public.protect_signed_job_photos()"
    );

    expect(protection).toMatch(/from public\.jobs job[\s\S]+order by job\.id[\s\S]+for update/i);
    expect(protection).toMatch(/set workflow_revision = job\.workflow_revision \+ 1/i);
    expect(protection).toContain("case when tg_op = 'DELETE' then old else new end");
  });

  it("serializes inserts, updates, and deletes of job photos through the same parent lock", () => {
    const protection = section(
      "create or replace function public.protect_signed_job_photos()",
      "create or replace function public.protect_work_authorization_signed_job_fields()"
    );

    expect(protection).toContain("before insert or update or delete on public.job_photos");
    expect(protection).toMatch(/from public\.jobs job[\s\S]+order by job\.id[\s\S]+for update/i);
    expect(protection).toMatch(/set workflow_revision = job\.workflow_revision \+ 1/i);
    expect(protection).toContain("case when tg_op = 'DELETE' then old else new end");
  });

  it("increments the revision for authorization-bound job fields and keeps it server-managed", () => {
    const protection = section(
      "create or replace function public.protect_work_authorization_signed_job_fields()",
      "drop trigger if exists protect_work_authorization_signed_job_fields"
    );

    expect(protection).toContain("authorization_bound_fields_changed");
    expect(protection).toContain("new.workflow_revision := old.workflow_revision + 1");
    expect(protection).toContain("The workflow revision is server managed.");
  });

  it("passes the observed revision and atomically rejects stale signatures", () => {
    const recordSignature = section(
      "create or replace function public.record_invoice_signature(",
      "revoke all on function public.record_invoice_signature("
    );

    expect(signatureServer).toContain("p_expected_workflow_revision: signatureTarget.workflowRevision");
    expect(recordSignature).toContain("p_expected_workflow_revision bigint");
    expect(recordSignature).toMatch(/from public\.jobs[\s\S]+for update/i);
    expect(recordSignature).toContain("target_job.workflow_revision is distinct from p_expected_workflow_revision");
    expect(recordSignature).toContain("errcode = '40001'");
  });

  it("lets only the assigned technician reopen active authorization while owners retain all other rejection authority", () => {
    const rejection = section(
      "create or replace function public.reject_invoice_signature(",
      "create or replace function public.complete_job_with_signature("
    );

    expect(signatureServer).toContain('existing.purpose === "work_authorization"');
    expect(signatureServer).toContain("targetJob.assignedTechId === actor.user.id");
    expect(rejection).toContain("target_signature.purpose = 'work_authorization'");
    expect(rejection).toContain("target_job.assigned_tech_id = rejecting_user.id");
    expect(rejection).toContain("target_job.status not in ('complete', 'cancelled')");
    expect(rejection).toContain("rejecting_user.role <> 'owner'");
    expect(rejection).toMatch(/from public\.jobs[\s\S]+for update/i);
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function section(start: string, end: string): string {
  const startIndex = migration.lastIndexOf(start);
  expect(startIndex, `Missing section: ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  return migration.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}
