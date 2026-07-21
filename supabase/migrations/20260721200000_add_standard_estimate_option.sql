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
