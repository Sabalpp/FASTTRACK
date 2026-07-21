-- Phase 4: server-owned invoice totals, private signatures, PDF audit metadata,
-- and customer approval before job completion.

alter table public.invoices
  add column if not exists option_label text not null default 'approved_work',
  add column if not exists notes text not null default '',
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists amount_paid numeric(10,2) not null default 0,
  add column if not exists approval_status text not null default 'not_signed',
  add column if not exists approved_at timestamptz,
  add column if not exists pdf_version integer not null default 0,
  add column if not exists pdf_generated_at timestamptz,
  add column if not exists pdf_sha256 text,
  add column if not exists pdf_size_bytes integer,
  add column if not exists updated_at timestamptz not null default now();

alter table public.jobs
  add column if not exists completion_signature_override_at timestamptz,
  add column if not exists completion_signature_override_by uuid references public.allowed_users(id) on delete set null,
  add column if not exists completion_signature_override_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_option_label_check'
  ) then
    alter table public.invoices add constraint invoices_option_label_check
      check (option_label in ('standard_service', 'approved_work', 'selected_option', 'custom_estimate'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'invoices_payment_status_check'
  ) then
    alter table public.invoices add constraint invoices_payment_status_check
      check (payment_status in ('unpaid', 'partially_paid', 'paid', 'refunded', 'void'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'invoices_amount_paid_check'
  ) then
    alter table public.invoices add constraint invoices_amount_paid_check
      check (amount_paid >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'invoices_approval_status_check'
  ) then
    alter table public.invoices add constraint invoices_approval_status_check
      check (approval_status in ('not_signed', 'signed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'invoices_pdf_sha256_check'
  ) then
    alter table public.invoices add constraint invoices_pdf_sha256_check
      check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end
$$;

create table if not exists public.invoice_signatures (
  id uuid primary key,
  invoice_id uuid references public.invoices(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  purpose text not null check (purpose in ('invoice_approval', 'work_completion', 'technician_acknowledgement')),
  signer_name text not null check (char_length(trim(signer_name)) between 2 and 120),
  signer_role text not null check (signer_role in ('customer', 'technician', 'company')),
  status text not null default 'active' check (status in ('active', 'rejected')),
  storage_path text not null unique,
  mime_type text not null default 'image/png' check (mime_type = 'image/png'),
  width integer not null check (width between 200 and 4096),
  height integer not null check (height between 100 and 2048),
  byte_size integer not null check (byte_size between 256 and 1048576),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null,
  collected_by uuid not null references public.allowed_users(id) on delete restrict,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  rejected_at timestamptz,
  rejected_by uuid references public.allowed_users(id) on delete set null,
  rejection_reason text,
  constraint invoice_signature_target_check check (
    (purpose = 'work_completion') or invoice_id is not null
  ),
  constraint invoice_signature_role_check check (
    (purpose in ('invoice_approval', 'work_completion') and signer_role = 'customer')
    or (purpose = 'technician_acknowledgement' and signer_role in ('technician', 'company'))
  )
);

create index if not exists invoice_signatures_invoice_id_idx
  on public.invoice_signatures(invoice_id, created_at desc);
create index if not exists invoice_signatures_job_id_idx
  on public.invoice_signatures(job_id, created_at desc);
create unique index if not exists invoice_signatures_active_invoice_purpose_idx
  on public.invoice_signatures(invoice_id, purpose)
  where status = 'active' and invoice_id is not null;
create unique index if not exists invoice_signatures_active_completion_idx
  on public.invoice_signatures(job_id, purpose)
  where status = 'active' and purpose = 'work_completion';

alter table public.invoice_signatures enable row level security;

revoke insert, update, delete on public.invoice_signatures from anon, authenticated;
grant select on public.invoice_signatures to authenticated;

drop policy if exists "owner or assigned tech reads invoice signatures" on public.invoice_signatures;
create policy "owner or assigned tech reads invoice signatures"
on public.invoice_signatures for select to authenticated
using (
  public.is_owner()
  or exists (
    select 1
    from public.jobs j
    where j.id = invoice_signatures.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);

create or replace function public.recalculate_invoice_amounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_total numeric(10,2);
begin
  select
    coalesce(sum(quantity * unit_price) filter (where tier = 'good'), 0),
    coalesce(sum(quantity * unit_price) filter (where tier = 'better'), 0),
    coalesce(sum(quantity * unit_price) filter (where tier = 'best'), 0)
  into new.subtotal_good, new.subtotal_better, new.subtotal_best
  from public.job_line_items
  where job_id = new.job_id;

  new.subtotal_good := round(new.subtotal_good, 2);
  new.subtotal_better := round(new.subtotal_better, 2);
  new.subtotal_best := round(new.subtotal_best, 2);
  new.total_good := round(new.subtotal_good * (1 + new.tax_rate), 2);
  new.total_better := round(new.subtotal_better * (1 + new.tax_rate), 2);
  new.total_best := round(new.subtotal_best * (1 + new.tax_rate), 2);
  new.updated_at := statement_timestamp();

  selected_total := case new.selected_tier
    when 'good' then new.total_good
    when 'better' then new.total_better
    when 'best' then new.total_best
    else null
  end;

  if selected_total is not null and new.amount_paid > selected_total then
    raise exception 'Amount paid cannot exceed the selected invoice total.' using errcode = '22003';
  end if;

  if new.payment_status = 'unpaid' and new.amount_paid <> 0 then
    raise exception 'An unpaid invoice must have an amount paid of zero.' using errcode = '23514';
  end if;
  if new.payment_status = 'partially_paid' and (new.amount_paid <= 0 or selected_total is null or new.amount_paid >= selected_total) then
    raise exception 'A partially paid invoice requires an amount between zero and the selected total.' using errcode = '23514';
  end if;
  if new.payment_status = 'paid' and (selected_total is null or new.amount_paid <> selected_total) then
    raise exception 'A paid invoice amount must match the selected total.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.protect_invoice_server_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_role_request boolean := coalesce(auth.role(), '') = 'service_role';
  internal_total_sync boolean := coalesce(current_setting('fasttrack.invoice_total_sync', true), '') = 'on';
begin
  if not service_role_request and not internal_total_sync then
    raise exception 'Invoices must be changed through the protected invoice workflow.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.invoice_signatures s
    where s.invoice_id = old.id
      and s.purpose = 'invoice_approval'
      and s.status = 'active'
  ) and (
    new.job_id is distinct from old.job_id
    or new.selected_tier is distinct from old.selected_tier
    or new.option_label is distinct from old.option_label
    or new.notes is distinct from old.notes
    or new.tax_rate is distinct from old.tax_rate
  ) then
    raise exception 'Reject the saved customer approval before changing signed invoice content.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_10_protect_server_fields on public.invoices;
create trigger invoice_10_protect_server_fields
before insert or update on public.invoices
for each row execute function public.protect_invoice_server_fields();

drop trigger if exists invoice_20_recalculate_amounts on public.invoices;
create trigger invoice_20_recalculate_amounts
before insert or update on public.invoices
for each row execute function public.recalculate_invoice_amounts();

create or replace function public.protect_signed_invoice_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_job_id uuid := case when tg_op in ('UPDATE', 'DELETE') then old.job_id else null end;
  next_job_id uuid := case when tg_op in ('INSERT', 'UPDATE') then new.job_id else null end;
begin
  if exists (
    select 1
    from public.invoices i
    join public.invoice_signatures s on s.invoice_id = i.id
    where (i.job_id = previous_job_id or i.job_id = next_job_id)
      and s.purpose = 'invoice_approval'
      and s.status = 'active'
  ) then
    raise exception 'Reject the saved customer approval before changing signed invoice line items.' using errcode = '42501';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_owner()
    and exists (
      select 1
      from public.invoices i
      where i.job_id = previous_job_id or i.job_id = next_job_id
    ) then
    raise exception 'Only an owner can change line items after an invoice draft exists.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_signed_invoice_line_items on public.job_line_items;
create trigger protect_signed_invoice_line_items
before insert or update or delete on public.job_line_items
for each row execute function public.protect_signed_invoice_line_items();

create or replace function public.sync_job_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform set_config('fasttrack.invoice_total_sync', 'on', true);
    update public.invoices set updated_at = statement_timestamp()
    where job_id = old.job_id and status = 'draft';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform set_config('fasttrack.invoice_total_sync', 'on', true);
    update public.invoices set updated_at = statement_timestamp()
    where job_id = new.job_id and status = 'draft';
  end if;
  return null;
end;
$$;

drop trigger if exists sync_job_invoice_totals on public.job_line_items;
create trigger sync_job_invoice_totals
after insert or update or delete on public.job_line_items
for each row execute function public.sync_job_invoice_totals();

create or replace function public.create_or_refresh_invoice_draft(
  p_job_id uuid,
  p_created_by uuid
)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  result public.invoices;
  only_tier text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  select case when count(distinct tier) = 1 then min(tier) else null end
  into only_tier
  from public.job_line_items
  where job_id = p_job_id;

  insert into public.invoices (job_id, selected_tier, created_by)
  values (p_job_id, only_tier, p_created_by)
  on conflict (job_id) do update
    set updated_at = statement_timestamp()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.create_or_refresh_invoice_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_or_refresh_invoice_draft(uuid, uuid) to service_role;

create or replace function public.record_invoice_signature(
  p_id uuid,
  p_invoice_id uuid,
  p_job_id uuid,
  p_purpose text,
  p_signer_name text,
  p_signer_role text,
  p_storage_path text,
  p_width integer,
  p_height integer,
  p_byte_size integer,
  p_content_sha256 text,
  p_document_sha256 text,
  p_signed_at timestamptz,
  p_collected_by uuid,
  p_audit_metadata jsonb
)
returns public.invoice_signatures
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  result public.invoice_signatures;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  if p_invoice_id is not null and not exists (
    select 1 from public.invoices where id = p_invoice_id and job_id = p_job_id
  ) then
    raise exception 'Invoice and job do not match.' using errcode = '23503';
  end if;

  update public.invoice_signatures
  set
    status = 'rejected',
    rejected_at = statement_timestamp(),
    rejected_by = p_collected_by,
    rejection_reason = 'Replaced by a newly collected signature.'
  where status = 'active'
    and purpose = p_purpose
    and (
      (p_purpose = 'work_completion' and job_id = p_job_id)
      or (p_purpose <> 'work_completion' and invoice_id = p_invoice_id)
    );

  insert into public.invoice_signatures (
    id, invoice_id, job_id, purpose, signer_name, signer_role, status,
    storage_path, mime_type, width, height, byte_size, content_sha256,
    document_sha256, signed_at, collected_by, audit_metadata
  ) values (
    p_id, p_invoice_id, p_job_id, p_purpose, trim(p_signer_name), p_signer_role, 'active',
    p_storage_path, 'image/png', p_width, p_height, p_byte_size, p_content_sha256,
    p_document_sha256, p_signed_at, p_collected_by, coalesce(p_audit_metadata, '{}'::jsonb)
  ) returning * into result;

  if p_purpose = 'invoice_approval' then
    update public.invoices
    set approval_status = 'signed', approved_at = p_signed_at
    where id = p_invoice_id;
  end if;

  return result;
end;
$$;

revoke all on function public.record_invoice_signature(
  uuid, uuid, uuid, text, text, text, text, integer, integer, integer,
  text, text, timestamptz, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.record_invoice_signature(
  uuid, uuid, uuid, text, text, text, text, integer, integer, integer,
  text, text, timestamptz, uuid, jsonb
) to service_role;

create or replace function public.reject_invoice_signature(
  p_signature_id uuid,
  p_rejected_by uuid,
  p_reason text
)
returns public.invoice_signatures
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  result public.invoice_signatures;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  update public.invoice_signatures
  set
    status = 'rejected',
    rejected_at = statement_timestamp(),
    rejected_by = p_rejected_by,
    rejection_reason = nullif(trim(p_reason), '')
  where id = p_signature_id and status = 'active'
  returning * into result;

  if result.id is null then
    raise exception 'Active signature not found.' using errcode = 'P0002';
  end if;

  if result.purpose = 'invoice_approval' then
    update public.invoices
    set
      approval_status = 'not_signed',
      approved_at = null,
      pdf_storage_path = null,
      pdf_generated_at = null,
      pdf_sha256 = null,
      pdf_size_bytes = null,
      status = case when payment_status = 'paid' then 'paid' else 'draft' end
    where id = result.invoice_id;
  end if;

  return result;
end;
$$;

revoke all on function public.reject_invoice_signature(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_invoice_signature(uuid, uuid, text) to service_role;

create or replace function public.enforce_job_completion_signature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_allowed_role();
  actor_id uuid := public.current_allowed_user_id();
  service_role_request boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if new.completion_signature_override_at is distinct from old.completion_signature_override_at
    or new.completion_signature_override_by is distinct from old.completion_signature_override_by
    or new.completion_signature_override_reason is distinct from old.completion_signature_override_reason then
    if not service_role_request and actor_role <> 'owner' then
      raise exception 'Only an owner can override the customer completion signature.' using errcode = '42501';
    end if;
    if new.completion_signature_override_at is not null and (
      new.completion_signature_override_by is null
      or nullif(trim(new.completion_signature_override_reason), '') is null
    ) then
      raise exception 'A completion-signature override requires an owner and reason.' using errcode = '23514';
    end if;
    if not service_role_request and new.completion_signature_override_by is distinct from actor_id then
      raise exception 'The override owner must match the signed-in owner.' using errcode = '42501';
    end if;
  end if;

  if old.status is distinct from 'complete' and new.status = 'complete' then
    if exists (
      select 1 from public.invoice_signatures s
      where s.job_id = new.id
        and s.purpose = 'work_completion'
        and s.status = 'active'
    ) then
      return new;
    end if;

    if new.completion_signature_override_at is not null
      and new.completion_signature_override_by is not null
      and nullif(trim(new.completion_signature_override_reason), '') is not null
      and (service_role_request or actor_role = 'owner') then
      return new;
    end if;

    raise exception 'Collect the customer completion signature before completing this job.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_job_completion_signature on public.jobs;
create trigger enforce_job_completion_signature
before update on public.jobs
for each row execute function public.enforce_job_completion_signature();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-signatures', 'invoice-signatures', false, 1048576, array['image/png'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "invoice signatures read for owner or assigned tech" on storage.objects;
create policy "invoice signatures read for owner or assigned tech"
on storage.objects for select to authenticated
using (
  bucket_id = 'invoice-signatures'
  and exists (
    select 1
    from public.jobs j
    where j.id::text = (storage.foldername(name))[1]
      and (
        public.is_owner()
        or j.assigned_tech_id = public.current_allowed_user_id()
      )
  )
);

drop policy if exists "invoice pdfs read for owner or assigned tech" on storage.objects;
create policy "invoice pdfs read for owner or assigned tech"
on storage.objects for select to authenticated
using (
  bucket_id = 'invoices'
  and (
    public.is_owner()
    or exists (
      select 1
      from public.invoices i
      join public.jobs j on j.id = i.job_id
      where (
          (storage.foldername(name))[1] = i.id::text
          or regexp_replace(name, '\.pdf$', '') = i.id::text
        )
        and j.assigned_tech_id = public.current_allowed_user_id()
    )
  )
);

drop policy if exists "owner tech assigned create invoice drafts" on public.invoices;
drop policy if exists "owner or assigned tech updates invoice drafts" on public.invoices;
drop policy if exists "no direct invoice inserts" on public.invoices;
drop policy if exists "no direct invoice updates" on public.invoices;

create policy "no direct invoice inserts"
on public.invoices for insert to authenticated
with check (false);

create policy "no direct invoice updates"
on public.invoices for update to authenticated
using (false)
with check (false);
