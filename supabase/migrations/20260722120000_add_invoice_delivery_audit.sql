-- Durable invoice delivery fencing. A request UUID can create at most one
-- provider attempt. Processing rows intentionally have no lease or reclaim
-- path because a crash after provider acceptance has an ambiguous outcome.

alter table public.invoices
  add column if not exists pdf_workflow_revision bigint;

create table if not exists public.invoice_delivery_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  channel text not null check (channel in ('email', 'sms')),
  destination_hash text not null check (destination_hash ~ '^[0-9a-f]{64}$'),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  workflow_revision bigint not null check (workflow_revision >= 0),
  status text not null default 'processing'
    check (status in ('processing', 'accepted', 'failed', 'delivery_unknown')),
  claim_token uuid not null unique default gen_random_uuid(),
  provider text check (provider is null or provider in ('resend', 'sendgrid', 'twilio')),
  provider_message_id text check (
    provider_message_id is null
    or (
      char_length(provider_message_id) between 1 and 256
      and provider_message_id ~ '^[a-zA-Z0-9_.:-]+$'
    )
  ),
  provider_status text check (
    provider_status is null
    or (
      char_length(provider_status) between 1 and 80
      and provider_status ~ '^[a-zA-Z0-9_.:-]+$'
    )
  ),
  error_code text check (
    error_code is null
    or (
      char_length(error_code) between 1 and 80
      and error_code ~ '^[a-zA-Z0-9_-]+$'
    )
  ),
  requested_by uuid not null references public.allowed_users(id) on delete restrict,
  claimed_at timestamptz not null default statement_timestamp(),
  accepted_at timestamptz,
  failed_at timestamptz,
  delivery_unknown_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint invoice_delivery_provider_channel_check check (
    provider is null
    or (channel = 'email' and provider in ('resend', 'sendgrid'))
    or (channel = 'sms' and provider = 'twilio')
  ),
  constraint invoice_delivery_outcome_check check (
    (
      status = 'processing'
      and provider is null
      and provider_message_id is null
      and provider_status is null
      and error_code is null
      and accepted_at is null
      and failed_at is null
      and delivery_unknown_at is null
    )
    or (
      status = 'accepted'
      and provider is not null
      and provider_message_id is not null
      and error_code is null
      and accepted_at is not null
      and failed_at is null
      and delivery_unknown_at is null
    )
    or (
      status = 'failed'
      and provider is not null
      and provider_message_id is null
      and error_code is not null
      and accepted_at is null
      and failed_at is not null
      and delivery_unknown_at is null
    )
    or (
      status = 'delivery_unknown'
      and provider is not null
      and provider_message_id is null
      and error_code is not null
      and accepted_at is null
      and failed_at is null
      and delivery_unknown_at is not null
    )
  ),
  constraint invoice_delivery_timestamp_check check (
    claimed_at >= created_at
    and updated_at >= created_at
    and (accepted_at is null or accepted_at >= claimed_at)
    and (failed_at is null or failed_at >= claimed_at)
    and (delivery_unknown_at is null or delivery_unknown_at >= claimed_at)
  )
);

create index if not exists invoice_delivery_audit_invoice_created_idx
  on public.invoice_delivery_audit(invoice_id, created_at desc);

create or replace function public.protect_invoice_delivery_audit()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Invoice delivery audit rows can only be written by the protected server.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Invoice delivery audit rows cannot be deleted.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'processing'
      or new.provider is not null
      or new.provider_message_id is not null
      or new.provider_status is not null
      or new.error_code is not null
      or new.accepted_at is not null
      or new.failed_at is not null
      or new.delivery_unknown_at is not null then
      raise exception 'New invoice delivery claims must begin in processing status.' using errcode = '23514';
    end if;
    new.created_at := statement_timestamp();
    new.claimed_at := new.created_at;
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.request_id is distinct from old.request_id
    or new.invoice_id is distinct from old.invoice_id
    or new.channel is distinct from old.channel
    or new.destination_hash is distinct from old.destination_hash
    or new.pdf_sha256 is distinct from old.pdf_sha256
    or new.workflow_revision is distinct from old.workflow_revision
    or new.claim_token is distinct from old.claim_token
    or new.requested_by is distinct from old.requested_by
    or new.claimed_at is distinct from old.claimed_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Invoice delivery claim identity is immutable.' using errcode = '42501';
  end if;

  if old.status <> 'processing'
    or new.status not in ('accepted', 'failed', 'delivery_unknown') then
    raise exception 'Invoice delivery audit status cannot be retried or rewritten.' using errcode = '42501';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists invoice_delivery_10_protect_audit on public.invoice_delivery_audit;
