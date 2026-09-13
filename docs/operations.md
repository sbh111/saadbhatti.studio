# Operations runbook — saadbhatti.studio

Procedures for running this system day-to-day: when to re-run something, how to rotate a
secret, what to do if something breaks. Where [system-overview.md](system-overview.md) and
[schema-design.md](schema-design.md) explain *why* the system is built the way it is, this
document is the *how* — the commands and checklists an operator (today: the owner) actually
runs. New sections get appended here rather than scattered across READMEs.

## Contents

1. [Re-indexing search](#1-re-indexing-search)
2. [Secrets](#2-secrets)
3. [Backups and restore](#3-backups-and-restore)
4. [Monitoring](#4-monitoring)

---

## 1. Re-indexing search

The embedder (`embed/`) is an on-demand container: nothing keeps it running, and nothing
re-runs it automatically. `/reindex` (see [embed/main.py](../embed/main.py)) does exactly
three things, and knowing them is what tells you *when* a re-run is needed:

1. Fetches the current list of Cloudinary `public_id`s from the site's `/api/catalog-index`.
2. For each id, fetches the image fresh from Cloudinary and writes/overwrites its CLIP vector
   in `artwork_embeddings`, keyed by `publicId`.
3. Deletes any `artwork_embeddings` row whose `publicId` is no longer in that list (prune).

### When to re-run

`public_id` is the one artwork attribute that never changes (see
[system-overview.md §3](system-overview.md#3-catalog-and-cloudinary-as-cms-)) — titles,
filenames, and folders are all editable, `public_id` is not. That has a direct consequence for
re-indexing:

- **A `display_name` rename (retitling, or the `NN-` reorder prefix) does NOT need a re-run.**
  The artwork keeps its `public_id`, the image bytes are unchanged, and the stored vector is
  still keyed correctly — `getArtworkIndex()` and `artwork_embeddings` both key off `public_id`,
  not the filename.
- **Moving an artwork to a different folder does NOT need a re-run**, for the same reason:
  folder membership (`asset_folder`) can change without touching `public_id`.
- **Adding a new artwork DOES need a re-run.** Its `public_id` has no row in
  `artwork_embeddings` yet — until reindexed it is simply unfindable by search, with no error
  anywhere (this is the drift detection gap fixed below).
- **Deleting an artwork DOES need a re-run** to prune its now-orphaned vector — otherwise
  search can still rank it, and the result is silently dropped at the last step of
  `app/api/search/route.ts` (a wasted top-5 slot, not a wrong answer, but worth cleaning up).
- **Replacing the image at an existing `public_id`** (overwriting the same asset with different
  pixels) DOES need a re-run — nothing else notices the pixels changed, so the stored vector
  would silently describe an image that no longer exists at that id.

In short: re-run after any add, delete, or content replacement. A pure rename or a pure folder
move is not required to trigger one, though it's harmless to include it in a routine one.

### How to re-run

Local dev (`docker-compose.yml`, host networking). **Both** `CATALOG_INDEX_URL` and
`EMBED_DATABASE_URL` default to local on purpose — plain `docker compose --profile embedding
up` can never touch production by accident:

```bash
docker compose --profile embedding up -d --build embed   # build once, or after requirements/main.py change
curl -XPOST localhost:8100/reindex -H "Authorization: Bearer $EMBED_TOKEN"
docker compose down   # or: docker compose --profile embedding down
```

Before committing to a real run — local or production — do a **dry run** first: it diffs the
catalog against `artwork_embeddings` (no image fetch, no CLIP, no write) and reports how many
artworks it would newly embed, refresh, or prune, plus the catalog/database host it resolved
(logged either way, so a wrong default shows up before it matters):

```bash
curl -XPOST "localhost:8100/reindex?dry_run=true" -H "Authorization: Bearer $EMBED_TOKEN"
```

**A real production refresh** (new/changed artwork on the live site) needs BOTH env vars
pointed at production, as an explicit opt-in — the defaults are local-only on purpose. A local
catalog against the production database (or the reverse) is not refused — there's one
Cloudinary cloud, so a "mixed" target can be a deliberate, legitimate refresh, not just a
mistake — but the dry run above is exactly how to confirm that's what you meant:

```bash
EMBED_TOKEN=<the embedder's token>                                            \
CATALOG_INDEX_URL=https://www.saadbhatti.studio/api/catalog-index            \
CATALOG_INDEX_TOKEN=<must equal CATALOG_INDEX_TOKEN in Vercel>                \
EMBED_DATABASE_URL=<Neon DIRECT (non-pooled) URL — see docs/schema-design.md §8> \
docker compose --profile embedding up -d --build embed
curl -XPOST "localhost:8100/reindex?dry_run=true" -H "Authorization: Bearer $EMBED_TOKEN"  # confirm the target first
curl -XPOST localhost:8100/reindex -H "Authorization: Bearer $EMBED_TOKEN"
docker compose down
```

Env vars, in one place:

| Var | Purpose |
|---|---|
| `EMBED_TOKEN` | Bearer the *caller* must present to `POST /reindex` on the embedder. Local-only default (`sbh_local_embed`); set a real value to protect a production run. |
| `CATALOG_INDEX_URL` | Where the embedder reads the artwork id list. Local default: `http://localhost:3000/api/catalog-index`. Production: the canonical `https://www.saadbhatti.studio/api/catalog-index` (the apex redirects to `www` and drops the auth header across that redirect — use `www` directly). |
| `CATALOG_INDEX_TOKEN` | Bearer the embedder sends *to* `/api/catalog-index`. Must equal the site's `CATALOG_INDEX_TOKEN` (Vercel env var for prod, `.env.local` for local dev). |
| `EMBED_DATABASE_URL` | Where vectors are written. Prefer Neon's DIRECT (non-pooled) URL for a real refresh (see [schema-design.md §8](schema-design.md#8-operations)); local default is the compose `db` container. |

Watch `docker compose logs -f embed` while it runs — every stage logs what it's doing, and a
failure names the stage (config / catalog / database / model) rather than a bare 500. Every
response (dry run or real) echoes `catalogHost` / `databaseHost` / `dryRun`; a real run also
reports `indexed` / `pruned` / `failed` / `total`, and a dry run reports `wouldEmbedNew` /
`wouldRefresh` / `wouldPrune` / `total` instead.

### Drift detection

Because nothing runs `/reindex` automatically, catalog and vectors drift silently by default.
Two signals now catch this instead of leaving it silent:

- **`app/api/search/route.ts`** logs a `console.warn` (with the count and the opaque
  `public_id`s) whenever a vector hit doesn't map back to a live catalog artwork — the case
  where an artwork was deleted (or renamed... no — see above) but the embedder hasn't pruned it
  yet. Check Vercel logs for `search: N vector hit(s) did not map`.
- **`/admin/settings`** shows a live count of catalog artworks with no embedding row, and
  embedding rows with no catalog artwork, with a hint to re-run the embedder when either is
  non-zero. It degrades to "unavailable" rather than breaking the page if Cloudinary or the
  database can't be reached.

### Model revision pinning

Both halves of CLIP are pinned to an exact commit SHA, not a moving branch, and the two pins
must always describe the *same* underlying weights (tech debt 2.3):

- **JS text encoder** ([lib/clip.ts](../lib/clip.ts)) — `Xenova/clip-vit-base-patch32` (the ONNX
  conversion) at `d15189d7028b43f1d3e65039190477f6af591c2a`, pinned 2026-09-13.
- **Python vision encoder** ([embed/main.py](../embed/main.py)) — `openai/clip-vit-base-patch32`
  (the original PyTorch weights) at `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268`, pinned 2026-09-13,
  baked into the embedder image at build time (see [embed/Dockerfile](../embed/Dockerfile)).

**Changing either pin requires re-embedding every artwork** (this section, above) afterward —
the whole point of model parity is that both sides describe the same vector space, and a pin
change is exactly the kind of upstream weight change that breaks it silently otherwise.

Search also has an accepted (not accidental) cold-start dependency on the HuggingFace CDN: with
no quantization on Node, a cold instance downloads the fp32 text tower (~242 MB) fresh, since
baking it into the function alongside onnxruntime-node would exceed Vercel's 250 MB limit — see
[system-overview.md §8](system-overview.md#8-semantic-image-search-) for the full reasoning and
the longer-term fix (moving query encoding into a warm container).

---

## 2. Secrets

Every `process.env` read in the app (`app/`, `lib/`, `proxy.ts`), plus the env vars the two
Python services and `docker-compose.yml` read. "Lives in" is every place a value must be kept in
sync — miss one after a rotation and that copy is now wrong.

The seven starred as required below (`DATABASE_URL`, `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`,
`IP_HASH_SALT`, `SESSION_SECRET`, `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`) are asserted at server
startup — see `lib/env.ts` and `instrumentation.ts` — so a deploy missing any of them fails loudly,
once, at boot, naming everything missing, rather than the old per-request discovery (tech debt
1.3). `next.config.ts` additionally refuses to even finish a `VERCEL_ENV === "production"` build if
one is missing. Every other var below is an optional feature that already degrades gracefully on
its own when unset — see `lib/env.ts`'s own comment for why those are deliberately NOT asserted.

| Variable | Lives in | Consumed by | If wrong or rotated |
|---|---|---|---|
| `DATABASE_URL` | Vercel; local `.env` | `lib/db.ts` (Prisma) — every runtime query | Every DB read/write fails: inquiries, likes, settings, rate limiting, search all break at once. |
| `DIRECT_URL` | Local `.env`; typed ad hoc on the CLI for a manual `prisma migrate deploy` (README) — not a standing Vercel var | Prisma CLI only (migrate/introspect) | Nothing breaks at runtime; only a manual migration attempt fails. |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Vercel; local `.env.local` | `lib/cloudinaryAdmin.ts` — every catalog read, i.e. nearly the whole site (see tech-debt 1.4) | Every page that reads the catalog throws. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | Vercel; local `.env.local` | `lib/auth.ts` — admin login | Owner locked out of `/admin/*`. |
| `SESSION_SECRET` | Vercel; local `.env.local` | `lib/auth.ts` — signs/encrypts the admin session cookie | Rotating invalidates every existing session (logged out, sign back in); nothing else depends on it. |
| `IP_HASH_SALT` | Vercel; local `.env.local` | `lib/inquiries.ts` `hashIp()` — every public write (inquiries, likes, search, events) | Unset: caught at boot (tech-debt 1.3 — see above); `hashIp()` itself still throws too, as a last line of defense. Rotated: see below — treat as effectively permanent. |
| `RESEND_API_KEY` / `INQUIRY_NOTIFY_FROM` / `INQUIRY_NOTIFY_TO` | Vercel; local `.env.local` | `lib/mail.ts` — inquiry notification email | Best-effort: send is skipped/fails and logged; the inquiry itself still saves either way. |
| `EVENT_COLLECTOR_URL` | Vercel; local `.env.local` | `lib/collector.ts` — where the site posts event batches | Forward silently fails (best-effort — endpoint still returns 204). |
| `EVENT_INGEST_TOKEN` | Vercel (sender) + EC2 `deploy/.env` (checker, via `deploy/compose.prod.yml`) + local default in `docker-compose.yml` / `.env.local` | `lib/collector.ts` (send) / `collector/main.py` (check) | Mismatch: every event 401s at the collector and is silently dropped (best-effort). **Order matters** — see below. |
| `CATALOG_INDEX_TOKEN` | Vercel (checker, `app/api/catalog-index/route.ts`) + embedder env (sender, `docker-compose.yml` / a production `/reindex` invocation) | Same route + `embed/main.py` `_fetch_public_ids()` | Mismatch: `/reindex` fails loudly at the "catalog" stage with a 401 (the embedder surfaces this — not silent). **Order matters** — see below. |
| `INGEST_DOMAIN` | EC2 `deploy/.env` only | `deploy/compose.prod.yml` (Caddy) | Caddy can't get/renew a TLS cert, or the collector is unreachable at the expected hostname. Not shared with Vercel. |
| `EMBED_TOKEN` | Embedder env (`docker-compose.yml`, local default `sbh_local_embed`) | `embed/main.py` `_require_token()` — protects `/reindex` | Caller gets a 401 from the embedder. Local-only concern day to day; set a real value before ever exposing the embedder beyond localhost. |
| `EMBED_DATABASE_URL` | Embedder env — local default is the compose `db` container; a production refresh sets it ad hoc to Neon's DIRECT URL | `embed/main.py` — writes vectors | `/reindex` fails loudly at the "database" stage. Not a standing secret — supplied per invocation. |
| `MODEL_ID` / `MODEL_REVISION` | Embedder env, defaulted in `embed/model_pin.py` (also baked into the image at build time — see the Dockerfile) | `embed/model_pin.py`, imported by `embed/main.py` | Non-secret configuration, not credentials. |
| `CLOUDINARY_CLOUD_NAME` / `LOG_LEVEL` | Embedder env, all defaulted in `docker-compose.yml` | `embed/main.py` | Non-secret configuration, not credentials. |
| `KAFKA_BOOTSTRAP` / `KAFKA_TOPIC` | Collector env, defaulted in `docker-compose.yml` / `deploy/compose.prod.yml` | `collector/main.py` | Non-secret configuration. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `docker-compose.yml` (`db` service), hardcoded in the file | Local Postgres container only | Local-dev only — the comment next to it already says "never a real secret". |

### Rotation order: `EVENT_INGEST_TOKEN`

The site (Vercel) sends this token continuously in the background on every page view;
the EC2 collector checks it on every request. There is no dual-token support — a mismatch
in either direction gets silently 401'd and dropped (the collector forward is best-effort, so
nothing surfaces this beyond the collector's own logs). To keep the mismatch window as short
as possible:

1. SSH into the EC2 box, update `deploy/.env`, and restart: `docker compose -f compose.prod.yml
   up -d` — this takes effect in seconds.
2. Immediately set the new value in Vercel's env vars and trigger a redeploy.

Doing the box first means the only window is however long the Vercel redeploy takes — doing
Vercel first leaves the (slower, less predictable) redeploy as the thing you're waiting on
while ingest is already broken.

### Rotation order: `CATALOG_INDEX_TOKEN`

The asymmetry here is smaller: the embedder is an on-demand tool a person runs by hand (see
§1), not a standing service, so there's no background traffic to race against. Rotate it in
Vercel (redeploy), then simply use the new value the next time you invoke the embedder —
either exported as `CATALOG_INDEX_TOKEN` for a production run, or updated in
`docker-compose.yml`'s default for local dev. The only failure mode is forgetting and running
the embedder with the stale value, which fails loudly (401 at the "catalog" stage) rather than
silently.

### `IP_HASH_SALT` is effectively permanent

`hashIp()` computes `sha256(ip + IP_HASH_SALT)`, and that hash is the only thing stored — never
the raw IP — in `likes.ipHash`, `rate_windows.ipHash`, and `inquiries.ipHash`. Rotating the salt
changes every future hash for the same IP, which makes every *previously stored* hash permanently
unmatchable:

- **Every like-dedup resets.** The unique constraint on `(artworkPublicId, ipHash)` no longer
  recognizes a repeat visitor, so everyone can like everything again.
- **Every rate-limit bucket resets.** A visitor (or an attacker) currently mid-window regains a
  full fresh allowance the instant their next request hashes to a `windowStart` row that's
  never been seen before.

Neither is a security hole exactly — but it is a full, silent reset of both mechanisms at once,
site-wide, the moment the salt changes. Treat it as fixed at first deploy; do not rotate it
casually.

If it must be rotated (e.g. a suspected leak), a **dual-hash migration** would be needed: version
the salt (store which salt version produced each `ipHash`, or add a second `ipHash2` column
during a transition), compute and check *both* old- and new-salt hashes for a transition window,
backfill or let old rows age out, then drop the old salt and column. That's real application
work — nothing like it exists today, so an emergency rotation today means accepting the reset
above rather than attempting a migration on the fly.

### Pruning unused local env vars

`.env` and `.env.local` are git-ignored and hold the real Neon/Cloudinary/Resend/session
secrets — this repo does not touch them. But grepping every `process.env.*` read in `app/` and
`lib/` turns up only `DATABASE_URL` and `DIRECT_URL` on the Postgres side (see the table above)
— nothing here ever reads the wider set of variables Neon's Vercel integration typically writes
alongside those two, such as `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`,
`POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`,
`POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `DATABASE_URL_UNPOOLED`, and
`NEON_PROJECT_ID`. If any of these are sitting in the local `.env` (pasted in whole from the
Neon/Vercel dashboard rather than trimmed to what's actually read), they're pure rotation
surface for no benefit — worth deleting by hand next time that file is touched. `.env.example`
does not list them, so a fresh `.env` copied from the example never re-introduces them.

---

## 3. Backups and restore

**The asymmetry this section exists to close:** [architecture.md §13](architecture.md#13-invariants--dont-break-these)
states outright that Cloudinary assets must never be deleted — they're the only copy of
production artwork. Nothing equivalent has ever been said about Postgres, which holds the
**only copy of every sales lead** (the `inquiries` table) — and the admin UI hard-deletes a
row behind a single `window.confirm`, with no soft delete, no trash, no undo (see
[schema-design.md §7](schema-design.md#7-growth-retention-and-known-issues)). Treat that
plainly: a fat-fingered delete, or a bug in the delete path, is unrecoverable without one of
the two mechanisms below.

### What Neon provides — point-in-time restore

Every Neon project keeps a rolling history of WAL changes and can restore to any point (or
LSN) inside that window, via the Console, the `neon` CLI (`neon branches restore <target>
<source>@<timestamp>`), or the API. Mechanically it's branch-based: Neon creates a new branch
at the target point in time, swaps compute onto it (the connection string doesn't change),
and renames the old branch to a timestamped backup name rather than deleting it outright — so
a restore-gone-wrong is itself recoverable.

**The retention window is plan-dependent and controlled per-project** (Console → Settings →
Instant restore). As of this writing Neon's published defaults/maximums are roughly: Free —
6 hours (also capped at 1 GB of history); Launch — 1 day default, up to 7 days; Scale — 1 day
default, up to 30 days. **Don't trust those numbers blindly** — Neon changes plans and limits;
confirm the actual window for this project in the Console before relying on it, and widen it
if a day or two isn't enough runway to notice a bad delete.

**How to restore:**

1. Console → the project → **Backup & Restore** (or **Instant restore**) → pick a timestamp
   (or LSN) on the branch that took the damage.
2. Neon branches from that point, swaps compute onto the new branch, and renames the old one
   to `<branch>_old_<timestamp>` — nothing is destroyed, so you can compare or re-restore if
   the first choice of timestamp was wrong.
3. The connection string Vercel already has keeps working (same branch name, new underlying
   data) — no redeploy needed purely for the restore itself.
4. Only **root** branches support PITR; if this project ever branches Postgres for previews or
   staging, restore the root, not a child branch.

This covers "restore the whole database to five minutes before the bad thing happened." It
does **not** cover "get me last Tuesday's data as a separate copy to inspect while production
keeps running on today's data" — for that, or for a copy outside Neon's control plane
entirely, use the logical backup below.

### An independent logical backup — `scripts/backup-db.sh`

A second, deliberately low-tech line of defense: a plain `pg_dump` custom-format file, on disk
outside the repo, restorable into any Postgres (Neon or otherwise) — useful if Neon itself is
ever unavailable, misconfigured, or if a restore needs to be inspected without touching the
live branch.

```bash
BACKUP_DATABASE_URL='<Neon DIRECT (non-pooled) URL>' scripts/backup-db.sh
# optional second location: scripts/backup-db.sh /path/outside/the/repo
```

- **Requires `BACKUP_DATABASE_URL`** — the script refuses to run without it (no silent
  fallback to some default that could be production).
- **Use the DIRECT/unpooled URL, never the pooled `DATABASE_URL`.** `pg_dump` holds one
  transaction open for the whole dump; that's a bad fit for PgBouncer's transaction-pooling
  mode, the same reasoning `prisma migrate` already follows (see
  [schema-design.md §8](schema-design.md#8-operations)).
- **Writes outside the repo by default** (`$HOME/backups/saadbhatti-studio`, override with
  `$BACKUP_DIR` or a positional arg) — a backup that lives in the working tree is one
  `git clean -fdx` away from vanishing with the code it was meant to survive.
- **Never echoes the connection string** — only the output path and file size are logged.
- Output is timestamped and custom-format (`-Fc`): compressed, and restorable selectively.

**Restoring from a dump:**

```bash
# Inspect what's in it first (no writes):
pg_restore --list saadbhatti-studio-<timestamp>.dump

# Full restore into an EMPTY target database (see the pgvector note below):
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d '<target Postgres URL>' saadbhatti-studio-<timestamp>.dump

# Restore just one table (e.g. to recover inquiries without touching everything else):
pg_restore --no-owner --no-privileges -t inquiries \
  -d '<target Postgres URL>' saadbhatti-studio-<timestamp>.dump
```

**pgvector requirement.** `artwork_embeddings.embedding` is a `vector(512)` column, and the
`vector` extension must exist in the target database *before* the restore runs — the same
`CREATE EXTENSION IF NOT EXISTS vector` migration 5 already applies for a normal `prisma
migrate deploy`. Restoring into a brand-new Postgres without the extension installed first
fails on that table with "type vector does not exist."

### Restore-drill checklist (do this periodically, not just when something breaks)

A backup nobody has ever restored is a hypothesis, not a safeguard. Periodically (a quarterly
cadence is a reasonable default for a site this size — tune to how fast the `inquiries` table
actually grows):

1. Run `scripts/backup-db.sh` against production (the DIRECT URL) and confirm the dump file
   size looks sane compared to last time.
2. Spin up a scratch Postgres (local Docker is fine) with the `vector` extension available —
   this repo's local compose already uses `pgvector/pgvector:pg16` for exactly this reason
   (tech-debt 1.2); a bare `postgres:16-alpine` doesn't ship the extension at all.
3. `pg_restore` the dump into it, end to end, with no manual patching.
4. Spot-check: row counts per table roughly match Neon; a known recent inquiry is present with
   the right `artworkPublicId`/`email`; a `SELECT ... <=> ...` query against
   `artwork_embeddings` runs without a missing-extension error.
5. Separately, exercise Neon's PITR at least once against a **non-production** branch (Neon
   supports branching for exactly this) — restoring a scratch branch to an earlier point and
   confirming the data at that point looks right — so the first time that button is pressed
   for real isn't also the first time it's ever been tried.
6. Note the date and outcome somewhere durable (this file, or wherever the owner already
   tracks operational tasks) so "when did we last verify this" has an answer.

**Recommended cadence, stated plainly:** run `scripts/backup-db.sh` on a schedule (weekly is a
reasonable starting point — inquiries are the only unrecoverable data and this site's write
volume is low) in addition to leaning on Neon's PITR for the common case, and run the full
restore drill above at least once a quarter.

---

## 4. Monitoring

The concrete gap this section closes: the Next app had no health endpoint at all, no uptime
check pointed at it, and no error tracking. The strategy today is entirely `console.*` calls
into Vercel's logs, which have short retention — so a failure nobody happened to be watching
for scrolls off before anyone notices. This section is the low-effort floor: what to poll, what
to grep for, and what's deliberately *not* done yet.

### Poll `/api/health`

`GET /api/health` runs one bounded `SELECT 1` through Prisma and returns `200 {"status":"ok"}`
or `503 {"status":"degraded"}` — terse on purpose, it never echoes the underlying error. It's
public, cheap, and safe to hit often; it does **not** check Cloudinary (see the comment in
[app/api/health/route.ts](../app/api/health/route.ts) for why — a Cloudinary outage already
takes down every public page, so an uptime check already polling `/` learns that independently).

Point a free external uptime checker at it — e.g. [UptimeRobot](https://uptimerobot.com) or
[Better Uptime](https://betteruptime.com) both have usable free tiers; this is a
**recommendation, not a dependency the app requires** — any HTTP-poll-with-alerting service
works, and it's the owner's call which one (and whether to add another Vercel-side check like
Vercel's own Monitoring, a paid-plan feature). A 5-minute interval is more than enough for a
site this size; alert on two consecutive failures rather than one, to avoid paging on a single
cold-start blip.

### The Python services already have health endpoints — nothing polls them

Both already expose `GET /health`, unauthenticated:

- **`embed/` (the CLIP embedder), port 8100** — `{"ok": bool, "model", "revision", "dim",
  "modelError", "hostGateway", "env": {...presence only...}}`. This container is **on-demand**
  (see [§1](#1-re-indexing-search)) — it isn't running most of the time, so there is nothing to
  continuously poll in production. Check it manually right before a reindex:
  `curl localhost:8100/health` (or the production host, if it's ever run as a standing
  service) — a non-null `modelError` means `/reindex` will 503 until the model loads correctly.
- **`collector/` (the Kafka ingest service), port 8000** — `{"ok": true}`, unauthenticated
  liveness only (it doesn't check the Kafka connection). This one **is** a standing service on
  the EC2 box when K2 is deployed — if/when that happens, add it as a second uptime-checker
  target (e.g. `https://ingest.saadbhatti.studio/health` — same recommendation as above) so a
  wedged collector doesn't silently drop every event.

### Where logs live today

- **Vercel** — the Next app's `console.*` output, viewable in the Vercel dashboard (Project →
  Logs) or `vercel logs`. **Retention is short** (exact window depends on the Vercel plan) — this
  is the entire reason a real error-tracking tool (below) would help.
- **EC2 (collector)** — `docker compose -f deploy/compose.prod.yml logs -f collector` (or
  `kafka`) on the box itself, once K2 is actually deployed. Nothing ships these off-box today;
  they exist only as long as the container's log driver retains them.
- **Local dev** — whichever terminal is running `next dev` / `docker compose logs`.

### Log lines worth alerting on

Grepping the codebase for the warnings and errors already written — these are the signals that
exist today but that nothing currently surfaces beyond "someone happened to be tailing Vercel
logs":

| Line | Where | What it means |
|---|---|---|
| `search: N vector hit(s) did not map to a catalog artwork` | [app/api/search/route.ts](../app/api/search/route.ts) | Embeddings have drifted from the catalog — re-run the embedder ([§1](#1-re-indexing-search)). |
| `search: embed failed` | [app/api/search/route.ts](../app/api/search/route.ts) | The CLIP text encoder threw — search is down for everyone. |
| `settings: embedding drift check failed` | [app/admin/settings/page.tsx](../app/admin/settings/page.tsx) | The `/admin/settings` drift widget couldn't reach Cloudinary or the database. |
| `isEventStreamingEnabled: settings read failed, defaulting off` | [lib/settings.ts](../lib/settings.ts) | The settings table is unreachable — streaming silently disables itself (fail-closed, by design — see [system-overview.md §10](system-overview.md#10-patterns-that-recur)). |
| `isRateLimited: DB error for bucket "…", failing open` | [lib/rateLimit.ts](../lib/rateLimit.ts) | A degraded database has disabled **every rate limit on the site**, including search's inference-cost ceiling (fail-open, by design — see [system-overview.md §10](system-overview.md#10-patterns-that-recur)). Throttled to at most one line per minute per instance; a trailing "(N more suppressed…)" means the outage is ongoing. |
| `sweepStaleRateWindows: DB error (ignored)` | [lib/rateLimit.ts](../lib/rateLimit.ts) | The opportunistic `rate_windows` sweep (tech debt 2.1) failed — harmless on its own (it just tries again on a future sampled call), but frequent occurrences point at the same DB trouble the line above would also be logging. Shares that line's one-per-minute throttle. |
| `[mail] inquiry notification skipped` | [lib/mail.ts](../lib/mail.ts) | Mail env vars are unset — every inquiry email is a no-op until fixed. |
| `inquiry notification failed` / `inquiry email-status update failed` | [app/api/inquiries/route.ts](../app/api/inquiries/route.ts) | Resend rejected a send, or the status write after it failed — the inquiry itself is still saved (also visible per-row via `InquiryEmailAlert` in the comment log). |
| `edit save failed for …` / `reorder failed for …` | [app/api/admin/artworks/route.ts](../app/api/admin/artworks/route.ts) | A Cloudinary write from the admin bulk save failed — the edit stays staged for retry, but worth knowing if it's frequent. |
| `forwardEvents: …` | [lib/collector.ts](../lib/collector.ts) | The event forward to the EC2 collector failed or returned non-2xx (best-effort — never affects the visitor). |
| `producer queue still full after retry, dropping batch …` | [collector/main.py](../collector/main.py) | Kafka backpressure didn't clear even after one poll-and-retry — the collector returned 503 and the batch was dropped (still invisible to the visitor; `forwardEvents` above logs the 503 on the Next side). |
| `flush timed out with N message(s) still queued` | [collector/main.py](../collector/main.py) | The broker didn't ack the batch within the flush deadline — the collector returned 503 instead of the silent-loss 204 this replaced. Frequent occurrences mean Kafka itself is degraded. |
| `health: database check failed` | [app/api/health/route.ts](../app/api/health/route.ts) | What flips `/api/health` to `503` — the uptime checker above should already be catching this, this line is what confirms *why* in the logs. |
| `[likes] create failed: …` / `[likes] delete failed: …` | [app/api/likes/route.ts](../app/api/likes/route.ts) | A non-dedup DB failure on a like/unlike write (tech debt 1.7) — the route now returns a 503 instead of an unhandled 500, and `LikeButton` rolls back the optimistic heart + `localStorage` entry. Never includes the ipHash. |

None of these currently page anyone — they're what to `grep`/search for by hand, or what a log
drain / alerting rule should watch for once one exists.

### Error tracking — recommended next step, not done here

No Sentry (or equivalent) is wired in, and this document doesn't add one. Picking a provider,
creating an account, and deciding what PII policy applies to captured errors (inquiry emails and
messages could easily end up in a stack trace or breadcrumb) is an **owner decision**, not a
default this runbook should make for them. When that decision is made, the natural integration
points are: wrap the route handlers' `catch` blocks (a thin call alongside the existing
`console.error`, not a replacement — keep the terse client response as-is), and the two Python
services' own exception handlers (`embed/main.py` already has a global one; `collector/main.py`
does not). Until then, the table above is the manual equivalent.
