-- Appointment confirmation outbox foundation.
-- This migration only records delivery work. External providers must be called by application code.

-- Repair the original phone normalizer for standard-conforming PostgreSQL
-- strings, then recompute stored generated phone/search columns before consent
-- is bound to a normalized destination.
create or replace function public.normalize_us_phone(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(input, ''), '[^0-9]', '', 'g')) = 11
      and left(regexp_replace(coalesce(input, ''), '[^0-9]', '', 'g'), 1) = '1'
      then substring(regexp_replace(coalesce(input, ''), '[^0-9]', '', 'g') from 2)
    else regexp_replace(coalesce(input, ''), '[^0-9]', '', 'g')
  end;
$$;

drop trigger if exists enforce_customer_sms_consent_timestamp on public.customers;

alter table public.customers
  drop constraint if exists customers_sms_consent_audit_check;

update public.customers
set phone = phone;

update public.call_logs
set caller_phone = caller_phone;

alter table public.customers
  add column if not exists email_notifications_enabled boolean not null default true,
  add column if not exists sms_consent_status text not null default 'unknown',
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_source text,
  add column if not exists sms_consent_phone_digits text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_sms_consent_status_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_sms_consent_status_check
      check (sms_consent_status in ('unknown', 'opted_in', 'opted_out'));
  end if;
end
$$;

drop trigger if exists enforce_customer_sms_consent_timestamp on public.customers;

with consent_snapshot as (
  select
    customer.id,
    public.normalize_us_phone(customer.phone) as normalized_phone,
    customer.sms_consent_status,
    customer.sms_consent_at,
    customer.sms_consent_source
  from public.customers customer
), validated_consent as (
  select
    consent_snapshot.*,
    consent_snapshot.sms_consent_status in ('opted_in', 'opted_out')
      and consent_snapshot.normalized_phone ~ '^[0-9]{10}$'
      and consent_snapshot.sms_consent_at is not null
      and nullif(trim(coalesce(consent_snapshot.sms_consent_source, '')), '') is not null
      and char_length(trim(consent_snapshot.sms_consent_source)) <= 120
      as has_valid_evidence
  from consent_snapshot
)
update public.customers customer
set sms_consent_status = case when validated_consent.has_valid_evidence then validated_consent.sms_consent_status else 'unknown' end,
    sms_consent_at = case when validated_consent.has_valid_evidence then validated_consent.sms_consent_at else null end,
    sms_consent_source = case when validated_consent.has_valid_evidence then trim(validated_consent.sms_consent_source) else null end,
    sms_consent_phone_digits = case when validated_consent.has_valid_evidence then validated_consent.normalized_phone else null end
from validated_consent
where customer.id = validated_consent.id;

alter table public.customers
  drop constraint if exists customers_sms_consent_audit_check;

alter table public.customers
  add constraint customers_sms_consent_audit_check
  check (
    (
      sms_consent_status = 'unknown'
      and sms_consent_at is null
      and sms_consent_source is null
      and sms_consent_phone_digits is null
    )
    or (
      sms_consent_status in ('opted_in', 'opted_out')
      and sms_consent_at is not null
      and nullif(trim(coalesce(sms_consent_source, '')), '') is not null
      and char_length(trim(sms_consent_source)) <= 120
      and sms_consent_phone_digits is not null
      and sms_consent_phone_digits ~ '^[0-9]{10}$'
      and sms_consent_phone_digits = public.normalize_us_phone(phone)
    )
  );

create or replace function public.enforce_customer_sms_consent_timestamp()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_allowed_role();
  service_role_request boolean := coalesce(auth.role(), '') = 'service_role';
  normalized_phone text := public.normalize_us_phone(new.phone);
  requested_source text := nullif(trim(coalesce(new.sms_consent_source, '')), '');
  consent_changed boolean;
begin
  if tg_op = 'UPDATE' then
    if new.phone is distinct from old.phone then
      new.sms_consent_status := 'unknown';
      new.sms_consent_at := null;
      new.sms_consent_source := null;
      new.sms_consent_phone_digits := null;
      return new;
    end if;
    consent_changed := new.sms_consent_status is distinct from old.sms_consent_status;
  else
    consent_changed := true;
  end if;

  if new.sms_consent_status = 'unknown' then
    new.sms_consent_at := null;
    new.sms_consent_source := null;
    new.sms_consent_phone_digits := null;
    return new;
  end if;

  if consent_changed then
    if normalized_phone !~ '^[0-9]{10}$' then
      raise exception 'SMS consent requires a valid US phone number.' using errcode = '22023';
    end if;

    if service_role_request then
      if requested_source = 'twilio_start' and new.sms_consent_status = 'opted_in' then
        new.sms_consent_source := requested_source;
      elsif requested_source in ('twilio_stop', 'twilio_error_21610')
        and new.sms_consent_status = 'opted_out' then
        new.sms_consent_source := requested_source;
      else
        new.sms_consent_source := 'service_recorded';
      end if;
    elsif actor_role in ('owner', 'call_center') then
      new.sms_consent_source := 'staff_recorded';
    else
      raise exception 'Only owner or call-center staff can change SMS consent.' using errcode = '42501';
    end if;

    new.sms_consent_at := statement_timestamp();
    new.sms_consent_phone_digits := normalized_phone;
  else
    new.sms_consent_at := old.sms_consent_at;
    new.sms_consent_source := old.sms_consent_source;
    new.sms_consent_phone_digits := old.sms_consent_phone_digits;
  end if;

  return new;
end;
$$;

create trigger enforce_customer_sms_consent_timestamp
before insert or update of phone, sms_consent_status, sms_consent_at, sms_consent_source, sms_consent_phone_digits
on public.customers
for each row execute function public.enforce_customer_sms_consent_timestamp();

create table if not exists public.customer_sms_consent_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null check (status in ('unknown', 'opted_in', 'opted_out')),
  source text not null check (char_length(trim(source)) between 1 and 120),
  phone_digits text not null check (phone_digits ~ '^[0-9]*$'),
  occurred_at timestamptz not null default statement_timestamp(),
  recorded_at timestamptz not null default statement_timestamp(),
  recorded_by uuid references public.allowed_users(id) on delete set null
);

create index if not exists customer_sms_consent_events_customer_recorded_idx
  on public.customer_sms_consent_events (customer_id, recorded_at desc);

alter table public.customer_sms_consent_events
  add column if not exists phone_digits text;

update public.customer_sms_consent_events consent_event
set phone_digits = coalesce(public.normalize_us_phone(customer.phone), '')
from public.customers customer
where customer.id = consent_event.customer_id
  and consent_event.phone_digits is null;

