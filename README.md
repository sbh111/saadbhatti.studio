# saadbhatti.studio

Minimal slate-grey portfolio for Saad Bhatti's film photography and (future) oil paintings.
Next.js (App Router) + Tailwind CSS · images on Cloudinary (`sbh111`) · deployed on Vercel.

Design docs live in [`docs/`](docs/) — see `fable-handoff-spec.md` for the full spec and
`saadbhattistudioPlan(refined).md` for product intent. The Figma reference is the
**"saadbhatti.studio — v1"** page in the `saadbhatti.studio` Figma file.

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000
```

## Adding / updating content

**Cloudinary is the source of truth for artwork** — the site reads it at build time via the
Admin API (see `lib/catalog.ts`). No code or JSON changes needed to add work:

1. **Upload the image to Cloudinary** into the folder convention
   `art/<medium>/<collection>/`, e.g. `art/photography/pakistan2023/01-rooftops`.
   The `art/` wrapper is the catalog root (`CATALOG_ROOT_FOLDER`); a folder
   created beside it is invisible to the site. The page is then at
   `/art/photography/pakistan2023`.
2. **Set contextual metadata** on the image in the Media Library:
   - `Title Name` — the display name (falls back to the built-in Title, then a
     prettified filename)
   - photographs: `Film` (e.g. `Portra 400`)
   - paintings: `Medium`, `Dimensions`, `Year`
   Blank/missing keys simply don't render.
3. **Order** is alphabetical by filename — prefix files `01-`, `02-`, … to control it.
4. The site re-checks Cloudinary hourly (ISR); redeploy on Vercel to see changes
   immediately.

A new collection = a new folder under the medium. New mediums (and the site text, bio,
contact) live in [`content/content.json`](content/content.json). A medium with
`"status": "wip"` renders the "Work in progress" view.

### Cloudinary API credentials (required to build)

The build calls the Cloudinary Admin API. Copy `.env.local.example` to `.env.local` and
fill in the API key/secret from the Cloudinary dashboard (Settings → API Keys). Add the
same two variables in Vercel: Project → Settings → Environment Variables.

### Required env vars fail loud, not silent

`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`, `DATABASE_URL`, `IP_HASH_SALT`,
`SESSION_SECRET`, and `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` are asserted present (and
non-empty) at server startup — see `lib/env.ts` and `instrumentation.ts`. A deploy
missing any of them fails immediately at boot, naming every missing one, instead of the
site building and rendering fine, then 500ing per-feature the first time each one is
actually needed. A production Vercel build (`VERCEL_ENV=production`) additionally refuses
to finish building at all if one is missing — see `next.config.ts`. Every other env var
below (Resend, the event collector, `CATALOG_INDEX_TOKEN`) is an optional feature that
already degrades gracefully on its own when unset.

### CI

`.github/workflows/ci.yml` runs lint, typecheck, tests, and `next build` on every push
and PR. The build step needs the same Cloudinary credentials as above — add
`CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` as **repository secrets** (Settings →
Secrets and variables → Actions) or the workflow's build step will fail. `DATABASE_URL`/
`DIRECT_URL` are hardcoded to an unreachable placeholder in the workflow itself — nothing
in the build ever queries the database, so no database secret is needed (or wanted) in CI.

### Hero & headshot — local files

The landing hero and about-page headshot are served straight from the repo, not
Cloudinary. Drop the files at:

- `public/images/hero.jpg` — landing hero photo
- `public/images/headshot.jpg` — about-page headshot

(`content.json` points at `/images/hero.jpg` and `/images/headshot.jpg`; any image
reference starting with `/` is treated as a local file under `public/`, everything
else as a Cloudinary public id.)

Images are delivered capped at **2048px long edge** (`c_limit`) with `f_auto,q_auto`,
responsive `srcset`, lazy loading, and a blur-up placeholder. Originals stay off-site.

## Local database (blog posts, inquiries, likes, settings, rate limits, search vectors)

Private inquiries ("comment log"), likes, the event-streaming toggle, rate-limit
counters, and CLIP search vectors are all stored in Postgres via Prisma — Neon in
production, a local Docker Postgres for development (see
[docs/schema-design.md](docs/schema-design.md) for the six tables). **DB URLs
live in `.env`** (not `.env.local`) because the Prisma CLI reads only `.env`;
Next.js reads both. Copy `.env.example` to `.env` (the committed local Docker
URLs work as-is) and add `IP_HASH_SALT` to `.env.local` (see
`.env.local.example`).

> **`.env` is local-only. Production credentials must never go in it.** That file
> is loaded implicitly by both the Prisma CLI and Next, so whatever is in it is
> what a careless command reaches — on 2026-11-17 it held the Neon URLs and a
> routine `prisma migrate diff --shadow-database-url "$DIRECT_URL"` reset the
> production database. Neon credentials belong in `.env.neon.local`, which is
> git-ignored and loaded automatically by nothing, and are used deliberately via
> `scripts/with-neon-db.mjs`. Full account: [docs/operations.md](docs/operations.md) #3.1.

Prefer these over raw Prisma commands — they refuse to run unless both
`DATABASE_URL` and `DIRECT_URL` point at a local host:

```bash
npm run db:migrate    # assert-local-db.mjs, then prisma migrate dev
```

```bash
npm run db:reset      # assert-local-db.mjs, then prisma migrate reset
```

```bash
npm run db:diff       # read-only drift check; safe against ANY database
```

```bash
npm run db:check      # just the guard: which database am I pointed at?
```

The local `db` image is `pgvector/pgvector:pg16`, not plain `postgres:16-alpine` —
`prisma/migrations` includes `CREATE EXTENSION IF NOT EXISTS vector` (the CLIP search
feature's storage), and a vanilla Postgres image doesn't ship that extension at all;
`npx prisma migrate dev` used to fail on a fresh clone with `extension "vector" is not
available` (tech-debt 1.2). If you have an **existing** local volume created before this
switch, Postgres may log a collation-version mismatch warning when it starts under the
new (Debian-based, not Alpine/musl) image — the clean fix is `docker compose down -v`
(wipes the local volume; your data is disposable dev data, not anything to migrate) and
recreating it fresh with `npx prisma migrate dev`.

```bash
docker compose up -d              # start Postgres 16 + pgvector (container sbh-studio-db, :5432)
npx prisma migrate dev            # first run: create tables from prisma/migrations
npm run dev                       # http://localhost:3000

