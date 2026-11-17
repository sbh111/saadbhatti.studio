#!/usr/bin/env node
/**
 * Non-interactive wrapper around scripts/backup-db.sh for the scheduled
 * backup. Reads the Neon direct URL from `.env.neon.local` and runs the dump.
 *
 *     scripts/backup-neon.mjs [output-dir]
 *
 * This is the one documented exception to scripts/with-neon-db.mjs's
 * "interactive only" rule, and it is a safe one: a `pg_dump` cannot destroy
 * what it reads. It is also the whole reason that rule can be strict
 * elsewhere — the single piece of automation that genuinely needs production
 * reads the credentials itself rather than needing an override flag on the
 * interactive path.
 *
 * ── Why not GitHub Actions ────────────────────────────────────────────────
 * This repository is PUBLIC. A workflow artifact on a public repository is
 * downloadable by anyone who can read the repo, and this dump contains the
 * `inquiries` table: names, email addresses and message bodies that visitors
 * sent privately. So the scheduled copy runs on a machine the owner controls
 * (scripts/systemd/), not in CI, and the dump never leaves it.
 *
 * The honest cost of that choice: a laptop timer only fires when the laptop is
 * on, so this is a SECOND line of defence with unbounded retention, not a
 * guaranteed-fresh one. Neon's instant restore is the always-on primary, and
 * it is time-bounded (~6h on Free). Each covers the other's gap — see
 * docs/operations.md #3.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyDbTarget, parseDotenv } from "./dbTarget.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS_FILE = ".env.neon.local";

function fail(message) {
  console.error(`backup-neon: ${message}`);
  process.exit(1);
}

let env;
try {
  env = parseDotenv(readFileSync(join(repoRoot, CREDENTIALS_FILE), "utf8"));
} catch {
  fail(
    `${CREDENTIALS_FILE} not found — nothing to back up. ` +
      "It holds the Neon URLs and is git-ignored."
  );
}

const url = env.DIRECT_URL;
if (!url) {
  fail(`${CREDENTIALS_FILE} has no DIRECT_URL.`);
}

const { kind, host } = classifyDbTarget(url);
if (kind === "invalid") {
  fail(`DIRECT_URL in ${CREDENTIALS_FILE} is not a valid Postgres URL.`);
}

// pg_dump holds one transaction open for the whole dump, and Neon's pooled
// endpoint runs PgBouncer in transaction-pooling mode, which is a poor fit for
// a long-lived session. backup-db.sh says this in prose; this refuses it.
if (host.includes("-pooler")) {
  fail(
    `DIRECT_URL points at the POOLED endpoint (${host}). ` +
      "pg_dump needs the direct, non-pooled host — see docs/schema-design.md #8."
  );
}

console.log(`backup-neon: dumping ${host}`);

const args = [join(repoRoot, "scripts", "backup-db.sh"), ...process.argv.slice(2)];
const child = spawn("bash", args, {
  stdio: "inherit",
  cwd: repoRoot,
  // Through the environment only — never interpolated into a shell string, so
  // the `&` in `?sslmode=require&channel_binding=require` stays one value.
  env: { ...process.env, BACKUP_DATABASE_URL: url },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on("error", (err) => fail(`could not run backup-db.sh: ${err.message}`));
