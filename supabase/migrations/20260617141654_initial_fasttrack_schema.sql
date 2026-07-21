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
  created_by uuid references public.allowed_users(id)
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
  service_address text not null,
  description text not null,
  notes text not null default '',
  originating_call_id uuid references public.call_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
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
  tier text not null check (tier in ('good', 'better', 'best')),
  is_manual boolean not null default false,
  sort_order integer not null default 0
);

create sequence if not exists public.invoice_number_seq start 1;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  invoice_number text unique not null default ('INV-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0')),
  selected_tier text check (selected_tier in ('good', 'better', 'best')),
  subtotal_good numeric(10,2) not null default 0,
  subtotal_better numeric(10,2) not null default 0,
  subtotal_best numeric(10,2) not null default 0,
  tax_rate numeric(5,4) not null default 0.0600,
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
set search_path = public
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

-- customers: owner/call center full; tech can read customers attached to assigned jobs.
create policy "role reads permitted customers" on public.customers for select using (
  public.is_owner()
  or public.is_call_center()
  or exists (
    select 1 from public.jobs j
    where j.customer_id = customers.id
      and j.assigned_tech_id = public.current_allowed_user_id()
  )
);
create policy "owner call center tech create customers" on public.customers for insert with check (public.is_owner() or public.is_call_center() or public.is_tech());
create policy "owner call center update customers" on public.customers for update using (public.is_owner() or public.is_call_center()) with check (public.is_owner() or public.is_call_center());

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
