#!/usr/bin/env node
/**
 * The deliberate path for running a command against the production (Neon)
 * database.
 *
 *     scripts/with-neon-db.mjs npx prisma migrate deploy
 *     scripts/with-neon-db.mjs npx prisma migrate status
 *     scripts/with-neon-db.mjs psql
 *
 * It reads the Neon URLs from `.env.neon.local` (git-ignored, and loaded
 * automatically by nothing — "neon" is not a NODE_ENV, so Next never picks it
 * up, and the Prisma CLI reads only `.env`), names the host it is about to
 * talk to, makes you type that host back, and then execs the command with
 * DATABASE_URL / DIRECT_URL set in its environment.
 *
 * ── Why a wrapper instead of just exporting the vars ──────────────────────
 * docs/operations.md #3.1. The production credentials used to sit in `.env`,
 * where `prisma` and `next` load them implicitly, so every command run in this
 * repo silently had production in reach — and one of them (`prisma migrate
 * diff --shadow-database-url "$DIRECT_URL"`) reset it. Moving them here
 * inverts the default: nothing reaches production unless it came through this
 * script, and this script says out loud what it is about to do.
 *
 * It also avoids a trap met while investigating that incident: a Neon URL
 * contains `&` (`?sslmode=require&channel_binding=require`), so
 * `set -a; . ./.env.neon.local` splits the line at the `&` and runs the
 * remainder as background shell jobs. This parses the file instead of
 * sourcing it, and passes the values through `spawn`'s env rather than
 * through a shell at all — so nothing is word-split, re-expanded, or echoed.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyDbTarget, parseDotenv } from "./dbTarget.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS_FILE = ".env.neon.local";

/**
 * Commands that must never run against production from here, whatever the
 * operator types at the prompt.
 *
 * These are not "dangerous in general" — they are the specific operations
 * whose documented behaviour is to destroy and rebuild a database. There is no
 * flag to override this list: the point of the list is that confirming is not
 * sufficient, because the operator who caused the incident WOULD have
 * confirmed, being certain the URL was local.
 */
const FORBIDDEN = [
  {
    match: (argv) => argv.some((a) => a.startsWith("--shadow-database-url")),
    why: "--shadow-database-url wipes its target and replays every migration into it. That is what reset production on 2026-11-17. For a read-only drift check use: npm run db:diff",
  },
  {
    match: (argv) => argv.includes("reset"),
    why: "`prisma migrate reset` drops the database and re-seeds it. There is no production use for it.",
  },
  {
    match: (argv) => argv.includes("push"),
    why: "`prisma db push` alters the schema to match prisma/schema.prisma with no migration file, and will drop columns to do it. Production changes go through `migrate deploy`.",
  },
  {
    match: (argv) => argv.includes("dev") && argv.includes("migrate"),
    why: "`prisma migrate dev` is a development command: it can reset the database when it detects drift. Production uses `migrate deploy`.",
  },
];

function fail(message) {
  console.error(`\n  with-neon-db: ${message}\n`);
  process.exit(1);
}

function readCredentials() {
  let contents;
  try {
    contents = readFileSync(join(repoRoot, CREDENTIALS_FILE), "utf8");
  } catch {
    fail(
      `${CREDENTIALS_FILE} not found.\n\n` +
        `  It holds the Neon URLs and is git-ignored. Create it with:\n` +
        `      DATABASE_URL="postgresql://...-pooler...neon.tech/DB?sslmode=require&pgbouncer=true"\n` +
        `      DIRECT_URL="postgresql://...neon.tech/DB?sslmode=require"\n\n` +
        `  Values come from Vercel → Project → Settings → Environment Variables.`
    );
  }
  const env = parseDotenv(contents);
  const direct = env.DIRECT_URL ?? env.DATABASE_URL;
  if (!direct) {
    fail(`${CREDENTIALS_FILE} has neither DIRECT_URL nor DATABASE_URL.`);
  }
  return { database: env.DATABASE_URL ?? direct, direct };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    fail("usage: scripts/with-neon-db.mjs <command> [args...]");
  }

  for (const rule of FORBIDDEN) {
    if (rule.match(argv)) fail(`refusing to run this against production.\n\n  ${rule.why}`);
  }

  const { database, direct } = readCredentials();
  const target = classifyDbTarget(direct);

  if (target.kind === "invalid") {
    fail(`DIRECT_URL in ${CREDENTIALS_FILE} is not a valid Postgres URL.`);
  }
  if (target.kind === "local") {
    // Not an error worth blocking — but worth saying, because the whole point
    // of this script is that you know which database you are touching.
    console.log(
      `\n  with-neon-db: note — ${CREDENTIALS_FILE} points at "${target.host}", which is local.\n`
    );
  }

  // A confirmation nobody can give by reflex: typing the host back requires
  // reading it. "Is this the right database?" is exactly the question that was
  // not asked on 2026-11-17.
  if (!process.stdin.isTTY) {
    fail(
      "refusing to run unattended — no TTY to confirm on.\n\n" +
        "  This script is interactive on purpose. Automation that genuinely needs\n" +
        "  production (e.g. the scheduled backup) should read the credentials itself."
    );
  }

  console.log("");
  console.log(`  Target database : ${target.host}`);
  console.log(`  Command         : ${argv.join(" ")}`);
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await rl.question(`  Type the host to continue (${target.host}): `);
  } catch (err) {
    // readline rejects with ABORT_ERR when the prompt is interrupted. Backing
    // out here is a perfectly reasonable thing to do — arguably the thing this
    // prompt exists to make easy — so it should read as a decision rather than
    // dumping a Node stack trace, which is what it used to do.
    if (err && err.code === "ABORT_ERR") {
      console.error("\n  with-neon-db: cancelled — nothing was run.\n");
      process.exit(130); // conventional exit status for an interrupt
    }
    throw err;
  } finally {
    rl.close();
  }

  if (answer.trim() !== target.host) {
    fail("host did not match — nothing was run.");
  }

  console.log("");
  const child = spawn(argv[0], argv.slice(1), {
    stdio: "inherit",
    // Credentials reach the child through its environment only. They are never
    // interpolated into a shell string, so `shell: false` (the default) is
    // load-bearing: a URL containing `&` or `?` stays one value.
    env: { ...process.env, DATABASE_URL: database, DIRECT_URL: direct },
  });
  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
  child.on("error", (err) => fail(`could not run "${argv[0]}": ${err.message}`));
}

await main();
