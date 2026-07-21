import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = read("../supabase/migrations/20260721170000_allow_technician_customer_intake.sql");
const schema = read("../supabase/schema.sql");

describe("technician customer intake database contract", () => {
  it("allows a technician to read only their own newly created customer", () => {
    for (const sql of [migration, schema]) {
      expect(sql).toContain("created_by = public.current_allowed_user_id()");
      expect(sql).toContain("public.is_tech() and created_by = public.current_allowed_user_id()");
    }
  });

  it("allows customer-entered opt-in only during technician intake", () => {
    for (const sql of [migration, schema]) {
      expect(sql).toContain("actor_role = 'tech'");
      expect(sql).toContain("tg_op = 'INSERT'");
      expect(sql).toContain("requested_source = 'customer_intake'");
      expect(sql).toContain("new.sms_consent_source := 'customer_intake'");
    }
  });

  it("keeps technician intake as the latest fresh-install contract", () => {
    expect(schema.endsWith(migration)).toBe(true);
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
