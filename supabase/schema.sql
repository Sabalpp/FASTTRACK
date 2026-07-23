-- HVAC + Plumbing MVP Supabase schema
-- Run in a new Supabase SQL editor, then connect the app with .env values.
-- Tables are shaped around: INSPECT -> CHARGE -> CASE -> SECURE -> INVOICE -> EMAIL.

create extension if not exists "pgcrypto";

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

create table if not exists public.allowed_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null check (role in ('owner', 'tech', 'call_center')),
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  phone_digits text generated always as (public.normalize_us_phone(phone)) stored,
  email text,
  email_notifications_enabled boolean not null default true,
  sms_consent_status text not null default 'unknown',
  sms_consent_at timestamptz,
  sms_consent_source text,
  sms_consent_phone_digits text,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null default 'VA',
  zip text not null,
  notes text not null default '',
  search_text tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(phone, '') || ' ' || public.normalize_us_phone(phone)), 'A') ||
    setweight(to_tsvector('simple', coalesce(email, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(address_line1, '') || ' ' || coalesce(address_line2, '') || ' ' || coalesce(city, '') || ' ' || coalesce(state, '') || ' ' || coalesce(zip, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  created_by uuid references public.allowed_users(id),
  constraint customers_sms_consent_status_check
    check (sms_consent_status in ('unknown', 'opted_in', 'opted_out')),
  constraint customers_sms_consent_audit_check
    check (
      sms_consent_status <> 'opted_in'
      or (
        sms_consent_at is not null
        and nullif(trim(coalesce(sms_consent_source, '')), '') is not null
        and char_length(trim(sms_consent_source)) <= 120
      )
    )
);

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  external_id text unique not null,
  customer_id uuid references public.customers(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  caller_phone text not null,
  caller_phone_digits text generated always as (public.normalize_us_phone(caller_phone)) stored,
  caller_name text,
  tracking_number text,
  started_at timestamptz not null default now(),
  duration_seconds integer not null default 0,
  answered boolean not null default false,
  recording_url text,
  transcript text,
  transcript_search tsvector generated always as (to_tsvector('simple', coalesce(transcript, ''))) stored,
  summary text,
  source text,
  tags text[],
  score integer,
  raw_payload jsonb,
  received_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  assigned_tech_id uuid references public.allowed_users(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'complete', 'cancelled')),
  scheduled_at timestamptz not null,
  en_route_at timestamptz,
  arrival_window_end_at timestamptz,
  arrived_at timestamptz,
  service_address text not null,
  description text not null,
  notes text not null default '',
  originating_call_id uuid references public.call_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint jobs_arrival_window_order check (arrival_window_end_at is null or arrival_window_end_at > scheduled_at)
);

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('before', 'after', 'other')),
  caption text,
  uploaded_by uuid references public.allowed_users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  category text not null,
  default_price numeric(10,2) not null default 0,
  unit text not null check (unit in ('each', 'hour', 'lb', 'visit', 'other')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.job_line_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  part_id uuid references public.parts(id) on delete set null,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  tier text not null check (tier in ('standard', 'good', 'better', 'best')),
  is_manual boolean not null default false,
  sort_order integer not null default 0
);

create sequence if not exists public.invoice_number_seq start 1;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  invoice_number text unique not null default ('INV-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0')),
  selected_tier text check (selected_tier in ('standard', 'good', 'better', 'best')),
  subtotal_standard numeric(10,2) not null default 0,
  subtotal_good numeric(10,2) not null default 0,
  subtotal_better numeric(10,2) not null default 0,
  subtotal_best numeric(10,2) not null default 0,
  tax_rate numeric(5,4) not null default 0.0600,
  total_standard numeric(10,2) not null default 0,
  total_good numeric(10,2) not null default 0,
  total_better numeric(10,2) not null default 0,
  total_best numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'cancelled')),
  pdf_storage_path text,
  sent_to_email text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.allowed_users(id) on delete set null
);

create table if not exists public.call_log_events (
  id uuid primary key default gen_random_uuid(),
  call_log_id uuid references public.call_logs(id) on delete set null,
  event_type text not null default 'unknown' check (event_type in ('pre_call', 'post_call', 'call_modified', 'unknown')),
  signature_valid boolean not null default false,
  processed_ok boolean not null default false,
  error text,
  received_at timestamptz not null default now()
);

create index if not exists customers_search_text_gin on public.customers using gin(search_text);
create index if not exists customers_phone_digits_idx on public.customers(phone_digits);
create index if not exists jobs_customer_id_idx on public.jobs(customer_id);
create index if not exists jobs_assigned_tech_id_idx on public.jobs(assigned_tech_id);
create index if not exists jobs_dispatch_window_idx
  on public.jobs(assigned_tech_id, status, scheduled_at, arrival_window_end_at)
  where assigned_tech_id is not null and status in ('scheduled', 'in_progress');
create index if not exists job_photos_job_id_idx on public.job_photos(job_id);
create index if not exists job_line_items_job_id_idx on public.job_line_items(job_id);
create index if not exists invoices_job_id_idx on public.invoices(job_id);
create index if not exists call_logs_customer_id_idx on public.call_logs(customer_id);
create index if not exists call_logs_caller_phone_digits_idx on public.call_logs(caller_phone_digits);
create index if not exists call_logs_transcript_search_gin on public.call_logs using gin(transcript_search);


-- Grants required when creating tables with raw SQL. RLS still decides which rows are visible.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- Fast customer search RPC. RLS still filters the returned rows by role.
create or replace function public.search_customers(search_query text, limit_count integer default 25)
returns setof public.customers
language plpgsql
stable
as $$
declare
  q text := trim(coalesce(search_query, ''));
  digits text := public.normalize_us_phone(search_query);
  tsq tsquery;
begin
  if q = '' then
    return query
      select * from public.customers
      order by created_at desc
      limit limit_count;
    return;
  end if;

  tsq := websearch_to_tsquery('simple', q || ':*');

  return query
    select *
    from public.customers
    where search_text @@ tsq
       or phone_digits like ('%' || digits || '%')
       or lower(name) like lower(q || '%')
       or lower(address_line1) like lower('%' || q || '%')
       or zip like (q || '%')
    order by ts_rank(search_text, tsq) desc, name asc
    limit limit_count;
end;
$$;

grant execute on function public.search_customers(text, integer) to authenticated;

-- Helper functions for RLS using the email embedded in the Supabase Auth JWT.
create or replace function public.current_allowed_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.allowed_users
  where lower(email) = lower(auth.jwt() ->> 'email') and active = true
  limit 1;
$$;

create or replace function public.current_allowed_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.allowed_users
  where lower(email) = lower(auth.jwt() ->> 'email') and active = true
  limit 1;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select public.current_allowed_role() = 'owner';
$$;

create or replace function public.is_call_center()
returns boolean
language sql
stable
as $$
  select public.current_allowed_role() = 'call_center';
$$;

create or replace function public.is_tech()
returns boolean
language sql
stable
as $$
  select public.current_allowed_role() = 'tech';
$$;

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

drop trigger if exists protect_job_workflow_fields on public.jobs;
create trigger protect_job_workflow_fields
before insert or update on public.jobs
for each row execute function public.protect_job_workflow_fields();

create or replace function public.protect_job_en_route_at()
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
    if not service_role_request and new.en_route_at is not null then
      raise exception 'En-route time is recorded after the job is created.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.en_route_at is not distinct from old.en_route_at then
    return new;
  end if;
  if old.en_route_at is not null then
    raise exception 'The recorded en-route time is immutable.' using errcode = '42501';
  end if;
  if not (coalesce(actor_role in ('owner', 'tech'), false) or service_role_request) then
    raise exception 'This role cannot mark a technician en route.' using errcode = '42501';
  end if;
  if new.en_route_at is null or new.arrived_at is not null or new.status <> 'scheduled' then
    raise exception 'Only an unarrived scheduled job can be marked en route.' using errcode = '42501';
  end if;

  new.en_route_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists protect_job_en_route_at on public.jobs;
create trigger protect_job_en_route_at
before insert or update on public.jobs
for each row execute function public.protect_job_en_route_at();

create or replace function public.mark_job_en_route(p_job_id uuid)
returns table(recorded_en_route_at timestamptz)
language sql
volatile
security invoker
set search_path = public
as $$
  update public.jobs
  set en_route_at = coalesce(public.jobs.en_route_at, statement_timestamp())
  where public.jobs.id = p_job_id
    and public.jobs.status = 'scheduled'
    and public.jobs.arrived_at is null
    and (
      public.is_owner()
      or public.jobs.assigned_tech_id = public.current_allowed_user_id()
    )
  returning public.jobs.en_route_at;
$$;

revoke all on function public.mark_job_en_route(uuid) from public;
grant execute on function public.mark_job_en_route(uuid) to authenticated;

