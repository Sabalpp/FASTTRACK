alter table public.jobs
  add column if not exists en_route_at timestamptz;

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