update public.customer_sms_consent_events
set phone_digits = ''
where phone_digits is null;

alter table public.customer_sms_consent_events
  alter column phone_digits set not null,
  drop constraint if exists customer_sms_consent_events_phone_digits_check,
  add constraint customer_sms_consent_events_phone_digits_check
    check (phone_digits ~ '^[0-9]*$'),
  drop constraint if exists customer_sms_consent_events_customer_id_fkey,
  add constraint customer_sms_consent_events_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete cascade;

create or replace function public.record_customer_sms_consent_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  event_timestamp timestamptz := statement_timestamp();
  event_source text;
  fallback_source text;
begin
  if tg_op = 'UPDATE' then
    if new.sms_consent_status is not distinct from old.sms_consent_status then
      return new;
    end if;
    fallback_source := case when new.phone is distinct from old.phone then 'phone_changed' else 'status_change' end;
  else
    fallback_source := 'customer_created';
  end if;

  event_source := coalesce(
    nullif(trim(new.sms_consent_source), ''),
    fallback_source
  );

  insert into public.customer_sms_consent_events (
    customer_id,
    status,
    source,
    phone_digits,
    occurred_at,
    recorded_at,
    recorded_by
  ) values (
    new.id,
    new.sms_consent_status,
    left(event_source, 120),
    coalesce(public.normalize_us_phone(new.phone), ''),
    event_timestamp,
    event_timestamp,
    public.current_allowed_user_id()
  );

  return new;
end;
$$;

drop trigger if exists record_initial_customer_sms_consent on public.customers;
create trigger record_initial_customer_sms_consent
after insert on public.customers
for each row execute function public.record_customer_sms_consent_event();

drop trigger if exists record_customer_sms_consent_change on public.customers;
create trigger record_customer_sms_consent_change
after update of phone, sms_consent_status on public.customers
for each row execute function public.record_customer_sms_consent_event();

-- Existing customers predate the trigger. Record one server-timestamped baseline
-- without pretending that an earlier opt-in/opt-out event time is known.
insert into public.customer_sms_consent_events (
  customer_id,
  status,
  source,
  phone_digits,
  occurred_at,
  recorded_at,
  recorded_by
)
select
  customer.id,
  customer.sms_consent_status,
  'migration_baseline',
  coalesce(public.normalize_us_phone(customer.phone), ''),
  statement_timestamp(),
  statement_timestamp(),
  public.current_allowed_user_id()
from public.customers customer
where not exists (
  select 1
  from public.customer_sms_consent_events consent_event
  where consent_event.customer_id = customer.id
);

create table if not exists public.job_notification_state (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  revision bigint not null check (revision > 0),
  last_fingerprint text not null,
  last_event_type text not null check (last_event_type in ('confirmation', 'reschedule', 'cancellation')),
  updated_at timestamptz not null default statement_timestamp()
);

create table if not exists public.appointment_notifications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_revision bigint not null check (job_revision > 0),
  event_type text not null check (event_type in ('confirmation', 'reschedule', 'cancellation', 'manual_resend')),
  channel text not null check (channel in ('email', 'sms')),
  destination text not null default '',
  customer_name text not null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  service_address text not null,
  message_subject text not null default '',
  message_body text not null,
  request_source text not null default 'auto' check (request_source in ('auto', 'manual')),
  manual_request_id uuid,
  created_by uuid references public.allowed_users(id) on delete set null,
  resend_of uuid references public.appointment_notifications(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'accepted', 'failed', 'suppressed', 'cancelled')),
  provider text,
  provider_message_id text,
  provider_status text,
  provider_error_code text,
  provider_status_at timestamptz,
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default statement_timestamp(),
  processing_at timestamptz,
  locked_until timestamptz,
  claim_token uuid,
  claimed_by uuid references public.allowed_users(id) on delete set null,
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  suppressed_at timestamptz,
  cancelled_at timestamptz,
  last_error_code text,
  error_message text,
  last_error_at timestamptz,
  queued_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint appointment_notifications_sendable_destination check (
    status not in ('queued', 'processing', 'accepted') or destination <> ''
  )
);

alter table public.appointment_notifications
  add column if not exists claim_token uuid;

delete from public.appointment_notifications
where job_id is null or customer_id is null;

alter table public.appointment_notifications
  alter column job_id set not null,
  alter column customer_id set not null,
  drop constraint if exists appointment_notifications_job_id_fkey,
  add constraint appointment_notifications_job_id_fkey
    foreign key (job_id) references public.jobs(id) on delete cascade,
  drop constraint if exists appointment_notifications_customer_id_fkey,
  add constraint appointment_notifications_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete cascade;

create unique index if not exists appointment_notifications_auto_event_unique
  on public.appointment_notifications (job_id, job_revision, event_type, channel)
  where request_source = 'auto' and job_id is not null;

create unique index if not exists appointment_notifications_manual_request_unique
  on public.appointment_notifications (created_by, manual_request_id, channel)
  where request_source = 'manual' and created_by is not null and manual_request_id is not null;

create unique index if not exists appointment_notifications_provider_message_unique
  on public.appointment_notifications (provider, provider_message_id)
  where provider is not null and provider_message_id is not null;

create index if not exists appointment_notifications_job_created_idx
  on public.appointment_notifications (job_id, queued_at desc);

create index if not exists appointment_notifications_claim_idx
  on public.appointment_notifications (job_id, status, available_at, queued_at)
  where status in ('queued', 'processing', 'failed');

