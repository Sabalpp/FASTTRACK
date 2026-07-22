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
