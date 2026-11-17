#!/usr/bin/env node
/**
 * Refuses to proceed unless every Postgres URL in play points at a local,
 * disposable database. Chained ahead of the destructive Prisma commands in
 * package.json:
 *
 *     "db:migrate": "node scripts/assert-local-db.mjs && prisma migrate dev"
 *     "db:reset":   "node scripts/assert-local-db.mjs && prisma migrate reset"
 *
 * Exit 0 = both URLs are local, carry on. Exit 1 = stop, with the offending
 * host named.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * docs/operations.md #3.1. `.env` held the Neon production URLs, so a routine
 * `prisma migrate diff --shadow-database-url "$DIRECT_URL"` — a flag whose
 * documented job is to wipe the target and replay every migration into it —
 * reset the production database. Nothing about the command was unusual. The
 * URL was.
 *
 * ── What it deliberately does NOT have ────────────────────────────────────
 * An override flag. An escape hatch that can be set in the same shell as the
 * mistake is not a guard, and there is already a deliberate production path:
 * scripts/with-neon-db.mjs, which names the target, asks for confirmation, and
 * still refuses the two commands that caused this.
 *
 * It also does not connect to anything. Classification is string work, so the
 * guard cannot itself be the thing that fails.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDbTarget,
  parseDotenv,
  resolveDbUrl,
} from "./dbTarget.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Prisma reads only `.env` (not `.env.local`) — see the README's note. */
function readEnvFile() {
  try {
    return parseDotenv(readFileSync(join(repoRoot, ".env"), "utf8"));
  } catch {
    // No .env at all is fine: the keys may come from the real environment,
    // and if they come from nowhere the checks below report that instead.
    return {};
  }
}

/** Both of these reach a database, so both have to be local. */
const KEYS = ["DATABASE_URL", "DIRECT_URL"];

function main() {
  const fileEnv = readEnvFile();
  const problems = [];
  const checked = [];

  for (const key of KEYS) {
    const { value, source } = resolveDbUrl(key, fileEnv, process.env);
    if (value === undefined) {
      // Unset is not a failure here. `prisma migrate dev` will complain about
      // a missing DATABASE_URL far more clearly than this script could, and
      // DIRECT_URL is genuinely optional in some setups.
      checked.push(`${key}: unset`);
      continue;
    }
    const { kind, host } = classifyDbTarget(value);
    checked.push(`${key}: ${kind} (${host || "unparseable"}) from ${source}`);
    if (kind !== "local") problems.push({ key, kind, host, source });
  }

  if (problems.length === 0) {
    console.log(`assert-local-db: ok — ${checked.join(", ")}`);
    return 0;
  }

  console.error("");
  console.error("  assert-local-db: REFUSING TO RUN A DESTRUCTIVE DB COMMAND");
  console.error("");
  for (const { key, kind, host, source } of problems) {
    console.error(
      kind === "invalid"
        ? `    ${key} (from ${source}) could not be parsed as a Postgres URL.`
        : `    ${key} (from ${source}) points at "${host}", which is not local.`
    );
  }
  console.error("");
  console.error("  Local development expects the Docker Postgres:");
  console.error("    docker compose up -d db");
  console.error("    DATABASE_URL=postgresql://sbh:sbh_local_dev@localhost:5432/sbh_studio");
  console.error("");
  console.error("  If you really meant to touch the production database, say so:");
  console.error("    scripts/with-neon-db.mjs npx prisma migrate deploy");
  console.error("");
  console.error("  Background: docs/operations.md #3.1.");
  console.error("");
  return 1;
}

process.exit(main());
