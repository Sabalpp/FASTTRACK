alter table public.jobs
  add column if not exists workflow_revision bigint not null default 0;

alter table public.invoice_signatures
  add column if not exists selected_tier text,
  add column if not exists authorization_signature_id uuid references public.invoice_signatures(id) on delete restrict,
  add column if not exists authorization_terms_version text,
  add column if not exists authorization_subtotal numeric(12,2),
  add column if not exists authorization_tax_rate numeric(8,6),
  add column if not exists authorization_tax_amount numeric(12,2),
  add column if not exists authorization_total numeric(12,2);

-- A signature collected before the price/terms binding existed cannot be
-- silently upgraded after the customer signed it. Preserve its audit record,
-- but deterministically require a new signature under the stronger contract.
update public.invoice_signatures
set
  status = 'rejected',
  rejected_at = coalesce(rejected_at, statement_timestamp()),
  rejection_reason = coalesce(rejection_reason, 'Security upgrade requires the customer to sign the price-and-terms-bound workflow again.')
where status = 'active'
  and (
    (purpose = 'work_authorization' and authorization_terms_version is null)
    or (purpose = 'work_completion' and authorization_signature_id is null)
  );

alter table public.invoice_signatures
  drop constraint if exists invoice_signatures_purpose_check,
  drop constraint if exists invoice_signature_target_check,
  drop constraint if exists invoice_signature_role_check,
  drop constraint if exists invoice_signature_selected_tier_check,
  drop constraint if exists invoice_signature_authorization_snapshot_check;

alter table public.invoice_signatures
  add constraint invoice_signatures_purpose_check
    check (purpose in ('work_authorization', 'work_completion', 'invoice_approval', 'technician_acknowledgement')),
  add constraint invoice_signature_target_check check (
    purpose in ('work_authorization', 'work_completion') or invoice_id is not null
  ),
  add constraint invoice_signature_role_check check (
    (purpose in ('work_authorization', 'work_completion', 'invoice_approval') and signer_role = 'customer')
    or (purpose = 'technician_acknowledgement' and signer_role in ('technician', 'company'))
  ),
  add constraint invoice_signature_selected_tier_check check (
    status = 'rejected'
    or (purpose in ('work_authorization', 'work_completion') and selected_tier in ('standard', 'good', 'better', 'best'))
    or (purpose not in ('work_authorization', 'work_completion') and selected_tier is null)
  ),
  add constraint invoice_signature_authorization_snapshot_check check (
    status = 'rejected'
    or (
      purpose = 'work_authorization'
      and authorization_signature_id is null
      and authorization_terms_version = 'fast-track-work-authorization-v1'
      and authorization_subtotal is not null
      and authorization_tax_rate is not null
      and authorization_tax_amount is not null
      and authorization_total is not null
    )
    or (
      purpose = 'work_completion'
      and authorization_signature_id is not null
      and authorization_terms_version is null
      and authorization_subtotal is null
      and authorization_tax_rate is null
      and authorization_tax_amount is null
      and authorization_total is null
    )
    or (
      purpose not in ('work_authorization', 'work_completion')
      and authorization_signature_id is null
      and authorization_terms_version is null
      and authorization_subtotal is null
      and authorization_tax_rate is null
      and authorization_tax_amount is null
      and authorization_total is null
    )
  );

create unique index if not exists invoice_signatures_active_work_authorization_idx
  on public.invoice_signatures(job_id, purpose)
  where status = 'active' and purpose = 'work_authorization';

create index if not exists invoice_signatures_authorization_signature_id_idx
  on public.invoice_signatures(authorization_signature_id)
  where authorization_signature_id is not null;

alter table public.job_photos
  drop constraint if exists job_photos_job_prefixed_storage_path_check;
alter table public.job_photos
  add constraint job_photos_job_prefixed_storage_path_check check (
    storage_path like (job_id::text || '/%')
    and position('..' in storage_path) = 0
    and char_length(storage_path) between 38 and 512
  ) not valid;