create or replace function public.mark_job_arrived(p_job_id uuid)
returns table(recorded_arrived_at timestamptz, job_status text)
language sql
volatile
security invoker
set search_path = public
as $$
  update public.jobs
  set
    arrived_at = coalesce(public.jobs.arrived_at, statement_timestamp()),
    status = case when public.jobs.status = 'scheduled' then 'in_progress' else public.jobs.status end
  where public.jobs.id = p_job_id
    and public.jobs.status in ('scheduled', 'in_progress')
    and (
      public.is_owner()
      or public.jobs.assigned_tech_id = public.current_allowed_user_id()
    )
  returning public.jobs.arrived_at, public.jobs.status;
$$;

revoke all on function public.mark_job_arrived(uuid) from public;
grant execute on function public.mark_job_arrived(uuid) to authenticated;

alter table public.allowed_users enable row level security;
alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.job_photos enable row level security;
alter table public.parts enable row level security;
alter table public.job_line_items enable row level security;
alter table public.invoices enable row level security;
alter table public.call_logs enable row level security;
alter table public.call_log_events enable row level security;

drop policy if exists "active users read allowed users" on public.allowed_users;
drop policy if exists "owner manages allowed users" on public.allowed_users;
drop policy if exists "role reads permitted customers" on public.customers;
drop policy if exists "owner call center tech create customers" on public.customers;
drop policy if exists "owner call center update customers" on public.customers;
drop policy if exists "owner deletes customers" on public.customers;
drop policy if exists "read permitted jobs" on public.jobs;
drop policy if exists "owner and call center create jobs" on public.jobs;
drop policy if exists "owner call center tech update jobs" on public.jobs;
drop policy if exists "owner tech assigned read photos" on public.job_photos;
drop policy if exists "owner tech assigned write photos" on public.job_photos;
drop policy if exists "owner and tech read active parts" on public.parts;
drop policy if exists "owner manages parts" on public.parts;
drop policy if exists "owner tech assigned read line items" on public.job_line_items;
drop policy if exists "owner tech assigned write line items" on public.job_line_items;
drop policy if exists "owner tech assigned read invoices" on public.invoices;
drop policy if exists "owner tech assigned create invoice drafts" on public.invoices;
drop policy if exists "owner or assigned tech updates invoice drafts" on public.invoices;
drop policy if exists "read permitted call logs" on public.call_logs;
drop policy if exists "owner reads call events" on public.call_log_events;

-- allowed_users
create policy "active users read allowed users" on public.allowed_users for select using (
  public.is_owner()
  or (active = true and public.current_allowed_user_id() is not null)
);
create policy "owner manages allowed users" on public.allowed_users for all using (public.is_owner()) with check (public.is_owner());