create trigger invoice_delivery_10_protect_audit
before insert or update or delete on public.invoice_delivery_audit
for each row execute function public.protect_invoice_delivery_audit();

create or replace function public.claim_invoice_delivery(
  p_request_id uuid,
  p_invoice_id uuid,
  p_channel text,
  p_destination_hash text,
  p_pdf_sha256 text,
  p_workflow_revision bigint,
  p_requested_by uuid
)
returns table (
  audit_id uuid,
  decision text,
  delivery_status text,
  completion_token uuid,
  delivery_provider text,
  delivery_provider_message_id text,
  delivery_provider_status text,
  delivery_error_code text,
  claimed_at timestamptz,
  completed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_channel text := lower(trim(coalesce(p_channel, '')));
  normalized_destination_hash text := lower(trim(coalesce(p_destination_hash, '')));
  normalized_pdf_sha256 text := lower(trim(coalesce(p_pdf_sha256, '')));
  invoice_job_id uuid;
  invoice_row public.invoices%rowtype;
  job_row public.jobs%rowtype;
  requested_user public.allowed_users%rowtype;
  audit_row public.invoice_delivery_audit%rowtype;
  claim_decision text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can claim invoice delivery.' using errcode = '42501';
  end if;
  if p_request_id is null or p_invoice_id is null or p_workflow_revision is null or p_requested_by is null then
    raise exception 'Invoice delivery request, invoice, workflow revision, and requester are required.' using errcode = '22004';
  end if;
  if p_workflow_revision < 0 then
    raise exception 'Invoice delivery workflow revision is invalid.' using errcode = '22023';
  end if;
  if normalized_channel not in ('email', 'sms') then
    raise exception 'Invoice delivery channel is invalid.' using errcode = '22023';
  end if;
  if normalized_destination_hash !~ '^[0-9a-f]{64}$'
    or normalized_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invoice delivery hashes are invalid.' using errcode = '22023';
  end if;

  select invoice.job_id into invoice_job_id
  from public.invoices invoice
  where invoice.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  select * into job_row
  from public.jobs job
  where job.id = invoice_job_id
  for share;
  if not found or job_row.workflow_revision is distinct from p_workflow_revision then
    raise exception 'Job evidence changed before invoice delivery was claimed.' using errcode = '40001';
  end if;

  select * into invoice_row
  from public.invoices invoice
  where invoice.id = p_invoice_id
  for share;
  if not found or invoice_row.job_id is distinct from job_row.id then
    raise exception 'Invoice job changed before delivery was claimed.' using errcode = '40001';
  end if;
  if invoice_row.status = 'cancelled' then
    raise exception 'A cancelled invoice cannot be delivered.' using errcode = '42501';
  end if;
  if invoice_row.pdf_storage_path is null
    or invoice_row.pdf_generated_at is null
    or lower(coalesce(invoice_row.pdf_sha256, '')) is distinct from normalized_pdf_sha256
    or invoice_row.pdf_workflow_revision is distinct from p_workflow_revision then
    raise exception 'The signed invoice PDF or workflow revision changed before delivery was claimed.' using errcode = '40001';
  end if;

  select * into requested_user
  from public.allowed_users allowed_user
  where allowed_user.id = p_requested_by
    and allowed_user.active;
  if not found or requested_user.role not in ('owner', 'tech') then
    raise exception 'Requester is not allowed to deliver invoices.' using errcode = '42501';
  end if;

  if requested_user.role <> 'owner' and job_row.assigned_tech_id is distinct from requested_user.id then
    raise exception 'Technicians can only deliver invoices for assigned jobs.' using errcode = '42501';
  end if;

  insert into public.invoice_delivery_audit (
    request_id,
    invoice_id,
    channel,
    destination_hash,
    pdf_sha256,
    workflow_revision,
    status,
    requested_by
  ) values (
    p_request_id,
    p_invoice_id,
    normalized_channel,
    normalized_destination_hash,
    normalized_pdf_sha256,
    p_workflow_revision,
    'processing',
    p_requested_by
  )
  on conflict (request_id) do nothing
  returning * into audit_row;

  if found then
    return query select
      audit_row.id,
      'send'::text,
      audit_row.status,
      audit_row.claim_token,
      audit_row.provider,
      audit_row.provider_message_id,
      audit_row.provider_status,
      audit_row.error_code,
      audit_row.claimed_at,
      null::timestamptz;
    return;
  end if;

  select * into audit_row
  from public.invoice_delivery_audit delivery
  where delivery.request_id = p_request_id
  for update;
  if not found then
    raise exception 'Invoice delivery claim could not be resolved.' using errcode = '40001';
  end if;
  if audit_row.invoice_id is distinct from p_invoice_id
    or audit_row.channel is distinct from normalized_channel
    or audit_row.destination_hash is distinct from normalized_destination_hash
    or audit_row.pdf_sha256 is distinct from normalized_pdf_sha256
    or audit_row.workflow_revision is distinct from p_workflow_revision
    or audit_row.requested_by is distinct from p_requested_by then
    raise exception 'Invoice delivery request ID was already used for different delivery details.' using errcode = '23505';
  end if;

  claim_decision := case audit_row.status
    when 'accepted' then 'already_accepted'
    when 'processing' then 'in_flight'
    when 'failed' then 'already_failed'
    else 'delivery_unknown'
  end;

  return query select
    audit_row.id,
    claim_decision,
    audit_row.status,
    null::uuid,
    audit_row.provider,
    audit_row.provider_message_id,
    audit_row.provider_status,
    audit_row.error_code,
    audit_row.claimed_at,
    coalesce(audit_row.accepted_at, audit_row.failed_at, audit_row.delivery_unknown_at);
end;
$$;

create or replace function public.record_invoice_delivery_result(
  p_request_id uuid,
  p_claim_token uuid,
  p_status text,
  p_provider text,
  p_provider_message_id text default null,
  p_provider_status text default null,
  p_error_code text default null
)
returns public.invoice_delivery_audit
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_status text := lower(trim(coalesce(p_status, '')));
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  normalized_message_id text := nullif(trim(coalesce(p_provider_message_id, '')), '');
  normalized_provider_status text := nullif(trim(coalesce(p_provider_status, '')), '');
  normalized_error_code text := nullif(trim(coalesce(p_error_code, '')), '');
  audit_row public.invoice_delivery_audit%rowtype;
  completed_at timestamptz := statement_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can complete invoice delivery.' using errcode = '42501';
  end if;
  if p_request_id is null or p_claim_token is null then
    raise exception 'Invoice delivery request and completion token are required.' using errcode = '22004';
  end if;
  if normalized_status not in ('accepted', 'failed', 'delivery_unknown') then
    raise exception 'Invoice delivery result status is invalid.' using errcode = '22023';
  end if;
  if normalized_provider not in ('resend', 'sendgrid', 'twilio') then
    raise exception 'Invoice delivery provider is invalid.' using errcode = '22023';
  end if;
  if normalized_message_id is not null and (
    char_length(normalized_message_id) > 256
    or normalized_message_id !~ '^[a-zA-Z0-9_.:-]+$'
  ) then
    raise exception 'Invoice delivery provider message ID is invalid.' using errcode = '22023';
  end if;
  if normalized_provider_status is not null and (
    char_length(normalized_provider_status) > 80
    or normalized_provider_status !~ '^[a-zA-Z0-9_.:-]+$'
  ) then
    raise exception 'Invoice delivery provider status is invalid.' using errcode = '22023';
  end if;
  if normalized_error_code is not null and (
    char_length(normalized_error_code) > 80
    or normalized_error_code !~ '^[a-zA-Z0-9_-]+$'
  ) then
    raise exception 'Invoice delivery error code is invalid.' using errcode = '22023';
  end if;

  select * into audit_row
  from public.invoice_delivery_audit delivery
  where delivery.request_id = p_request_id
  for update;
  if not found then
    raise exception 'Invoice delivery claim not found.' using errcode = 'P0002';
  end if;
  if audit_row.claim_token is distinct from p_claim_token then
    raise exception 'Invoice delivery completion token is stale.' using errcode = '40001';
  end if;
  if (audit_row.channel = 'email' and normalized_provider not in ('resend', 'sendgrid'))
    or (audit_row.channel = 'sms' and normalized_provider <> 'twilio') then
    raise exception 'Invoice delivery provider does not match its channel.' using errcode = '22023';
  end if;
  if normalized_status = 'accepted' and normalized_message_id is null then
    raise exception 'Accepted invoice delivery requires a provider message ID.' using errcode = '22023';
  end if;
  if normalized_status = 'accepted' and normalized_error_code is not null then
    raise exception 'Accepted invoice delivery cannot include an error code.' using errcode = '22023';
  end if;
  if normalized_status in ('failed', 'delivery_unknown')
    and (normalized_message_id is not null or normalized_error_code is null) then
    raise exception 'Failed or unknown invoice delivery requires only a safe error code.' using errcode = '22023';
  end if;

  if audit_row.status <> 'processing' then
    if audit_row.status = normalized_status
      and audit_row.provider = normalized_provider
      and audit_row.provider_message_id is not distinct from normalized_message_id
      and audit_row.provider_status is not distinct from normalized_provider_status
      and audit_row.error_code is not distinct from normalized_error_code then
      return audit_row;
    end if;
    raise exception 'Invoice delivery result was already finalized.' using errcode = '40001';
  end if;

  update public.invoice_delivery_audit delivery
  set status = normalized_status,
      provider = normalized_provider,
      provider_message_id = case when normalized_status = 'accepted' then normalized_message_id else null end,
      provider_status = normalized_provider_status,
      error_code = case when normalized_status = 'accepted' then null else normalized_error_code end,
      accepted_at = case when normalized_status = 'accepted' then completed_at else null end,
      failed_at = case when normalized_status = 'failed' then completed_at else null end,
      delivery_unknown_at = case when normalized_status = 'delivery_unknown' then completed_at else null end
  where delivery.id = audit_row.id
  returning * into audit_row;

  return audit_row;
end;
$$;

alter table public.invoice_delivery_audit enable row level security;

drop policy if exists "owner assigned tech read invoice delivery audit" on public.invoice_delivery_audit;
create policy "owner assigned tech read invoice delivery audit"
on public.invoice_delivery_audit for select to authenticated
using (
  public.is_owner()
  or exists (
    select 1
    from public.invoices invoice
    join public.jobs job on job.id = invoice.job_id
    where invoice.id = invoice_delivery_audit.invoice_id
      and job.assigned_tech_id = public.current_allowed_user_id()
  )
);

drop policy if exists "no direct invoice delivery audit inserts" on public.invoice_delivery_audit;
create policy "no direct invoice delivery audit inserts"
on public.invoice_delivery_audit for insert to authenticated
with check (false);

drop policy if exists "no direct invoice delivery audit updates" on public.invoice_delivery_audit;
create policy "no direct invoice delivery audit updates"
on public.invoice_delivery_audit for update to authenticated
using (false)
with check (false);

drop policy if exists "no direct invoice delivery audit deletes" on public.invoice_delivery_audit;
create policy "no direct invoice delivery audit deletes"
on public.invoice_delivery_audit for delete to authenticated
using (false);

revoke all on table public.invoice_delivery_audit from public, anon, authenticated, service_role;
grant select (
  id,
  request_id,
  invoice_id,
  channel,
  destination_hash,
  pdf_sha256,
  workflow_revision,
  status,
  provider,
  provider_message_id,
  provider_status,
  error_code,
  requested_by,
  claimed_at,
  accepted_at,
  failed_at,
  delivery_unknown_at,
  created_at,
  updated_at
) on table public.invoice_delivery_audit to authenticated;
grant select, insert, update on table public.invoice_delivery_audit to service_role;

revoke all on function public.claim_invoice_delivery(uuid, uuid, text, text, text, bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_invoice_delivery(uuid, uuid, text, text, text, bigint, uuid)
  to service_role;

revoke all on function public.record_invoice_delivery_result(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_invoice_delivery_result(uuid, uuid, text, text, text, text, text)
  to service_role;
