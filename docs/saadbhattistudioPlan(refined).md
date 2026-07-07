# saadbhatti.studio — Executive Plan (Refined v2)

> A minimal, personal site for high-resolution film photography and (future) oil
> painting, with a persistent navigation sidebar and a scrollable main viewing area.
> **v2 folds in all answers from `questions.md` (Q1–Q20).** This is now the source of truth
> going into the Figma design.

---

## 1. Vision & Principles

- **Minimal and content-first.** The artwork is the interface. Chrome (menus, text) stays
  quiet so images dominate.
- **Persistent navigation.** A left sidebar is always present on desktop, showing the full
  content tree so a visitor can jump anywhere in a few clicks.
- **Fast, high-quality images.** Capped hi-res JPGs served from Cloudinary with automatic
  resizing/compression so pages load quickly without sacrificing quality.
- **Built to grow.** Phase 0 is a portfolio. The data model and structure are designed so
  Phase 1 can add print purchasing + an admin panel without a rewrite.

---

## 2. Terminology (plain-English → front-end terms)

| Your term            | Standard term                        | Notes |
|----------------------|--------------------------------------|-------|
| Side Bar / Panel     | **Persistent sidebar / nav rail**    | Fixed left column, always visible on desktop |
| Tree structure       | **Collapsible navigation tree**      | Expand/collapse nodes; scrolls if taller than viewport |
| Main View Area       | **Main content area / content pane** | Fills the space to the **right** of the sidebar |
| The "Views"          | **Pages / routes**                   | Landing, About, Collections, Collection, WIP |
| Jump to an artwork   | **Anchor / scroll-to link**          | Deep-links to a position within a scrollable page |
| ClickableBox         | **Card**                             | Image + label, optionally links somewhere |

The site is a **single-page application (SPA)** with **client-side routing** — the sidebar
never reloads; only the main content area swaps as you navigate.

---

## 3. Layout

```
┌──────────────────┬───────────────────────────────────────┐
│  SIDEBAR         │  MAIN CONTENT AREA                    │
│  (fits name+tree)│  (remaining width)                    │
│                  │                                       │
│  Saad Bhatti     │   [ Landing / About / Collections /   │
│  (bold, 1 line)  │     Collection / WIP renders here     │
│                  │                                       │
│  about me        │                                       │
│  art             │                                       │
│    photography   │                                       │
│    oil paintings │   (scrolls independently of sidebar)  │
│                  │                                       │
│  (scrolls)       │                                       │
└──────────────────┴───────────────────────────────────────┘
```

- **Sidebar width:** wide enough to hold **"Saad Bhatti" on one line** in a bold, large
  weight — roughly **~220px** at 1440px (~1/6.5). Priority is the one-line name; width flexes
  to that, final call from the Figma. *(Q2a)*
- **Tree alignment:** labels hug the **left edge** of the sidebar (small left padding) and
  align by indent level; the expand/collapse **chevron sits at the right edge** of each row
  (only parent rows show one). `about me` and `art` sit at the **same depth** (both direct
  children of root); mediums indent one level under `art`.
- **Two independent scroll regions:** sidebar scrolls on its own when the tree is tall; the
  main area scrolls on its own for long collections.
- **Mobile/tablet:** the sidebar collapses behind a **hamburger menu** and slides in as an
  overlay; always-visible sidebar is desktop-only. *(Q2b)*
- **No contact in the sidebar:** the Instagram/contact link lives **only on the About page**,
  not in the sidebar. *(per feedback)*

---

## 4. Pages (Views)

### 4.1 LandingView (home, `/`)
- Hero image: Saad holding a brush / with a piece (asset in hand — on local drive). *(Q10)*
- Short intro beneath it: *"Howdy, I'm Saad Bhatti, and welcome to my studio. Feel free to
  explore my work."*
- Quiet, generous whitespace. First impression.

### 4.2 AboutMeView (`/about`)
- Separate **headshot** (not the hero). *(Q19a)*
- Bio (placeholder for now, seeded with these true details — Q19b):
  - *I'm Saad Bhatti, a Software Engineer by trade, but a creative at heart.*
  - *I've been shooting film for a few years on my film cameras, and have expanded my creative
    endeavors to oil painting.*