create or replace function public.notification_us_phone_digits(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(digits) = 11 and left(digits, 1) = '1' then substring(digits from 2)
    else digits
  end
  from (
    select regexp_replace(coalesce(input, ''), '[^0-9]', '', 'g') as digits
  ) normalized;
$$;

create or replace function public.record_customer_sms_consent_from_provider(
  p_phone text,
  p_status text,
  p_source text,
  p_customer_id uuid default null
)
returns table(updated_customer_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_phone_digits text;
  matching_count bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can record provider SMS consent changes.' using errcode = '42501';
  end if;

  if not coalesce(
    (p_status = 'opted_in' and p_source = 'twilio_start')
    or (p_status = 'opted_out' and p_source in ('twilio_stop', 'twilio_error_21610')),
    false
  ) then
    raise exception 'Provider SMS consent status and source do not match.' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    normalized_phone_digits := public.normalize_us_phone(p_phone);
    if normalized_phone_digits !~ '^[0-9]{10}$' then
      raise exception 'Provider phone must be a valid US number.' using errcode = '22023';
    end if;
  end if;

  if normalized_phone_digits is null and p_customer_id is null then
    raise exception 'Provider SMS consent changes require a phone or customer ID.' using errcode = '22004';
  end if;

  if p_status = 'opted_in' and p_customer_id is null then
    select count(*) into matching_count
    from public.customers customer
    where customer.phone_digits = normalized_phone_digits;

    if matching_count > 1 then
      raise exception 'Twilio START phone matches more than one customer.' using errcode = 'P0003';
    end if;
  end if;

  return query
  update public.customers customer
  set sms_consent_status = p_status,
      sms_consent_source = p_source
  where (p_customer_id is null or customer.id = p_customer_id)
    and (normalized_phone_digits is null or customer.phone_digits = normalized_phone_digits)
  returning customer.id;
end;
$$;


create table if not exists public.twilio_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  message_sid text,
  status text,
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  constraint twilio_webhook_events_event_key_check
    check (char_length(trim(event_key)) between 1 and 255),
  constraint twilio_webhook_events_event_type_check
    check (char_length(trim(event_type)) between 1 and 80),
  constraint twilio_webhook_events_message_sid_check
    check (message_sid is null or char_length(message_sid) <= 64),
  constraint twilio_webhook_events_status_check
    check (status is null or char_length(status) <= 80),
  constraint twilio_webhook_events_processed_order_check
    check (processed_at is null or processed_at >= received_at)
);

create or replace function public.mark_twilio_webhook_event_processed(
  p_event_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated_count bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can process Twilio webhook events.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_event_key, '')), '') is null then
    raise exception 'Twilio webhook event key is required.' using errcode = '22004';
  end if;

  update public.twilio_webhook_events webhook_event
  set processed_at = statement_timestamp()
  where webhook_event.event_key = p_event_key
    and webhook_event.processed_at is null;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

-- Reassert the workflow trigger contract in Phase 3 for databases that ran an
-- earlier arrival-window migration before these restrictions were strengthened.
create or replace function public.protect_job_workflow_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_allowed_role();
  service_role_request boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if tg_op = 'INSERT' then
    if not service_role_request and new.status <> 'scheduled' then
      raise exception 'New jobs must begin in scheduled status.' using errcode = '42501';
    end if;
    if not service_role_request and new.arrived_at is not null then
      raise exception 'Arrival must be recorded after the job is created.' using errcode = '42501';
    end if;
    if not service_role_request and new.completed_at is not null then
      raise exception 'Completion time is recorded by the workflow.' using errcode = '42501';
    end if;
    return new;
  end if;

  if actor_role = 'tech' and (
    new.customer_id is distinct from old.customer_id
    or new.assigned_tech_id is distinct from old.assigned_tech_id
    or new.scheduled_at is distinct from old.scheduled_at
    or new.arrival_window_end_at is distinct from old.arrival_window_end_at
    or new.service_address is distinct from old.service_address
    or new.originating_call_id is distinct from old.originating_call_id
  ) then
    raise exception 'Technicians cannot change dispatch, address, or arrival-window fields.' using errcode = '42501';
  end if;

  if actor_role = 'tech' and new.status is distinct from old.status and not (
    (old.status = 'scheduled' and new.status = 'in_progress')
    or (
      old.status = 'in_progress'
      and old.arrived_at is not null
      and new.status = 'complete'
    )
  ) then
    raise exception 'Technicians can only start an assigned job or complete an arrived job.' using errcode = '42501';
  end if;

  if actor_role = 'call_center' and new.status is distinct from old.status then
    raise exception 'Call center users cannot change job workflow status.' using errcode = '42501';
  end if;

  if old.arrived_at is not null and not service_role_request then
    if new.assigned_tech_id is distinct from old.assigned_tech_id
      or new.scheduled_at is distinct from old.scheduled_at
      or new.arrival_window_end_at is distinct from old.arrival_window_end_at then
      raise exception 'Dispatch fields are locked after arrival is recorded.' using errcode = '42501';
    end if;
    if new.status = 'scheduled' then
      raise exception 'An arrived job cannot return to scheduled status.' using errcode = '42501';
    end if;
  end if;

  if old.arrived_at is null
    and old.arrival_window_end_at is not null
    and new.scheduled_at is distinct from old.scheduled_at
    and new.arrival_window_end_at is not distinct from old.arrival_window_end_at then
    new.arrival_window_end_at := old.arrival_window_end_at + (new.scheduled_at - old.scheduled_at);
  end if;

  if not service_role_request and old.status is distinct from 'complete' and new.status = 'complete' then
    if old.arrived_at is null or old.status <> 'in_progress' then
      raise exception 'Only an arrived job in progress can be completed.' using errcode = '42501';
    end if;
    new.completed_at := statement_timestamp();
  elsif not service_role_request and new.completed_at is distinct from old.completed_at then
    raise exception 'Completion time is recorded by the workflow.' using errcode = '42501';
  end if;

  if new.arrived_at is distinct from old.arrived_at then
    if old.arrived_at is not null then
      raise exception 'The recorded arrival time is immutable.' using errcode = '42501';
    end if;
    if not (coalesce(actor_role in ('owner', 'tech'), false) or service_role_request) then
      raise exception 'This role cannot record a technician arrival.' using errcode = '42501';
    end if;
    if new.status not in ('scheduled', 'in_progress') then
      raise exception 'Only active jobs can record an arrival.' using errcode = '42501';
    end if;
    new.arrived_at := statement_timestamp();
    new.status := 'in_progress';
  elsif old.arrived_at is null and old.status is distinct from 'in_progress' and new.status = 'in_progress' then
    if not (coalesce(actor_role in ('owner', 'tech'), false) or service_role_request) then
      raise exception 'This role cannot start a job.' using errcode = '42501';
    end if;
    new.arrived_at := statement_timestamp();
  end if;

  return new;
end;
$$;

