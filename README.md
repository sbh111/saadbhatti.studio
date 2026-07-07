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

All content is driven by [`content/content.json`](content/content.json) — no code changes
needed to add work.

1. **Upload the image to Cloudinary** into the folder convention
   `/<medium>/<collection>/`, e.g. `photography/pakistan2023/rooftops-lahore`.
2. **Add an entry** to the collection's `artworks` array (array order = display order):

   ```jsonc
   // photograph
   { "type": "photograph", "slug": "rooftops-lahore", "name": "Rooftops, Lahore",
     "image": "photography/pakistan2023/rooftops-lahore", "film": "Portra 400" }

   // painting
   { "type": "painting", "slug": "first-oil", "name": "First Oil",
     "image": "oil-paintings/collection/first-oil",
     "medium": "Oil on Canvas", "dimensions": "24x36in", "year": "2026" }
   ```

   Optional fields (`film`, `medium`, `dimensions`, `year`, `aspect`) can be `null` or
   omitted — blanks simply don't render. `aspect` (width ÷ height, e.g. `1.5`) reserves
   the right space before the image loads; it defaults to 3:2.
3. Commit + push — Vercel redeploys automatically.

New collections go in a medium's `collections` array; a new medium goes in `mediums`.
A medium with `"status": "wip"` (or no collections) renders the "Work in progress" view.

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

## Deploy

Hosted on Vercel (project linked to this repo; pushes to `main` deploy).
Domain `saadbhatti.studio` is registered at Porkbun → point DNS at Vercel.
Analytics: Vercel Analytics (already wired in `app/layout.tsx`).

## Phase 1 (not built yet)

Print purchasing, admin panel behind Vercel password protection, order log. The
`content.json` schema already reserves `availability`/`price` on paintings for this.