-- customers: owner/call center full; tech can read assigned or self-created intake records.
create policy "role reads permitted customers" on public.customers for select using (
  public.is_owner()
  or public.is_call_center()
  or created_by = public.current_allowed_user_id()
  or exists (
    select 1 from public.jobs j
    where j.customer_id = customers.id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);
create policy "owner call center tech create customers" on public.customers for insert with check (
  public.is_owner()
  or public.is_call_center()
  or (public.is_tech() and created_by = public.current_allowed_user_id())
);
create policy "owner call center update customers" on public.customers for update using (public.is_owner() or public.is_call_center()) with check (public.is_owner() or public.is_call_center());
create policy "owner deletes customers" on public.customers for delete using (public.is_owner());

-- jobs
create policy "read permitted jobs" on public.jobs for select using (
  public.is_owner()
  or public.is_call_center()
  or assigned_tech_id = public.current_allowed_user_id()
);
create policy "owner and call center create jobs" on public.jobs for insert with check (public.is_owner() or public.is_call_center());
create policy "owner call center tech update jobs" on public.jobs for update using (
  public.is_owner()
  or public.is_call_center()
  or assigned_tech_id = public.current_allowed_user_id()
) with check (
  public.is_owner()
  or public.is_call_center()
  or assigned_tech_id = public.current_allowed_user_id()
);

-- photos
create policy "owner tech assigned read photos" on public.job_photos for select using (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = job_photos.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);
create policy "owner tech assigned write photos" on public.job_photos for all using (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = job_photos.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
) with check (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = job_photos.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);

-- parts
create policy "owner and tech read active parts" on public.parts for select using (public.is_owner() or public.is_tech());
create policy "owner manages parts" on public.parts for all using (public.is_owner()) with check (public.is_owner());

-- line items
create policy "owner tech assigned read line items" on public.job_line_items for select using (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = job_line_items.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);
create policy "owner tech assigned write line items" on public.job_line_items for all using (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = job_line_items.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
) with check (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = job_line_items.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);

-- invoices
create policy "owner tech assigned read invoices" on public.invoices for select using (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = invoices.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);
create policy "owner tech assigned create invoice drafts" on public.invoices for insert with check (
  public.is_owner()
  or exists (
    select 1 from public.jobs j
    where j.id = invoices.job_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);
create policy "owner or assigned tech updates invoice drafts" on public.invoices for update using (
  public.is_owner()
  or (
    status = 'draft'
    and exists (
      select 1 from public.jobs j
      where j.id = invoices.job_id
        and j.assigned_tech_id = public.current_allowed_user_id()
    )
  )
) with check (
  public.is_owner()
  or (
    status = 'draft'
    and exists (
      select 1 from public.jobs j
      where j.id = invoices.job_id
        and j.assigned_tech_id = public.current_allowed_user_id()
    )
  )
);

-- calls: owner/call center read all; tech reads calls for customers on assigned jobs.
create policy "read permitted call logs" on public.call_logs for select using (
  public.is_owner()
  or public.is_call_center()
  or exists (
    select 1 from public.jobs j
    where j.customer_id = call_logs.customer_id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);

-- call_log_events: owner only. Webhook uses service role and bypasses RLS.
create policy "owner reads call events" on public.call_log_events for select using (public.is_owner());

-- Private storage buckets. Create through Supabase Storage UI if SQL bucket insert is restricted.
insert into storage.buckets (id, name, public) values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- Seed common parts for first production testing. Real users must be added to
-- public.allowed_users manually or through the owner-only Users page.
insert into public.parts (name, sku, category, default_price, unit, active) values
  ('Diagnostic Visit', 'DIAG', 'Service', 89.00, 'visit', true),
  ('Labor Hour', 'LABOR-HR', 'Labor', 125.00, 'hour', true),
  ('Run Capacitor', 'CAP-45-5', 'HVAC', 245.00, 'each', true),
  ('Condenser Coil Replacement', 'COIL-COND', 'HVAC', 1850.00, 'each', true),
  ('Drain Line Clearing', 'DRAIN-CLEAR', 'Plumbing', 195.00, 'each', true),
  ('Water Heater Element', 'WH-ELEMENT', 'Plumbing', 275.00, 'each', true),
  ('Refrigerant R-410A', 'R410A', 'HVAC', 145.00, 'lb', true),
  ('Smart Thermostat Install', 'THERMO-SMART', 'HVAC', 425.00, 'each', true)
on conflict do nothing;


-- Storage RLS policies for private job photos and invoice PDFs.
-- Supabase Storage requires policies on storage.objects before authenticated users can upload/read private buckets.
drop policy if exists "job photos read for owner or assigned tech" on storage.objects;
create policy "job photos read for owner or assigned tech"
on storage.objects for select to authenticated
using (
  bucket_id = 'job-photos'
  and (
    public.is_owner()
    or exists (
      select 1 from public.jobs j
      where j.id::text = (storage.foldername(name))[1]
        and j.assigned_tech_id = public.current_allowed_user_id()
    )
  )
);

drop policy if exists "job photos insert for owner or assigned tech" on storage.objects;
create policy "job photos insert for owner or assigned tech"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-photos'
  and (
    public.is_owner()
    or exists (
      select 1 from public.jobs j
      where j.id::text = (storage.foldername(name))[1]
        and j.assigned_tech_id = public.current_allowed_user_id()
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
      where regexp_replace(name, '\.pdf$', '') = i.id::text
        and j.assigned_tech_id = public.current_allowed_user_id()
    )
  )
);

drop policy if exists "invoice pdfs insert by owner" on storage.objects;
create policy "invoice pdfs insert by owner"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'invoices'
  and public.is_owner()
);

drop policy if exists "invoice pdfs update by owner" on storage.objects;
create policy "invoice pdfs update by owner"
on storage.objects for update to authenticated
using (
  bucket_id = 'invoices'
  and public.is_owner()
)
with check (
  bucket_id = 'invoices'
  and public.is_owner()
);

drop policy if exists "invoice pdfs delete by owner" on storage.objects;
create policy "invoice pdfs delete by owner"
on storage.objects for delete to authenticated
using (
  bucket_id = 'invoices'
  and public.is_owner()
);

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

-- Re-run the protected totals trigger for every invoice that predates Phase 4.
-- Preserve the caller's transaction-local setting so this migration does not
-- accidentally authorize unrelated invoice writes later in the transaction.
do $$
declare
  previous_total_sync_setting text := current_setting('fasttrack.invoice_total_sync', true);
begin
  perform set_config('fasttrack.invoice_total_sync', 'on', true);
  update public.invoices
  set updated_at = statement_timestamp();
  perform set_config(
    'fasttrack.invoice_total_sync',
    coalesce(previous_total_sync_setting, ''),
    true
  );
end
$$;

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

create or replace function public.invalidate_invoice_pdf_after_signature_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_invoice_ids uuid[] := array[]::uuid[];
  rendered_signature_changed boolean := false;
begin
  -- PDF versions remain monotonic for auditability, but the current artifact
  -- and delivery receipt are no longer valid whenever a signature rendered in
  -- the invoice PDF is added, replaced, rejected, or moved between invoices.
  -- Work-completion signatures are job evidence and are not rendered there.
  if tg_op = 'INSERT' then
    if new.purpose in ('invoice_approval', 'technician_acknowledgement')
      and new.invoice_id is not null then
      affected_invoice_ids := array_append(affected_invoice_ids, new.invoice_id);
    end if;
  elsif tg_op = 'UPDATE' then
    rendered_signature_changed := new.status is distinct from old.status
      or new.purpose is distinct from old.purpose
      or new.signer_name is distinct from old.signer_name
      or new.signer_role is distinct from old.signer_role
      or new.storage_path is distinct from old.storage_path
      or new.content_sha256 is distinct from old.content_sha256
      or new.document_sha256 is distinct from old.document_sha256
      or new.signed_at is distinct from old.signed_at
      or new.invoice_id is distinct from old.invoice_id;

    if rendered_signature_changed then
      if old.purpose in ('invoice_approval', 'technician_acknowledgement')
        and old.invoice_id is not null then
        affected_invoice_ids := array_append(affected_invoice_ids, old.invoice_id);
      end if;
      if new.purpose in ('invoice_approval', 'technician_acknowledgement')
        and new.invoice_id is not null then
        affected_invoice_ids := array_append(affected_invoice_ids, new.invoice_id);
      end if;
    end if;
  end if;

  if cardinality(affected_invoice_ids) > 0 then
    update public.invoices
    set
      pdf_storage_path = null,
      pdf_generated_at = null,
      pdf_sha256 = null,
      pdf_size_bytes = null,
      sent_to_email = null,
      sent_at = null,
      status = case when payment_status = 'paid' then 'paid' else 'draft' end
    where id = any(affected_invoice_ids);
  end if;

  return new;
end;
$$;

drop trigger if exists invalidate_invoice_pdf_after_signature_change on public.invoice_signatures;
create trigger invalidate_invoice_pdf_after_signature_change
after insert or update on public.invoice_signatures
for each row execute function public.invalidate_invoice_pdf_after_signature_change();

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
  target_job public.jobs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  -- Serialize completion-signature collection with job cancellation and
  -- completion. A request that resolved the job while it was open must not be
  -- able to save a signature after another transaction closes the job.
  if p_purpose = 'work_completion' then
    select * into target_job
    from public.jobs
    where id = p_job_id
    for update;

    if not found then
      raise exception 'Job not found.' using errcode = 'P0002';
    end if;
    if target_job.status <> 'in_progress' or target_job.arrived_at is null then
      raise exception 'Only an arrived job in progress can accept a completion signature.' using errcode = '42501';
    end if;
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
  target_signature public.invoice_signatures;
  target_job public.jobs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  select * into target_signature
  from public.invoice_signatures
  where id = p_signature_id;

  if not found then
    raise exception 'Active signature not found.' using errcode = 'P0002';
  end if;

  -- Completion takes the job lock before the signature lock. Rejection uses
  -- the same order so it cannot wait for completion and then reject the exact
  -- signature that authorized the completed job.
  if target_signature.purpose = 'work_completion' then
    select * into target_job
    from public.jobs
    where id = target_signature.job_id
    for update;

    if target_job.status = 'complete' then
      raise exception 'Reopen the job before rejecting its completion signature.' using errcode = '42501';
    end if;
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
      approved_at = null
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
  current_signature public.invoice_signatures;
  result public.jobs;
  normalized_override_reason text := nullif(trim(coalesce(p_override_reason, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required.' using errcode = '42501';
  end if;

  -- The job lock is also acquired first by record_invoice_signature. This
  -- makes cancellation, signature replacement, and completion serialize in a
  -- deterministic order instead of relying on an application read/update gap.
  select * into current_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

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

  select * into current_signature
  from public.invoice_signatures
  where job_id = p_job_id
    and purpose = 'work_completion'
    and status = 'active'
  for update;

  if p_expected_signature_id is not null then
    if p_override_by is not null or normalized_override_reason is not null then
      raise exception 'A signed completion cannot also use an owner override.' using errcode = '23514';
    end if;
    if current_signature.id is null
      or current_signature.id is distinct from p_expected_signature_id
      or current_signature.document_sha256 is distinct from p_expected_signature_document_sha256 then
      raise exception 'The customer completion signature changed. Review and try again.' using errcode = '40001';
    end if;
  else
    if p_expected_signature_document_sha256 is not null then
      raise exception 'A signature hash requires a signature identifier.' using errcode = '23514';
    end if;
    if current_signature.id is not null then
      raise exception 'A customer completion signature was added. Review and try again.' using errcode = '40001';
    end if;
    if p_override_by is null or normalized_override_reason is null
      or char_length(normalized_override_reason) < 10
      or char_length(normalized_override_reason) > 500 then
      raise exception 'Owner override requires a clear reason of 10 to 500 characters.' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.allowed_users owner_user
      where owner_user.id = p_override_by
        and owner_user.active
        and owner_user.role = 'owner'
    ) then
      raise exception 'Only an active owner can override the customer completion signature.' using errcode = '42501';
    end if;
  end if;

  update public.jobs
  set
    status = 'complete',
    completed_at = statement_timestamp(),
    completion_signature_override_at = case
      when p_expected_signature_id is null then statement_timestamp()
      else null
    end,
    completion_signature_override_by = case
      when p_expected_signature_id is null then p_override_by
      else null
    end,
    completion_signature_override_reason = case
      when p_expected_signature_id is null then normalized_override_reason
      else null
    end
  where id = p_job_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.complete_job_with_signature(
  uuid, text, uuid, uuid, text, text, text, timestamptz, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.complete_job_with_signature(
  uuid, text, uuid, uuid, text, text, text, timestamptz, uuid, text, uuid, text
) to service_role;

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

-- This trigger intentionally sorts after Phase 3's
-- protect_job_workflow_fields trigger. It therefore sees an arrived_at value
-- that Phase 3 may set while starting a job and prevents that implicit change
-- from making an existing completion signature stale.
create or replace function public.protect_work_completion_signed_job_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.invoice_signatures signature
    where signature.job_id = old.id
      and signature.purpose = 'work_completion'
      and signature.status = 'active'
  ) and (
    new.customer_id is distinct from old.customer_id
    or new.service_address is distinct from old.service_address
    or new.description is distinct from old.description
    or new.notes is distinct from old.notes
    or new.arrived_at is distinct from old.arrived_at
  ) then
    raise exception 'Reject the saved work-completion signature before changing signed job details.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_job_completion_signature on public.jobs;
create trigger enforce_job_completion_signature
before update on public.jobs
for each row execute function public.enforce_job_completion_signature();

drop trigger if exists protect_work_completion_signed_job_fields on public.jobs;
create trigger protect_work_completion_signed_job_fields
before update on public.jobs
for each row execute function public.protect_work_completion_signed_job_fields();

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

-- The application now generates and replaces PDFs through its service-role
-- server route. Remove every legacy authenticated mutation policy for this
-- bucket; authenticated users retain read-only access through the policy above.
drop policy if exists "invoice pdfs insert by owner" on storage.objects;
drop policy if exists "invoice pdfs update by owner" on storage.objects;
drop policy if exists "invoice pdfs delete by owner" on storage.objects;

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


-- Permit supervised technician customer intake without granting technicians
-- permission to edit existing customer records or schedule work.

drop policy if exists "role reads permitted customers" on public.customers;
create policy "role reads permitted customers" on public.customers for select using (
  public.is_owner()
  or public.is_call_center()
  or created_by = public.current_allowed_user_id()
  or exists (
    select 1 from public.jobs j
    where j.customer_id = customers.id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);

drop policy if exists "owner call center tech create customers" on public.customers;
create policy "owner call center tech create customers" on public.customers for insert with check (
  public.is_owner()
  or public.is_call_center()
  or (public.is_tech() and created_by = public.current_allowed_user_id())
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
    elsif actor_role = 'tech'
      and tg_op = 'INSERT'
      and new.sms_consent_status = 'opted_in'
      and requested_source = 'customer_intake' then
      new.sms_consent_source := 'customer_intake';
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

-- Add a neutral Standard scope for work that does not need tiered choices.
-- Good / Better / Best remain available, and technicians retain control of
-- line-item descriptions, quantities, prices, and option assignment.

alter table public.job_line_items
  drop constraint if exists job_line_items_tier_check;
alter table public.job_line_items
  add constraint job_line_items_tier_check
  check (tier in ('standard', 'good', 'better', 'best'));

alter table public.invoices
  add column if not exists subtotal_standard numeric(10,2) not null default 0,
  add column if not exists total_standard numeric(10,2) not null default 0;

alter table public.invoices
  drop constraint if exists invoices_selected_tier_check;
alter table public.invoices
  add constraint invoices_selected_tier_check
  check (selected_tier in ('standard', 'good', 'better', 'best'));

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
    coalesce(sum(quantity * unit_price) filter (where tier = 'standard'), 0),
    coalesce(sum(quantity * unit_price) filter (where tier = 'good'), 0),
    coalesce(sum(quantity * unit_price) filter (where tier = 'better'), 0),
    coalesce(sum(quantity * unit_price) filter (where tier = 'best'), 0)
  into new.subtotal_standard, new.subtotal_good, new.subtotal_better, new.subtotal_best
  from public.job_line_items
  where job_id = new.job_id;

  new.subtotal_standard := round(new.subtotal_standard, 2);
  new.subtotal_good := round(new.subtotal_good, 2);
  new.subtotal_better := round(new.subtotal_better, 2);
  new.subtotal_best := round(new.subtotal_best, 2);
  new.total_standard := round(new.subtotal_standard * (1 + new.tax_rate), 2);
  new.total_good := round(new.subtotal_good * (1 + new.tax_rate), 2);
  new.total_better := round(new.subtotal_better * (1 + new.tax_rate), 2);
  new.total_best := round(new.subtotal_best * (1 + new.tax_rate), 2);
  new.updated_at := statement_timestamp();

  selected_total := case new.selected_tier
    when 'standard' then new.total_standard
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

-- Populate the new totals for existing invoice drafts without weakening the
-- protected invoice workflow for any later statement in this transaction.
do $$
declare
  previous_total_sync_setting text := current_setting('fasttrack.invoice_total_sync', true);
begin
  perform set_config('fasttrack.invoice_total_sync', 'on', true);
  update public.invoices set updated_at = statement_timestamp();
  perform set_config(
    'fasttrack.invoice_total_sync',
    coalesce(previous_total_sync_setting, ''),
    true
  );
end
$$;

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
      join public.invoice_signatures work_auth
        on work_auth.id = completion.authorization_signature_id
       and work_auth.job_id = completion.job_id
       and work_auth.purpose = 'work_authorization'
       and work_auth.status = 'active'
       and work_auth.selected_tier = completion.selected_tier
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
-- Applied migration: 20260722090000_relax_authorization_and_invoice_drafts.sql
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
-- Allow an assigned field technician (or owner) to explicitly continue without
-- a before/after photo while retaining an immutable actor-and-time audit record.

alter table public.jobs
  add column if not exists before_photos_skipped_at timestamptz,
  add column if not exists before_photos_skipped_by uuid,
  add column if not exists after_photos_skipped_at timestamptz,
  add column if not exists after_photos_skipped_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_photos_caption_length_check'
      and conrelid = 'public.job_photos'::regclass
  ) then
    alter table public.job_photos
      add constraint job_photos_caption_length_check
      check (caption is null or char_length(caption) <= 240) not valid;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_before_photos_skipped_by_fkey'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_before_photos_skipped_by_fkey
      foreign key (before_photos_skipped_by) references public.allowed_users(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_after_photos_skipped_by_fkey'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_after_photos_skipped_by_fkey
      foreign key (after_photos_skipped_by) references public.allowed_users(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_before_photo_skip_audit_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_before_photo_skip_audit_check check (
        (before_photos_skipped_at is null) = (before_photos_skipped_by is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_after_photo_skip_audit_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_after_photo_skip_audit_check check (
        (after_photos_skipped_at is null) = (after_photos_skipped_by is null)
      );
  end if;
end
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

  if tg_op in ('INSERT', 'UPDATE') and new.kind = 'before' and exists (
    select 1 from public.jobs job
    where job.id = next_job_id and job.before_photos_skipped_at is not null
  ) then
    raise exception 'A before photo cannot be added after that checkpoint was explicitly skipped.' using errcode = '42501';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.kind = 'after' and exists (
    select 1 from public.jobs job
    where job.id = next_job_id and job.after_photos_skipped_at is not null
  ) then
    raise exception 'An after photo cannot be added after that checkpoint was explicitly skipped.' using errcode = '42501';
  end if;

  -- Authorization may precede the first before photo, but any saved before
  -- evidence remains immutable once it exists and is signed against the job.
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
  actor_id uuid := public.current_allowed_user_id();
  actor_role text := public.current_allowed_role();
  authorization_bound_fields_changed boolean;
  completion_bound_fields_changed boolean;
  before_skip_changed boolean;
  after_skip_changed boolean;
  photo_checkpoint_changed boolean;
begin
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), '') <> 'service_role' and (
      new.before_photos_skipped_at is not null
      or new.before_photos_skipped_by is not null
      or new.after_photos_skipped_at is not null
      or new.after_photos_skipped_by is not null
    ) then
      raise exception 'Photo checkpoints must be skipped through the protected workflow.' using errcode = '42501';
    end if;
    return new;
  end if;

  authorization_bound_fields_changed :=
    new.customer_id is distinct from old.customer_id
    or new.service_address is distinct from old.service_address
    or new.description is distinct from old.description
    or new.scheduled_at is distinct from old.scheduled_at
    or new.arrival_window_end_at is distinct from old.arrival_window_end_at;
  completion_bound_fields_changed :=
    authorization_bound_fields_changed
    or new.arrived_at is distinct from old.arrived_at
    or new.notes is distinct from old.notes;
  before_skip_changed :=
    new.before_photos_skipped_at is distinct from old.before_photos_skipped_at
    or new.before_photos_skipped_by is distinct from old.before_photos_skipped_by;
  after_skip_changed :=
    new.after_photos_skipped_at is distinct from old.after_photos_skipped_at
    or new.after_photos_skipped_by is distinct from old.after_photos_skipped_by;
  photo_checkpoint_changed := before_skip_changed or after_skip_changed;

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

  if photo_checkpoint_changed then
    if current_setting('fasttrack.internal_photo_checkpoint_skip', true) is distinct from 'on' then
      raise exception 'Photo checkpoints must be skipped through the protected workflow.' using errcode = '42501';
    end if;
    if before_skip_changed and after_skip_changed then
      raise exception 'Skip one photo checkpoint at a time.' using errcode = '23514';
    end if;
    if actor_id is null or actor_role not in ('owner', 'tech') then
      raise exception 'Only an active owner or assigned technician can skip a job photo.' using errcode = '42501';
    end if;
    if actor_role = 'tech' and old.assigned_tech_id is distinct from actor_id then
      raise exception 'Only the assigned technician can skip this job photo.' using errcode = '42501';
    end if;
    if old.status <> 'in_progress' or old.arrived_at is null then
      raise exception 'Only an arrived job in progress can skip a job photo.' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.invoice_signatures signature
      where signature.job_id = old.id
        and signature.purpose = 'work_completion'
        and signature.status = 'active'
    ) then
      raise exception 'The photo checkpoint is locked by the customer completion signature.' using errcode = '42501';
    end if;

    if before_skip_changed then
      if old.before_photos_skipped_at is not null or old.before_photos_skipped_by is not null then
        raise exception 'The recorded before-photo skip is immutable.' using errcode = '42501';
      end if;
      if exists (
        select 1 from public.job_photos photo
        where photo.job_id = old.id and photo.kind = 'before'
      ) then
        raise exception 'A saved before photo already satisfies this checkpoint.' using errcode = '42501';
      end if;
      new.before_photos_skipped_at := statement_timestamp();
      new.before_photos_skipped_by := actor_id;
    end if;

    if after_skip_changed then
      if old.after_photos_skipped_at is not null or old.after_photos_skipped_by is not null then
        raise exception 'The recorded after-photo skip is immutable.' using errcode = '42501';
      end if;
      if exists (
        select 1 from public.job_photos photo
        where photo.job_id = old.id and photo.kind = 'after'
      ) then
        raise exception 'A saved after photo already satisfies this checkpoint.' using errcode = '42501';
      end if;
      if not exists (
        select 1 from public.invoice_signatures signature
        where signature.job_id = old.id
          and signature.purpose = 'work_authorization'
          and signature.status = 'active'
      ) then
        raise exception 'Collect customer work authorization before skipping the after photo.' using errcode = '42501';
      end if;
      new.after_photos_skipped_at := statement_timestamp();
      new.after_photos_skipped_by := actor_id;
    end if;
  end if;

  if completion_bound_fields_changed or photo_checkpoint_changed then
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
before insert or update on public.jobs
for each row execute function public.protect_work_authorization_signed_job_fields();

create or replace function public.skip_job_photo_checkpoint(p_job_id uuid, p_kind text)
returns public.jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid := public.current_allowed_user_id();
  actor_role text := public.current_allowed_role();
  target_job public.jobs;
  result public.jobs;
begin
  if coalesce(auth.role(), '') <> 'authenticated'
    or actor_id is null
    or actor_role not in ('owner', 'tech') then
    raise exception 'Only an active owner or assigned technician can skip a job photo.' using errcode = '42501';
  end if;
  if p_kind not in ('before', 'after') then
    raise exception 'Choose a before or after photo checkpoint.' using errcode = '23514';
  end if;

  select * into target_job
  from public.jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if actor_role = 'tech' and target_job.assigned_tech_id is distinct from actor_id then
    raise exception 'Only the assigned technician can skip this job photo.' using errcode = '42501';
  end if;
  if target_job.status <> 'in_progress' or target_job.arrived_at is null then
    raise exception 'Only an arrived job in progress can skip a job photo.' using errcode = '42501';
  end if;

  if p_kind = 'before'
    and target_job.before_photos_skipped_at is not null
    and target_job.before_photos_skipped_by is not null then
    return target_job;
  end if;
  if p_kind = 'after'
    and target_job.after_photos_skipped_at is not null
    and target_job.after_photos_skipped_by is not null then
    return target_job;
  end if;

  if exists (
    select 1 from public.job_photos photo
    where photo.job_id = p_job_id and photo.kind = p_kind
  ) then
    raise exception 'A saved % photo already satisfies this checkpoint.', p_kind using errcode = '42501';
  end if;
  if exists (
    select 1 from public.invoice_signatures signature
    where signature.job_id = p_job_id
      and signature.purpose = 'work_completion'
      and signature.status = 'active'
  ) then
    raise exception 'The photo checkpoint is locked by the customer completion signature.' using errcode = '42501';
  end if;
  if p_kind = 'after' and not exists (
    select 1 from public.invoice_signatures signature
    where signature.job_id = p_job_id
      and signature.purpose = 'work_authorization'
      and signature.status = 'active'
  ) then
    raise exception 'Collect customer work authorization before skipping the after photo.' using errcode = '42501';
  end if;

  perform set_config('fasttrack.internal_photo_checkpoint_skip', 'on', true);
  if p_kind = 'before' then
    update public.jobs
    set before_photos_skipped_at = statement_timestamp(), before_photos_skipped_by = actor_id
    where id = p_job_id
    returning * into result;
  else
    update public.jobs
    set after_photos_skipped_at = statement_timestamp(), after_photos_skipped_by = actor_id
    where id = p_job_id
    returning * into result;
  end if;
  perform set_config('fasttrack.internal_photo_checkpoint_skip', 'off', true);

  return result;
end;
$$;

revoke all on function public.skip_job_photo_checkpoint(uuid, text) from public, anon, authenticated;
grant execute on function public.skip_job_photo_checkpoint(uuid, text) to authenticated;

-- Server signature persistence rechecks the same after-photo-or-audited-skip
-- invariant while holding the parent job lock.
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
    if (
      target_job.after_photos_skipped_at is null
      or target_job.after_photos_skipped_by is null
    ) and not exists (
      select 1 from public.job_photos
      where job_id = p_job_id and kind = 'after'
    ) then
      raise exception 'An after photo or an audited skip is required before completion.' using errcode = '42501';
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

  if (
    current_job.after_photos_skipped_at is null
    or current_job.after_photos_skipped_by is null
  ) and not exists (
    select 1 from public.job_photos
    where job_id = p_job_id and kind = 'after'
  ) then
    raise exception 'An after photo or an audited skip is required before completion.' using errcode = '42501';
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

revoke all on function public.complete_job_with_signature(
  uuid, text, uuid, uuid, text, text, text, timestamptz, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.complete_job_with_signature(
  uuid, text, uuid, uuid, text, text, text, timestamptz, uuid, text, uuid, text
) to service_role;

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
    if (
      new.after_photos_skipped_at is null
      or new.after_photos_skipped_by is null
    ) and not exists (
      select 1 from public.job_photos
      where job_id = new.id and kind = 'after'
    ) then
      raise exception 'Save an after photo or explicitly skip it before completing this job.' using errcode = '42501';
    end if;
    if exists (
      select 1
      from public.invoice_signatures completion
      join public.invoice_signatures work_auth
        on work_auth.id = completion.authorization_signature_id
       and work_auth.job_id = completion.job_id
       and work_auth.purpose = 'work_authorization'
       and work_auth.status = 'active'
       and work_auth.selected_tier = completion.selected_tier
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
-- Add an immutable payment ledger for Stripe Checkout, cash, and check
-- receipts. Invoice payment totals remain derived server-side from succeeded
-- ledger rows so provider retries and manual collection cannot double count.

alter table public.invoices
  add column if not exists pdf_workflow_revision bigint;

create table if not exists public.invoice_payments (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  method text not null check (method in ('card', 'cash', 'check', 'other')),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded')),
  amount numeric(12,2) not null check (amount > 0),
  refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0 and refunded_amount <= amount),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  reference text check (reference is null or char_length(trim(reference)) between 1 and 120),
  note text check (note is null or char_length(trim(note)) between 1 and 500),
  request_id uuid not null unique,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_checkout_url text,
  provider_status text,
  recorded_by uuid references public.allowed_users(id) on delete set null,
  expires_at timestamptz,
  succeeded_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  refunded_by uuid references public.allowed_users(id) on delete set null,
  reversal_reason text check (reversal_reason is null or char_length(trim(reversal_reason)) between 3 and 300),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint invoice_payments_method_provider_check check (
    (method = 'card' and status <> 'succeeded')
    or (method = 'card' and stripe_checkout_session_id is not null)
    or method <> 'card'
  ),
  constraint invoice_payments_timestamps_check check (
    (succeeded_at is null or succeeded_at >= created_at)
    and (failed_at is null or failed_at >= created_at)
    and (refunded_at is null or refunded_at >= created_at)
    and (expires_at is null or expires_at > created_at)
  )
);

create index if not exists invoice_payments_invoice_created_idx
  on public.invoice_payments(invoice_id, created_at desc);

create unique index if not exists invoice_payments_one_pending_card_idx
  on public.invoice_payments(invoice_id)
  where method = 'card' and status = 'pending';

create or replace function public.assert_invoice_payment_reservations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_total numeric(12,2);
  reserved_total numeric(12,2);
  has_pending_card boolean;
begin
  select
    coalesce(sum(
      case
        when payment.status in ('succeeded', 'partially_refunded') then payment.amount - payment.refunded_amount
        when payment.status = 'pending' and payment.method = 'card' then payment.amount
        else 0
      end
    ), 0),
    coalesce(bool_or(payment.status = 'pending' and payment.method = 'card'), false)
  into reserved_total, has_pending_card
  from public.invoice_payments payment
  where payment.invoice_id = new.id;

  selected_total := case new.selected_tier
    when 'standard' then new.total_standard
    when 'good' then new.total_good
    when 'better' then new.total_better
    when 'best' then new.total_best
    else null
  end;

  if has_pending_card and (
    new.selected_tier is distinct from old.selected_tier
    or new.tax_rate is distinct from old.tax_rate
    or new.total_standard is distinct from old.total_standard
    or new.total_good is distinct from old.total_good
    or new.total_better is distinct from old.total_better
    or new.total_best is distinct from old.total_best
    or new.status = 'cancelled'
    or new.payment_status = 'void'
  ) then
    raise exception 'Finish or expire the open card checkout before changing the invoice price, scope, or status.' using errcode = '55000';
  end if;

  if reserved_total > 0 and (selected_total is null or reserved_total > selected_total) then
    raise exception 'Invoice changes cannot reduce the total below collected or reserved payments.' using errcode = '22003';
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_30_assert_payment_reservations on public.invoices;
create trigger invoice_30_assert_payment_reservations
before update on public.invoices
for each row execute function public.assert_invoice_payment_reservations();

revoke all on function public.assert_invoice_payment_reservations() from public, anon, authenticated;

create or replace function public.protect_invoice_payment_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.amount_paid is distinct from old.amount_paid or new.payment_status is distinct from old.payment_status)
    and coalesce(current_setting('fasttrack.invoice_payment_sync', true), '') <> 'on' then
    raise exception 'Invoice payment totals are derived from the immutable payment ledger.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_15_protect_payment_summary on public.invoices;
create trigger invoice_15_protect_payment_summary
before update of amount_paid, payment_status on public.invoices
for each row execute function public.protect_invoice_payment_summary();

revoke all on function public.protect_invoice_payment_summary() from public, anon, authenticated;

-- Preserve any legacy amount that was recorded before the ledger existed.
-- These rows are intentionally marked as imported rather than guessed as cash
-- or check payments.
insert into public.invoice_payments (
  id,
  invoice_id,
  method,
  status,
  amount,
  refunded_amount,
  currency,
  reference,
  note,
  request_id,
  request_fingerprint,
  recorded_by,
  succeeded_at,
  refunded_at,
  refunded_by,
  reversal_reason,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  invoice.id,
  'other',
  case when invoice.payment_status = 'refunded' then 'refunded' else 'succeeded' end,
  invoice.amount_paid,
  case when invoice.payment_status = 'refunded' then invoice.amount_paid else 0 end,
  'usd',
  'Legacy invoice balance',
  'Imported from the pre-ledger invoice payment record.',
  gen_random_uuid(),
  encode(digest(invoice.id::text || ':legacy-payment', 'sha256'), 'hex'),
  invoice.created_by,
  case when invoice.payment_status = 'refunded' then null else coalesce(invoice.updated_at, invoice.created_at) end,
  case when invoice.payment_status = 'refunded' then coalesce(invoice.updated_at, invoice.created_at) else null end,
  case when invoice.payment_status = 'refunded' then invoice.created_by else null end,
  case when invoice.payment_status = 'refunded' then 'Imported legacy refund state.' else null end,
  coalesce(invoice.updated_at, invoice.created_at),
  coalesce(invoice.updated_at, invoice.created_at)
from public.invoices invoice
where invoice.amount_paid > 0
  and not exists (
    select 1 from public.invoice_payments payment where payment.invoice_id = invoice.id
  );

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing' check (status in ('processing', 'processed', 'ignored', 'failed')),
  error_message text,
  claim_token uuid not null default gen_random_uuid(),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_attempt_at timestamptz not null default statement_timestamp(),
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  constraint stripe_webhook_events_processed_check check (
    (status = 'processing' and processed_at is null)
    or (status <> 'processing' and processed_at is not null)
  )
);

create table if not exists public.stripe_payment_refunds (
  id text primary key check (id ~ '^re_[a-zA-Z0-9_]+$'),
  payment_id uuid not null references public.invoice_payments(id) on delete restrict,
  stripe_payment_intent_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency = 'usd'),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  provider_status text not null,
  failure_reason text,
  provider_created_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index if not exists stripe_payment_refunds_payment_idx
  on public.stripe_payment_refunds(payment_id, provider_created_at);

alter table public.invoice_payments enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_payment_refunds enable row level security;

drop policy if exists "owner assigned tech read invoice payments" on public.invoice_payments;
create policy "owner assigned tech read invoice payments"
on public.invoice_payments for select to authenticated
using (
  public.is_owner()
  or exists (
    select 1
    from public.invoices invoice
    join public.jobs job on job.id = invoice.job_id
    where invoice.id = invoice_payments.invoice_id
      and job.assigned_tech_id = public.current_allowed_user_id()
  )
);

drop policy if exists "no direct invoice payment inserts" on public.invoice_payments;
create policy "no direct invoice payment inserts"
on public.invoice_payments for insert to authenticated
with check (false);

drop policy if exists "no direct invoice payment updates" on public.invoice_payments;
create policy "no direct invoice payment updates"
on public.invoice_payments for update to authenticated
using (false)
with check (false);

drop policy if exists "no direct invoice payment deletes" on public.invoice_payments;
create policy "no direct invoice payment deletes"
on public.invoice_payments for delete to authenticated
using (false);

revoke all on public.invoice_payments from public, anon, authenticated;
grant select on public.invoice_payments to authenticated;
grant all on public.invoice_payments to service_role;

revoke all on public.stripe_webhook_events from public, anon, authenticated;
grant all on public.stripe_webhook_events to service_role;

drop policy if exists "owner assigned tech read stripe refunds" on public.stripe_payment_refunds;
create policy "owner assigned tech read stripe refunds"
on public.stripe_payment_refunds for select to authenticated
using (
  public.is_owner()
  or exists (
    select 1
    from public.invoice_payments payment
    join public.invoices invoice on invoice.id = payment.invoice_id
    join public.jobs job on job.id = invoice.job_id
    where payment.id = stripe_payment_refunds.payment_id
      and job.assigned_tech_id = public.current_allowed_user_id()
  )
);

revoke all on public.stripe_payment_refunds from public, anon, authenticated;
grant select on public.stripe_payment_refunds to authenticated;
grant all on public.stripe_payment_refunds to service_role;

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_payload_sha256 text
)
returns table(decision text, completion_token uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  event_row public.stripe_webhook_events%rowtype;
  new_token uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can claim Stripe events.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_event_id, '')), '') is null
    or nullif(trim(coalesce(p_event_type, '')), '') is null
    or lower(trim(coalesce(p_payload_sha256, ''))) !~ '^[0-9a-f]{64}$' then
    raise exception 'Stripe event identity is invalid.' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events (
    id, event_type, payload_sha256, status
  ) values (
    p_event_id, p_event_type, lower(trim(p_payload_sha256)), 'processing'
  )
  on conflict (id) do nothing
  returning claim_token into new_token;
  if found then
    return query select 'process'::text, new_token;
    return;
  end if;

  select * into event_row
  from public.stripe_webhook_events stripe_event
  where stripe_event.id = p_event_id
  for update;
  if event_row.event_type is distinct from p_event_type
    or event_row.payload_sha256 is distinct from lower(trim(p_payload_sha256)) then
    raise exception 'Stripe event identity conflict.' using errcode = '23505';
  end if;
  if event_row.status in ('processed', 'ignored') then
    return query select 'duplicate'::text, null::uuid;
    return;
  end if;
  if event_row.status = 'processing'
    and event_row.last_attempt_at > statement_timestamp() - interval '5 minutes' then
    return query select 'in_flight'::text, null::uuid;
    return;
  end if;

  new_token := gen_random_uuid();
  update public.stripe_webhook_events stripe_event
  set status = 'processing',
      error_message = null,
      processed_at = null,
      claim_token = new_token,
      attempt_count = stripe_event.attempt_count + 1,
      last_attempt_at = statement_timestamp()
  where stripe_event.id = p_event_id;
  return query select 'process'::text, new_token;
end;
$$;

create or replace function public.complete_stripe_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_status text,
  p_error_message text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(trim(coalesce(p_status, '')));
  affected integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role can complete Stripe events.' using errcode = '42501';
  end if;
  if p_claim_token is null or normalized_status not in ('processed', 'ignored', 'failed') then
    raise exception 'Stripe event completion is invalid.' using errcode = '22023';
  end if;
  update public.stripe_webhook_events stripe_event
  set status = normalized_status,
      error_message = case when normalized_status = 'failed' then left(coalesce(p_error_message, 'Unknown Stripe processing error.'), 500) else null end,
      processed_at = statement_timestamp()
  where stripe_event.id = p_event_id
    and stripe_event.claim_token = p_claim_token
    and stripe_event.status = 'processing';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Stripe event completion token is stale.' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.claim_stripe_webhook_event(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_stripe_webhook_event(text, text, text)
  to service_role;
revoke all on function public.complete_stripe_webhook_event(text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_stripe_webhook_event(text, uuid, text, text)
  to service_role;

create or replace function public.protect_invoice_payment_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invoice public.invoices;
  selected_total numeric(12,2);
  succeeded_total numeric(12,2);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Invoice payments can only be written by the protected server.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Invoice payment audit rows cannot be deleted.' using errcode = '42501';
  end if;

  select * into target_invoice
  from public.invoices
  where id = new.invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  if target_invoice.status = 'cancelled' or target_invoice.payment_status = 'void' then
    raise exception 'A void invoice cannot accept a payment.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.invoice_id is distinct from old.invoice_id
      or new.method is distinct from old.method
      or new.amount is distinct from old.amount
      or new.currency is distinct from old.currency
      or new.request_id is distinct from old.request_id
      or new.request_fingerprint is distinct from old.request_fingerprint
      or new.recorded_by is distinct from old.recorded_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Invoice payment identity, amount, method, and recorder are immutable.' using errcode = '42501';
    end if;

    if new.status is distinct from old.status and not (
      (old.status = 'pending' and new.status in ('succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded'))
      or (old.status = 'succeeded' and new.status in ('partially_refunded', 'refunded'))
      or (old.status = 'partially_refunded' and new.status in ('partially_refunded', 'refunded'))
      or (old.status in ('failed', 'cancelled') and new.status in ('succeeded', 'partially_refunded', 'refunded'))
    ) then
      raise exception 'The invoice payment status transition is not allowed.' using errcode = '42501';
    end if;
    if new.refunded_amount < old.refunded_amount then
      raise exception 'A recorded refund amount cannot decrease.' using errcode = '42501';
    end if;
    if old.refunded_by is not null and new.refunded_by is distinct from old.refunded_by then
      raise exception 'The payment reversal actor is immutable.' using errcode = '42501';
    end if;
  end if;

  if new.method = 'card' and new.status = 'pending' and exists (
    select 1
    from public.invoice_payments payment
    where payment.invoice_id = new.invoice_id
      and payment.method = 'card'
      and payment.status = 'pending'
      and payment.id <> new.id
  ) then
    raise exception 'A card checkout is already open for this invoice.' using errcode = '23505';
  end if;

  if tg_op = 'INSERT' and new.method in ('cash', 'check', 'other') and new.status <> 'succeeded' then
    raise exception 'Manual payment records must be succeeded when recorded.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.method in ('cash', 'check', 'other') and exists (
    select 1
    from public.invoice_payments payment
    where payment.invoice_id = new.invoice_id
      and payment.method = 'card'
      and payment.status = 'pending'
  ) then
    raise exception 'Wait for the open card checkout to finish or expire before recording cash or check.' using errcode = '55000';
  end if;

  if new.status = 'partially_refunded' and (new.refunded_amount <= 0 or new.refunded_amount >= new.amount) then
    raise exception 'A partial refund must be greater than zero and below the payment amount.' using errcode = '23514';
  end if;
  if new.status = 'refunded' and new.refunded_amount <> new.amount then
    raise exception 'A fully refunded payment must record the full refunded amount.' using errcode = '23514';
  end if;
  if new.status not in ('partially_refunded', 'refunded') and new.refunded_amount <> 0 then
    raise exception 'Only refunded payments can record a refunded amount.' using errcode = '23514';
  end if;
  if new.method in ('cash', 'check', 'other') and new.status = 'refunded'
    and (new.refunded_by is null or nullif(trim(coalesce(new.reversal_reason, '')), '') is null) then
    raise exception 'Manual payment reversals require an actor and reason.' using errcode = '23514';
  end if;

  selected_total := case target_invoice.selected_tier
    when 'standard' then target_invoice.total_standard
    when 'good' then target_invoice.total_good
    when 'better' then target_invoice.total_better
    when 'best' then target_invoice.total_best
    else null
  end;
  if selected_total is null or selected_total <= 0 then
    raise exception 'Select non-empty approved work before collecting payment.' using errcode = '42501';
  end if;

  select coalesce(sum(payment.amount - payment.refunded_amount), 0)
  into succeeded_total
  from public.invoice_payments payment
  where payment.invoice_id = new.invoice_id
    and payment.status in ('succeeded', 'partially_refunded')
    and payment.id <> new.id;

  if new.status in ('succeeded', 'partially_refunded') then
    succeeded_total := succeeded_total + (new.amount - new.refunded_amount);
  end if;

  if succeeded_total > selected_total then
    raise exception 'The payment would exceed the invoice balance.' using errcode = '22003';
  end if;
  if new.method = 'card' and new.status = 'pending' and new.amount > selected_total - succeeded_total then
    raise exception 'The card checkout exceeds the invoice balance.' using errcode = '22003';
  end if;

  if new.status = 'succeeded' and new.succeeded_at is null then
    new.succeeded_at := statement_timestamp();
  end if;
  if new.status = 'failed' and new.failed_at is null then
    new.failed_at := statement_timestamp();
  end if;
  if new.status in ('partially_refunded', 'refunded') and new.refunded_at is null then
    new.refunded_at := statement_timestamp();
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists invoice_payment_10_protect_ledger on public.invoice_payments;
create trigger invoice_payment_10_protect_ledger
before insert or update or delete on public.invoice_payments
for each row execute function public.protect_invoice_payment_ledger();

create or replace function public.claim_invoice_payment(
  p_request_id uuid,
  p_invoice_id uuid,
  p_method text,
  p_amount numeric,
  p_currency text,
  p_reference text,
  p_note text,
  p_request_fingerprint text,
  p_recorded_by uuid,
  p_expires_at timestamptz default null
)
returns public.invoice_payments
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  normalized_method text := lower(trim(coalesce(p_method, '')));
  normalized_currency text := lower(trim(coalesce(p_currency, '')));
  normalized_reference text := nullif(trim(coalesce(p_reference, '')), '');
  normalized_note text := nullif(trim(coalesce(p_note, '')), '');
  normalized_fingerprint text := lower(trim(coalesce(p_request_fingerprint, '')));
  requested_user public.allowed_users%rowtype;
  assigned_tech_id uuid;
  payment_row public.invoice_payments%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the protected server can claim invoice payments.' using errcode = '42501';
  end if;
  if p_request_id is null or p_invoice_id is null or p_recorded_by is null then
    raise exception 'Payment request, invoice, and recorder are required.' using errcode = '22004';
  end if;
  if normalized_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Payment request fingerprint is invalid.' using errcode = '22023';
  end if;

  select * into requested_user
  from public.allowed_users allowed_user
  where allowed_user.id = p_recorded_by
    and allowed_user.active;
  if not found or requested_user.role not in ('owner', 'tech') then
    raise exception 'Recorder is not allowed to collect invoice payments.' using errcode = '42501';
  end if;

  -- Serialize by idempotency key and resolve an existing request before any
  -- invoice-balance, pending-checkout, or trigger validation can reject an
  -- otherwise exact replay after the invoice has moved on.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into payment_row
  from public.invoice_payments payment
  where payment.request_id = p_request_id
  for update;
  if found then
    if payment_row.invoice_id is distinct from p_invoice_id
      or payment_row.request_fingerprint is distinct from normalized_fingerprint
      or payment_row.recorded_by is distinct from p_recorded_by then
      raise exception 'Payment request ID was already used for different payment details.' using errcode = '23505';
    end if;
    return payment_row;
  end if;

  if normalized_method not in ('card', 'cash', 'check') then
    raise exception 'Payment method is invalid.' using errcode = '22023';
  end if;
  if normalized_currency <> 'usd' then
    raise exception 'Only USD invoice payments are supported.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception 'Payment amount is invalid.' using errcode = '22023';
  end if;
  if normalized_method = 'check' and normalized_reference is null then
    raise exception 'Check payments require a reference.' using errcode = '22023';
  end if;
  if normalized_method = 'card' and (p_expires_at is null or p_expires_at <= statement_timestamp() + interval '30 minutes') then
    raise exception 'Card checkout expiry must be more than 30 minutes in the future.' using errcode = '22023';
  end if;

  select job.assigned_tech_id into assigned_tech_id
  from public.invoices invoice
  join public.jobs job on job.id = invoice.job_id
  where invoice.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  if requested_user.role = 'tech' and assigned_tech_id is distinct from requested_user.id then
    raise exception 'Technicians can only collect payments for assigned jobs.' using errcode = '42501';
  end if;

  insert into public.invoice_payments (
    id,
    invoice_id,
    method,
    status,
    amount,
    currency,
    reference,
    note,
    request_id,
    request_fingerprint,
    recorded_by,
    expires_at,
    succeeded_at,
    provider_status
  ) values (
    p_request_id,
    p_invoice_id,
    normalized_method,
    case when normalized_method = 'card' then 'pending' else 'succeeded' end,
    p_amount,
    normalized_currency,
    normalized_reference,
    normalized_note,
    p_request_id,
    normalized_fingerprint,
    p_recorded_by,
    case when normalized_method = 'card' then p_expires_at else null end,
    case when normalized_method = 'card' then null else statement_timestamp() end,
    case when normalized_method = 'card' then 'creating' else null end
  )
  returning * into payment_row;

  return payment_row;
end;
$$;

revoke all on function public.claim_invoice_payment(uuid, uuid, text, numeric, text, text, text, text, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_invoice_payment(uuid, uuid, text, numeric, text, text, text, text, uuid, timestamptz)
  to service_role;

create or replace function public.sync_invoice_payment_totals(p_invoice_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target_invoice public.invoices;
  selected_total numeric(12,2);
  paid_total numeric(12,2);
  has_refund boolean;
  next_payment_status text;
  next_invoice_status text;
  previous_payment_sync_setting text := current_setting('fasttrack.invoice_payment_sync', true);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Invoice payment totals can only be synchronized by the protected server.' using errcode = '42501';
  end if;

  select * into target_invoice
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then return; end if;

  selected_total := case target_invoice.selected_tier
    when 'standard' then target_invoice.total_standard
    when 'good' then target_invoice.total_good
    when 'better' then target_invoice.total_better
    when 'best' then target_invoice.total_best
    else null
  end;

  select
    coalesce(sum(payment.amount - payment.refunded_amount) filter (where payment.status in ('succeeded', 'partially_refunded')), 0),
    coalesce(bool_or(payment.refunded_amount > 0), false)
  into paid_total, has_refund
  from public.invoice_payments payment
  where payment.invoice_id = p_invoice_id;

  if target_invoice.status = 'cancelled' or target_invoice.payment_status = 'void' then
    next_payment_status := 'void';
    next_invoice_status := 'cancelled';
  elsif paid_total = 0 and has_refund then
    next_payment_status := 'refunded';
    next_invoice_status := case when target_invoice.sent_at is null then 'draft' else 'sent' end;
  elsif paid_total = 0 then
    next_payment_status := 'unpaid';
    next_invoice_status := case when target_invoice.sent_at is null then 'draft' else 'sent' end;
  elsif selected_total is not null and paid_total = selected_total then
    next_payment_status := 'paid';
    next_invoice_status := 'paid';
  else
    next_payment_status := 'partially_paid';
    next_invoice_status := case when target_invoice.sent_at is null then 'draft' else 'sent' end;
  end if;

  perform set_config('fasttrack.invoice_payment_sync', 'on', true);
  update public.invoices invoice
  set
    amount_paid = paid_total,
    payment_status = next_payment_status,
    status = next_invoice_status,
    pdf_storage_path = case
      when invoice.amount_paid is distinct from paid_total or invoice.payment_status is distinct from next_payment_status then null
      else invoice.pdf_storage_path
    end,
    pdf_generated_at = case
      when invoice.amount_paid is distinct from paid_total or invoice.payment_status is distinct from next_payment_status then null
      else invoice.pdf_generated_at
    end,
    pdf_sha256 = case
      when invoice.amount_paid is distinct from paid_total or invoice.payment_status is distinct from next_payment_status then null
      else invoice.pdf_sha256
    end,
    pdf_size_bytes = case
      when invoice.amount_paid is distinct from paid_total or invoice.payment_status is distinct from next_payment_status then null
      else invoice.pdf_size_bytes
    end,
    pdf_workflow_revision = case
      when invoice.amount_paid is distinct from paid_total or invoice.payment_status is distinct from next_payment_status then null
      else invoice.pdf_workflow_revision
    end,
    updated_at = statement_timestamp()
  where invoice.id = p_invoice_id;
  perform set_config(
    'fasttrack.invoice_payment_sync',
    coalesce(previous_payment_sync_setting, ''),
    true
  );
end;
$$;

revoke all on function public.sync_invoice_payment_totals(uuid) from public, anon, authenticated;
grant execute on function public.sync_invoice_payment_totals(uuid) to service_role;

create or replace function public.after_invoice_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status not in ('succeeded', 'partially_refunded', 'refunded') then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.amount is not distinct from old.amount
    and new.refunded_amount is not distinct from old.refunded_amount then
    return new;
  end if;

  perform public.sync_invoice_payment_totals(new.invoice_id);
  return new;
end;
$$;

drop trigger if exists invoice_payment_20_sync_invoice on public.invoice_payments;
create trigger invoice_payment_20_sync_invoice
after insert or update on public.invoice_payments
for each row execute function public.after_invoice_payment_change();

create or replace function public.protect_stripe_payment_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Stripe refunds can only be written by the protected server.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Stripe refund audit rows cannot be deleted.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.payment_id is distinct from old.payment_id
      or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
      or new.amount is distinct from old.amount
      or new.currency is distinct from old.currency
      or new.provider_created_at is distinct from old.provider_created_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Stripe refund identity and amount are immutable.' using errcode = '42501';
    end if;
    if old.status = 'succeeded' and new.status <> 'succeeded' then
      raise exception 'A succeeded Stripe refund cannot regress.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists stripe_refund_10_protect on public.stripe_payment_refunds;
create trigger stripe_refund_10_protect
before insert or update or delete on public.stripe_payment_refunds
for each row execute function public.protect_stripe_payment_refund();

create or replace function public.record_stripe_payment_refund(
  p_refund_id text,
  p_payment_id uuid,
  p_payment_intent_id text,
  p_amount numeric,
  p_currency text,
  p_status text,
  p_provider_status text,
  p_failure_reason text,
  p_provider_created_at timestamptz
)
returns public.stripe_payment_refunds
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(trim(coalesce(p_status, '')));
  normalized_provider_status text := left(trim(coalesce(p_provider_status, 'unknown')), 80);
  normalized_failure_reason text := nullif(left(trim(coalesce(p_failure_reason, '')), 300), '');
  payment_row public.invoice_payments%rowtype;
  refund_row public.stripe_payment_refunds%rowtype;
  succeeded_refunds numeric(12,2);
  next_payment_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the protected server can record Stripe refunds.' using errcode = '42501';
  end if;
  if p_refund_id !~ '^re_[a-zA-Z0-9_]+$'
    or p_payment_id is null
    or nullif(trim(coalesce(p_payment_intent_id, '')), '') is null
    or p_provider_created_at is null then
    raise exception 'Stripe refund identity is invalid.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount or lower(trim(coalesce(p_currency, ''))) <> 'usd' then
    raise exception 'Stripe refund amount or currency is invalid.' using errcode = '22023';
  end if;
  if normalized_status not in ('pending', 'succeeded', 'failed', 'cancelled') then
    raise exception 'Stripe refund status is invalid.' using errcode = '22023';
  end if;

  select * into payment_row
  from public.invoice_payments payment
  where payment.id = p_payment_id
  for update;
  if not found or payment_row.method <> 'card' then
    raise exception 'Stripe refund payment was not found.' using errcode = 'P0002';
  end if;
  if payment_row.stripe_payment_intent_id is not null
    and payment_row.stripe_payment_intent_id is distinct from p_payment_intent_id then
    raise exception 'Stripe refund payment intent does not match the ledger.' using errcode = '23505';
  end if;

  insert into public.stripe_payment_refunds (
    id, payment_id, stripe_payment_intent_id, amount, currency, status,
    provider_status, failure_reason, provider_created_at
  ) values (
    p_refund_id, p_payment_id, p_payment_intent_id, p_amount, 'usd', normalized_status,
    normalized_provider_status, normalized_failure_reason, p_provider_created_at
  )
  on conflict (id) do nothing
  returning * into refund_row;

  if not found then
    select * into refund_row
    from public.stripe_payment_refunds refund
    where refund.id = p_refund_id
    for update;
    if refund_row.payment_id is distinct from p_payment_id
      or refund_row.stripe_payment_intent_id is distinct from p_payment_intent_id
      or refund_row.amount is distinct from p_amount
      or refund_row.currency <> 'usd' then
      raise exception 'Stripe refund ID was reused with different details.' using errcode = '23505';
    end if;

    if refund_row.status <> 'succeeded' and (
      normalized_status = 'succeeded'
      or refund_row.status = 'pending'
    ) then
      update public.stripe_payment_refunds refund
      set status = normalized_status,
          provider_status = normalized_provider_status,
          failure_reason = normalized_failure_reason
      where refund.id = p_refund_id
      returning * into refund_row;
    end if;
  end if;

  select coalesce(sum(refund.amount) filter (where refund.status = 'succeeded'), 0)
  into succeeded_refunds
  from public.stripe_payment_refunds refund
  where refund.payment_id = p_payment_id;
  if succeeded_refunds > payment_row.amount then
    raise exception 'Stripe refunds exceed the original card payment.' using errcode = '22003';
  end if;

  next_payment_status := case
    when succeeded_refunds = 0 then payment_row.status
    when succeeded_refunds = payment_row.amount then 'refunded'
    else 'partially_refunded'
  end;
  update public.invoice_payments payment
  set stripe_payment_intent_id = coalesce(payment.stripe_payment_intent_id, p_payment_intent_id),
      status = next_payment_status,
      refunded_amount = succeeded_refunds,
      provider_status = case
        when succeeded_refunds = payment.amount then 'refunded'
        when succeeded_refunds > 0 then 'partially_refunded'
        else payment.provider_status
      end,
      succeeded_at = case when succeeded_refunds > 0 then coalesce(payment.succeeded_at, statement_timestamp()) else payment.succeeded_at end,
      refunded_at = case when succeeded_refunds > 0 then statement_timestamp() else payment.refunded_at end
  where payment.id = p_payment_id;

  return refund_row;
end;
$$;

revoke all on function public.record_stripe_payment_refund(text, uuid, text, numeric, text, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stripe_payment_refund(text, uuid, text, numeric, text, text, text, text, timestamptz)
  to service_role;

revoke all on function public.protect_invoice_payment_ledger() from public, anon, authenticated;
revoke all on function public.after_invoice_payment_change() from public, anon, authenticated;
revoke all on function public.protect_stripe_payment_refund() from public, anon, authenticated;

-- One business-wide schedule configuration. Working hours guide presets and
-- dispatch display; they are not database restrictions on job appointment times.

create table if not exists public.business_scheduling_settings (
  id smallint primary key default 1,
  time_zone text not null default 'America/New_York',
  default_arrival_window_minutes integer not null default 180,
  business_day_start_time time without time zone not null default time '08:00',
  business_day_end_time time without time zone not null default time '17:00',
  scheduling_increment_minutes integer not null default 15,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid references public.allowed_users(id) on delete restrict,
  constraint business_scheduling_settings_singleton_check check (id = 1),
  constraint business_scheduling_settings_time_zone_check check (
    char_length(time_zone) between 1 and 100
    and time_zone ~ '^[A-Za-z0-9_+./-]+$'
  ),
  constraint business_scheduling_settings_arrival_window_check check (
    default_arrival_window_minutes between 15 and 720
  ),
  constraint business_scheduling_settings_increment_check check (
    scheduling_increment_minutes in (5, 10, 15, 30, 60)
  ),
  constraint business_scheduling_settings_window_increment_check check (
    mod(default_arrival_window_minutes, scheduling_increment_minutes) = 0
  ),
  constraint business_scheduling_settings_day_order_check check (
    business_day_end_time > business_day_start_time
  ),
  constraint business_scheduling_settings_whole_minute_check check (
    extract(second from business_day_start_time) = 0
    and extract(second from business_day_end_time) = 0
  )
);

insert into public.business_scheduling_settings (
  id,
  time_zone,
  default_arrival_window_minutes,
  business_day_start_time,
  business_day_end_time,
  scheduling_increment_minutes
)
values (1, 'America/New_York', 180, time '08:00', time '17:00', 15)
on conflict (id) do nothing;

create or replace function public.touch_business_scheduling_settings_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists business_scheduling_settings_touch_updated_at
  on public.business_scheduling_settings;
create trigger business_scheduling_settings_touch_updated_at
before update on public.business_scheduling_settings
for each row execute function public.touch_business_scheduling_settings_updated_at();

revoke all on function public.touch_business_scheduling_settings_updated_at() from public, anon, authenticated;

alter table public.business_scheduling_settings enable row level security;

drop policy if exists "active users read business scheduling settings"
  on public.business_scheduling_settings;
create policy "active users read business scheduling settings"
on public.business_scheduling_settings for select to authenticated
using (public.current_allowed_user_id() is not null);

revoke all on public.business_scheduling_settings from public, anon, authenticated;
grant select on public.business_scheduling_settings to authenticated;
grant all on public.business_scheduling_settings to service_role;
