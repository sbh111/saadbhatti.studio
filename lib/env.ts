/**
 * The server env vars this app cannot function without. Each was previously
 * discovered missing only the first time the specific code path that reads it
 * ran — `hashIp()` (lib/inquiries.ts) throwing 500 on the first inquiry/like/
 * search, `sessionOptions()` (lib/auth.ts) throwing on the first login
 * attempt, `authHeader()` (lib/cloudinaryAdmin.ts) throwing on the first
 * catalog read — each a separate silent failure mode discovered at a
 * different time by a different visitor (tech debt 1.3). `instrumentation.ts`
 * asserts every one of these at server startup instead, so a misconfigured
 * deploy fails loudly, once, before it serves a single request.
 *
 * An empty string counts as missing — an accidentally-blank env var (a Vercel
 * dashboard entry saved with no value) is not a valid secret.
 *
 * Deliberately NOT everything `process.env` this app reads: several vars are
 * optional features that already degrade gracefully on their own when unset
 * — RESEND_API_KEY / INQUIRY_NOTIFY_FROM / INQUIRY_NOTIFY_TO (lib/mail.ts:
 * warns and skips the send), EVENT_COLLECTOR_URL / EVENT_INGEST_TOKEN
 * (lib/collector.ts: warns and drops), and CATALOG_INDEX_TOKEN
 * (app/api/catalog-index/route.ts: cleanly 401s). Requiring those here would
 * turn an intentionally-degraded deploy (e.g. no Kafka collector wired up
 * yet) into a boot failure instead. See docs/operations.md's environment
 * table for the full list, required and optional alike.
 *
 * IP_HASH_SALT is worth a special callout: once set, it is effectively
 * PERMANENT — see docs/operations.md's "IP_HASH_SALT is effectively
 * permanent" for why rotating it silently resets every like-dedup and
 * rate-limit bucket, site-wide, at once.
 */
export const REQUIRED_ENV_VARS = [
  "DATABASE_URL", // lib/db.ts (Prisma) — every DB-backed route/page
  "CLOUDINARY_API_KEY", // lib/cloudinaryAdmin.ts authHeader() — every catalog read
  "CLOUDINARY_API_SECRET",
  "IP_HASH_SALT", // lib/inquiries.ts hashIp() — every public write
  "SESSION_SECRET", // lib/auth.ts sessionOptions() — the admin session cookie
  "ADMIN_USERNAME", // lib/auth.ts verifyCredentials() — admin login
  "ADMIN_PASSWORD_HASH",
] as const;

/**
 * Pure (no `process.env` access) so it's trivially unit-testable: given an
 * env snapshot, which of REQUIRED_ENV_VARS are missing or blank?
 */
export function missingEnvVars(
  env: Record<string, string | undefined>
): string[] {
  return REQUIRED_ENV_VARS.filter((name) => !env[name]);
}

/**
 * Throws ONE error naming every missing var at once — not the first one
 * found — so a fresh deploy with several unset vars gets a single complete
 * list instead of a fix-one-redeploy-find-the-next loop.
 */
export function assertRequiredEnv(
  env: Record<string, string | undefined> = process.env
): void {
  const missing = missingEnvVars(env);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}. See docs/operations.md's ` +
        "environment table and README for where each one is set."
    );
  }
}
