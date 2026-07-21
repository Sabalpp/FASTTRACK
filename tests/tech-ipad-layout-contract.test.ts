import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const jobCss = read("app/jobs/[id]/JobDetail.module.css");
const stageNavCss = read("components/JobStageNav.module.css");
const dashboardCss = read("app/dashboard/dashboard.module.css");

describe("technician iPad layout contract", () => {
  it("keeps the job brief and primary action inside portrait-width bounds", () => {
    expect(jobCss).toMatch(/\.summaryGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(jobCss).toMatch(/\.summaryFact\s*\{[^}]*min-width:\s*0/s);
    expect(jobCss).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.customerActions\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
    expect(jobCss).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.primaryAction\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
  });

  it("contains stage navigation overflow instead of widening the whole page", () => {
    expect(stageNavCss).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.scroller\s*\{[^}]*overflow-x:\s*auto/s);
    expect(stageNavCss).toMatch(/\.tab\s*\{[^}]*min-width:\s*0/s);
    expect(stageNavCss).toContain("overscroll-behavior-inline: contain");
  });

  it("shrinks Tech Home cards and makes the job action full width before iPad portrait", () => {
    expect(dashboardCss).toMatch(/@media\s*\(max-width:\s*980px\)[\s\S]*?\.techCurrentCard\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(250px,\s*0\.85fr\)/s);
    expect(dashboardCss).toMatch(/@media\s*\(max-width:\s*980px\)[\s\S]*?\.techOpenJob\s*\{[^}]*width:\s*100%/s);
    expect(dashboardCss).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\.techCurrentCard,[\s\S]*?\.techUpcomingRow\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  });
});

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}
