import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = read("../supabase/migrations/20260722110000_optional_job_photo_checkpoints.sql");
const types = read("../lib/types.ts");
const mappers = read("../lib/supabase-mappers.ts");
const dataStore = read("../lib/data-store.tsx");
const signatureServer = read("../lib/signature-server.ts");
const completionRoute = read("../app/api/jobs/[id]/complete/route.ts");

describe("optional job photo checkpoints", () => {
  it("persists paired actor-and-time audit fields without exposing them to generic job patches", () => {
    expect(migration).toContain("add column if not exists before_photos_skipped_at timestamptz");
    expect(migration).toContain("add column if not exists before_photos_skipped_by uuid");
    expect(migration).toContain("add column if not exists after_photos_skipped_at timestamptz");
    expect(migration).toContain("add column if not exists after_photos_skipped_by uuid");
    expect(migration).toContain("jobs_before_photo_skip_audit_check");
    expect(migration).toContain("jobs_after_photo_skip_audit_check");
    expect(migration).toContain("job_photos_caption_length_check");
    expect(migration).toContain("char_length(caption) <= 240");
    expect(migration).toContain("references public.allowed_users(id) on delete restrict");
    expect(types).toContain("beforePhotosSkippedAt?: string");
    expect(types).toContain("afterPhotosSkippedBy?: string");
    expect(mappers).toContain("beforePhotosSkippedAt: row.before_photos_skipped_at ?? undefined");
    expect(section(mappers, "export function jobPatchToRow", "export function jobPhotoFromRow")).not.toContain("before_photos_skipped_at");
  });

  it("allows only an active owner or assigned technician on an arrived in-progress job to skip", () => {
    const rpc = section(
      migration,
      "create or replace function public.skip_job_photo_checkpoint",
      "revoke all on function public.skip_job_photo_checkpoint"
    );

    expect(rpc).toContain("actor_role not in ('owner', 'tech')");
    expect(rpc).toContain("target_job.assigned_tech_id is distinct from actor_id");
    expect(rpc).toContain("target_job.status <> 'in_progress' or target_job.arrived_at is null");
    expect(rpc).toMatch(/public\.job_photos[\s\S]+photo\.kind = p_kind/);
    expect(rpc).toContain("signature.purpose = 'work_completion'");
    expect(rpc).toContain("p_kind = 'after' and not exists");
    expect(rpc).toContain("signature.purpose = 'work_authorization'");
    expect(rpc).toContain("return target_job");
    expect(migration).toContain("grant execute on function public.skip_job_photo_checkpoint(uuid, text) to authenticated");
    expect(dataStore).toContain('.rpc("skip_job_photo_checkpoint", { p_job_id: id, p_kind: kind })');
  });

  it("makes a recorded skip immutable and mutually exclusive with a matching photo", () => {
    const jobProtection = section(
      migration,
      "create or replace function public.protect_work_authorization_signed_job_fields()",
      "drop trigger if exists protect_work_authorization_signed_job_fields"
    );
    const photoProtection = section(
      migration,
      "create or replace function public.protect_signed_job_photos()",
      "create or replace function public.protect_work_authorization_signed_job_fields()"
    );

    expect(jobProtection).toContain("fasttrack.internal_photo_checkpoint_skip");
    expect(jobProtection).toContain("The recorded before-photo skip is immutable.");
    expect(jobProtection).toContain("The recorded after-photo skip is immutable.");
    expect(jobProtection).toContain("new.workflow_revision := old.workflow_revision + 1");
    expect(jobProtection).toContain("purpose = 'work_completion'");
    expect(photoProtection).toContain("before_photos_skipped_at is not null");
    expect(photoProtection).toContain("after_photos_skipped_at is not null");
    expect(photoProtection).toContain("cannot be added after that checkpoint was explicitly skipped");
    expect(migration).toContain("before insert or update on public.jobs");
  });

  it("rechecks photo-or-audited-skip at signature collection and atomic completion", () => {
    const recordSignature = section(
      migration,
      "create or replace function public.record_invoice_signature(",
      "revoke all on function public.record_invoice_signature("
    );
    const completion = section(
      migration,
      "create or replace function public.complete_job_with_signature(",
      "revoke all on function public.complete_job_with_signature("
    );
    const completionTrigger = section(
      migration,
      "create or replace function public.enforce_job_completion_signature()"
    );

    for (const source of [recordSignature, completion, completionTrigger]) {
      expect(source).toContain("after_photos_skipped_at is null");
      expect(source).toContain("after_photos_skipped_by is null");
      expect(source).toMatch(/public\.job_photos[\s\S]+kind = 'after'/);
    }
    expect(signatureServer).toContain("job.afterPhotosSkippedAt && job.afterPhotosSkippedBy");
    expect(completionRoute).toContain("job.afterPhotosSkippedAt && job.afterPhotosSkippedBy");
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function section(source: string, start: string, end?: string): string {
  const startIndex = source.lastIndexOf(start);
  expect(startIndex, `Missing section: ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}
