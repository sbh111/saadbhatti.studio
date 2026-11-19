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
  // Akismet scores comments against a third party; a test must never reach it,
  // and lib/akismet.ts treats an absent key as "hold everything", which is
  // exactly the behaviour tests should see by default.
  "AKISMET_API_KEY",
  "SUBSCRIBE_TOKEN_SECRET",
  "RESEND_SEGMENT_ID",
  "BLOG_NOTIFY_FROM",
];

for (const key of DANGEROUS_ENV_VARS) {
  delete process.env[key];
}