create or replace function public.render_job_confirmation_subject(
  p_event_type text,
  p_channel text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_channel = 'sms' then ''
    when p_event_type = 'cancellation' then 'Fast Track service appointment cancelled'
    when p_event_type = 'reschedule' then 'Fast Track service appointment updated'
    else 'Fast Track service appointment confirmation'
  end;
$$;

create or replace function public.render_job_confirmation_body(
  p_event_type text,
  p_channel text,
  p_customer_name text,
  p_window_start_at timestamptz,
  p_window_end_at timestamptz,
  p_service_address text
)
returns text
language plpgsql
stable
set search_path = ''
set timezone = 'America/New_York'
as $$
declare
  start_date date := p_window_start_at::date;
  end_date date := p_window_end_at::date;
  window_label text;
  greeting text := case
    when nullif(trim(p_customer_name), '') is null then ''
    else 'Hello ' || trim(p_customer_name) || '. '
  end;
  body text;
begin
  if start_date = end_date then
    window_label :=
      to_char(p_window_start_at, 'Dy, Mon FMDD, YYYY "at" FMHH12:MI AM TZ')
      || ' to '
      || to_char(p_window_end_at, 'FMHH12:MI AM TZ');
  else
    window_label :=
      to_char(p_window_start_at, 'Dy, Mon FMDD, YYYY "at" FMHH12:MI AM TZ')
      || ' to '
      || to_char(p_window_end_at, 'Dy, Mon FMDD, YYYY "at" FMHH12:MI AM TZ');
  end if;

  body := case p_event_type
    when 'cancellation' then
      greeting || 'Your Fast Track service appointment for ' || window_label
      || ' at ' || trim(p_service_address) || ' has been cancelled.'
    when 'reschedule' then
      greeting || 'Your Fast Track service appointment has been updated to ' || window_label
      || ' at ' || trim(p_service_address)
      || '. The technician may arrive at any time within this service window.'
      || ' Service duration is separate from the arrival window.'
      || ' If we expect to arrive after the window, Fast Track will contact you.'
    else
      greeting || 'Your Fast Track service appointment is confirmed for ' || window_label
      || ' at ' || trim(p_service_address)
      || '. The technician may arrive at any time within this service window.'
      || ' Service duration is separate from the arrival window.'
      || ' If we expect to arrive after the window, Fast Track will contact you.'
  end;

  if p_channel = 'sms' then
    body := body || ' Reply STOP to opt out.';
  end if;

  return body;
end;
$$;

create or replace function public.enqueue_job_notification_channels(
  p_job_id uuid,
  p_revision bigint,
  p_event_type text,
  p_request_source text,
  p_manual_request_id uuid default null,
  p_requested_by uuid default null
)
returns setof public.appointment_notifications
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job_row public.jobs%rowtype;
  customer_row public.customers%rowtype;
  channel_name text;
  destination_value text;
  delivery_status text;
  error_code text;
  error_message text;
  phone_digits text;
  effective_window_end timestamptz;
  prior_notification_id uuid;
  inserted_row public.appointment_notifications%rowtype;
begin
  if p_event_type not in ('confirmation', 'reschedule', 'cancellation', 'manual_resend') then
    raise exception 'Unsupported appointment notification event.' using errcode = '22023';
  end if;

  if p_request_source not in ('auto', 'manual') then
    raise exception 'Unsupported appointment notification source.' using errcode = '22023';
  end if;

  select * into job_row
  from public.jobs
  where id = p_job_id;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  select * into customer_row
  from public.customers
  where id = job_row.customer_id;

  if not found then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;

  effective_window_end := coalesce(job_row.arrival_window_end_at, job_row.scheduled_at + interval '3 hours');
  phone_digits := public.notification_us_phone_digits(customer_row.phone);

  foreach channel_name in array array['email'::text, 'sms'::text]
  loop
    destination_value := null;
    delivery_status := 'queued';
    error_code := null;
    error_message := null;

    if channel_name = 'email' then
      destination_value := nullif(lower(trim(coalesce(customer_row.email, ''))), '');

      if not customer_row.email_notifications_enabled then
        delivery_status := 'suppressed';
        error_code := 'email_notifications_disabled';
        error_message := 'Customer email notifications are disabled.';
      elsif destination_value is null then
        delivery_status := 'suppressed';
        error_code := 'email_missing';
        error_message := 'Customer does not have an email address.';
      elsif destination_value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        delivery_status := 'suppressed';
        error_code := 'email_invalid';
        error_message := 'Customer email address is not valid for delivery.';
      end if;
    else
      if phone_digits ~ '^[0-9]{10}$' then
        destination_value := '+1' || phone_digits;
      end if;

      if customer_row.sms_consent_status <> 'opted_in' then
        delivery_status := 'suppressed';
        error_code := 'sms_consent_' || customer_row.sms_consent_status;
        error_message := 'Customer has not opted in to appointment text messages.';
      elsif customer_row.sms_consent_phone_digits is distinct from phone_digits then
        delivery_status := 'suppressed';
        error_code := 'sms_consent_phone_changed';
        error_message := 'Customer text consent does not match the current phone number.';
      elsif destination_value is null then
        delivery_status := 'suppressed';
        error_code := 'sms_phone_invalid';
        error_message := 'Customer phone number is not a valid US delivery number.';
      end if;
    end if;

    prior_notification_id := null;
    if p_request_source = 'manual' then
      select id into prior_notification_id
      from public.appointment_notifications
      where job_id = p_job_id
        and channel = channel_name
      order by queued_at desc, id desc
      limit 1;
    end if;

    insert into public.appointment_notifications (
      job_id,
      customer_id,
      job_revision,
      event_type,
      channel,
      destination,
      customer_name,
      scheduled_start_at,
      scheduled_end_at,
      service_address,
      message_subject,
      message_body,
      request_source,
      manual_request_id,
      created_by,
      resend_of,
      status,
      idempotency_key,
      suppressed_at,
      last_error_code,
      error_message,
      last_error_at
    ) values (
      job_row.id,
      customer_row.id,
      p_revision,
      p_event_type,
      channel_name,
      coalesce(destination_value, ''),
      customer_row.name,
      job_row.scheduled_at,
      effective_window_end,
      job_row.service_address,
      public.render_job_confirmation_subject(
        case
          when p_event_type = 'manual_resend' and job_row.status = 'cancelled' then 'cancellation'
          when p_event_type = 'manual_resend' then 'confirmation'
          else p_event_type
        end,
        channel_name
      ),
      public.render_job_confirmation_body(
        case
          when p_event_type = 'manual_resend' and job_row.status = 'cancelled' then 'cancellation'
          when p_event_type = 'manual_resend' then 'confirmation'
          else p_event_type
        end,
        channel_name,
        customer_row.name,
        job_row.scheduled_at,
        effective_window_end,
        job_row.service_address
      ),
      p_request_source,
      p_manual_request_id,
      p_requested_by,
      prior_notification_id,
      delivery_status,
      case
        when p_request_source = 'auto' then
          'auto:' || job_row.id::text || ':' || p_revision::text || ':' || p_event_type || ':' || channel_name
        else
          'manual:' || p_requested_by::text || ':' || p_manual_request_id::text || ':' || channel_name
      end,
      case when delivery_status = 'suppressed' then statement_timestamp() else null end,
      error_code,
      error_message,
      case when error_code is not null then statement_timestamp() else null end
    )
    on conflict do nothing
    returning * into inserted_row;

    if found then
      return next inserted_row;
    end if;
  end loop;

  return;
end;
$$;

create or replace function public.enqueue_job_confirmation_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  event_name text;
  event_fingerprint text;
  next_revision bigint;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
      return new;
    end if;
    event_name := 'confirmation';
  else
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      event_name := 'cancellation';
    elsif new.status = 'scheduled' and (
      old.status = 'cancelled'
      or new.scheduled_at is distinct from old.scheduled_at
      or new.arrival_window_end_at is distinct from old.arrival_window_end_at
      or new.service_address is distinct from old.service_address
    ) then
      event_name := 'reschedule';
    else
      return new;
    end if;
  end if;

  event_fingerprint := jsonb_build_array(
    event_name,
    new.status,
    new.scheduled_at,
    coalesce(new.arrival_window_end_at, new.scheduled_at + interval '3 hours'),
    new.service_address
  )::text;

  insert into public.job_notification_state as notification_state (
    job_id,
    revision,
    last_fingerprint,
    last_event_type,
    updated_at
  ) values (
    new.id,
    1,
    event_fingerprint,
    event_name,
    statement_timestamp()
  )
  on conflict (job_id) do update
  set revision = notification_state.revision + 1,
      last_fingerprint = excluded.last_fingerprint,
      last_event_type = excluded.last_event_type,
      updated_at = statement_timestamp()
  where notification_state.last_fingerprint is distinct from excluded.last_fingerprint
  returning revision into next_revision;

  if next_revision is not null then
    perform public.enqueue_job_notification_channels(
      new.id,
      next_revision,
      event_name,
      'auto',
      null,
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_initial_job_confirmation on public.jobs;
create trigger enqueue_initial_job_confirmation
after insert on public.jobs
for each row execute function public.enqueue_job_confirmation_event();

drop trigger if exists enqueue_job_confirmation_change on public.jobs;
create trigger enqueue_job_confirmation_change
after update of scheduled_at, arrival_window_end_at, service_address, status on public.jobs
for each row execute function public.enqueue_job_confirmation_event();

drop function if exists public.queue_manual_job_confirmations(uuid, uuid);

create or replace function public.queue_manual_job_confirmations(
  p_job_id uuid,
  p_request_id uuid,
  p_requested_by uuid
)
returns setof public.appointment_notifications
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := p_requested_by;
  actor_role text;
  job_row public.jobs%rowtype;
  state_row public.job_notification_state%rowtype;
  event_name text;
  event_fingerprint text;
  existing_count bigint;
  recent_request_count bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can queue appointment confirmations.' using errcode = '42501';
  end if;

  if p_job_id is null or p_request_id is null or actor_id is null then
    raise exception 'Job ID, request ID, and requesting user are required.' using errcode = '22004';
  end if;

  select allowed_user.role into actor_role
  from public.allowed_users allowed_user
  where allowed_user.id = actor_id
    and allowed_user.active;

  if not found or actor_role not in ('owner', 'call_center') then
    raise exception 'Requested sender must be an active owner or call-center user.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.appointment_notifications notification
    where notification.request_source = 'manual'
      and notification.created_by = actor_id
      and notification.manual_request_id = p_request_id
      and notification.job_id <> p_job_id
  ) then
    raise exception 'Request ID was already used for another appointment.' using errcode = '22023';
  end if;

  return query
  select notification.*
  from public.appointment_notifications notification
  where notification.request_source = 'manual'
    and notification.created_by = actor_id
    and notification.manual_request_id = p_request_id
    and notification.job_id = p_job_id
  order by notification.channel;

  get diagnostics existing_count = row_count;
  if existing_count > 0 then
    return;
  end if;

  select * into job_row
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  -- Recheck after taking the job lock so concurrent retries with the same UUID
  -- return the first request instead of tripping the resend throttle.
  return query
  select notification.*
  from public.appointment_notifications notification
  where notification.request_source = 'manual'
    and notification.created_by = actor_id
    and notification.manual_request_id = p_request_id
    and notification.job_id = p_job_id
  order by notification.channel;

  get diagnostics existing_count = row_count;
  if existing_count > 0 then
    return;
  end if;

  if job_row.status not in ('scheduled', 'cancelled') then
    raise exception 'Only scheduled or cancelled appointments can be resent.' using errcode = '22023';
  end if;

  if coalesce(job_row.arrival_window_end_at, job_row.scheduled_at + interval '3 hours') <= statement_timestamp() then
    raise exception 'The appointment service window has already ended.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.appointment_notifications notification
    where notification.job_id = p_job_id
      and notification.request_source = 'manual'
      and notification.queued_at > statement_timestamp() - interval '30 seconds'
  ) then
    raise exception 'Wait 30 seconds before requesting another manual confirmation.' using errcode = '55000';
  end if;

  select count(distinct notification.manual_request_id) into recent_request_count
  from public.appointment_notifications notification
  where notification.job_id = p_job_id
    and notification.request_source = 'manual'
    and notification.queued_at > statement_timestamp() - interval '1 hour';

  if recent_request_count >= 10 then
    raise exception 'This appointment has reached the hourly manual confirmation limit.' using errcode = '54000';
  end if;

  event_name := case when job_row.status = 'cancelled' then 'cancellation' else 'confirmation' end;
  event_fingerprint := jsonb_build_array(
    event_name,
    job_row.status,
    job_row.scheduled_at,
    coalesce(job_row.arrival_window_end_at, job_row.scheduled_at + interval '3 hours'),
    job_row.service_address
  )::text;

  insert into public.job_notification_state (
    job_id,
    revision,
    last_fingerprint,
    last_event_type,
    updated_at
  ) values (
    job_row.id,
    1,
    event_fingerprint,
    event_name,
    statement_timestamp()
  )
  on conflict (job_id) do nothing;

  select * into state_row
  from public.job_notification_state
  where job_id = job_row.id;

  perform public.enqueue_job_notification_channels(
    job_row.id,
    state_row.revision,
    case when job_row.status = 'cancelled' then 'cancellation' else 'manual_resend' end,
    'manual',
    p_request_id,
    actor_id
  );

  return query
  select notification.*
  from public.appointment_notifications notification
  where notification.request_source = 'manual'
    and notification.created_by = actor_id
    and notification.manual_request_id = p_request_id
    and notification.job_id = p_job_id
  order by notification.channel;