npx prisma studio                 # browse/edit rows in the browser
docker compose down               # stop (data persists in the named volume)
docker compose down -v            # stop AND wipe the volume (full reset)
```

`prisma generate` runs automatically on `npm install` (postinstall). The app connects
lazily, so `next build` never needs a running database.

### Production migrations (manual)

Migrations are **not** run in the Vercel build (content redeploys stay decoupled from DB
availability). After adding a migration, apply it to Neon through the wrapper, which reads
`.env.neon.local`, tells you which host it is about to touch, and makes you type that host
back before it runs anything:

```bash
scripts/with-neon-db.mjs npx prisma migrate deploy
```

It passes the credentials to the child process through its environment (real env beats `.env`
in Prisma's precedence), so nothing has to be exported into your shell — where it would then
be in reach of every *later* command in that session, which is precisely how the 2026-11-17
incident happened. The wrapper unconditionally refuses `--shadow-database-url`,
`migrate reset`, `db push` and `migrate dev`, whatever you type at the prompt.

Check what is applied without changing anything:

```bash
scripts/with-neon-db.mjs npx prisma migrate status
```

## Email notifications (Resend)

Each new inquiry emails you a notification (with the inquirer set as the reply-to, so
you can reply straight from your inbox). Delivery is via [Resend](https://resend.com).
It is **best-effort**: the inquiry is saved and shown in the comment log first, then the
email is sent in the background via `after()` from `next/server` — so a mail failure can
never block or fail a submission, and the endpoint's latency is unchanged.

The send lives in [`lib/mail.ts`](lib/mail.ts) and is fully implemented — it only needs
configuring:

1. In Resend, **verify the `saadbhatti.studio` domain** (add the DNS records it gives you
   at Porkbun). Until verified, Resend only delivers to your own account email, and `from`
   must be `onboarding@resend.dev`.
2. Set three env vars in `.env.local` and in Vercel (see `.env.local.example`):
   - `RESEND_API_KEY` — from the Resend dashboard.
   - `INQUIRY_NOTIFY_FROM` — an address on the verified domain, e.g. `inquiries@saadbhatti.studio`.
   - `INQUIRY_NOTIFY_TO` — your work email.

If any of the three is unset, the send is skipped with a warning and inquiries keep
working. If Resend rejects a send, the error is logged and the inquiry is still saved.

## Event streaming (Kafka — optional learning feature)

A **toggleable** clickstream pipeline: the site streams anonymized page views,
artwork views, likes, and intent gestures to a Kafka broker via an HTTP
collector. It is **off by default** and **never affects the site when off or when
the broker is unreachable** — the collector forward is best-effort (`after()`,
all errors swallowed, endpoint always 204), exactly like the mail phase. Full
design + the AWS/Python phases are in [`docs/kafkaEventsPlan.md`](docs/kafkaEventsPlan.md).

**Likes are durable and independent of streaming** — the ♥ under each artwork
writes a deduped row to Postgres regardless of the toggle, so it keeps working
even with the broker torn down. Counts are private (admin-only, at `/admin/likes`).

Run the streaming stack locally (Kafka + collector are behind a compose profile,
so ordinary `docker compose up -d` still starts only Postgres):

```bash
docker compose --profile streaming up -d     # + Kafka (KRaft) + collector
```

Then set `EVENT_COLLECTOR_URL` / `EVENT_INGEST_TOKEN` in `.env.local` (see
`.env.local.example`), flip the toggle **on** at `/admin/settings`, and browse.
Kafka's `9092` is **not** published to the host (private, like prod) — watch the
stream with a console consumer inside the container:

```bash
docker compose exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 --topic web.events.v1 \
  --from-beginning --property print.key=true
