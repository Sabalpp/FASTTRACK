import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260722140000_add_business_scheduling_settings.sql",
  "utf8"
);

describe("business scheduling settings migration", () => {
  it("seeds the current behavior in a single business-wide row", () => {
    expect(migration).toContain("business_scheduling_settings_singleton_check check (id = 1)");
    expect(migration).toContain("default 'America/New_York'");
    expect(migration).toContain("default 180");
    expect(migration).toContain("default time '08:00'");
    expect(migration).toContain("default time '17:00'");
    expect(migration).toContain("scheduling_increment_minutes integer not null default 15");
    expect(migration).toContain("on conflict (id) do nothing");
  });

  it("mirrors API safety constraints at the database boundary", () => {
    expect(migration).toContain("default_arrival_window_minutes between 15 and 720");
    expect(migration).toContain("scheduling_increment_minutes in (5, 10, 15, 30, 60)");
    expect(migration).toContain("mod(default_arrival_window_minutes, scheduling_increment_minutes) = 0");
    expect(migration).toContain("business_day_end_time > business_day_start_time");
    expect(migration).toContain("extract(second from business_day_start_time) = 0");
  });

  it("allows active authenticated reads but keeps all writes behind the owner-gated service API", () => {
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain("using (public.current_allowed_user_id() is not null)");
    expect(migration).toContain("revoke all on public.business_scheduling_settings from public, anon, authenticated");
    expect(migration).toContain("grant select on public.business_scheduling_settings to authenticated");
    expect(migration).toContain("grant all on public.business_scheduling_settings to service_role");
    expect(migration).not.toContain("for update to authenticated");
    expect(migration).not.toContain("for insert to authenticated");
  });

  it("documents that working hours guide scheduling instead of blocking valid appointments", () => {
    expect(migration).toContain("guide presets and");
    expect(migration).toContain("not database restrictions on job appointment times");
  });
});
