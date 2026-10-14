#!/usr/bin/env bash
set -euo pipefail

# Independent logical backup of Postgres, on top of Neon's built-in point-in-time
# restore (see docs/operations.md #3). Neon's PITR restores the whole project by
# branching; this is a second, portable copy — a plain custom-format dump you
# could restore into ANY Postgres, in or out of Neon, kept OUTSIDE the repo and
# outside Neon's own control plane. It exists for the one asymmetry this project
# can't shrug off: Postgres holds the ONLY copy of every sales lead (the
# `inquiries` table), and the admin hard-deletes rows behind a single
# window.confirm with no undo — see docs/operations.md #3 for the cadence this
# is meant to run on.
#
# Usage:
#   BACKUP_DATABASE_URL='postgresql://...' scripts/backup-db.sh [output-dir]
#
# BACKUP_DATABASE_URL is REQUIRED — this script refuses to run without it, on
# purpose, rather than silently defaulting to some URL that might be production.
# It MUST be Neon's DIRECT (non-pooled) connection string (see
# docs/schema-design.md #8), never the pooled DATABASE_URL: pg_dump holds one
# transaction open for the entire dump, and PgBouncer's transaction-pooling mode
# (what `pgbouncer=true` selects) is not a good fit for a long-lived session —
# use the direct URL, exactly like `prisma migrate` does.
#
# Output is custom format (`-Fc`): compressed, and restorable selectively with
# pg_restore (one table, --list first, parallel jobs) rather than only as one
# monolithic SQL replay. See the pg_restore commands and restore-drill checklist
# in docs/operations.md #3.

if [[ -z "${BACKUP_DATABASE_URL:-}" ]]; then
  echo "backup-db.sh: BACKUP_DATABASE_URL is not set - refusing to run." >&2
  echo "Set it to Neon's DIRECT (non-pooled) connection string and retry." >&2
  echo "(See docs/operations.md #3 and docs/schema-design.md #8.)" >&2
  exit 1
fi

# Default output directory is OUTSIDE the repo on purpose: a backup living
# inside the working tree is one 'git clean -fdx' (or a bad 'rm -rf') away from
# disappearing right alongside the code it was meant to survive. Override with
# a positional arg or $BACKUP_DIR.
OUT_DIR="${1:-${BACKUP_DIR:-$HOME/backups/saadbhatti-studio}}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/saadbhatti-studio-${STAMP}.dump"

echo "backup-db.sh: dumping to $OUT_FILE"

# Never echo $BACKUP_DATABASE_URL anywhere below - it carries the production
# password. pg_dump reads it directly; nothing here logs or forwards it.
pg_dump --format=custom --no-owner --no-privileges \
  --file="$OUT_FILE" "$BACKUP_DATABASE_URL"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "backup-db.sh: done - $OUT_FILE ($SIZE)."
echo "Restore with pg_restore against a target URL - see docs/operations.md #3."
