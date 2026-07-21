import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = read("../supabase/migrations/20260721023000_add_job_confirmation_outbox.sql");
const canonicalSchema = read("../supabase/schema.sql");

describe("appointment notification database foundation", () => {
  it("repairs formatted phone normalization and recomputes stored phone keys", () => {
    expect(migration).toContain("create or replace function public.normalize_us_phone(input text)");
    expect(migration).toContain("regexp_replace(coalesce(input, ''), '[^0-9]', '', 'g')");
    expect(migration).toContain("update public.customers\nset phone = phone;");
    expect(migration).toContain("update public.call_logs\nset caller_phone = caller_phone;");
  });

  it("adds explicit customer email and SMS consent controls", () => {
    expect(migration).toContain("email_notifications_enabled boolean not null default true");
    expect(migration).toContain("sms_consent_status text not null default 'unknown'");
    expect(migration).toContain("sms_consent_status in ('unknown', 'opted_in', 'opted_out')");
    expect(migration).toContain("sms_consent_at timestamptz");
    expect(migration).toContain("sms_consent_source text");
    expect(migration).toContain("sms_consent_phone_digits text");
    expect(migration).toContain("customers_sms_consent_audit_check");
    expect(migration).toContain("sms_consent_status = 'unknown'");
    expect(migration).toContain("sms_consent_status in ('opted_in', 'opted_out')");
    expect(migration).toContain("sms_consent_at is not null");
    expect(migration).toContain("nullif(trim(coalesce(sms_consent_source, '')), '') is not null");
    expect(migration).toContain("char_length(trim(sms_consent_source)) <= 120");
    expect(migration).toContain("sms_consent_phone_digits is not null");
    expect(migration).toContain("create or replace function public.enforce_customer_sms_consent_timestamp()");
    expect(migration).toContain(
      "before insert or update of phone, sms_consent_status, sms_consent_at, sms_consent_source, sms_consent_phone_digits"
    );
    expect(migration).toContain("new.phone is distinct from old.phone");
    expect(migration).toContain("new.sms_consent_status := 'unknown'");
    expect(migration).toContain("new.sms_consent_at := statement_timestamp()");
    expect(migration).toContain("new.sms_consent_at := null");
    expect(migration).toContain("new.sms_consent_at := old.sms_consent_at");
    expect(migration).toContain("new.sms_consent_source := old.sms_consent_source");
  });

  it("records append-only SMS consent and opt-out history with server attribution", () => {
    expect(migration).toContain("create table if not exists public.customer_sms_consent_events");
    expect(migration).toContain("customer_id uuid not null references public.customers(id) on delete cascade");
    expect(migration).toContain("phone_digits text not null");
    expect(migration).toContain("occurred_at timestamptz not null default statement_timestamp()");
    expect(migration).toContain("recorded_at timestamptz not null default statement_timestamp()");
    expect(migration).toContain("recorded_by uuid references public.allowed_users(id) on delete set null");
    expect(migration).toContain("create or replace function public.record_customer_sms_consent_event()");
    expect(migration).toContain("public.current_allowed_user_id()");
    expect(migration).toContain("after insert on public.customers");
    expect(migration).toContain("after update of phone, sms_consent_status on public.customers");
    expect(migration).toContain("new.sms_consent_status is not distinct from old.sms_consent_status");
    expect(migration).toContain("'migration_baseline'");
    expect(migration).toContain(
      "revoke all on table public.customer_sms_consent_events from public, anon, authenticated, service_role"
    );
    expect(migration).toContain("grant select on table public.customer_sms_consent_events to authenticated");
    expect(migration).toContain("grant select on table public.customer_sms_consent_events to service_role");
    expect(migration).toContain("using (public.is_owner() or public.is_call_center())");
    expect(migration).not.toContain("grant insert on table public.customer_sms_consent_events");
    expect(migration).not.toContain("grant update on table public.customer_sms_consent_events");
    expect(migration).not.toContain("grant delete on table public.customer_sms_consent_events");
  });

  it("accepts verified provider consent changes only through the service role", () => {
    expect(migration).toContain("create or replace function public.record_customer_sms_consent_from_provider(");
    expect(migration).toContain("returns table(updated_customer_id uuid)");
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("if not coalesce(");
    expect(migration).toContain("p_status = 'opted_in' and p_source = 'twilio_start'");
    expect(migration).toContain("p_status = 'opted_out' and p_source in ('twilio_stop', 'twilio_error_21610')");
    expect(migration).toContain("Twilio START phone matches more than one customer.");
    expect(migration).toContain("customer.phone_digits = normalized_phone_digits");
    expect(migration).toContain(
      "revoke all on function public.record_customer_sms_consent_from_provider(text, text, text, uuid) from public, anon, authenticated"
    );
    expect(migration).toContain(
      "grant execute on function public.record_customer_sms_consent_from_provider(text, text, text, uuid) to service_role"
    );
  });

  it("keeps the persisted row contract aligned with the app mapper", () => {
    for (const column of [
      "job_revision bigint",
      "destination text",
      "customer_name text",
      "scheduled_start_at timestamptz",
      "scheduled_end_at timestamptz",
      "service_address text",
      "message_subject text",
      "message_body text",
      "idempotency_key text",
      "error_message text",
      "queued_at timestamptz",
      "processing_at timestamptz",
      "created_by uuid",
      "provider_status text",
      "provider_error_code text",
      "provider_status_at timestamptz",
      "claim_token uuid"
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("status in ('queued', 'processing', 'accepted', 'failed', 'suppressed', 'cancelled')");
  });

  it("creates deterministic revisioned automatic events and idempotent manual requests", () => {
    expect(migration).toContain("create table if not exists public.job_notification_state");
    expect(migration).toContain("set revision = notification_state.revision + 1");
    expect(migration).toContain("appointment_notifications_auto_event_unique");
    expect(migration).toContain("(job_id, job_revision, event_type, channel)");
    expect(migration).toContain("appointment_notifications_manual_request_unique");
    expect(migration).toContain("(created_by, manual_request_id, channel)");
    expect(migration).toContain("Wait 30 seconds before requesting another manual confirmation.");
    expect(migration).toContain("recent_request_count >= 10");
    expect(migration).toContain("p_requested_by uuid");
    expect(migration).toContain("Requested sender must be an active owner or call-center user.");
    expect(migration).toContain("'auto:' || job_row.id::text || ':' || p_revision::text");
    expect(migration).toContain("'manual:' || p_requested_by::text || ':' || p_manual_request_id::text");
  });

  it("only reacts to customer-visible scheduling changes and cancellation", () => {
    const triggerSection = section(
      migration,
      "create or replace function public.enqueue_job_confirmation_event()",
      "create or replace function public.queue_manual_job_confirmations"
    );

    expect(triggerSection).toContain("event_name := 'confirmation'");
    expect(triggerSection).toContain("event_name := 'cancellation'");
    expect(triggerSection).toContain("event_name := 'reschedule'");
    expect(triggerSection).toContain(
      "after update of scheduled_at, arrival_window_end_at, service_address, status on public.jobs"
    );
    expect(triggerSection).not.toContain("assigned_tech_id");
    expect(triggerSection).not.toContain("arrived_at");
    expect(triggerSection).not.toContain("new.notes");
  });

  it("records both channels while suppressing unsafe destinations", () => {
    expect(migration).toContain("array['email'::text, 'sms'::text]");
    expect(migration).toContain("email_notifications_disabled");
    expect(migration).toContain("email_missing");
    expect(migration).toContain("email_invalid");
    expect(migration).toContain("customer_row.sms_consent_status <> 'opted_in'");
    expect(migration).toContain("customer_row.sms_consent_phone_digits is distinct from phone_digits");
    expect(migration).toContain("sms_phone_invalid");
    expect(migration).toContain("delivery_status := 'suppressed'");
    expect(migration).toContain("Service duration is separate from the arrival window.");
    expect(migration).toContain("If we expect to arrive after the window, Fast Track will contact you.");
    expect(migration).toContain("Reply STOP to opt out.");
  });

  it("exposes only guarded RPC writes and atomic row claims", () => {
    const queueSection = section(
      migration,
      "create or replace function public.queue_manual_job_confirmations(",
      "create or replace function public.claim_job_confirmations("
    );
    const claimSection = lastSection(
      migration,
      "create or replace function public.claim_job_confirmations(",
      "drop function if exists public.complete_job_confirmation"
    );
    const completeSection = section(
      migration,
      "create or replace function public.complete_job_confirmation(",
      "alter table public.customer_sms_consent_events enable row level security"
    );

    expect(queueSection).toContain("p_requested_by uuid");
    expect(queueSection).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(claimSection).toContain("Only the service role can claim appointment confirmations.");
    expect(claimSection).toContain("for update of notification skip locked");
    expect(claimSection).toContain("claim_token = gen_random_uuid()");
    expect(claimSection).toContain("notification_expired");
    expect(claimSection).toContain("row_number() over");
    expect(claimSection).toContain("partition by notification.channel");
    expect(claimSection).toContain(
      "notification.status in ('queued', 'processing', 'accepted', 'failed', 'suppressed', 'cancelled')"
    );
    expect(claimSection).toContain("notification.last_error_code = 'provider_temporary_failure'");
    expect(claimSection).not.toContain("last_error_code is distinct from 'provider_permanent_failure'");
    expect(completeSection).toContain("p_claim_token uuid");
    expect(completeSection).toContain("notification_row.claim_token is distinct from p_claim_token");
    expect(completeSection).toContain("'sms_delivery_state_unknown'");
    expect(completeSection).toContain("p_message_subject is distinct from notification_row.message_subject");
    expect(completeSection).toContain("p_message_body is distinct from notification_row.message_body");
    expect(completeSection).toContain("sms_consent_source = 'twilio_error_21610'");
    expect(completeSection).toContain("customer.sms_consent_phone_digits = customer.phone_digits");
    expect(completeSection).toContain("available_at = case");
    expect(completeSection).toContain(
      "accepted_at = case when p_status = 'accepted' then statement_timestamp() else null end"
    );
    expect(completeSection).toContain(
      "failed_at = case when p_status = 'failed' then statement_timestamp() else null end"
    );
    expect(migration).not.toMatch(/https?:\/\//);

    const queueServiceGrant = "grant execute on function public.queue_manual_job_confirmations(uuid, uuid, uuid) to service_role;";
    const claimServiceGrant = "grant execute on function public.claim_job_confirmations(uuid, boolean) to service_role;";
    const completeServiceGrant = "grant execute on function public.complete_job_confirmation(uuid, uuid, text, text, text, text, text, text, text) to service_role;";
    expect(migration.split(queueServiceGrant)).toHaveLength(2);
    expect(migration.split(claimServiceGrant)).toHaveLength(2);
    expect(migration.split(completeServiceGrant)).toHaveLength(2);
    expect(migration).not.toMatch(/grant execute on function public\.(queue_manual_job_confirmations|claim_job_confirmations|complete_job_confirmation).*to authenticated/);
  });

  it("uses a locked-down Twilio replay inbox with database-clock processing", () => {
    expect(migration).toContain("create table if not exists public.twilio_webhook_events");
    expect(migration).toContain("event_key text not null unique");
    expect(migration).toContain("received_at timestamptz not null default statement_timestamp()");
    expect(migration).toContain("processed_at is null or processed_at >= received_at");
    expect(migration).toContain("create or replace function public.mark_twilio_webhook_event_processed(");
    expect(migration).toContain("set processed_at = statement_timestamp()");
    expect(migration).toContain("grant select, insert, update on table public.twilio_webhook_events to service_role");
    expect(migration).not.toContain("grant select on table public.twilio_webhook_events to authenticated");
  });

  it("protects technician workflow fields and server-owned completion time", () => {
    const workflowSection = lastSection(
      migration,
      "create or replace function public.protect_job_workflow_fields()",
      "create or replace function public.render_job_confirmation_subject("
    );
    expect(workflowSection).toContain("new.service_address is distinct from old.service_address");
    expect(workflowSection).toContain("old.status = 'in_progress'");
    expect(workflowSection).toContain("old.arrived_at is not null");
    expect(workflowSection).toContain("new.completed_at := statement_timestamp()");
    expect(workflowSection).toContain("Call center users cannot change job workflow status.");
  });

  it("renders timezone-explicit same-day and cross-day service windows", () => {
    expect(migration).toContain("set timezone = 'America/New_York'");
    expect(migration).toContain("if start_date = end_date then");
    expect(migration).toContain("FMHH12:MI AM TZ");
    expect(migration).toContain("to_char(p_window_end_at, 'Dy, Mon FMDD, YYYY \"at\" FMHH12:MI AM TZ')");
  });

  it("allows authenticated reads through RLS but denies direct writes", () => {
    expect(migration).toContain("alter table public.appointment_notifications enable row level security");
    expect(migration).toContain("permitted users read appointment notifications");
    expect(migration).toContain("job.assigned_tech_id = public.current_allowed_user_id()");
    expect(migration).toContain("revoke all on table public.appointment_notifications from public, anon, authenticated");
    expect(migration).toContain("grant select on table public.appointment_notifications to authenticated");
    expect(migration).not.toContain("grant insert on table public.appointment_notifications to authenticated");
    expect(migration).not.toContain("grant update on table public.appointment_notifications to authenticated");
  });

  it("keeps the canonical schema synchronized", () => {
    for (const contract of [
      "create table if not exists public.job_notification_state",
      "create table if not exists public.appointment_notifications",
      "create table if not exists public.customer_sms_consent_events",
      "create table if not exists public.twilio_webhook_events",
      "create or replace function public.enforce_customer_sms_consent_timestamp",
      "create or replace function public.record_customer_sms_consent_from_provider",
      "create or replace function public.queue_manual_job_confirmations",
      "create or replace function public.claim_job_confirmations",
      "create or replace function public.complete_job_confirmation",
      "after update of scheduled_at, arrival_window_end_at, service_address, status on public.jobs"
    ]) {
      expect(canonicalSchema).toContain(contract);
    }
    expect(canonicalSchema.endsWith(migration)).toBe(true);
  });
});

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function lastSection(source: string, start: string, end: string): string {
  const startIndex = source.lastIndexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
