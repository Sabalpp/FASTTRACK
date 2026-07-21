alter table public.jobs
  add column if not exists arrival_window_end_at timestamptz,
  add column if not exists arrived_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_arrival_window_order'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_arrival_window_order
      check (arrival_window_end_at is null or arrival_window_end_at > scheduled_at);
  end if;
end
$$;

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

create index if not exists jobs_dispatch_window_idx
  on public.jobs (assigned_tech_id, status, scheduled_at, arrival_window_end_at)
  where assigned_tech_id is not null
    and status in ('scheduled', 'in_progress');