drop policy if exists "owner tech assigned write photos" on public.job_photos;
drop policy if exists "owner tech assigned insert photos" on public.job_photos;
drop policy if exists "owner tech assigned update photos" on public.job_photos;
drop policy if exists "owner tech assigned delete photos" on public.job_photos;

create policy "owner tech assigned insert photos"
on public.job_photos for insert to authenticated
with check (
  uploaded_by = public.current_allowed_user_id()
  and storage_path like (job_id::text || '/%')
  and (
    public.is_owner()
    or exists (
      select 1 from public.jobs job
      where job.id = job_photos.job_id
        and job.assigned_tech_id = public.current_allowed_user_id()
    )
  )
);

create policy "owner tech assigned update photos"
on public.job_photos for update to authenticated
using (
  public.is_owner()
  or exists (
    select 1 from public.jobs job
    where job.id = job_photos.job_id
      and job.assigned_tech_id = public.current_allowed_user_id()
  )
)
with check (
  public.is_owner()
  or exists (
    select 1 from public.jobs job
    where job.id = job_photos.job_id
      and job.assigned_tech_id = public.current_allowed_user_id()
  )
);

create policy "owner tech assigned delete photos"
on public.job_photos for delete to authenticated
using (
  public.is_owner()
  or exists (
    select 1 from public.jobs job
    where job.id = job_photos.job_id
      and job.assigned_tech_id = public.current_allowed_user_id()
  )
);

create or replace function public.protect_signed_invoice_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_job_id uuid := case when tg_op in ('UPDATE', 'DELETE') then old.job_id else null end;
  next_job_id uuid := case when tg_op in ('INSERT', 'UPDATE') then new.job_id else null end;
  locked_job_id uuid;
begin
  -- Every scope mutation takes the parent job lock first. The signature RPC
  -- takes the same lock before it verifies the revision and evidence, so a
  -- line-item write can only happen entirely before or entirely after signing.
  for locked_job_id in
    select job.id
    from public.jobs job
    where job.id in (previous_job_id, next_job_id)
    order by job.id
    for update
  loop
    null;
  end loop;

  if exists (
    select 1
    from public.invoice_signatures signature
    where (signature.job_id = previous_job_id or signature.job_id = next_job_id)
      and signature.purpose = 'work_authorization'
      and signature.status = 'active'
  ) then
    raise exception 'Reject the saved customer work authorization before changing the authorized scope.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.invoices invoice
    join public.invoice_signatures signature on signature.invoice_id = invoice.id
    where (invoice.job_id = previous_job_id or invoice.job_id = next_job_id)
      and signature.purpose = 'invoice_approval'
      and signature.status = 'active'
  ) then
    raise exception 'Reject the saved customer invoice approval before changing signed invoice line items.' using errcode = '42501';
  end if;

  perform set_config('fasttrack.internal_workflow_revision_bump', 'on', true);
  update public.jobs job
  set workflow_revision = job.workflow_revision + 1
  where job.id in (previous_job_id, next_job_id);
  perform set_config('fasttrack.internal_workflow_revision_bump', 'off', true);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.protect_signed_job_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_job_id uuid := case when tg_op in ('UPDATE', 'DELETE') then old.job_id else null end;
  next_job_id uuid := case when tg_op in ('INSERT', 'UPDATE') then new.job_id else null end;
  locked_job_id uuid;