```

Turn the toggle off, or `docker compose stop collector kafka`, and the site (and
likes) behave identically. Production deployment (EC2, TLS, security group) and
the Python analysis consumer are Phases K2/K3 in the plan doc.

## Semantic image search

Visitors can search artwork by description (`/api/search`), backed by CLIP image vectors that
a separate on-demand container (`embed/`, `docker compose --profile embedding`) writes to
Postgres via its own `POST /reindex` endpoint. It does not run automatically — see
[docs/operations.md §1](docs/operations.md#1-re-indexing-search) for when and how to re-run it,
including the `EMBED_TOKEN` (defaulted in `docker-compose.yml`) and `CATALOG_INDEX_TOKEN`
(`.env.local.example` has the local default; the production value lives in Vercel and is passed
to the embedder per-invocation — see [docs/operations.md §2](docs/operations.md#2-secrets)).

## Blog

Posts live in Postgres (the first content this database owns — see the backup note below) and are
written at `/admin/blog`:

1. **`/admin/blog`** — every post, filterable by state (`?status=draft` and friends; the filter is
   in the URL so a view is bookmarkable). Type a title and hit **new draft** to start one.
2. **The editor** — title, slug, excerpt, cover image and body, with a **save** button and an
   unsaved-changes warning if you try to leave with edits pending. The body is **Markdown**
   (headings, lists, links, quotes, code, tables, images), with a live character count and
   reading-time estimate.
3. **Images** — **upload a cover** or **insert an image** sends the file straight from your
   browser to Cloudinary under a short-lived signed ticket, so it never passes through the
   serverless function (and is not subject to its 4.5 MB body limit). Uploads land in the
   post's own folder, named `blog/<slug>-<post-id>/` — e.g.
   `blog/on-shooting-portra-clq2x8k9p0000abcd1234efgh/`. The artwork catalog cannot see it.
   Both halves of the name earn their place: the slug is what lets you recognise a folder in
   the Cloudinary console, and the id is what keeps it unique when two posts share a title.
   Grouping per post matters because nothing in this app ever deletes a Cloudinary asset — a
   flat folder would only grow, while per-post folders keep an abandoned post's images
   identifiable as a unit when you clear them out by hand. **One wrinkle:** renaming a draft
   after uploading leaves the earlier images in the old folder, so a post can span two. Both
   carry the same id, so they are still recognisable as one post's; the alternative was
   freezing the name at first upload, which trades this for folder names that go stale after a
   retitle. A body image is inserted as Markdown at your cursor; fill in its alt text in the
   brackets. Removing a cover detaches it from the post rather than deleting the file.
4. **Preview** a draft at `/admin/blog/<id>/preview` — it renders through the same component
   visitors get, so the preview cannot drift from production. That matters more with Markdown
   than it did with plain text, because the output is no longer something you can predict by
   reading the source. Drafts deliberately 404 on the public URL; previewing there would mean
   reading the session on a public page and would make the whole site dynamic.
5. **publish** puts it live at `/blog/<slug>` and on the `/blog` index immediately (the cache is
   invalidated on the spot, not on a timer). **unpublish** returns it to draft, **archive** takes
   it off the site but keeps it in the admin list (**restore to draft** brings it back), **delete**
   is permanent.

Rules worth knowing:

- **An excerpt is required to publish** (the index renders it), but not to save a draft.
- **A published post's slug is locked.** It is editable only while the post is a draft, because
  once published the URL is something a reader may already have shared.
- **Raw HTML in a body is shown as text, not rendered**, and only `http`/`https`/`mailto` links
  survive. `marked` does neither of those by itself — it emits raw HTML verbatim and happily
  builds a `javascript:` link — so `lib/markdown.ts` is load-bearing security code, not
  formatting polish. See [docs/architecture.md](docs/architecture.md) invariant 13.
- **A body `#` heading renders as `<h2>`.** The post title is the page's only `<h1>`.
- **Reading time is an estimate** from a word count over the raw Markdown, so a link-heavy post
  reads slightly long. It is derived at read time rather than stored, so it can never disagree
  with the body.
