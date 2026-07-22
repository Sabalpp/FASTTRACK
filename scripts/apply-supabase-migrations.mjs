import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnvConfig(projectRoot, true);

const databaseUrl = process.env.SUPABASE_DB_URL?.trim();
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is missing. Paste the percent-encoded Supabase Postgres connection string into .env.local, then run this command again.");
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  console.error("SUPABASE_DB_URL is not a valid Postgres connection string.");
  process.exit(1);
}
if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
  console.error("SUPABASE_DB_URL must use the postgres:// or postgresql:// protocol.");
  process.exit(1);
}

const binary = fileURLToPath(new URL("../node_modules/.bin/supabase", import.meta.url));
if (!existsSync(binary)) {
  console.error("The Supabase CLI dependency is missing. Run npm install first.");
  process.exit(1);
}

const statusOnly = process.argv.includes("--status");
const dryRun = process.argv.includes("--dry-run");
const common = ["--db-url", databaseUrl, "--workdir", projectRoot];
const commands = statusOnly
  ? [["migration", "list", ...common]]
  : dryRun
    ? [["db", "push", "--dry-run", ...common]]
    : [
      ["db", "push", "--dry-run", ...common],
      ["db", "push", "--yes", ...common],
      ["migration", "list", ...common]
    ];

for (const args of commands) {
  const result = spawnSync(binary, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(`Supabase migration command could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
