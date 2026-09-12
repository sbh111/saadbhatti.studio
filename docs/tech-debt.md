# Tech debt & loose ends

A ranked inventory of known defects, risks, and unfinished work, as of 2026-09-04.

Ordered by **severity of consequence**, not by effort — a one-line fix can sit at the top. Every
entry carries what it is, a concrete failure scenario, the fix, and a rough size:
**XS** (<15 min) · **S** (<1h) · **M** (half-day) · **L** (multi-day).

Where something is a *deliberate, documented* trade-off (fail-open limiting, terse errors, no ANN
index), it appears here only because the logging, documentation, or guard-rail around it is the
actual gap. See [system-overview.md](system-overview.md) and [schema-design.md](schema-design.md)
for the reasoning behind those choices.

---

## S1 — Live defects and data loss

### 1.1 The contact email link is dead — `app/about/page.tsx:42` · XS
The email `<a>` has **no `href`**. It is styled identically to the working Instagram link four
lines above, so it looks clickable and does nothing. `target="_blank" rel="noopener noreferrer"`
are meaningless without an href, and an anchor without one is not focusable or keyboard-reachable
at all.

**Impact:** a visitor who wants to buy a print clicks the only email link on the site and nothing
happens. On a portfolio whose commercial purpose is inquiries, this is the worst possible link to
have broken.
**Fix:** `href={`mailto:${site.contact.email}`}` and drop the `target`/`rel`.

### 1.2 Local setup is broken for a fresh clone — `docker-compose.yml:13` · S
The README's documented `npx prisma migrate dev` runs migration 5, which begins
`CREATE EXTENSION IF NOT EXISTS vector`. The compose database is `postgres:16-alpine`, which does
not ship pgvector.

**Impact:** a new contributor (or the owner on a new machine) follows the README exactly and fails
at migration 5 with `extension "vector" is not available`. There is no note anywhere explaining it.
**Fix:** switch the image to `pgvector/pgvector:pg16`, and say so in the README.

### 1.3 One missing env var silently breaks every public write — `lib/inquiries.ts:14` · S
`hashIp` throws when `IP_HASH_SALT` is unset, and it is called by `/api/inquiries`, `/api/likes`
(both POST and DELETE), `/api/events`, and `/api/search`.

**Impact:** the build succeeds and the site renders perfectly, then **every inquiry, like, and
search 500s at runtime**. Inquiries are permanently lost — the visitor sees a generic "please try
again" and retries into the same wall. Likes fail completely silently (see 1.7).
**Fix:** assert required env at startup and fail the boot loudly, rather than throwing per-request
deep in a helper.

**Related, and worse:** `IP_HASH_SALT` is effectively **unrotatable** and nothing says so. Changing
it invalidates every stored hash — resetting every like-dedup (everyone can like everything again)
and every rate-limit bucket. Document it as permanent, or plan a dual-hash migration. **S**

### 1.4 A Cloudinary outage takes down the whole site, including admin — `app/layout.tsx:47` · M
`buildNavTree(await getCatalog())` is unguarded in the **root layout**, and there are **no error
boundaries anywhere** — no `error.tsx`, `global-error.tsx`, or `not-found.tsx` in the entire app.

**Impact:** Cloudinary returns 420/503, or its credentials lapse → every route throws, including
all four admin pages (which are `force-dynamic`). The owner cannot read sales leads, cannot log in,
and cannot reach `/admin/settings` to turn anything off. Even `/about`, which needs only
`content.json`, dies. The visitor gets Next's raw "Application error" page with no retry.
**Fix:** add `global-error.tsx` + route-level `error.tsx`, and let the nav degrade to an empty tree
rather than throwing. `app/admin/comments/page.tsx:36` and `app/admin/likes/page.tsx:21` should
also stop using `Promise.all` for the catalog, which is only needed for a thumbnail — the page can
render from the database alone.

### 1.5 The admin editor silently destroys edits made during a save — `components/AdminProvider.tsx:233,265` · M
`saveAll` snapshots the staged edits at line 233, then at line 265 **replaces the whole ref**
(`editsRef.current = remaining`) with only the failures. Nothing disables the caption inputs while
the save is in flight — only the admin-bar buttons get a disabled state.

**Impact:** the admin clicks "Save all", keeps typing a title while the Cloudinary round-trip runs,
and the response wipes that entry from both the ref and `localStorage`. The text is still visible
on screen, the bar reports "no unsaved changes", and a refresh loses the work.
**Fix:** merge instead of replace, and disable the caption inputs while saving.

