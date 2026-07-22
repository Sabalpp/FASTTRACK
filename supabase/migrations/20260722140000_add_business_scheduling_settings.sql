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
