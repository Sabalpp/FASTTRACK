import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("schedule clutter contract", () => {
  it("keeps the schedule list to one page title and four scan-friendly row groups", () => {
    const page = readFileSync(resolve(process.cwd(), "app/jobs/page.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "app/jobs/jobs.module.css"), "utf8");

    expect(page.match(/<h1/g)).toHaveLength(1);
    expect(page).not.toContain("<h2");
    expect(page).not.toMatch(/>Dispatch</);
    expect(page).not.toContain("ArrowRight");
    expect(page).toContain("styles.window");
    expect(page).toContain("styles.customer");
    expect(page).toContain("styles.technician");
    expect(page).toContain("styles.jobState");
    expect(css).toMatch(/@media\s*\(max-width:\s*1040px\)[\s\S]*grid-template-areas:/);
  });

  it("uses four direct scheduling sections and one submit action", () => {
    const page = readFileSync(resolve(process.cwd(), "app/jobs/new/page.tsx"), "utf8");

    expect(page.match(/<h1/g)).toHaveLength(1);
    expect(page.match(/<Button type="submit"/g)).toHaveLength(1);
    expect(page).toContain('id="customer-heading">Customer');
    expect(page).toContain('id="window-heading">Arrival window');
    expect(page).toContain('id="details-heading">Job details');
    expect(page).toContain('id="confirmation-heading">Confirmation');
    expect(page).not.toContain('eyebrow="Dispatch"');
    expect(page).not.toContain("service-call-panel");
    expect(page).not.toContain("notification-review-panel");
  });
});