end;
$$;

create or replace function public.claim_job_confirmations(
  p_job_id uuid,
  p_include_failed boolean default false
)
returns setof public.appointment_notifications
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_allowed_user_id();
  actor_role text := public.current_allowed_role();
  service_role_request boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not service_role_request and (actor_id is null or actor_role not in ('owner', 'call_center')) then
    raise exception 'Only an active owner or call-center user can claim appointment confirmations.' using errcode = '42501';
  end if;

  if p_job_id is null then
    raise exception 'Job ID is required.' using errcode = '22004';
  end if;

  -- A timed-out SMS claim is ambiguous because the provider may have accepted it
  -- before the database acknowledgement failed. Do not auto-reclaim and duplicate it.
  update public.appointment_notifications notification
  set status = 'failed',
      failed_at = statement_timestamp(),
      last_error_code = 'sms_delivery_state_unknown',
      error_message = 'Text delivery could not be confirmed. Review before sending another text.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.status = 'processing'
    and notification.channel = 'sms'
    and notification.locked_until < statement_timestamp();

  update public.appointment_notifications notification
  set status = 'failed',
      failed_at = statement_timestamp(),
      last_error_code = 'attempt_limit_reached',
      error_message = 'Automatic delivery retry limit reached.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.status = 'processing'
    and notification.channel = 'email'
    and notification.attempt_count >= 5
    and notification.locked_until < statement_timestamp();

  update public.appointment_notifications notification
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      last_error_code = 'attempt_limit_reached',
      error_message = 'Automatic delivery retry limit reached. Review before manually resending.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.status = 'failed'
    and notification.attempt_count >= 5
    and notification.last_error_code is distinct from 'sms_delivery_state_unknown';

  update public.appointment_notifications notification
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      last_error_code = 'notification_superseded',
      error_message = 'The appointment or customer delivery details changed before this notification was claimed.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and (
      notification.status = 'queued'
      or (
        notification.status = 'failed'
        and notification.last_error_code is distinct from 'sms_delivery_state_unknown'
      )
      or (
        notification.status = 'processing'
        and notification.channel = 'email'
        and notification.locked_until < statement_timestamp()
      )
    )
    and (
      not exists (
        select 1
        from public.jobs job
        join public.customers customer on customer.id = job.customer_id
        where job.id = notification.job_id
          and (
            (
              notification.event_type = 'cancellation'
              and job.status = 'cancelled'
              and notification.scheduled_start_at = job.scheduled_at
              and notification.scheduled_end_at = coalesce(job.arrival_window_end_at, job.scheduled_at + interval '3 hours')
              and notification.service_address = job.service_address
            )
            or (
              notification.event_type <> 'cancellation'
              and job.status = 'scheduled'
              and notification.scheduled_start_at = job.scheduled_at
              and notification.scheduled_end_at = coalesce(job.arrival_window_end_at, job.scheduled_at + interval '3 hours')
              and notification.service_address = job.service_address
            )
          )
          and (
            (
              notification.channel = 'email'
              and customer.email_notifications_enabled
              and nullif(lower(trim(coalesce(customer.email, ''))), '') = notification.destination
            )
            or (
              notification.channel = 'sms'
              and customer.sms_consent_status = 'opted_in'
              and public.notification_us_phone_digits(customer.phone) ~ '^[0-9]{10}$'
              and '+1' || public.notification_us_phone_digits(customer.phone) = notification.destination
            )
          )
      )
      or (
        notification.request_source = 'auto'
        and not exists (
          select 1
          from public.job_notification_state notification_state
          where notification_state.job_id = notification.job_id
            and notification_state.revision = notification.job_revision
        )
      )
    );

  return query
  with claimable as (
    select notification.id
    from public.appointment_notifications notification
    where notification.job_id = p_job_id
      and notification.available_at <= statement_timestamp()
      and notification.attempt_count < 5
      and (
        notification.status = 'queued'
        or (
          coalesce(p_include_failed, false)
          and notification.status = 'failed'
          and notification.last_error_code is distinct from 'sms_delivery_state_unknown'
          and notification.last_error_code is distinct from 'provider_permanent_failure'
          and notification.last_error_code is distinct from 'sms_recipient_opted_out'
        )
        or (
          notification.status = 'processing'
          and notification.channel = 'email'
          and notification.locked_until < statement_timestamp()
        )
      )
    order by notification.job_revision, notification.queued_at, notification.channel
    for update skip locked
  )
  update public.appointment_notifications notification
  set status = 'processing',
      attempt_count = notification.attempt_count + 1,
      last_attempt_at = statement_timestamp(),
      processing_at = statement_timestamp(),
      locked_until = statement_timestamp() + interval '2 minutes',
      claimed_by = actor_id,
      updated_at = statement_timestamp()
  from claimable
  where notification.id = claimable.id
  returning notification.*;
