-- Keep pre-work authorization easy to collect while preserving the strict
-- completion and final-invoice audit trail.

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

  -- A customer may authorize work before the technician takes the first
  -- before photo. Once a before photo exists, however, signed evidence remains
  -- immutable unless the authorization is explicitly rejected.
  if (
    (tg_op in ('UPDATE', 'DELETE') and old.kind = 'before')
    or (tg_op = 'UPDATE' and new.kind = 'before')
  ) and exists (
    select 1 from public.invoice_signatures signature
    where (signature.job_id = previous_job_id or signature.job_id = next_job_id)
      and signature.purpose = 'work_authorization'
      and signature.status = 'active'
  ) then
    raise exception 'Reject the saved customer work authorization before changing before-work evidence.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.kind = 'before' and (
    exists (
      select 1 from public.invoice_signatures signature
      where signature.job_id = next_job_id
        and signature.purpose = 'work_completion'
        and signature.status = 'active'
    )
    or exists (
      select 1 from public.jobs job
      where job.id = next_job_id and job.status = 'complete'
    )
  ) then
    raise exception 'Before-work evidence cannot be added after work completion.' using errcode = '42501';
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
    or new.arrival_window_end_at is distinct from old.arrival_window_end_at;
  completion_bound_fields_changed boolean :=
    authorization_bound_fields_changed
    or new.arrived_at is distinct from old.arrived_at
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
  existing_tier text;
  fallback_tier text;
  draft_tier text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  select * into target_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if target_job.status = 'cancelled' then
    raise exception 'A cancelled job cannot create a new invoice draft.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.job_line_items item where item.job_id = p_job_id
  ) then
    raise exception 'Add at least one work item before creating an invoice draft.' using errcode = '42501';
  end if;

  select signature.selected_tier into authorized_tier
  from public.invoice_signatures signature
  where signature.job_id = p_job_id
    and signature.purpose = 'work_authorization'
    and signature.status = 'active'
  for update;

  select invoice.selected_tier into existing_tier
  from public.invoices invoice
  where invoice.job_id = p_job_id
  for update;

  if existing_tier is not null and not exists (
    select 1
    from public.job_line_items item
    where item.job_id = p_job_id and item.tier = existing_tier
  ) then
    existing_tier := null;
  end if;

  select item.tier into fallback_tier
  from public.job_line_items item
  where item.job_id = p_job_id
  group by item.tier
  order by case item.tier
    when 'standard' then 1
    when 'good' then 2
    when 'better' then 3
    when 'best' then 4
    else 5
  end
  limit 1;

  draft_tier := coalesce(authorized_tier, existing_tier, fallback_tier);
  if draft_tier is null then
    raise exception 'The invoice has no populated work option.' using errcode = '42501';
  end if;

  insert into public.invoices as existing_invoice (job_id, selected_tier, created_by)
  values (p_job_id, draft_tier, p_created_by)
  on conflict (job_id) do update
    set selected_tier = draft_tier,
        updated_at = statement_timestamp()
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

  if p_purpose = 'work_authorization' then
    if target_job.status in ('complete', 'cancelled') then
      raise exception 'Closed jobs cannot accept work authorization.' using errcode = '42501';
    end if;
  elsif p_purpose = 'work_completion' then
    if target_job.status <> 'in_progress' or target_job.arrived_at is null then
      raise exception 'Only an arrived job in progress can accept a completion signature.' using errcode = '42501';
    end if;
  end if;

  if p_purpose = 'work_authorization' then
    if p_selected_tier not in ('standard', 'good', 'better', 'best') then
      raise exception 'Choose a valid estimate option before authorization.' using errcode = '23514';
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
