# Operations runbook — saadbhatti.studio

Procedures for running this system day-to-day: when to re-run something, how to rotate a
secret, what to do if something breaks. Where [system-overview.md](system-overview.md) and
[schema-design.md](schema-design.md) explain *why* the system is built the way it is, this
document is the *how* — the commands and checklists an operator (today: the owner) actually
runs. New sections get appended here rather than scattered across READMEs.

## Contents

1. [Re-indexing search](#1-re-indexing-search)

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

Local dev (`docker-compose.yml`, host networking, defaults to the local dev site *and* the
local database — see [§3 below](#3-dangerous-defaults) for why both are local by default):

```bash
docker compose --profile embedding up -d --build embed   # build once, or after requirements/main.py change
curl -XPOST localhost:8100/reindex -H "Authorization: Bearer $EMBED_TOKEN"
docker compose down   # or: docker compose --profile embedding down
```

**A real production refresh** (new/changed artwork on the live site) needs BOTH env vars
pointed at production, as an explicit opt-in — the defaults are local-only on purpose:

```bash
EMBED_TOKEN=<the embedder's token>                                            \
CATALOG_INDEX_URL=https://www.saadbhatti.studio/api/catalog-index            \
CATALOG_INDEX_TOKEN=<must equal CATALOG_INDEX_TOKEN in Vercel>                \
EMBED_DATABASE_URL=<Neon DIRECT (non-pooled) URL — see docs/schema-design.md §8> \
docker compose --profile embedding up -d --build embed
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
failure names the stage (config / catalog / database / model) rather than a bare 500. The
response body also reports `indexed` / `pruned` / `failed` / `total` counts.

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