end;
$$;

create or replace function public.claim_job_confirmations(
  p_job_id uuid,
  p_include_failed boolean default false
)
returns setof public.appointment_notifications
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can claim appointment confirmations.' using errcode = '42501';
  end if;

  if p_job_id is null then
    raise exception 'Job ID is required.' using errcode = '22004';
  end if;

  -- Never deliver a snapshot after its promised arrival window.
  update public.appointment_notifications notification
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      last_error_code = 'notification_expired',
      error_message = 'The appointment window ended before this notification could be delivered.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.scheduled_end_at <= statement_timestamp()
    and (
      notification.status in ('queued', 'failed')
      or (
        notification.status = 'processing'
        and coalesce(notification.locked_until, '-infinity'::timestamptz) < statement_timestamp()
      )
    );

  -- An expired SMS lease is ambiguous: the provider may have accepted it before
  -- the worker could persist acknowledgement. Never retry it automatically.
  update public.appointment_notifications notification
  set status = 'failed',
      failed_at = statement_timestamp(),
      last_error_code = 'sms_delivery_state_unknown',
      error_message = 'Text delivery could not be confirmed. Review before sending another text.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.status = 'processing'
    and notification.channel = 'sms'
    and coalesce(notification.locked_until, '-infinity'::timestamptz) < statement_timestamp();

  update public.appointment_notifications notification
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      last_error_code = 'attempt_limit_reached',
      error_message = 'Automatic delivery retry limit reached. Review before manually resending.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.status = 'processing'
    and notification.channel = 'email'
    and notification.attempt_count >= 5
    and coalesce(notification.locked_until, '-infinity'::timestamptz) < statement_timestamp();

  update public.appointment_notifications notification
  set status = 'failed',
      failed_at = statement_timestamp(),
      last_error_code = 'provider_temporary_failure',
      error_message = 'Email delivery acknowledgement timed out and will be retried.',
      last_error_at = statement_timestamp(),
      available_at = statement_timestamp() + case
        when notification.attempt_count <= 1 then interval '30 seconds'
        when notification.attempt_count = 2 then interval '2 minutes'
        when notification.attempt_count = 3 then interval '5 minutes'
        else interval '15 minutes'
      end,
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.status = 'processing'
    and notification.channel = 'email'
    and notification.attempt_count < 5
    and coalesce(notification.locked_until, '-infinity'::timestamptz) < statement_timestamp();

  update public.appointment_notifications notification
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      last_error_code = 'attempt_limit_reached',
      error_message = 'Automatic delivery retry limit reached. Review before manually resending.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and notification.status = 'failed'
    and notification.attempt_count >= 5
    and notification.last_error_code = 'provider_temporary_failure';

  -- Revalidate mutable job/customer state immediately before a provider claim.
  update public.appointment_notifications notification
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      last_error_code = 'notification_superseded',
      error_message = 'The appointment or customer delivery details changed before this notification was claimed.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  where notification.job_id = p_job_id
    and (
      notification.status = 'queued'
      or (
        notification.status = 'failed'
        and notification.last_error_code = 'provider_temporary_failure'
      )
    )
    and (
      notification.scheduled_end_at <= statement_timestamp()
      or not exists (
        select 1
        from public.jobs job
        join public.customers customer on customer.id = job.customer_id
        where job.id = notification.job_id
          and (
            (
              notification.event_type = 'cancellation'
              and job.status = 'cancelled'
              and notification.scheduled_start_at = job.scheduled_at
              and notification.scheduled_end_at = coalesce(job.arrival_window_end_at, job.scheduled_at + interval '3 hours')
              and notification.service_address = job.service_address
            )
            or (
              notification.event_type <> 'cancellation'
              and job.status = 'scheduled'
              and notification.scheduled_start_at = job.scheduled_at
              and notification.scheduled_end_at = coalesce(job.arrival_window_end_at, job.scheduled_at + interval '3 hours')
              and notification.service_address = job.service_address
            )
          )
          and (
            (
              notification.channel = 'email'
              and customer.email_notifications_enabled
              and nullif(lower(trim(coalesce(customer.email, ''))), '') = notification.destination
            )
            or (
              notification.channel = 'sms'
              and customer.sms_consent_status = 'opted_in'
              and customer.sms_consent_phone_digits ~ '^[0-9]{10}$'
              and customer.sms_consent_phone_digits = customer.phone_digits
              and '+1' || customer.sms_consent_phone_digits = notification.destination
            )
          )
      )
      or (
        notification.request_source = 'auto'
        and not exists (
          select 1
          from public.job_notification_state notification_state
          where notification_state.job_id = notification.job_id
            and notification_state.revision = notification.job_revision
        )
      )
    );

  -- Across automatic and manual requests, only the newest row for each channel
  -- remains eligible. Terminal or in-flight newer rows also fence older work.
  with ranked as (
    select
      notification.id,
      row_number() over (
        partition by notification.channel
        order by notification.job_revision desc, notification.queued_at desc, notification.id desc
      ) as channel_position
    from public.appointment_notifications notification
    where notification.job_id = p_job_id
      and notification.status in ('queued', 'processing', 'accepted', 'failed', 'suppressed', 'cancelled')
  )
  update public.appointment_notifications notification
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      last_error_code = 'notification_superseded',
      error_message = 'A newer appointment notification replaced this pending delivery.',
      last_error_at = statement_timestamp(),
      locked_until = null,
      updated_at = statement_timestamp()
  from ranked
  where notification.id = ranked.id
    and ranked.channel_position > 1
    and (
      notification.status = 'queued'
      or (
        notification.status = 'failed'
        and notification.last_error_code = 'provider_temporary_failure'
      )
    );

  return query
  with latest_candidate as (
    select distinct on (notification.channel)
      notification.id
    from public.appointment_notifications notification
    where notification.job_id = p_job_id
      and notification.scheduled_end_at > statement_timestamp()
      and notification.available_at <= statement_timestamp()
      and notification.attempt_count < 5
      and (
        notification.status = 'queued'
        or (
          coalesce(p_include_failed, false)
          and notification.status = 'failed'
          and notification.last_error_code = 'provider_temporary_failure'
        )
      )
      and not exists (
        select 1
        from public.appointment_notifications active_claim
        where active_claim.job_id = notification.job_id
          and active_claim.channel = notification.channel
          and active_claim.status = 'processing'
          and coalesce(active_claim.locked_until, 'infinity'::timestamptz) >= statement_timestamp()
      )
    order by notification.channel, notification.job_revision desc, notification.queued_at desc, notification.id desc
  ), claimable as (
    select notification.id
    from public.appointment_notifications notification
    join latest_candidate on latest_candidate.id = notification.id
    order by notification.job_revision, notification.queued_at, notification.channel
    for update of notification skip locked
  )
  update public.appointment_notifications notification
  set status = 'processing',
      attempt_count = notification.attempt_count + 1,
      last_attempt_at = statement_timestamp(),
      processing_at = statement_timestamp(),
      locked_until = statement_timestamp() + interval '2 minutes',
      claim_token = gen_random_uuid(),
      claimed_by = null,
      failed_at = null,
      last_error_code = null,
      error_message = null,
      last_error_at = null,
      updated_at = statement_timestamp()
  from claimable
  where notification.id = claimable.id
  returning notification.*;
