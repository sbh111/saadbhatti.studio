# learnings.md — how saadbhatti.studio works, for a backend engineer

A technical consolidation of the build session: what the pieces are, how they fit,
and the front-end concepts behind them — translated into backend vocabulary wherever
possible. Read alongside the code; every section names the files it describes.

---

## 1. The mental model: this site is a build-time ETL job, not a server

The biggest backend-to-frontend mindset shift for this project: **there is no
application server handling requests at runtime.** The site is *compiled*.

```
                    BUILD TIME (npm run build / Vercel deploy)
┌──────────────┐   ┌─────────────────┐   ┌──────────────────────────────┐
│ Cloudinary   │──▶│ lib/catalog.ts  │──▶│ Static HTML per route        │
│ Admin API    │   │ (extract +      │   │ /, /about, /photography,     │
│ (folders,    │   │  transform)     │   │ /photography/pakistan-       │
│  metadata)   │   └─────────────────┘   │ zindabad, /oil-paintings     │
└──────────────┘           ▲             └──────────────────────────────┘
                           │                          │
                  content/content.json                ▼
                  (site text, medium list)   Served from Vercel's CDN
                                             like any static file
```

- **Build** = an ETL run: pull the catalog from Cloudinary, join it with
  `content.json`, render every page to HTML, ship the artifacts to a CDN.
- **A visitor request** never touches our code. It's a CDN cache hit.
- **ISR (Incremental Static Regeneration)** is the cache-invalidation policy:
  `revalidate = 3600` in `app/layout.tsx` means "this compiled output has a TTL of
  1 hour; after that, the next request triggers a background re-run of the ETL."
  That's why uploading a photo to Cloudinary appears on the site within an hour
  with no deploy: the *data* changed, and the build re-runs itself.

Backend analogy: it's a materialized view over Cloudinary, refreshed on a TTL.

The exception to "no server code at runtime" is the regeneration itself (Vercel runs
our build code server-side when the TTL lapses) — but no per-request business logic
exists anywhere.

---

## 2. The stack, in one paragraph each

- **Next.js (App Router)** — the framework. Its core contract: *the filesystem is
  the router*. A folder under `app/` is a URL segment; a `page.tsx` in it is the
  handler for that route. `[medium]` in a folder name is a path parameter, exactly
  like `/{medium}` in a REST route definition.
- **React** — the templating + composition layer. A *component* is a pure function:
  `props in → UI description out`. Pages are built by composing these functions.
  Think of components as well-factored private functions in a service class, except
  the return type is markup. (Yes, this site **is** React — every file in
  `components/` and `app/` is a React component. It's easy to miss: modern React
  needs no `import React` line, and Next.js is a framework *built on* React the way
  Spring Boot is built on Spring.)
- **TypeScript** — same role as in backend code. The interfaces in `lib/catalog.ts`
  (`CatalogArtwork`, `CatalogCollection`, `CatalogMedium`) are the domain model.
- **Tailwind CSS** — utility-class styling. Instead of a separate stylesheet with
  named classes, elements carry small atomic classes (`px-2`, `text-ink`). Our
  design tokens (colors, breakpoint) are declared once in `app/globals.css` under
  `@theme` and referenced everywhere — the front-end equivalent of a constants file.

---

## 3. The layers (backend architecture mapping)

The repo has a layered architecture you'll recognize immediately:

| Layer (backend term)      | Here                            | Files |
|---------------------------|---------------------------------|-------|
| Config / static data      | site text, medium definitions   | `content/content.json`, `lib/content.ts` |
| External client / gateway | Cloudinary Admin API wrapper    | `lib/catalog.ts` (`api()` helper) |
| Repository / service      | catalog assembly, domain types  | `lib/catalog.ts` (`getCatalog`, …) |
| DTO builder               | nav tree for the sidebar        | `lib/nav.ts` (`buildNavTree`) |
| URL/helpers               | Cloudinary delivery URLs        | `lib/cloudinary.ts` |
| Controllers (routes)      | one per view                    | `app/**/page.tsx` |
| Views / templates         | reusable UI pieces              | `components/*.tsx` |
| Middleware-ish shell      | chrome around every page        | `app/layout.tsx` + `components/AppShell.tsx` |

