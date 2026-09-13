# Operations runbook — saadbhatti.studio

Procedures for running this system day-to-day: when to re-run something, how to rotate a
secret, what to do if something breaks. Where [system-overview.md](system-overview.md) and
[schema-design.md](schema-design.md) explain *why* the system is built the way it is, this
document is the *how* — the commands and checklists an operator (today: the owner) actually
runs. New sections get appended here rather than scattered across READMEs.

## Contents

1. [Re-indexing search](#1-re-indexing-search)
2. [Secrets](#2-secrets)

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

---

## 2. Secrets

Every `process.env` read in the app (`app/`, `lib/`, `proxy.ts`), plus the env vars the two
Python services and `docker-compose.yml` read. "Lives in" is every place a value must be kept in
sync — miss one after a rotation and that copy is now wrong.

| Variable | Lives in | Consumed by | If wrong or rotated |
|---|---|---|---|
| `DATABASE_URL` | Vercel; local `.env` | `lib/db.ts` (Prisma) — every runtime query | Every DB read/write fails: inquiries, likes, settings, rate limiting, search all break at once. |
| `DIRECT_URL` | Local `.env`; typed ad hoc on the CLI for a manual `prisma migrate deploy` (README) — not a standing Vercel var | Prisma CLI only (migrate/introspect) | Nothing breaks at runtime; only a manual migration attempt fails. |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Vercel; local `.env.local` | `lib/cloudinaryAdmin.ts` — every catalog read, i.e. nearly the whole site (see tech-debt 1.4) | Every page that reads the catalog throws. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | Vercel; local `.env.local` | `lib/auth.ts` — admin login | Owner locked out of `/admin/*`. |
| `SESSION_SECRET` | Vercel; local `.env.local` | `lib/auth.ts` — signs/encrypts the admin session cookie | Rotating invalidates every existing session (logged out, sign back in); nothing else depends on it. |
| `IP_HASH_SALT` | Vercel; local `.env.local` | `lib/inquiries.ts` `hashIp()` — every public write (inquiries, likes, search, events) | Unset: every public write 500s (tech-debt 1.3). Rotated: see below — treat as effectively permanent. |
| `RESEND_API_KEY` / `INQUIRY_NOTIFY_FROM` / `INQUIRY_NOTIFY_TO` | Vercel; local `.env.local` | `lib/mail.ts` — inquiry notification email | Best-effort: send is skipped/fails and logged; the inquiry itself still saves either way. |
| `EVENT_COLLECTOR_URL` | Vercel; local `.env.local` | `lib/collector.ts` — where the site posts event batches | Forward silently fails (best-effort — endpoint still returns 204). |
| `EVENT_INGEST_TOKEN` | Vercel (sender) + EC2 `deploy/.env` (checker, via `deploy/compose.prod.yml`) + local default in `docker-compose.yml` / `.env.local` | `lib/collector.ts` (send) / `collector/main.py` (check) | Mismatch: every event 401s at the collector and is silently dropped (best-effort). **Order matters** — see below. |
| `CATALOG_INDEX_TOKEN` | Vercel (checker, `app/api/catalog-index/route.ts`) + embedder env (sender, `docker-compose.yml` / a production `/reindex` invocation) | Same route + `embed/main.py` `_fetch_public_ids()` | Mismatch: `/reindex` fails loudly at the "catalog" stage with a 401 (the embedder surfaces this — not silent). **Order matters** — see below. |
| `INGEST_DOMAIN` | EC2 `deploy/.env` only | `deploy/compose.prod.yml` (Caddy) | Caddy can't get/renew a TLS cert, or the collector is unreachable at the expected hostname. Not shared with Vercel. |
| `EMBED_TOKEN` | Embedder env (`docker-compose.yml`, local default `sbh_local_embed`) | `embed/main.py` `_require_token()` — protects `/reindex` | Caller gets a 401 from the embedder. Local-only concern day to day; set a real value before ever exposing the embedder beyond localhost. |
| `EMBED_DATABASE_URL` | Embedder env — local default is the compose `db` container; a production refresh sets it ad hoc to Neon's DIRECT URL | `embed/main.py` — writes vectors | `/reindex` fails loudly at the "database" stage. Not a standing secret — supplied per invocation. |
| `MODEL_ID` / `MODEL_REVISION` / `CLOUDINARY_CLOUD_NAME` / `LOG_LEVEL` | Embedder env, all defaulted in `docker-compose.yml` | `embed/main.py` | Non-secret configuration, not credentials. |
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