end;
$$;

drop function if exists public.complete_job_confirmation(uuid, text, text, text, text, text, text);
drop function if exists public.complete_job_confirmation(uuid, text, text, text, text, text, text, text);

create or replace function public.complete_job_confirmation(
  p_notification_id uuid,
  p_claim_token uuid,
  p_status text,
  p_provider text,
  p_provider_message_id text,
  p_message_subject text,
  p_message_body text,
  p_error_message text,
  p_error_code text
)
returns public.appointment_notifications
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  notification_row public.appointment_notifications%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can complete appointment confirmations.' using errcode = '42501';
  end if;

  if p_notification_id is null or p_claim_token is null then
    raise exception 'Notification ID and claim token are required.' using errcode = '22004';
  end if;

  if p_status not in ('accepted', 'failed') then
    raise exception 'Completion status must be accepted or failed.' using errcode = '22023';
  end if;

  if p_status = 'failed' and (
    p_error_code is null
    or p_error_code not in (
      'provider_temporary_failure',
      'provider_permanent_failure',
      'sms_recipient_opted_out',
      'sms_delivery_state_unknown'
    )
  ) then
    raise exception 'Unsupported notification delivery error code.' using errcode = '22023';
  end if;

  if p_status = 'accepted' and p_error_code is not null then
    raise exception 'Accepted delivery cannot include an error code.' using errcode = '22023';
  end if;

  select * into notification_row
  from public.appointment_notifications
  where id = p_notification_id
  for update;

  if not found then
    raise exception 'Appointment notification not found.' using errcode = 'P0002';
  end if;

  if notification_row.claim_token is distinct from p_claim_token then
    raise exception 'Notification claim token is stale or invalid.' using errcode = '42501';
  end if;

  if p_message_subject is distinct from notification_row.message_subject
    or p_message_body is distinct from notification_row.message_body then
    raise exception 'Provider content must match the server-generated notification snapshot.' using errcode = '22023';
  end if;

  if notification_row.status = p_status then
    return notification_row;
  end if;

  if notification_row.status <> 'processing' then
    raise exception 'Only a claimed processing notification can be completed.' using errcode = '55000';
  end if;

  if p_status = 'accepted' and (
    nullif(trim(coalesce(p_provider, '')), '') is null
    or nullif(trim(coalesce(p_provider_message_id, '')), '') is null
  ) then
    raise exception 'Accepted notifications require provider identifiers.' using errcode = '22023';
  end if;

  if p_error_code = 'sms_recipient_opted_out' and notification_row.channel <> 'sms' then
    raise exception 'SMS opt-out failures require an SMS notification.' using errcode = '22023';
  end if;

  -- A synchronous Twilio 21610 rejection must revoke SMS eligibility in the
  -- same transaction that records the failed send. This prevents a later job
  -- revision from queueing another text before a webhook can arrive.
  if p_status = 'failed'
    and p_error_code = 'sms_recipient_opted_out'
    and notification_row.channel = 'sms'
    and notification_row.customer_id is not null then
    update public.customers customer
    set sms_consent_status = 'opted_out',
        sms_consent_source = 'twilio_error_21610'
    where customer.id = notification_row.customer_id
      and customer.phone_digits ~ '^[0-9]{10}$'
      and customer.sms_consent_phone_digits = customer.phone_digits
      and '+1' || customer.phone_digits = notification_row.destination;
  end if;

  update public.appointment_notifications
  set status = p_status,
      provider = nullif(trim(coalesce(p_provider, '')), ''),
      provider_message_id = nullif(trim(coalesce(p_provider_message_id, '')), ''),
      provider_status = p_status,
      provider_error_code = case when p_status = 'failed' then p_error_code else null end,
      provider_status_at = statement_timestamp(),
      accepted_at = case when p_status = 'accepted' then statement_timestamp() else null end,
      failed_at = case when p_status = 'failed' then statement_timestamp() else null end,
      last_error_code = case
        when p_status = 'failed' then p_error_code
        else null
      end,
      error_message = case
        when p_status = 'failed' then left(coalesce(nullif(trim(p_error_message), ''), 'Provider delivery failed.'), 1000)
        else null
      end,
      last_error_at = case when p_status = 'failed' then statement_timestamp() else null end,
      available_at = case
        when p_status = 'failed' and p_error_code = 'provider_temporary_failure' then
          statement_timestamp() + case
            when notification_row.attempt_count <= 1 then interval '30 seconds'
            when notification_row.attempt_count = 2 then interval '2 minutes'
            when notification_row.attempt_count = 3 then interval '5 minutes'
            else interval '15 minutes'
          end
        else available_at
      end,
      locked_until = null,
      updated_at = statement_timestamp()
  where id = notification_row.id
  returning * into notification_row;

  return notification_row;