- **Posts written before Markdown may read differently now.** A line starting with `#` or `*` is
  no longer literal. Phase 0 shipped with no published posts, so in practice this affects
  nothing — but it is the reason the switch happened early.

**The public blog pages read Postgres, which no other public page does.** That is deliberate and
fenced in: reads are cached for an hour and tagged, `next build` never issues the query (so a
deploy never depends on the database being up), and `npm run verify:routes` asserts the
static/dynamic split in CI. See [docs/architecture.md §13](docs/architecture.md) invariant 2.

**Back up the database.** Artwork survives a lost database because Cloudinary holds the real copy;
blog posts do not. There are two lines of defence and they cover different failures:

- **Neon instant restore** — always on, no setup, but time-bounded (~6 hours on Free). This is
  what recovered the 2026-11-17 reset; see [docs/operations.md](docs/operations.md) #3.1.
- **A nightly `pg_dump` to `~/backups`** — unbounded retention, outside Neon entirely, but it
  only fires when this machine is on. Install the timer:

```bash
mkdir -p ~/.config/systemd/user && cp scripts/systemd/sbh-studio-backup.* ~/.config/systemd/user/
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now sbh-studio-backup.timer
```

```bash
sudo loginctl enable-linger $USER
```

The last one lets the timer fire while logged out. Verify with
`systemctl --user start sbh-studio-backup.service` then
`journalctl --user -u sbh-studio-backup.service -n 30`. Deliberately **not** a GitHub Actions
workflow: this repository is public, and a workflow artifact containing the `inquiries` table
would publish visitors' names, emails and messages. A restore drill has still never been
run — an untested backup is a hypothesis.

## Deploy

> **If an install fails with `onnxruntime-node ... 404 Not Found`**, the CUDA
> execution-provider download is the cause. `.npmrc` already skips it (nothing here
> uses a GPU — the CLIP text encoder runs on CPU in a serverless function). If a
> Vercel build somehow misses that file, set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`
> as a project environment variable; it is the same switch in the form npm does not
> deprecate.

Hosted on Vercel (project linked to this repo; pushes to `main` deploy).
Domain `saadbhatti.studio` is registered at Porkbun → point DNS at Vercel.
Analytics: Vercel Analytics (already wired in `app/layout.tsx`).

## Admin panel

Logging in at `/admin/login` (single owner account, `iron-session` cookie —
no Vercel password protection, no user table) unlocks inline editing on the
public pages themselves: caption/metadata edits and drag-to-reorder are staged
locally and published with one "Save all" (writes back to Cloudinary), plus
four dedicated pages — `/admin/blog` (write and publish posts, see below),
`/admin/comments` (the inquiry log), `/admin/likes` (private like counts), and
`/admin/settings` (the event-streaming toggle and search/embedding drift
counts). See
[docs/architecture.md §§8–9](docs/architecture.md) for how auth and the staged
editor work.

**Not built:** print purchasing and an order-log view. `content.json` already
reserves `availability`/`price` on paintings for when that lands.
