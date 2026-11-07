# saadbhatti.studio — Fable Build Hand-off Spec

> **⚠️ Historical / superseded.** This is the original Phase 0 build brief, kept
> for the design-token and layout reference (§3–4, §9–10 are still accurate).
> Several concrete claims below are **no longer true** — for current state see
> [system-overview.md](system-overview.md) and [architecture.md](architecture.md):
> - **§2 "Images via `next/image`"** — false today. Artwork images are a raw
>   `<img>` with hand-built Cloudinary URLs (`lib/cloudinary.ts`); the CDN does
>   the optimization, so `next/image`'s own transform pipeline was never needed.
> - **§2 "Tailwind tokens wired into `tailwind.config`"** — false today. The repo
>   is on Tailwind v4, which has no `tailwind.config.*` file; tokens live as CSS
>   variables in `app/globals.css`/`postcss.config.mjs`.
> - **§13 "no admin in Phase 0"** — long since built. There's a full inline admin
>   surface (edit/reorder artworks, comment log, likes, settings) gated by an
>   `iron-session` cookie — see [system-overview.md §4](system-overview.md#4-admin-editing-and-auth-).
>   Print purchasing and an order-log view remain unbuilt, as this section predicted.
>
> Companion docs:
> `saadbhattistudioPlan(refined).md` (product intent) and `questions.md` (decisions Q1–Q20).
> **Figma:** file `saadbhatti.studio` (key `yW8EuGztFSd0vAVqo0uDDA`), page **"saadbhatti.studio — v1"**.
> Sections: *Components* (`Sidebar / master`) and *Screens* (5 desktop + 3 mobile frames).

---

## 1. Goal & scope

Build **Phase 0**: a minimal, slate-grey portfolio for film photography (and a future
oil-painting section). Persistent left sidebar + scrollable main content area; single-page app
feel with client-side routing. Portfolio only — **no commerce, no admin in Phase 0.**

At launch there is **one** photography collection (`pakistan2023`, 10 photos) and **zero** oil
paintings (the oil-paintings medium exists but routes to a "work in progress" view).

---

## 2. Tech stack

- **Framework:** Next.js (App Router) + React + TypeScript.
- **Styling:** Tailwind CSS, with the tokens below wired into `tailwind.config` + CSS variables.
- **Font:** Inter, via `next/font/google` (weights 400/500/600/700).
- **Images:** Cloudinary (cloud name **`sbh111`**), served through `next/image` with a
  Cloudinary loader (or `next-cloudinary`).
- **Content:** a static **`content.json`** manifest in the repo (Pattern B — see §7). No CMS.
- **Hosting:** Vercel. Domain `saadbhatti.studio` (owned, on Porkbun) → point DNS at Vercel.
- **Analytics:** Vercel Analytics (`@vercel/analytics`), enabled.

---

## 3. Design tokens

### 3.1 Colors (Figma color styles → CSS vars)

| Token / var         | Hex       | Use |
|---------------------|-----------|-----|
| `--slate-page`      | `#E9EBEE` | Page background / main content area |
| `--slate-panel`     | `#DFE2E6` | Sidebar & mobile-drawer background (flat) |
| `--ink`             | `#262A2E` | Primary text, wordmark |
| `--ink-muted`       | `#6C727A` | Metadata, secondary text |
| `--ink-faint`       | `#9AA0A7` | Placeholders, `+ N more`, chevrons |
| `--hairline`        | `#CFD3D8` | Dividers, sidebar edge, top-bar border |
| `--accent-steel`    | `#445059` | Active nav (bar + label), links |
| `--nav-active-fill` | `#D2D7DC` | Active nav row background |
| image placeholders  | `#C7CBD0` / `#CDD1D6` / `#D5D9DE` | dev-only; replaced by real images |

### 3.2 Typography (all Inter; Figma text styles)

| Style          | Weight    | Size | Tracking | Use |
|----------------|-----------|------|----------|-----|
| `wordmark`     | 700 Bold  | 22   | -2%      | "Saad Bhatti" in sidebar/top-bar (one line) |
| `nav`          | 400       | 15   | 0        | Top-level nav labels |
| `nav-active`   | 600       | 15   | 0        | Active nav label |
| `nav-nested`   | 400       | 14   | 0        | Nested nav (artwork names, `+ N more`) |
| `view-heading` | 600       | 30   | -1%      | View titles (collection/medium/"about") |
| `view-subhead` | 400       | 14   | 0        | Sub-line under a heading (muted) |
| `body`         | 400       | 17   | 0        | Body copy, intro, bio |
| `artwork-name` | 500       | 17   | 0        | Artwork title under image; collection cover name |
| `artwork-meta` | 400       | 14   | 0        | Per-medium metadata (muted) |

### 3.3 Layout tokens
- **Sidebar width:** ~**220px** desktop (fixed; sized to hold the one-line wordmark, ≈1/6).
  Final value may be nudged after review — keep it a single constant.
- **Desktop breakpoint:** sidebar persistent ≥ ~900px; below that → hamburger + drawer.
- **Content gutter:** collection images span nearly full width with an **8px** side gutter.
- **Corner radius:** images/cards `2px` (near-square gallery look).

---

## 4. App shell & layout

```
Desktop (≥ ~900px)          Mobile (< ~900px)
┌────────┬───────────────┐   ┌───────────────────┐
│Sidebar │ Main (route)  │   │ TopBar (☰ + name) │
│(fixed  │ scrolls       │   ├───────────────────┤
│ 220px, │ independently │   │ Main (route)      │
│ flat   │               │   │ scrolls           │
│ panel) │               │   └───────────────────┘
└────────┴───────────────┘   ☰ → Drawer slides in (tree over dimmed backdrop)
```

- Sidebar and main area are **independent scroll regions**.
- Sidebar is a **flat** `--slate-panel`; main area is `--slate-page`.
- Mobile top bar: wordmark left, hamburger right, `--hairline` bottom border. Tapping the
  hamburger opens the **drawer** (the same nav tree) over a `rgba(0,0,0,0.35)` backdrop;
  tapping the backdrop or a link closes it.

---

## 5. Routes / views

| Route | View | Notes |
|-------|------|-------|
| `/` | **LandingView** | Hero image (centered) + intro line below |
| `/about` | **AboutMeView** | Headshot + bio + contact (Instagram) |
| `/:medium` | **CollectionsView** | Vertical stack of full-width collection covers; if medium `status==='wip'` → **WIPView** |
| `/:medium/:collection` | **CollectionView** | Vertical stack of artworks |
| `/:medium/:collection#:artworkSlug` | CollectionView + scroll | Anchor-scroll to that artwork |

- `oil-paintings` has `status: 'wip'` and no collections → `/oil-paintings` renders **WIPView**
  ("Work in progress · Stay tuned…"), reusable for any future not-ready section.
- Intro copy (Landing): *"Howdy, I'm Saad Bhatti, and welcome to my studio. Feel free to
  explore my work."*

---

## 6. Components (Figma → React)

| React component | Maps to Figma | Responsibility |
|-----------------|---------------|----------------|
| `AppShell` | screen frame (Sidebar + Main) | Layout, routing outlet, responsive switch |
| `Sidebar` | `Sidebar / master` | Wordmark, divider, `NavTree`, flat panel bg |
| `NavTree` / `NavRow` | `row: *` frames | Recursive tree; indent by depth; chevron **right**, label **left** |
| `MobileTopBar` | `topbar` | Wordmark + hamburger |
| `MobileDrawer` | `drawer` + backdrop | Slide-in `NavTree` overlay |
| `LandingView` | Desktop/Mobile Landing | Hero + intro |
| `AboutView` | Desktop/About | Headshot + bio + contact |
| `CollectionsView` | Desktop/CollectionsView | Vertical stack of `CollectionCover` |
| `CollectionView` | Desktop/CollectionView | Stack of `ArtworkBlock` |
| `WIPView` | Desktop/WIPView | Centered WIP message |
| `CollectionCover` | `collection: *` | Full-width cover + name + count below; clickable box → collection |
| `ArtworkBlock` | `artwork: *` | Full-width `ArtworkImage` + name + metadata below |
| `ArtworkImage` | `image` | Cloudinary responsive image + placeholder |

### NavTree behavior (important)
- `about me` → `/about`. `art` → **expand/collapse only** (not a link).
- `:medium` (e.g. `photography`) → expands collections **and** navigates to `CollectionsView`.
- `:collection` (e.g. `pakistan2023`) → expands artworks **and** opens `CollectionView`.
- artwork leaf → **scroll** the open `CollectionView` to that artwork (`#slug` anchor).
- `oil paintings` → leaf, routes to `WIPView` (no chevron, nothing to expand).
- **Active row** styling: `--nav-active-fill` background, 2px `--accent-steel` left bar,
  label `nav-active` in `--accent-steel`, chevron in `--accent-steel`.
- Chevron sits at the **right edge**; labels **hug the left edge** and indent by depth via
  left padding (about me / art at base indent; mediums one level in, etc.).
- Persist which branches are expanded as the user navigates; highlight the current node.

---

## 7. Content model — Cloudinary is the source of truth (Pattern A — REVISED)

> **Revision (post-launch):** originally built as Pattern B (JSON manifest). Switched to
> Pattern A at Saad's request once Cloudinary **contextual metadata** proved sufficient:
> folder membership = collection, `Title Name`/`Film`/`Medium`/`Dimensions`/`Year` context
> keys = per-artwork data, alphabetical filename order (`01-`, `02-`, …) = display order.
> Implemented in `lib/catalog.ts` via the Admin API (env vars `CLOUDINARY_API_KEY`/
> `CLOUDINARY_API_SECRET`), with hourly ISR revalidation. `content.json` now holds only
> site text + the medium list (slug, displayName, published/wip status).

The original Pattern B manifest shape below is kept for historical reference:

```jsonc
{
  "site": {
    "title": "Saad Bhatti's Studio",
    "intro": "Howdy, I'm Saad Bhatti, and welcome to my studio. Feel free to explore my work.",
    "contact": { "instagram": "https://instagram.com/sbhphotographyaccount/" }
  },
  "mediums": [
    {
      "slug": "photography",
      "displayName": "photography",
      "status": "published",
      "collections": [
        {
          "slug": "pakistan2023",
          "name": "pakistan2023",
          "cover": null,                        // null → use first artwork's image
          "artworks": [
            {
              "type": "photograph",
              "slug": "rooftops-lahore",
              "name": "Rooftops, Lahore",
              "image": "photography/pakistan2023/rooftops-lahore",  // Cloudinary public id
              "film": "Portra 400"
            }
            // …9 more (order in array = display order)
          ]
        }
      ]
    },
    {
      "slug": "oil-paintings",
      "displayName": "oil paintings",
      "status": "wip",
      "collections": []
    }
  ]
}
```

**Field reference**
- `ArtWork` (base): `type`, `slug`, `name`, `image` (Cloudinary public id).
- `photograph`: + `film` (optional).
- `painting`: + `medium`, `dimensions`, `year` (all optional); **reserved, not rendered in
  Phase 0:** `availability`, `price` (include in the type now to avoid a later migration).
- **Metadata rendering** (directly below the image / cover name):
  - photograph → `Film: {film}`
  - painting → `Medium: {medium} · Dimensions: {dimensions} · Year: {year}`

---

## 8. Cloudinary

- **Cloud name:** `sbh111`. **Folder convention:** `/<medium>/<collection>/` (e.g.
  `/photography/pakistan2023/`). The manifest's `image` is the public id (path without
  extension).