begin
  -- Lock both parents in stable UUID order when a row is ever moved. This
  -- matches line-item and signature lock ordering and avoids lock inversion.
  for locked_job_id in
    select job.id
    from public.jobs job
    where job.id in (previous_job_id, next_job_id)
    order by job.id
    for update
  loop
    null;
  end loop;

  if tg_op = 'UPDATE' and (
    new.job_id is distinct from old.job_id
    or new.storage_path is distinct from old.storage_path
    or new.uploaded_by is distinct from old.uploaded_by
    or new.uploaded_at is distinct from old.uploaded_at
  ) then
    raise exception 'Job photo identity, storage path, and uploader attribution are immutable.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and coalesce(auth.role(), '') <> 'service_role'
    and new.uploaded_by is distinct from public.current_allowed_user_id() then
    raise exception 'The photo uploader must match the signed-in Fast Track user.' using errcode = '42501';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and (
    new.storage_path not like (new.job_id::text || '/%')
    or position('..' in new.storage_path) > 0
  ) then
    raise exception 'Job photo storage paths must remain inside the parent job folder.' using errcode = '23514';
  end if;

  if (
    (tg_op in ('UPDATE', 'DELETE') and old.kind = 'before')
    or (tg_op in ('INSERT', 'UPDATE') and new.kind = 'before')
  ) and exists (
    select 1 from public.invoice_signatures signature
    where (signature.job_id = previous_job_id or signature.job_id = next_job_id)
      and signature.purpose = 'work_authorization'
      and signature.status = 'active'
  ) then
    raise exception 'Reject the saved customer work authorization before changing before-work evidence.' using errcode = '42501';
  end if;

  if (
    (tg_op in ('UPDATE', 'DELETE') and old.kind = 'after')
    or (tg_op in ('INSERT', 'UPDATE') and new.kind = 'after')
  ) and exists (
    select 1 from public.invoice_signatures signature
    where (signature.job_id = previous_job_id or signature.job_id = next_job_id)
      and signature.purpose = 'work_completion'
      and signature.status = 'active'
  ) then
    raise exception 'Reject the saved completion signature before changing after-work evidence.' using errcode = '42501';
  end if;

  if (
    (tg_op in ('UPDATE', 'DELETE') and old.kind = 'after')
    or (tg_op in ('INSERT', 'UPDATE') and new.kind = 'after')
  ) and exists (
    select 1 from public.jobs job
    where (job.id = previous_job_id or job.id = next_job_id)
      and job.status = 'complete'
  ) then
    raise exception 'After-work evidence is frozen when the job is complete, including owner-overridden completion.' using errcode = '42501';
  end if;

  perform set_config('fasttrack.internal_workflow_revision_bump', 'on', true);
  update public.jobs job
  set workflow_revision = job.workflow_revision + 1
  where job.id in (previous_job_id, next_job_id);
  perform set_config('fasttrack.internal_workflow_revision_bump', 'off', true);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_signed_job_photos on public.job_photos;
create trigger protect_signed_job_photos
before insert or update or delete on public.job_photos
for each row execute function public.protect_signed_job_photos();

create or replace function public.protect_work_authorization_signed_job_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  authorization_bound_fields_changed boolean :=
    new.customer_id is distinct from old.customer_id
    or new.service_address is distinct from old.service_address
    or new.description is distinct from old.description
    or new.scheduled_at is distinct from old.scheduled_at
    or new.arrival_window_end_at is distinct from old.arrival_window_end_at
    or new.arrived_at is distinct from old.arrived_at;
  completion_bound_fields_changed boolean :=
    authorization_bound_fields_changed
    or new.notes is distinct from old.notes;
begin
  if authorization_bound_fields_changed and exists (
    select 1 from public.invoice_signatures signature
    where signature.job_id = old.id
      and signature.purpose = 'work_authorization'
      and signature.status = 'active'
  ) then
    raise exception 'Reject the saved customer work authorization before changing authorized job details.' using errcode = '42501';
  end if;

  if completion_bound_fields_changed and exists (
    select 1 from public.invoice_signatures signature
    where signature.job_id = old.id
      and signature.purpose = 'work_completion'
      and signature.status = 'active'
  ) then
    raise exception 'Reject the saved customer completion signature before changing completed-work details.' using errcode = '42501';
  end if;

  if completion_bound_fields_changed then
    new.workflow_revision := old.workflow_revision + 1;
  elsif new.workflow_revision is distinct from old.workflow_revision then
    if not (
      current_setting('fasttrack.internal_workflow_revision_bump', true) = 'on'
      and pg_trigger_depth() > 1
      and new.workflow_revision = old.workflow_revision + 1
    ) then
      raise exception 'The workflow revision is server managed.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_work_authorization_signed_job_fields on public.jobs;
