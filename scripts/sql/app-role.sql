-- A least-privilege database role for the running app.
--
-- RUN THIS AFTER any Neon instant-restore has completed, not before: a branch
-- restore rewinds the branch, and a role created beforehand goes with it.
--
--   psql "<neon DIRECT url as neondb_owner>" -v app_password="'<generated>'" \
--        -f scripts/sql/app-role.sql
--
-- ── Why ───────────────────────────────────────────────────────────────────
-- On 2026-11-17 a `prisma migrate diff --shadow-database-url "$DIRECT_URL"`
-- reset the production database. It succeeded for one reason: the credential
-- in `.env` was `neondb_owner`, which can DROP anything. The same command
-- against the role below fails with a permission error, because this role
-- cannot create or drop a single object.
--
-- That is the real lesson of the incident. The URL being wrong was the
-- mistake; the credential being omnipotent is what turned a mistake into data
-- loss. Guards (scripts/assert-local-db.mjs) catch the commands you thought
-- of. A role that physically cannot do DDL catches the ones you did not.
--
-- ── The split ─────────────────────────────────────────────────────────────
--   neondb_owner  migrations only, used deliberately via
--                 scripts/with-neon-db.mjs. Lives in .env.neon.local.
--   sbh_app       what Vercel's DATABASE_URL / DIRECT_URL become. DML only.
--
-- ── What the app actually needs, and nothing more ─────────────────────────
-- Checked against every query in this codebase:
--   SELECT          every read path, including the raw pgvector `<=>` search
--   INSERT, UPDATE  inquiries, likes, posts, settings, and the rate_windows
--                   upsert (which is an INSERT ... ON CONFLICT DO UPDATE)
--   DELETE          the admin's inquiry and post deletes
-- No sequences are granted because there are none: every id is a cuid
-- generated in the application, not a serial.

\set ON_ERROR_STOP on

-- Password comes in as a psql variable so it is never written into this file
-- (which is committed to a PUBLIC repository) or into shell history if you
-- read it from a prompt. Generate one with: openssl rand -base64 32
\if :{?app_password}
\else
  \echo 'ERROR: pass the password, e.g. -v app_password="''...''"'
  \quit 1
\endif

-- Idempotent: safe to re-run, e.g. to rotate the password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sbh_app') THEN
    CREATE ROLE sbh_app LOGIN;
  END IF;
END
$$;

ALTER ROLE sbh_app WITH PASSWORD :app_password;

-- Explicitly withheld, and listed rather than merely omitted so a future
-- reader can see these were considered: no SUPERUSER, no CREATEDB, no
-- CREATEROLE, no BYPASSRLS, and no REPLICATION.
ALTER ROLE sbh_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

GRANT CONNECT ON DATABASE neondb TO sbh_app;

-- USAGE lets the role see and reference objects in the schema. It does NOT
-- include CREATE, which is the whole point: without CREATE on the schema, this
-- role cannot add a table, and without ownership it cannot drop one.
GRANT USAGE ON SCHEMA public TO sbh_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO sbh_app;

-- Future tables too, or the next migration silently produces a table the app
-- cannot read — a failure that would surface as a 500 in production rather
-- than as an error during the migration. FOR ROLE neondb_owner because
-- default privileges apply to objects created BY a specific role, and
-- migrations run as the owner.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sbh_app;

-- Not granted on purpose: TRUNCATE (a bulk delete that bypasses nothing the
-- app needs), and REFERENCES / TRIGGER (schema-shaped privileges).

-- Verify. Every row should read `t` except the DDL checks, which must be `f`.
\echo ''
\echo 'sbh_app privileges:'
SELECT
  has_database_privilege('sbh_app', 'neondb', 'CONNECT')      AS can_connect,
  has_schema_privilege('sbh_app', 'public', 'USAGE')          AS can_use_schema,
  has_table_privilege('sbh_app', 'posts', 'SELECT')           AS can_read_posts,
  has_table_privilege('sbh_app', 'posts', 'INSERT')           AS can_write_posts,
  has_schema_privilege('sbh_app', 'public', 'CREATE')         AS can_create_MUST_BE_FALSE,
  pg_has_role('sbh_app', 'neondb_owner', 'MEMBER')            AS is_owner_MUST_BE_FALSE;
\echo ''
\echo 'Next: set Vercel DATABASE_URL and DIRECT_URL to use sbh_app, redeploy,'
\echo 'then confirm the site reads and writes normally (submit a test inquiry).'
\echo 'Keep neondb_owner ONLY in .env.neon.local, for migrations.'