- **Display cap:** long edge **2048px**. Base delivery URL:
  `https://res.cloudinary.com/sbh111/image/upload/f_auto,q_auto,c_limit,w_2048/<public_id>`
- **Responsive:** generate a `srcset` at ~640/1024/1536/2048 widths (`c_limit,w_<n>`); let the
  browser pick. Never ship the full original to a phone.
- **Lazy loading:** native `loading="lazy"` (or `next/image` default) for everything below the
  fold — matters for long collections.
- **Placeholder:** blur-up (`q_auto,w_16,e_blur` LQIP) or a solid `--ink-faint` box to prevent
  layout shift; reserve space with the image's aspect ratio.
- TIFs are not uploaded (Cloudinary takes JPG/PNG/WebP); Saad's originals stay off-site.

---

## 9. Surface treatment

Surfaces are **flat**: sidebar/drawer = `--slate-panel`, main area = `--slate-page`, separated
by the `--hairline` edge. **No marble/texture** — a plain, clean slate palette. (An earlier
marble idea was tried and dropped.)

---

## 10. Site meta & polish

- **Title:** `Saad Bhatti's Studio`. **Social/OG preview:** the landing hero image.
- **Favicon:** skip for now (Saad will add a logo later) — use a neutral placeholder.
- **Analytics:** Vercel Analytics enabled.
- **Accessibility:** semantic landmarks (`nav`, `main`), alt text = artwork name, keyboard-
  operable tree + drawer, visible focus states, `prefers-reduced-motion` respected on the
  drawer transition.