### 1.6 Two open tabs clobber each other's staged edits — `components/AdminProvider.tsx:165` · M
Staged state is read from `localStorage` **once on mount**, there is no `storage` event listener
(confirmed absent), and every persist writes the entire map rather than merging.

**Impact:** two tabs open on different collections. Tab A stages an edit; tab B — still holding a
pre-A snapshot — stages its own and writes it, **erasing A's**. Tab A's bar still reports an
unsaved change for an entry that no longer exists on disk.
**Fix:** add a `storage` listener to re-hydrate, and merge on write.

### 1.7 Like failures are invisible to everyone — `app/api/likes/route.ts:73` + `components/LikeButton.tsx:62` · S
Any non-`P2002` error rethrows into a 500, and the client **never checks `res.ok`** — it has
already written to `localStorage`.

**Impact:** the pooler drops a connection → 500 → the heart stays filled, `localStorage` says
"liked" forever, no row exists, no retry, and nothing is logged where anyone would see it. The
DELETE path at line 116 is entirely unguarded.
**Fix:** check `res.ok` and roll back the optimistic state; log server-side failures.

### 1.8 Reordering a collection breaks every link ever shared — `lib/cloudinaryAdmin.ts` + `lib/catalog.ts:138` · M
Reorder works by renaming `display_name` with `NN-` prefixes, and the artwork `slug` — the URL
anchor — is *derived from that filename*.

**Impact:** every previously shared `#anchor` silently stops resolving: links in past inquiry
notification emails, in the admin comment log, and in search results. The visitor lands at the top
of the collection with no error. The "stable key" invariant is enforced for `public_id` but **not
for the user-facing URL**.
**Fix:** derive slugs from something stable (the `public_id`, or a stored slug), or accept it and
stop putting anchors in emails.

### 1.9 `/admin/login` redirects a logged-in admin to a 404 — `app/admin/login/page.tsx:17` · XS
`redirect("/admin")` — but `app/admin/page.tsx` does not exist (`lib/nav.ts` correctly models
`/admin` as href-less). With no `not-found.tsx`, it's a bare 404.
**Fix:** redirect to `/admin/comments` or `/`.

### 1.10 A source file is invisible to `grep` — `components/ReorderableArtworkList.tsx:45` · XS
The file contains a literal **NUL byte** inside `join("\0")`. Reproduce:

```
$ file components/ReorderableArtworkList.tsx
components/ReorderableArtworkList.tsx: data          # ← not "text"

$ grep -rn "exhaustive-deps" components/ | wc -l
1                                                    # ← misses this file
$ grep -arn "exhaustive-deps" components/ | wc -l
2                                                    # ← -a finds it
```

**Impact:** every grep-based tool skips this file silently — audits, codemods, secret scanning, a
CI TODO check. It functions correctly at runtime, which is exactly why it survived. It also hides
an `exhaustive-deps` suppression on an effect with a real stale-closure hazard.
**Fix:** replace the NUL with a normal separator.

---

## S2 — Resilience, scale, and cost

### 2.1 `rate_windows` grows forever; the promised sweeper was never written — `lib/rateLimit.ts:13` · S
Both the code comment and `prisma/schema.prisma:55` say stale windows "can be swept occasionally by
`windowStart`". There is no cron, no scheduled function, no delete anywhere.

**Impact:** one row per (bucket, IP, window) accumulates permanently across six buckets — the
fastest-growing table in the database, on the hot path of **every public write**. The composite
primary key grows with it, making that upsert progressively more expensive. The
`rate_windows_windowStart_idx` index exists purely for the sweep query nobody wrote.
**Fix:** a periodic delete of windows older than a day.

### 2.2 The catalog silently truncates at hard limits — `lib/catalog.ts:122,164,182` · M
`max_results=500` per collection and `100` for folders, and **`next_cursor` is never read**
(confirmed absent repo-wide).

**Impact:** the 101st collection or 501st artwork simply vanishes — no error, no log. And it
cascades: those artworks disappear from `getArtworkIndex`, so an inquiry about one is rejected as
`invalid`, its likes are rejected, and because `/api/catalog-index` stops listing it, the embedder
**prunes its search vector**. One silent limit corrupts four subsystems.
**Fix:** follow `next_cursor`.

### 2.3 The CLIP model is fetched from the internet during a user request — `lib/clip.ts:19` · M
Weights are downloaded to a per-instance `/tmp` on the first request of every cold start, and
**neither side is version-pinned** — the JS side has no revision, and the Python side defaults to
`MODEL_REVISION = "main"` with its own `# pin to a commit in prod` comment unacted on.

