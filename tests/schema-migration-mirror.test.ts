import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const migrations = [
  "20260722110000_optional_job_photo_checkpoints.sql",
  "20260722120000_add_invoice_delivery_audit.sql",
  "20260722130000_add_invoice_payment_ledger.sql",
  "20260722140000_add_business_scheduling_settings.sql"
];

describe("canonical schema migration mirror", () => {
  for (const filename of migrations) {
    it(`contains ${filename} verbatim`, () => {
      const migration = readFileSync(`supabase/migrations/${filename}`, "utf8").trimEnd();
      expect(schema).toContain(migration);
    });
  }
});
