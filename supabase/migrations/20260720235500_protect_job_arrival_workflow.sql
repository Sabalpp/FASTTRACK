create or replace function public.protect_job_workflow_fields()
returns trigger
language plpgsql
security definer
set search_path = public
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
    return new;
  end if;

  if actor_role = 'tech' and (
    new.customer_id is distinct from old.customer_id
    or new.assigned_tech_id is distinct from old.assigned_tech_id
    or new.scheduled_at is distinct from old.scheduled_at
    or new.arrival_window_end_at is distinct from old.arrival_window_end_at
    or new.originating_call_id is distinct from old.originating_call_id
  ) then
    raise exception 'Technicians cannot change dispatch or arrival-window fields.' using errcode = '42501';
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

  if old.arrived_at is null and old.status is distinct from 'complete' and new.status = 'complete' then
    raise exception 'Record the technician arrival before completing the job.' using errcode = '42501';
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
