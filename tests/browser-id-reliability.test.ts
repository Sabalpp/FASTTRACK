import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("browser id reliability", () => {
  it("keeps insecure-LAN iPad flows off direct crypto.randomUUID calls", () => {
    const browserSources = ["app", "components", "lib"]
      .flatMap((directory) => sourceFiles(resolve(projectRoot, directory)))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /^\s*["']use client["'];/m.test(source) || /-client\.(ts|tsx)$/.test(file);
      });

    const unsafeCalls = browserSources.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /(?:globalThis\.)?crypto\.randomUUID\s*\(/.test(source)
        ? [relative(projectRoot, file)]
        : [];
    });

    expect(unsafeCalls, `Direct randomUUID calls remain in: ${unsafeCalls.join(", ")}`).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}