### 3.1 Data layer — `lib/`

- **`lib/content.ts`** types and exports `content.json`. After the Cloudinary
  refactor, the JSON holds only site text (title, intro, bio, contact, hero/headshot
  paths) and the medium list (`photography` published, `oil-paintings` wip). It is
  deliberately dumb — a config file.
- **`lib/catalog.ts`** is the interesting one. `getCatalog()`:
  1. For each published medium, `GET /folders/<medium>` → subfolders = collections.
  2. For each collection folder, `GET /resources/by_asset_folder` → the assets,
     with `context=true` to include the contextual metadata.
  3. Transforms each asset into a `CatalogArtwork`: display name → sort key + URL
     slug; `Title`/`caption` context → artwork name; `Film` (or `Medium`/
     `Dimensions`/`Year` for paintings) → a pre-rendered `metaLine` string; real
     `width/height` → aspect ratio for layout.
  It's wrapped in React's `cache()` — request-scoped memoization, so the layout and
  every page share one fetch per build instead of each re-querying (think:
  per-request DI container caching a repository call).
- **`lib/cloudinary.ts`** builds delivery URLs. Pure string functions, no I/O.
- **`lib/nav.ts`** flattens the catalog into a serializable tree of
  `{id, label, href, depth, children}` nodes for the sidebar. It exists as a
  separate step because of the server/client boundary (see §5).

### 3.2 Routes — `app/`

Each `page.tsx` is a controller: parse params → call the service → 404 or render.

| Route | File | Behavior |
|-------|------|----------|
| `/` | `app/page.tsx` | LandingView: hero + intro from `content.json` |
| `/about` | `app/about/page.tsx` | headshot, bio, contact |
| `/[medium]` | `app/[medium]/page.tsx` | CollectionsView: full-width cover per collection; renders `WIPView` if the medium is `wip`/empty |
| `/[medium]/[collection]` | `app/[medium]/[collection]/page.tsx` | CollectionView: the artwork stack |

Two framework hooks worth knowing:

- **`generateStaticParams()`** = "enumerate every value of the path parameter at
  build time so each can be compiled." Ours return medium slugs from `content.json`
  and collection slugs from the catalog. This is why the build log prints each
  concrete URL it prerendered.
- **`generateMetadata()`** = per-route response headers, but for `<title>`/OG tags.

`app/layout.tsx` is the root template every page renders inside (like a base
template + middleware): it loads the Inter font, sets site-wide metadata, fetches
the catalog, builds the nav tree, and wraps `children` (the current page) in
`AppShell`.

### 3.3 Components — `components/`

Composition graph:

```
layout.tsx (server)
└── AppShell (client)  ── owns: drawer open/closed state
    ├── mobile top bar (wordmark + hamburger)
    ├── desktop sidebar ──► SidebarContent ──► NavTree (client)
    ├── mobile drawer   ──► SidebarContent ──► NavTree      owns: expanded set
    └── <main> = the current page:
        ├── LandingView   ──► ArtworkImage
        ├── AboutMeView   ──► ArtworkImage
        ├── CollectionsView ──► CollectionCover ──► ArtworkImage
        ├── CollectionView  ──► ArtworkBlock    ──► ArtworkImage
        └── WIPView
```

- **`ArtworkImage`** — the one image primitive everything uses. Given a `src` it
  branches: starts with `/` → local static file from `public/`; otherwise → a
  Cloudinary public id, rendered with a capped-width URL, a `srcset` (multiple
  sizes; the browser picks — think content negotiation), lazy loading, and a
  blur-up placeholder. It also reserves the image's aspect ratio *before* load so
  the page doesn't reflow (CLS prevention).
- **`ArtworkBlock`** — `<figure>` = image + caption (name + metaLine). Its `id` is
  the artwork slug, which makes it an anchor target.
- **`CollectionCover`** — same visual pattern, but the whole block is a link to the
  collection.
- **`WIPView`** — the reusable "Work in progress · Stay tuned…" placeholder.

---

## 4. Views vs components — the distinction that matters

"View" (our design vocabulary) = a full screen the router can land on: Landing,
About, Collections, Collection, WIP. In code, views are just the `page.tsx` files.

"Component" = a reusable fragment a view composes: `ArtworkImage`, `NavTree`, etc.

