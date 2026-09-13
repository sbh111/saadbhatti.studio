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
   `/<medium>/<collection>/`, e.g. `photography/pakistan2023/01-rooftops`.
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

## Local database (inquiries, likes, settings, rate limits, search vectors)

Private inquiries ("comment log"), likes, the event-streaming toggle, rate-limit
counters, and CLIP search vectors are all stored in Postgres via Prisma — Neon in
production, a local Docker Postgres for development (see
[docs/schema-design.md](docs/schema-design.md) for the five tables). **DB URLs
live in `.env`** (not `.env.local`) because the Prisma CLI reads only `.env`;
Next.js reads both. Copy `.env.example` to `.env` (the committed local Docker
URLs work as-is) and add `IP_HASH_SALT` to `.env.local` (see
`.env.local.example`).

```bash
docker compose up -d              # start Postgres 16 (container sbh-studio-db, :5432)
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
availability). After adding a migration, apply it to Neon by hand with the Neon URLs as
real env vars (real env beats `.env` in Prisma's precedence — no dotenv-cli needed):

```powershell
$env:DATABASE_URL="<neon pooled ...?sslmode=require&pgbouncer=true>"
$env:DIRECT_URL="<neon direct ...?sslmode=require>"
npx prisma migrate deploy
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

## Deploy

Hosted on Vercel (project linked to this repo; pushes to `main` deploy).
Domain `saadbhatti.studio` is registered at Porkbun → point DNS at Vercel.
Analytics: Vercel Analytics (already wired in `app/layout.tsx`).

## Admin panel

Logging in at `/admin/login` (single owner account, `iron-session` cookie —
no Vercel password protection, no user table) unlocks inline editing on the
public pages themselves: caption/metadata edits and drag-to-reorder are staged
locally and published with one "Save all" (writes back to Cloudinary), plus
three dedicated pages — `/admin/comments` (the inquiry log), `/admin/likes`
(private like counts), and `/admin/settings` (the event-streaming toggle and
search/embedding drift counts). See
[docs/architecture.md §§8–9](docs/architecture.md) for how auth and the staged
editor work.

**Not built:** print purchasing and an order-log view. `content.json` already
reserves `availability`/`price` on paintings for when that lands.