end;
$$;

alter table public.customer_sms_consent_events enable row level security;
alter table public.job_notification_state enable row level security;
alter table public.appointment_notifications enable row level security;
alter table public.twilio_webhook_events enable row level security;

drop policy if exists "owner call center read sms consent events" on public.customer_sms_consent_events;
create policy "owner call center read sms consent events"
on public.customer_sms_consent_events for select to authenticated
using (public.is_owner() or public.is_call_center());

drop policy if exists "permitted users read appointment notifications" on public.appointment_notifications;
create policy "permitted users read appointment notifications"
on public.appointment_notifications for select to authenticated
using (
  public.is_owner()
  or public.is_call_center()
  or exists (
    select 1
    from public.jobs job
    where job.id = appointment_notifications.job_id
      and job.assigned_tech_id = public.current_allowed_user_id()
  )
);

revoke all on table public.customer_sms_consent_events from public, anon, authenticated, service_role;
grant select on table public.customer_sms_consent_events to authenticated;
grant select on table public.customer_sms_consent_events to service_role;

revoke all on table public.job_notification_state from public, anon, authenticated;
revoke all on table public.appointment_notifications from public, anon, authenticated;
grant select on table public.appointment_notifications to authenticated;
revoke all on table public.twilio_webhook_events from public, anon, authenticated, service_role;
grant select, insert, update on table public.twilio_webhook_events to service_role;

revoke all on function public.enforce_customer_sms_consent_timestamp() from public, anon, authenticated;
revoke all on function public.record_customer_sms_consent_event() from public, anon, authenticated;
revoke all on function public.notification_us_phone_digits(text) from public, anon, authenticated;
revoke all on function public.record_customer_sms_consent_from_provider(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_customer_sms_consent_from_provider(text, text, text, uuid) to service_role;
revoke all on function public.mark_twilio_webhook_event_processed(text) from public, anon, authenticated, service_role;
grant execute on function public.mark_twilio_webhook_event_processed(text) to service_role;
revoke all on function public.protect_job_workflow_fields() from public, anon, authenticated;
revoke all on function public.render_job_confirmation_subject(text, text) from public, anon, authenticated;
revoke all on function public.render_job_confirmation_body(text, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.enqueue_job_notification_channels(uuid, bigint, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_job_confirmation_event() from public, anon, authenticated;

revoke all on function public.queue_manual_job_confirmations(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.queue_manual_job_confirmations(uuid, uuid, uuid) to service_role;

revoke all on function public.claim_job_confirmations(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.claim_job_confirmations(uuid, boolean) to service_role;

revoke all on function public.complete_job_confirmation(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.complete_job_confirmation(uuid, uuid, text, text, text, text, text, text, text) to service_role;