The relationship is exactly *handler → helper functions*. Views own route concerns
(params, 404s, metadata); components own presentation and are route-agnostic. That's
why `CollectionCover` takes `collection` + `mediumSlug` as props instead of reading
the URL itself.

**Props** are function arguments flowing strictly downward. There is no global
mutable state; if a child needs data, a parent passes it. When two siblings need
the same state (top bar button opens the drawer), the state lives in their common
parent (`AppShell`) — "lifting state up."

---

## 5. Server components vs client components (the App Router's big idea)

Every component is one of two kinds, and the split maps cleanly to backend thinking:

- **Server components** (default): run *only* during the build/regeneration, on the
  server. They may do I/O (our layout awaits `getCatalog()`), they can hold secrets
  (the Cloudinary key never reaches a browser), and they ship **zero JavaScript**
  to the client — output is pure HTML. All pages and most components here are
  server components.
- **Client components** (marked `"use client"`): also server-rendered to HTML for
  first paint, but their JS *additionally* ships to the browser and "hydrates" so
  they can respond to events and hold state. We have exactly two:
  `AppShell` (drawer open/closed) and `NavTree` (expanded branches, active row).

The boundary rule that shaped `lib/nav.ts`: **server → client data must cross as
serializable props** (it's marshalled into the page payload — think JSON over a
process boundary). The layout (server) fetches the catalog and passes a plain
`NavNode[]` tree into `AppShell` (client). `NavTree` can't call `getCatalog()`
itself — it runs in the browser, where there is no API secret and no server.

Interactivity inventory (deliberately tiny):
- `NavTree` keeps a `Set<string>` of expanded node ids (`useState`). A `useEffect`
  auto-expands the ancestors of the current URL on navigation. Active row =
  `node.href === usePathname()`. Chevron clicks toggle; label clicks navigate (and
  expand). Because the App Router keeps the layout mounted across navigations, this
  state survives page changes without any persistence layer.
- `AppShell` keeps one boolean: is the mobile drawer open.

Everything else on the site is inert HTML.

---

## 6. Routing & navigation (why the site feels like an SPA)

`<Link>` (used in the nav tree, wordmark, collection covers) intercepts clicks and
performs **client-side navigation**: instead of a full page load, Next fetches the
target page's payload and swaps only `<main>`'s contents. The layout — sidebar
included — never remounts. That's what produces the "persistent sidebar, only the
main view area changes" behavior from the original plan, and it's why nav expansion
state survives navigation for free.

Artwork links (`/photography/pakistan-zindabad#01-masjid`) are plain **anchor
navigation**: the `#fragment` scrolls to the `ArtworkBlock` with the matching `id`
inside the scrollable `<main>`. `scroll-margin-top` in `globals.css` keeps targets
from hugging the container edge.

Layout mechanics worth naming: the shell is `body { h-screen; overflow-hidden }`
with a flex row inside — sidebar and `<main>` are each `overflow-y-auto`, i.e. two
independent scroll regions. Responsive switching is pure CSS: below the custom
`desk:` breakpoint (900px, defined in `globals.css`) the sidebar is `display:none`
and the top bar + drawer render instead. Nothing measures the window in JS.

---

## 7. The image pipeline

Two source types, one component (`ArtworkImage`):

1. **Local** (`/images/hero.jpg`): files in `public/` are served verbatim at the
   site root — `public/` is the static-assets mount. No transformation happens, so
   we pre-compressed them (4032px/3–4.6MB originals → 2000px/~0.5MB, EXIF
   orientation baked in).
2. **Cloudinary** (everything artwork): the URL *is* the transform API —
   `f_auto,q_auto,c_limit,w_2048` = "best format for this browser (AVIF/WebP),
   auto quality, cap long edge at 2048." The `srcset` lists 640/1024/1536/2048
   variants; the browser requests the smallest that satisfies the layout. This is
   also the image-protection story: visitors can only ever obtain capped
   display copies; originals never leave Saad's drive.

---

## 8. The Cloudinary integration — what we learned the hard way

These cost real debugging time; recorded so they never do again.

1. **Product environments.** One Cloudinary *account* can hold several isolated
   *environments*, each with its own cloud name and its own API keys. Admin API
   calls are validated against the environment in the URL (`cloud_name mismatch`
   otherwise).