**Impact:** search availability depends on the HuggingFace CDN mid-request; a cold fan-out under
load means many instances downloading simultaneously, each risking a timeout → 503. Worse, if
upstream weights change, query vectors **silently drift out of the stored image-vector space** —
search quality degrades with no error anywhere.
**Fix:** pin both revisions; bake weights into the deployment or move encoding to a warm container.

### 2.4 The ONNX shared-library path is hardcoded to a version — `next.config.ts:19` *(mine, this session)* · S
`libonnxruntime.so.1.21.0` is named literally, while `package.json` floats
`"@huggingface/transformers": "^3.5.0"`. That version is pinned transitively today, but any minor
bump can repin `onnxruntime-node`.

**Impact:** `outputFileTracingIncludes` with a non-matching path is **silent** — no build warning.
The first signal is production search dying with the exact
`libonnxruntime.so.1: cannot open shared object file` error this config was written to fix. The
excludes carry the mirror risk: a new provider `.so` gets traced in and blows the 250 MB limit
(that failure at least is loud).
**Fix:** derive the version from `onnxruntime-node/package.json`, or assert the paths exist at
build time.

### 2.5 The collector accepts anything and reports success regardless — `collector/main.py:66-81` · M
Past the bearer token it is a raw Kafka write primitive: no event-count cap (the `/api/events`
route caps at 25, but nothing enforces that here), no schema or size validation, no version check.

**Impact:** three concrete failures. `{"sessionId": 123}` → `AttributeError` on `.encode()` → 500
**after earlier events in the batch were already produced** (partial batch, no compensation). A
full producer queue raises `BufferError` the same way. And **`p.flush(5)`'s return value is
discarded** — it returns the number of messages still queued, so when Kafka is slow or down the
endpoint returns `204` and the events are dropped, exactly the silent loss the docstring claims to
prevent.
**Fix:** validate and cap the batch, coerce `sessionId` to `str`, and check `flush()`'s return.

### 2.6 The rate limiter fails open with no log — `lib/rateLimit.ts:34` · XS
Failing open is the right call and is documented. But the `catch {}` is **completely silent** —
compare `lib/settings.ts:41`, which logs its equivalent.

**Impact:** a degraded database disables **every rate limit on the site**, including the search
inference cost ceiling, and nothing anywhere records that it happened.
**Fix:** one `console.warn`.

### 2.7 The inquiry log has a hard 200-row ceiling — `app/admin/comments/page.tsx:26` · S
`take: 200`, with a static "Showing latest 200." and no pagination, filter, or search.
**Impact:** at inquiry 201 the oldest lead becomes permanently unreachable through the UI — on the
one table that holds actual sales leads.
**Fix:** paginate.

---

## S3 — Correctness and consistency

### 3.1 Adding a metadata field silently deletes it on the next save · M
The metadata field list exists **three times**: `META_KEYS` (`lib/catalog.ts:70`), `FIELD_KEYS`
(`components/AdminProvider.tsx:33`), and hardcoded again in `components/ArtworkCaption.tsx:37`.

**Impact:** add `Location` to `META_KEYS` and it renders — but the admin form never shows an input,
so the save path writes `context["Location"] = ""`, and an empty value is treated as *delete this
key*. The new field is wiped on the next bulk save.
**Fix:** derive all three from one exported constant.

### 3.2 Clearing a title doesn't clear it — `lib/cloudinaryAdmin.ts:71` + `lib/catalog.ts:135` · S
Blanking a title deletes the `Title Name` context key, but the read path falls back through
`caption` → `Title` → `title` → filename.
**Impact:** for any asset with a Cloudinary `caption`, the old title **reappears** after the admin
deletes it, with no way to fix it from the UI.
**Fix:** write an empty sentinel, or stop falling back when the key was explicitly cleared.

### 3.3 Search sanitizes an unbounded string before checking its length — `app/api/search/route.ts:56` · S
`sanitize()` runs NFC normalization and two full regex passes over the **entire** input, and only
then compares against `QUERY_MAX_CHARS`. The per-IP limiter runs after that. Route handlers have no
default body-size limit.
**Impact:** an unauthenticated POST with a multi-megabyte `query` is fully parsed, normalized, and
scanned three times before any limiter sees it — repeatable at no cost to the attacker. Note
`/api/events` gets this ordering right; the two routes disagree.
**Fix:** bound `rawQuery.length` before touching it.

### 3.4 `likes` DELETE skips both guards its own POST applies — `app/api/likes/route.ts:105` · S
No length cap on `artworkPublicId` and no catalog-existence check, 40 lines below a POST that does
both. Impact is negligible (it matches nothing) but it is the one public write path with neither
guard. **Fix:** mirror the POST.

