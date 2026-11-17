/**
 * Is a Postgres connection string pointing at a local, disposable database or
 * at a real one somewhere else?
 *
 * Exists because of a specific incident (docs/operations.md #3.1): `.env` held
 * the Neon production URLs, and `prisma migrate diff --shadow-database-url
 * "$DIRECT_URL"` therefore reset the production database — `--shadow-database-url`
 * means "this database is scratch space, wipe it and replay every migration
 * into it", which is exactly what it did. The command was not wrong; the URL
 * was. So the guard is on the URL.
 *
 * Pure and dependency-free so scripts/assert-local-db.mjs can be a three-line
 * CLI over it and test/scripts/dbTarget.test.ts can cover the classification
 * without a database, a filesystem or a network.
 *
 * ── Fails closed ──────────────────────────────────────────────────────────
 * Anything this module cannot confidently call local is "remote", including a
 * malformed URL. A guard that waves through what it does not understand is not
 * a guard.
 */

/**
 * Hostnames that mean "the loopback or the dev container", and nothing else.
 *
 * Matched EXACTLY, never as a prefix or suffix: `localhost.example.com` is a
 * perfectly resolvable public hostname, and `notlocalhost` is a valid private
 * one. A substring test here would be the whole bug class this module exists
 * to prevent.
 *
 * `db` is the compose service name (docker-compose.yml), reachable under that
 * name from inside the compose network. `host.docker.internal` is how a
 * container reaches the host's dev server.
 */
export const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "db",
  "host.docker.internal",
]);

/**
 * Classify a connection string.
 *
 * @param {string | undefined | null} url
 * @returns {{ kind: "local" | "remote" | "invalid", host: string }}
 *   `host` is safe to print — it is the hostname only, never the credentials.
 */
export function classifyDbTarget(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return { kind: "invalid", host: "" };
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { kind: "invalid", host: "" };
  }

  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    return { kind: "invalid", host: parsed.hostname };
  }

  // A Unix-domain socket has no hostname and carries the directory in a
  // `host=` parameter (`postgresql:///db?host=/var/run/postgresql`). A socket
  // path is necessarily on this machine, so it is local.
  if (parsed.hostname === "") {
    const socket = parsed.searchParams.get("host");
    if (socket && socket.startsWith("/")) {
      return { kind: "local", host: socket };
    }
    return { kind: "invalid", host: "" };
  }

  // URL lowercases the hostname already; the explicit call documents that the
  // exact-match below is deliberately case-insensitive and nothing more.
  const host = parsed.hostname.toLowerCase();
  return { kind: LOCAL_HOSTS.has(host) ? "local" : "remote", host };
}

/** True only for a target this module is confident is local and disposable. */
export function isLocalDbTarget(url) {
  return classifyDbTarget(url).kind === "local";
}

/**
 * Parse a dotenv-style file's contents into a plain object.
 *
 * Hand-rolled rather than pulling in `dotenv` because this runs as a bare
 * `node scripts/...` guard before anything else, and because the only thing it
 * has to get right is `KEY=VALUE` with optional quotes. It deliberately does
 * NOT do variable expansion: a guard that evaluates its input is a guard with
 * an attack surface.
 *
 * Also note what this is NOT for: sourcing a dotenv file into a shell. A Neon
 * URL contains `&` (`?sslmode=require&channel_binding=require`), so
 * `set -a; . ./.env` splits the line on `&` and runs the remainder as
 * background jobs — a trap hit for real while investigating the incident.
 * scripts/with-neon-db.sh uses this parser instead.
 *
 * @param {string} contents
 * @returns {Record<string, string>}
 */
export function parseDotenv(contents) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolve a connection string the way Prisma does: a real environment
 * variable wins over the same key in a dotenv file.
 *
 * That precedence is not incidental — it is the mechanism the README's
 * "Production migrations (manual)" section relies on, where Neon URLs are
 * exported as real env vars to override `.env`. A guard that only read the
 * file would therefore pass while the actual command talked to Neon.
 *
 * @param {string} key
 * @param {Record<string, string>} fileEnv
 * @param {Record<string, string | undefined>} processEnv
 */
export function resolveDbUrl(key, fileEnv, processEnv) {
  const fromProcess = processEnv[key];
  if (typeof fromProcess === "string" && fromProcess.trim() !== "") {
    return { value: fromProcess, source: "environment" };
  }
  const fromFile = fileEnv[key];
  if (typeof fromFile === "string" && fromFile.trim() !== "") {
    return { value: fromFile, source: ".env" };
  }
  return { value: undefined, source: "unset" };
}