---

## 11. Assets Saad provides

- Landing **hero photo** (has it) and **About headshot** (has it).
- The **10 `pakistan2023` photos** (on local drive) → upload to Cloudinary
  `/photography/pakistan2023/`, then fill their `name` + `film` in the manifest.
- Final **bio** text (placeholder seeded in §5 of the plan is fine to ship initially).
- Contact: Instagram `@sbhphotographyaccount` (business email TBD — omit until ready).

---

## 12. Acceptance criteria

- [ ] Persistent sidebar (desktop) with flat slate panel; hamburger drawer (mobile) — matches Figma.
- [ ] One-line "Saad Bhatti" wordmark; labels hug left; chevrons at right edge; active state correct.
- [ ] All 5 views render from `content.json`; adding a collection/photo is a data-only change.
- [ ] `photography → pakistan2023` shows 10 images near-full-width with name + `Film:` metadata.
- [ ] `oil-paintings` shows WIPView; Instagram appears only on About.
- [ ] Nav: expand/collapse persists, active node highlighted, artwork links scroll-anchor.
- [ ] Images via Cloudinary `sbh111`, capped 2048 long edge, responsive + lazy + placeholder.
- [ ] Title "Saad Bhatti's Studio", hero OG preview, Vercel Analytics live, deploys on Vercel.
- [ ] Inter + exact color/type tokens from §3.

---

## 13. Out of scope (Phase 1 — do not build now)

Print purchasing (`ArtWorkView` + checkout), admin panel (upload/reorder/edit, publish↔WIP
toggle) behind **Vercel password protection**, and an **order-log view**. The data model
already reserves `availability`/`price` so these won't require a migration.