2. **API key roles.** A key without the right role **authenticates but returns
   empty payloads**: listings came back `{"resources": [], "total_count": 27}` —
   counts visible, data withheld — and a direct asset GET finally surfaced the real
   error: `403 … missing permissions (actions=["read"])`. Fix: grant the key
   *Master Admin* (or at least read). If listings return counts with empty arrays,
   suspect the key role first.
3. **Dynamic folders mode.** In modern environments an asset's `public_id` is an
   opaque string (`000094130032_v1yz2w`) with **no folder path in it**. The folder
   lives in the `asset_folder` attribute and the human filename in `display_name`.
   Consequences: prefix-based queries return nothing; you list folders via
   `GET /folders/<path>` and members via `GET /resources/by_asset_folder`. ("Home"
   in the Media Library UI is just the root — never part of any path.)
4. **Built-in metadata field names lie.** The Media Library field labeled **Title**
   is stored as context key **`caption`** (and Description as `alt`). Our lookup
   chain — `Title Name` → `caption` → `Title` → `title` — absorbs this.
5. **Secrets discipline.** API credentials live in `.env.local` (git-ignored) and
   in Vercel's environment settings — never in code, never in the committed
   `.env.local.example` template. (One near-miss: credentials pasted into the
   example file were caught before commit.)

---

## 9. Deployment & operations

- **Pipeline:** push to `main` on GitHub → Vercel builds (`next build`, which runs
  the Cloudinary ETL using the env vars) → atomic deploy to the CDN. A failed build
  never takes the site down; the previous deploy stays live.
- **Domain:** `saadbhatti.studio` (Porkbun DNS → Vercel); apex 308-redirects to
  `www`.
- **Content ops (the payoff of this architecture):** upload photos to
  `photography/<Collection Name>/` in the Media Library, set Title + Film, prefix
  filenames `01-`, `02-`… for order. Folder name = collection title; rename the
  folder, the site follows. Changes go live within the 1-hour ISR window, or
  immediately on redeploy. Zero code, zero JSON, zero deploys for day-to-day
  content.
- **Analytics:** Vercel Analytics via one `<Analytics />` component in the layout.

---

## 10. Glossary (front-end term → nearest backend concept)

| Front-end term | Nearest backend concept |
|---|---|
| Component | Pure function returning markup; composable unit |
| Props | Function arguments / DTO passed downward |
| State (`useState`) | In-memory per-instance variable that triggers re-render on write |
| `useEffect` | Post-render hook reacting to dependency changes |
| Server component | Code that runs at build/regeneration; can do I/O, keeps secrets |
| Client component (`"use client"`) | Code shipped to the browser; interactive, stateless-server |
| Hydration | Attaching live behavior to server-rendered HTML on the client |
| SSG (static site generation) | Ahead-of-time compilation of routes to HTML |
| ISR / `revalidate` | Cache TTL + background refresh of the compiled output |
| `generateStaticParams` | Enumerating path-parameter values to precompile |
| Client-side navigation | Partial response swap instead of full page reload |
| Layout (App Router) | Base template + shared middleware that persists across routes |
| `public/` | Static file mount at the web root |
| `srcset` / `sizes` | Content negotiation for image resolution |
| Lazy loading | Deferred fetch on scroll-into-view |
| Blur-up placeholder / CLS | Space reservation to avoid layout shift |
| Tailwind `@theme` tokens | Central constants file for the design system |
| Hydration boundary props | Serialization across a process boundary |

---

## 11. Where Phase 1 will plug in

The seams are already cut:

- **ArtWorkView / purchasing:** `ArtworkBlock` is intentionally not a link today;
  making it one (`/photography/<collection>/<artwork>`) adds a detail route that
  reads the same catalog. `availability`/`price` will come from Cloudinary context
  keys the same way `Film` does.
- **Admin panel:** a protected route (Vercel password protection) whose actions are
  Cloudinary uploads/renames + context edits — the site already rebuilds itself
  from whatever Cloudinary says, so admin writes need no site-side database.
- **Order log:** the first feature that genuinely needs a runtime backend (orders
  are runtime data, not build-time content) — likely a small API route + hosted DB
  when we get there.
