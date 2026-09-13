/**
 * Runs before every test file. `.env`/`.env.local` hold PRODUCTION credentials
 * (Neon Postgres, Cloudinary, Resend, session secrets) — vitest does not load
 * dotenv files itself, but this blanks the variables anyway as a belt-and-
 * braces guard against a real service ever being reachable from a test, even
 * if something upstream (a shell profile, CI misconfiguration) exports them.
 * Every test that needs one of these sets it explicitly and narrowly instead.
 */
const DANGEROUS_ENV_VARS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "CLOUDINARY_URL",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "RESEND_API_KEY",
  "INQUIRY_NOTIFY_FROM",
  "INQUIRY_NOTIFY_TO",
  "IP_HASH_SALT",
  "SESSION_SECRET",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD_HASH",
  "EVENT_INGEST_TOKEN",
  "EVENT_COLLECTOR_URL",
  "EMBED_TOKEN",
  "CATALOG_INDEX_TOKEN",
];

for (const key of DANGEROUS_ENV_VARS) {
  delete process.env[key];
}
