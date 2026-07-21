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
