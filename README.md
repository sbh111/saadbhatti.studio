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

### Images still to upload (placeholders until then)

- `public/images/hero.jpg` and `public/images/headshot.jpg` (local, see above)
- `photography/pakistan2023/photo-01` — first photo on Cloudinary (then set its real
  `name`/`film` in the manifest)

Images are delivered capped at **2048px long edge** (`c_limit`) with `f_auto,q_auto`,
responsive `srcset`, lazy loading, and a blur-up placeholder. Originals stay off-site.

## Local database (inquiries)

Private inquiries ("comment log") are stored in Postgres via Prisma — Neon in production,
a local Docker Postgres for development. **DB URLs live in `.env`** (not `.env.local`)
because the Prisma CLI reads only `.env`; Next.js reads both. Copy `.env.example` to `.env`
(the committed local Docker URLs work as-is) and add `IP_HASH_SALT` to `.env.local` (see
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

## Deploy

Hosted on Vercel (project linked to this repo; pushes to `main` deploy).
Domain `saadbhatti.studio` is registered at Porkbun → point DNS at Vercel.
Analytics: Vercel Analytics (already wired in `app/layout.tsx`).

## Phase 1 (not built yet)

Print purchasing, admin panel behind Vercel password protection, order log. The
`content.json` schema already reserves `availability`/`price` on paintings for this.