create trigger protect_work_authorization_signed_job_fields
before update on public.jobs
for each row execute function public.protect_work_authorization_signed_job_fields();

drop function if exists public.create_or_refresh_invoice_draft(uuid, uuid);
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
  target_job public.jobs;
  authorized_tier text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  select * into target_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if target_job.status <> 'complete' then
    raise exception 'The field workflow must be complete before an invoice draft can be created.' using errcode = '42501';
  end if;

  select signature.selected_tier into authorized_tier
  from public.invoice_signatures signature
  where signature.job_id = p_job_id
    and signature.purpose = 'work_authorization'
    and signature.status = 'active'
  for update;

  if authorized_tier is null then
    raise exception 'Customer work authorization is required before invoicing.' using errcode = '42501';
  end if;

  insert into public.invoices (job_id, selected_tier, created_by)
  values (p_job_id, authorized_tier, p_created_by)
  on conflict (job_id) do update
    set selected_tier = authorized_tier,
        updated_at = statement_timestamp()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.create_or_refresh_invoice_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_or_refresh_invoice_draft(uuid, uuid) to service_role;

drop function if exists public.record_invoice_signature(
  uuid, uuid, uuid, text, text, text, text, integer, integer, integer,
  text, text, timestamptz, uuid, jsonb
);
drop function if exists public.record_invoice_signature(
  uuid, uuid, uuid, text, text, text, text, text, integer, integer, integer,
  text, text, timestamptz, uuid, jsonb
);
drop function if exists public.record_invoice_signature(
  uuid, uuid, uuid, text, text, bigint, text, text, text, integer, integer, integer,
  text, text, timestamptz, uuid, jsonb
);
drop function if exists public.record_invoice_signature(
  uuid, uuid, uuid, text, text, bigint, uuid, text, text, numeric, numeric, numeric, numeric,
  text, text, text, integer, integer, integer, text, text, timestamptz, uuid, jsonb
);

