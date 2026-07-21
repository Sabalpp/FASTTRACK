import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tierLabels, tierOptions } from "@/lib/data-store";

const migration = read("../supabase/migrations/20260721200000_add_standard_estimate_option.sql");
const schema = read("../supabase/schema.sql");

describe("neutral Standard estimate option", () => {
  it("presents Standard first without removing optional tiered choices", () => {
    expect(tierOptions).toEqual(["standard", "good", "better", "best"]);
    expect(tierLabels.standard).toBe("Standard");
  });

  it("expands both production tier constraints", () => {
    expect(migration).toContain("tier in ('standard', 'good', 'better', 'best')");
    expect(migration).toContain("selected_tier in ('standard', 'good', 'better', 'best')");
  });

  it("persists, recalculates, and validates Standard invoice totals", () => {
    expect(migration).toContain("subtotal_standard numeric(10,2) not null default 0");
    expect(migration).toContain("total_standard numeric(10,2) not null default 0");
    expect(migration).toContain("filter (where tier = 'standard')");
    expect(migration).toContain("when 'standard' then new.total_standard");
  });

  it("keeps the canonical fresh-install schema aligned", () => {
    expect(schema).toContain(migration);
    expect(schema).toContain("tier text not null check (tier in ('standard', 'good', 'better', 'best'))");
    expect(schema).toContain("selected_tier text check (selected_tier in ('standard', 'good', 'better', 'best'))");
    expect(schema).toContain("subtotal_standard numeric(10,2) not null default 0");
    expect(schema).toContain("total_standard numeric(10,2) not null default 0");
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