- Contact: Instagram `instagram.com/sbhphotographyaccount/` now; business email later. *(Q10)*

### 4.3 CollectionsView (`/[medium]`, e.g. `/photography`)
- Shows every Collection within a medium as a **vertical stack of full-width covers** — the
  same near-full-width treatment as CollectionView (small side gutter), **not** a small card grid.
- Each entry = the collection's cover image spanning the main-area width, with the collection
  name + photo count directly below. The whole entry is a clickable box.
- Cover defaults to the collection's first artwork. *(Q7b)*
- Clicking a cover opens that Collection.
- At launch, photography has **one** collection: `pakistan2023`. *(Q1, Q12c)*

### 4.4 CollectionView (`/[medium]/[collection]`)
- Vertical, scrollable stack of artworks.
- Each image spans **nearly the full width** of the content area (small gutter, a few px).
- Directly **below each image**: the artwork name + its per-medium metadata. *(Q7a)*
- Not clickable in Phase 0. Reserved: future link to an ArtWorkView for print purchase.

### 4.5 WIPView (reusable placeholder) *(Q1, Q15)*
- Centered message: **"Work in Progress, Stay Tuned…"**
- Used at launch for the **oil paintings** medium: the tab appears in the sidebar and is
  clickable, but has no collections, so its main area shows WIPView. Reusable for any future
  not-yet-ready section.

---

## 5. Navigation Tree (sidebar)

```
Saad Bhatti                      ← wordmark, bold, large, one line, top of sidebar
─────────────
about me                         → AboutMeView
art                              ▸ expands mediums (label only, no page)
  photography                    → CollectionsView (photography) + expands collections
    pakistan2023                 → CollectionView + expands its artworks
      Rooftops, Lahore           → scrolls CollectionView to that photo
      Truck Stop
      ... (10 total)
  oil paintings                  → WIPView (no collections yet)
```

`about me` and `art` are **siblings** (same depth). Labels hug the left edge and align by
indent level; the expand/collapse chevron sits at the **right edge** of the row, shown only on
rows that have children.

Behavior rules:
- **art** — expand/collapse only; not a link.
- **photography** — expands *and* navigates to the photography CollectionsView.
- **[collection]** — expands its artworks *and* opens the CollectionView.
- **[artwork]** — scrolls the open CollectionView to that artwork's position (anchor link).
- **oil paintings** — clickable, routes to WIPView.
- Active node is highlighted; expanded branches persist as you navigate.

---

## 6. Data Model

Modeled as a small class hierarchy (per your Q13 suggestion — a base `ArtWork` with
medium-specific subclasses), realized in the manifest as tagged records:

```
ArtMedium
  ├─ slug            (e.g. "photography", "oil-paintings")
  ├─ displayName
  ├─ status          ("published" | "wip")   ← oil-paintings = wip at launch
  └─ collections[]   → Collection

Collection
  ├─ slug            (e.g. "pakistan2023")
  ├─ name
  ├─ coverImage      (defaults to first artwork)
  └─ artworks[]      → ArtWork

ArtWork (base)
  ├─ id / slug
  ├─ name
  └─ image           (Cloudinary public id → capped display JPG + thumbnail)

  ├─ Photograph (extends ArtWork)
  │    └─ film                       (e.g. "Portra 400")
  │
  └─ Painting (extends ArtWork)
       ├─ medium                     (e.g. "Oil on Canvas")
       ├─ dimensions                 (e.g. "24x36in")
       ├─ year                       (e.g. "2026")
       └─ (reserved, not rendered in Phase 0) availability, price
```

**Metadata display (below each image):** *(Q13)*
- Photograph → `name` + `Film: <film>`
- Painting → `name` + `Medium: <medium> · Dimensions: <dimensions> · Year: <year>`
- All metadata fields are optional — blanks simply don't render.
- `availability` / `price` exist as reserved optional fields now (cheap to carry, avoids a
  later migration) but are **not displayed** until Phase 1 purchasing.