create or replace function public.record_invoice_signature(
  p_id uuid,
  p_invoice_id uuid,
  p_job_id uuid,
  p_purpose text,
  p_selected_tier text,
  p_expected_workflow_revision bigint,
  p_authorization_signature_id uuid,
  p_expected_authorization_document_sha256 text,
  p_authorization_terms_version text,
  p_authorization_subtotal numeric,
  p_authorization_tax_rate numeric,
  p_authorization_tax_amount numeric,
  p_authorization_total numeric,
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
  target_job public.jobs;
  current_authorization public.invoice_signatures;
  calculated_subtotal numeric(12,2);
  calculated_tax_amount numeric(12,2);
  calculated_total numeric(12,2);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  -- Parent-first locking is shared by line-item/photo mutation triggers. Once
  -- this lock is held, no authorization-bound evidence can change until the
  -- expected revision is checked and the signature audit row is committed.
  select * into target_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  if target_job.workflow_revision is distinct from p_expected_workflow_revision then
    raise exception 'The job workflow changed while the signature was being prepared. Review and try again.' using errcode = '40001';
  end if;

  if p_purpose in ('work_authorization', 'work_completion') then
    if target_job.status <> 'in_progress' or target_job.arrived_at is null then
      raise exception 'Only an arrived job in progress can accept field-work signatures.' using errcode = '42501';
    end if;
  end if;

  if p_purpose = 'work_authorization' then
    if p_selected_tier not in ('standard', 'good', 'better', 'best') then
      raise exception 'Choose a valid estimate option before authorization.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.job_photos
      where job_id = p_job_id and kind = 'before'
    ) then
      raise exception 'A before photo is required before work authorization.' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.job_line_items
      where job_id = p_job_id and tier = p_selected_tier
    ) then
      raise exception 'The selected estimate option must contain proposed work.' using errcode = '42501';
    end if;

    if p_authorization_signature_id is not null or p_expected_authorization_document_sha256 is not null then
      raise exception 'A work authorization cannot point to another authorization.' using errcode = '23514';
    end if;
    if p_authorization_terms_version is distinct from 'fast-track-work-authorization-v1' then
      raise exception 'The work-authorization terms version is not current.' using errcode = '23514';
    end if;
    if p_authorization_tax_rate is null or p_authorization_tax_rate < 0 or p_authorization_tax_rate > 1 then
      raise exception 'The work-authorization tax rate is invalid.' using errcode = '23514';
    end if;

    select coalesce(round(sum(quantity * unit_price), 2), 0)
    into calculated_subtotal
    from public.job_line_items
    where job_id = p_job_id and tier = p_selected_tier;
    calculated_tax_amount := round(calculated_subtotal * p_authorization_tax_rate, 2);
    calculated_total := calculated_subtotal + calculated_tax_amount;

    if p_authorization_subtotal is distinct from calculated_subtotal
      or p_authorization_tax_amount is distinct from calculated_tax_amount
      or p_authorization_total is distinct from calculated_total then
      raise exception 'The signed authorization totals do not match the current selected work.' using errcode = '40001';
    end if;

    if exists (
      select 1 from public.invoice_signatures signature
      where signature.job_id = p_job_id
        and signature.purpose = 'work_completion'
        and signature.status = 'active'
    ) then
      raise exception 'Reject the active completion signature before replacing work authorization.' using errcode = '42501';
    end if;
  elsif p_purpose = 'work_completion' then
    select * into current_authorization
    from public.invoice_signatures signature
    where signature.id = p_authorization_signature_id
      and signature.job_id = p_job_id
      and signature.purpose = 'work_authorization'
      and signature.status = 'active'
    for update;
    if current_authorization.id is null then
      raise exception 'Customer work authorization is required before completion.' using errcode = '42501';
    end if;
    if p_selected_tier is distinct from current_authorization.selected_tier
      or p_expected_authorization_document_sha256 is distinct from current_authorization.document_sha256 then
      raise exception 'The completion signature does not match the active authorized scope.' using errcode = '40001';
    end if;
    if current_authorization.authorization_terms_version is distinct from 'fast-track-work-authorization-v1'
      or current_authorization.authorization_subtotal is null
      or current_authorization.authorization_tax_rate is null
      or current_authorization.authorization_tax_amount is null
      or current_authorization.authorization_total is null then
      raise exception 'The active authorization is missing its price-and-terms snapshot.' using errcode = '42501';
    end if;
    if p_authorization_terms_version is not null
      or p_authorization_subtotal is not null
      or p_authorization_tax_rate is not null
      or p_authorization_tax_amount is not null
      or p_authorization_total is not null then
      raise exception 'Completion must reference, not replace, the signed authorization snapshot.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.job_photos
      where job_id = p_job_id and kind = 'after'
    ) then
      raise exception 'An after photo is required before completion.' using errcode = '42501';
    end if;
  elsif p_selected_tier is not null
    or p_authorization_signature_id is not null
    or p_expected_authorization_document_sha256 is not null
    or p_authorization_terms_version is not null
    or p_authorization_subtotal is not null
    or p_authorization_tax_rate is not null
    or p_authorization_tax_amount is not null
    or p_authorization_total is not null then
    raise exception 'This signature type cannot bind a field-work authorization.' using errcode = '23514';
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
      (p_purpose in ('work_authorization', 'work_completion') and job_id = p_job_id)
      or (p_purpose not in ('work_authorization', 'work_completion') and invoice_id = p_invoice_id)
    );

  insert into public.invoice_signatures (
    id, invoice_id, job_id, purpose, selected_tier, authorization_signature_id,
    authorization_terms_version, authorization_subtotal, authorization_tax_rate,
    authorization_tax_amount, authorization_total, signer_name, signer_role, status,
    storage_path, mime_type, width, height, byte_size, content_sha256,
    document_sha256, signed_at, collected_by, audit_metadata
  ) values (
    p_id, p_invoice_id, p_job_id, p_purpose, p_selected_tier, p_authorization_signature_id,
    p_authorization_terms_version, p_authorization_subtotal, p_authorization_tax_rate,
    p_authorization_tax_amount, p_authorization_total, trim(p_signer_name), p_signer_role, 'active',
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
  uuid, uuid, uuid, text, text, bigint, uuid, text, text, numeric, numeric, numeric, numeric,
  text, text, text, integer, integer, integer,
  text, text, timestamptz, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.record_invoice_signature(
  uuid, uuid, uuid, text, text, bigint, uuid, text, text, numeric, numeric, numeric, numeric,
  text, text, text, integer, integer, integer,
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
  target_signature public.invoice_signatures;
  target_job public.jobs;
  rejecting_user public.allowed_users;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  -- Read the target without locking only to discover its parent. Every field
  -- signature rejection then locks the job before the signature, matching the
  -- collection and evidence-mutation order.
  select * into target_signature
  from public.invoice_signatures
  where id = p_signature_id and status = 'active';
  if not found then
    raise exception 'Active signature not found.' using errcode = 'P0002';
  end if;

  select * into target_job
  from public.jobs
  where id = target_signature.job_id
  for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  select * into rejecting_user
  from public.allowed_users
  where id = p_rejected_by and active;
  if not found then
    raise exception 'An active Fast Track user is required.' using errcode = '42501';
  end if;

  if rejecting_user.role <> 'owner' and not (
    target_signature.purpose = 'work_authorization'
    and rejecting_user.role = 'tech'
    and target_job.assigned_tech_id = rejecting_user.id
    and target_job.status not in ('complete', 'cancelled')
  ) then
    raise exception 'Only an owner can reject invoice or completion signatures; an assigned technician may reject open work authorization.' using errcode = '42501';
  end if;

  if target_signature.purpose = 'work_completion' and target_job.status = 'complete' then
    raise exception 'Reopen the job before rejecting its completion signature.' using errcode = '42501';
  end if;
  if target_signature.purpose = 'work_authorization' and target_job.status in ('complete', 'cancelled') then
    raise exception 'Closed jobs cannot reopen customer work authorization.' using errcode = '42501';
  end if;
  if target_signature.purpose = 'work_authorization' and exists (
    select 1 from public.invoice_signatures completion
    where completion.authorization_signature_id = target_signature.id
      and completion.purpose = 'work_completion'
      and completion.status = 'active'
  ) then
    raise exception 'Reject the active completion signature before reopening its work authorization.' using errcode = '42501';
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
    set approval_status = 'not_signed', approved_at = null
    where id = result.invoice_id;
  end if;

  return result;
end;
$$;

revoke all on function public.reject_invoice_signature(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_invoice_signature(uuid, uuid, text) to service_role;

create or replace function public.complete_job_with_signature(
  p_job_id uuid,
  p_expected_status text,
  p_expected_customer_id uuid,
  p_expected_assigned_tech_id uuid,
  p_expected_service_address text,
  p_expected_description text,
  p_expected_notes text,
  p_expected_arrived_at timestamptz,
  p_expected_signature_id uuid,
  p_expected_signature_document_sha256 text,
  p_override_by uuid,
  p_override_reason text
)
returns public.jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_job public.jobs;
  current_authorization public.invoice_signatures;
  current_signature public.invoice_signatures;
  result public.jobs;
  normalized_override_reason text := nullif(trim(coalesce(p_override_reason, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  select * into current_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found.' using errcode = 'P0002'; end if;

  if current_job.status is distinct from p_expected_status
    or current_job.customer_id is distinct from p_expected_customer_id
    or current_job.assigned_tech_id is distinct from p_expected_assigned_tech_id
    or current_job.service_address is distinct from p_expected_service_address
    or current_job.description is distinct from p_expected_description
    or coalesce(current_job.notes, '') is distinct from coalesce(p_expected_notes, '')
    or current_job.arrived_at is distinct from p_expected_arrived_at then
    raise exception 'The job changed while completion was being recorded. Review and try again.' using errcode = '40001';
  end if;

  if current_job.status <> 'in_progress' or current_job.arrived_at is null then
    raise exception 'Only an arrived job in progress can be completed.' using errcode = '42501';
  end if;

  select * into current_authorization
  from public.invoice_signatures
  where job_id = p_job_id and purpose = 'work_authorization' and status = 'active'
  for update;
  if current_authorization.id is null then
    raise exception 'Customer work authorization is required before completion.' using errcode = '42501';
  end if;
  if current_authorization.authorization_terms_version is distinct from 'fast-track-work-authorization-v1'
    or current_authorization.authorization_subtotal is null
    or current_authorization.authorization_tax_rate is null
    or current_authorization.authorization_tax_amount is null
    or current_authorization.authorization_total is null then
    raise exception 'Customer work authorization is missing its price-and-terms snapshot.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.job_photos
    where job_id = p_job_id and kind = 'after'
  ) then
    raise exception 'An after photo is required before completion.' using errcode = '42501';
  end if;

  select * into current_signature
  from public.invoice_signatures
  where job_id = p_job_id and purpose = 'work_completion' and status = 'active'
  for update;

  if p_expected_signature_id is not null then
    if p_override_by is not null or normalized_override_reason is not null then
      raise exception 'A signed completion cannot also use an owner override.' using errcode = '23514';
    end if;
    if current_signature.id is null
      or current_signature.id is distinct from p_expected_signature_id
      or current_signature.document_sha256 is distinct from p_expected_signature_document_sha256
      or current_signature.authorization_signature_id is distinct from current_authorization.id
      or current_signature.selected_tier is distinct from current_authorization.selected_tier then
      raise exception 'The customer completion signature changed. Review and try again.' using errcode = '40001';
    end if;
  else
    if current_signature.id is not null then
      raise exception 'A customer completion signature was added. Review and try again.' using errcode = '40001';
    end if;
    if p_override_by is null or normalized_override_reason is null
      or char_length(normalized_override_reason) < 10
      or char_length(normalized_override_reason) > 500 then
      raise exception 'Owner override requires a clear reason of 10 to 500 characters.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.allowed_users owner_user
      where owner_user.id = p_override_by and owner_user.active and owner_user.role = 'owner'
    ) then
      raise exception 'Only an active owner can override the customer completion signature.' using errcode = '42501';
    end if;
  end if;

  update public.jobs
  set
    status = 'complete',
    completed_at = statement_timestamp(),
    completion_signature_override_at = case when p_expected_signature_id is null then statement_timestamp() else null end,
    completion_signature_override_by = case when p_expected_signature_id is null then p_override_by else null end,
    completion_signature_override_reason = case when p_expected_signature_id is null then normalized_override_reason else null end
  where id = p_job_id
  returning * into result;

  return result;
end;
$$;

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
    if not exists (
      select 1 from public.invoice_signatures signature
      where signature.job_id = new.id
        and signature.purpose = 'work_authorization'
        and signature.status = 'active'
    ) then
      raise exception 'Collect customer work authorization before completing this job.' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.job_photos
      where job_id = new.id and kind = 'after'
    ) then
      raise exception 'Save an after photo before completing this job.' using errcode = '42501';
    end if;
    if exists (
      select 1
      from public.invoice_signatures completion
      join public.invoice_signatures authorization
        on authorization.id = completion.authorization_signature_id
       and authorization.job_id = completion.job_id
       and authorization.purpose = 'work_authorization'
       and authorization.status = 'active'
       and authorization.selected_tier = completion.selected_tier
      where completion.job_id = new.id
        and completion.purpose = 'work_completion'
        and completion.status = 'active'
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