### 3.5 Four error shapes, four string helpers, one alias collision · M
Public routes return `{error:"invalid"}`, `{error:"rate_limited"}`, `{error:"busy"}`, bare 204s,
and — uniquely — `{error:"bad request"}` (`app/api/admin/artworks/route.ts:39`), the only
space-separated code in a codebase that otherwise uses `snake_case`. Each route also defines its own
string normalizer (`str`, `strOf`, `boundedStr`, `sanitize`), none shared. And
`lib/inquiries.ts:59` exports an `isRateLimited` with a different arity from `lib/rateLimit.ts:18`
— `app/api/inquiries/route.ts` imports both and aliases one.
**Fix:** one shared error helper, one `boundedStr`, drop the wrapper.

### 3.6 Admin timestamps render in the server's timezone — `app/admin/comments/page.tsx:28` · XS
`Intl.DateTimeFormat` with no `timeZone`, constructed at module scope in a Server Component → it
formats in the function's timezone (UTC) and presents it unlabelled as if local.
**Impact:** the owner reads every inquiry as several hours later than it arrived.
**Fix:** pass an explicit `timeZone`, or format client-side.

### 3.7 Two indexes serve no query · XS
`inquiries_ipHash_createdAt_idx` is **dead** — it existed for the old count-based limiter, and
nothing has filtered inquiries by `ipHash` since that moved to `rate_windows` *(mine, this
session)*. `likes_artworkPublicId_idx` is redundant with the leading column of the unique index.
Both are pure write amplification. Details in [schema-design.md](schema-design.md#7-growth-retention-and-known-issues).

### 3.8 Honeypot submissions bypass the rate limit — `app/api/inquiries/route.ts:44` · XS
The honeypot returns `200` before the limiter runs, so a bot that keeps the field filled is never
limited. Each request is cheap (no DB, no Cloudinary), so this is near-benign — but the documented
"over the rate limit → 429" contract has an unmentioned bypass.

---

## S4 — Process and maintainability

### 4.1 No tests, no CI, no linter · L
Nothing runs between `git push` and a production deploy except `next build`. There is no `.github/`,
no test runner, no test file, and **no ESLint installed or configured** — yet the source carries
**six `eslint-disable` comments** for a linter that never runs. Two of those suppress
`react-hooks/exhaustive-deps` on effects with genuine stale-closure hazards, and nothing will ever
re-evaluate them. A linter would very likely have caught 1.10 years ago.
**Fix:** install ESLint and add `lint`/`typecheck` scripts; add CI running both plus `next build`.
First tests worth writing: the rate-limiter window arithmetic, the inquiry pipeline ordering, and
the search route's sanitization.

### 4.2 No monitoring, no error tracking · M
No uptime check, no Sentry, no alerting. The Next app has **no health endpoint at all** (the two
Python services have one; nothing polls them). The entire strategy is `console.*` into Vercel logs
with short retention. Combined with 2.6, a degraded database can disable every rate limit on the
site and the first signal would be a bill.

### 4.3 No backup or restore story for the database · M
No `pg_dump`, no documented PITR or branch-retention policy, no restore drill — anywhere in the
README, `docs/`, or `deploy/`. Note the asymmetry: the architecture doc states an invariant that
Cloudinary assets are the only copy of production artwork and must never be deleted, but says
nothing equivalent about Postgres — which holds the **only copy of every sales lead**, and where
the admin hard-deletes rows behind a single `window.confirm`.

### 4.4 880 lines of documentation are stranded on an unmerged branch · XS
`docs/system-overview.md`, `docs/schema-design.md`, and the `architecture.md` staleness banner are
committed on `origin/search` and not in `main`. **Fix:** merge it — the cheapest available win
against 4.5.

### 4.5 Documentation drift · M
Beyond the two docs above: `docs/architecture.md` claims one database table (there are five),
`next.config.ts` is empty (38 lines), email notification is out of scope (shipped), and its route,
component, `lib/`, and env tables are each missing roughly half their entries — including both
Python services, which appear nowhere in the "Directory map". `docs/kafkaEventsPlan.md` says K1
lives on an unmerged branch and K2 is pending; both are false. `docs/fable-handoff-spec.md` reads as
current but describes `next/image`, `tailwind.config`, and "no admin" — none of which are true.
**The README never mentions the search feature or the embedder at all**: no `--profile embedding`,
no `/reindex`, no `EMBED_TOKEN`, no `CATALOG_INDEX_TOKEN`. It also still says the hero and headshot
images are "still to upload" (both committed) and that the admin panel is "not built yet".

### 4.6 The embedder's dependencies are unpinned — and the CPU-only claim isn't enforced — `embed/requirements.txt:1` *(mine, this session)* · S
Every dependency is floor-pinned (`torch>=2.2`, `transformers>=4.44`) with no lockfile, so two
builds on different days produce materially different images. **This has already broken once:** the
`_image_embeds` helper in `embed/main.py` exists solely to paper over a `transformers` version
difference in whether `get_image_features()` returns a tensor or a `ModelOutput`.

Separately, line 1 uses `--extra-index-url`, which **adds** an index rather than replacing PyPI —
so pip can resolve `torch` to the CUDA build from PyPI and pull the `nvidia-*` wheels, contradicting
the "CPU-only Torch — keeps the image small" comment directly above it.
**Fix:** `--index-url`, exact pins, and a lockfile. Also: the Dockerfile bakes the full `CLIPModel`
including the text tower, which the embedder never uses.

### 4.7 No `engines`, `.nvmrc`, or `packageManager` · XS
The Node version is whatever Vercel's default drifts to — for a project shipping a native addon
compiled against a specific ABI.

### 4.8 Dangerous compose defaults — `docker-compose.yml:119,124` *(mine, this session)* · XS
`CATALOG_INDEX_URL` defaults to **production** while `EMBED_DATABASE_URL` defaults to the **local**
database.
**Impact:** out of the box, the embedder reads production artwork ids and writes vectors to a
throwaway local database. The inverse mistake — a localhost URL with the Neon string still set —
writes dev-catalog vectors into production. No guard rail, no dry-run.
**Fix:** make both required, or make both default local.

### 4.9 No secrets-rotation policy · S
`EVENT_INGEST_TOKEN` lives in Vercel *and* on the EC2 box; rotating out of order breaks ingest and
nothing documents the order. `CATALOG_INDEX_TOKEN` lives in two places. `IP_HASH_SALT` is
unrotatable (1.3). The untracked local `.env` also carries the production database password in
**three redundant forms** across 14 Neon boilerplate variables that no code in the repo reads —
pure paste residue, widening the rotation surface for nothing.

### 4.10 No reindex runbook, and no drift detection · S
Nothing states *when* to re-run the embedder (after every artwork add, delete, or rename). And
because the search route maps ids back through the catalog and drops misses, a deleted artwork just
quietly returns fewer results while a new one is simply unfindable — with **no signal at all**.

---

## S5 — Cleanup

- **`public/images/oldHero.jpg`** — 216 KB, zero references, shipped in every deploy. **XS**
- **Three merged branches** (`security-audit`, `origin/kafka-events`, `origin/email`) still around,
  the oldest six weeks. `kafka-events` is still described as live in the docs. **XS**
- **~9 exports with no external consumer** (`SESSION_COOKIE`, `MAX_WIDTH`, `SRCSET_WIDTHS`,
  `CatalogArtworkRef`, `InquiryNotification`, `SiteContent`, …) — they make `lib/` look like a wider
  public surface than it is. **XS**
- **`restart: unless-stopped` on the embedder** *(mine)* — contradicts its own comments describing a
  spin-up/probe/tear-down service; it now returns on every Docker restart and holds the model in
  RAM. **XS**
- **A compose comment that contradicts the code** — line 98 calls `/api/catalog-index` the "admin"
  endpoint; it is deliberately *not* under `/api/admin` because a container has no cookie. **XS**
- **Stale comments:** `prisma/schema.prisma:79` says the unique constraint "doubles as the rate limit"
  (both halves now false); `prisma/schema.prisma:57` lists three buckets where six are in use;
  `lib/inquiries.ts:8` claims the inquiry route is the "sole caller" of helpers that four routes
  import — misleading to anyone judging the blast radius of `clientIpOf`, the spoofing guard. **XS**
- **Duplicated magic values** across files that must not drift: the sidebar width `236px` (change it
  and every `srcset` picks the wrong candidate), the `66vh` fit-height (captions stop aligning), the
  `3600` revalidate window, the `"catalog"` cache tag, and the site origin — which is spelled three
  ways, one of which drops an auth header on redirect. **S**

---

## If you only do five things

1. **Fix the contact email link** (1.1) — one line, and it is losing you inquiries right now.
2. **Fix local setup** (1.2) — one line, and nobody can start the project without it.
3. **Add error boundaries and guard the root layout** (1.4) — stops a third-party outage from
   taking down the admin tools you would use to respond to it.
4. **Merge the stranded docs, then write the `rate_windows` sweeper** (4.4, 2.1) — one is free, the
   other is the only unbounded growth in the system.
5. **Install ESLint and add CI** (4.1) — the absence of any gate is what let most of this list
   accumulate silently.