**Source of truth — Pattern B:** *(Q11)* images live in Cloudinary; a `content.json`
manifest lists mediums, collections, artwork order, names, and per-medium metadata. The site
reads the manifest to build both the sidebar tree and the views. Adding a photo = upload to
Cloudinary + a few lines in the manifest. An admin UI over this comes in Phase 1.

---

## 7. Images & Performance

- **Host:** Cloudinary. Cloud name **`sbh111`**; folder convention **`/<medium>/<collection>/`**
  (e.g. `/photography/pakistan2023/`). *(Q3, Q12)*
- **Resolution cap:** display copies capped at **long edge 2048px** (Cloudinary generates
  these via URL params; your full-res originals stay on your drive — this is also the image
  "protection"). TIFs aren't uploaded (Cloudinary takes JPG/PNG/WebP). *(Q8, Q14)*
- **Responsive images:** serve a right-sized version per device (`srcset`).
- **Lazy loading:** images load as they scroll into view — important for long collections.
- **Placeholders:** blur-up or solid color while each image loads, to avoid layout jumps.

---

## 8. Typography & Visual Style

- **Font:** **Inter** throughout. *(Q5)*
- **Mood:** **slate-grey gallery, flat surfaces** — cool grey surfaces, a restrained steel
  accent, mostly monochrome, photos doing the talking. (Marble was explored and dropped — plain
  slate reads cleaner.) *(Q6 + feedback)*
- **Proposed tokens (finalized in Figma):**

  | Token            | Value             | Use |
  |------------------|-------------------|-----|
  | `--slate-page`   | `#E9EBEE`         | Page background |
  | `--slate-panel`  | `#DFE2E6`         | Sidebar background (flat) |
  | `--ink`          | `#262A2E`         | Primary text / name |
  | `--ink-muted`    | `#6C727A`         | Metadata, secondary text |
  | `--hairline`     | `#CFD3D8`         | Dividers, sidebar edge |
  | `--accent`       | `#445059` (steel) | Active nav state (used sparingly) |

- **Type scale (Inter):** wordmark 22px bold · nav 15px · nested nav 14px · view heading 30px ·
  body 17px · metadata 14px muted.

---

## 9. Tech & Delivery (for the Fable build)

- **Type:** SPA with client-side routing; static-hostable.
- **Suggested stack:** React (Next.js) + Tailwind CSS; images via Cloudinary; content via
  `content.json`. Fable makes the final call, but the Figma is structured to map 1:1 onto
  components: `Sidebar`, `NavTree`, `MainArea`, `LandingView`, `AboutView`, `CollectionsView`,
  `CollectionView`, `WIPView`, `CollectionCover`, `ArtworkBlock`, `ArtworkImage`.
- **Hosting/domain:** deploy to **Vercel**; domain **saadbhatti.studio** owned on Porkbun,
  DNS to be pointed at Vercel. *(Q9)*
- **Site meta:** *(Q20)* browser tab title **"Saad Bhatti's Studio"**; social-share preview
  uses the hero image; **favicon skipped** for now (logo later); **Vercel Analytics enabled**.

---

## 10. Phasing

- **Phase 0 (this build):** sidebar + tree, Landing, About, CollectionsView, CollectionView,
  WIPView, Cloudinary + manifest, capped images, responsive/mobile, analytics, site meta.
  Portfolio only — no commerce, no admin.
- **Phase 1 (later):** ArtWorkView with print/purchase; admin panel (upload/replace images,
  create & reorder collections, edit names + metadata, reorder artworks, publish/WIP toggle)
  behind **Vercel password protection**; an **order-log view** (table of orders: status, time
  submitted, and other fields). *(Q16, Q17, Q18)*

---

## 11. Workflow from here

1. ✅ Answers folded into this plan (v2).
2. ✅ Figma design built (`figma-console`): sidebar + nav tree, all five views, desktop +
   mobile (hamburger) frames, Inter type styles, slate color styles.
3. ✅ Design refined (slate palette, flat surfaces, one-line wordmark, right-edge chevrons,
   full-width collection covers). Hand-off spec written: `fable-handoff-spec.md`.
4. **→ Fable builds the site** from the approved design + spec.
