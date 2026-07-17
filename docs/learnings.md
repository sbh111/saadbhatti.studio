# learnings.md — how saadbhatti.studio works, for a backend engineer

The front-end concepts behind this site, translated into backend vocabulary wherever
possible. Read alongside the code; every section names the files it describes.

This is the *conceptual* guide — the "why does it work this way" doc. For the
exhaustive structural reference (every directory, every route, every invariant),
see [architecture.md](architecture.md). Current as of **Phase D**.

---

## 1. The mental model: one repo, two regimes

The original version of this doc opened with "this site is a build-time ETL job, not
a server." That was true through Phase 0, and it's still the *dominant* half of the
picture — but it stopped being the whole truth once admin editing and inquiries
shipped. The accurate model today is **two regimes living in one Next.js app**:

| | Public site | Admin + inquiries |
|---|---|---|
| Routes | `/`, `/about`, `/[medium]`, `/[medium]/[collection]` | `/admin/*`, `/api/inquiries` |
| When code runs | Build time (and hourly regeneration) | Per request |
| A visitor request | CDN cache hit — never touches our code | Runs our code, hits Cloudinary or Postgres |
| Backend analogy | Materialized view over Cloudinary, refreshed on a TTL | An ordinary small service |

```
        BUILD TIME (npm run build / ISR regeneration)
┌──────────────┐   ┌─────────────────┐   ┌───────────────────────────────┐
│ Cloudinary   │──▶│ lib/catalog.ts  │──▶│ Static HTML per route         │
│ Admin API    │   │ (extract +      │   │ /, /about, /photography,      │
│ (folders,    │   │  transform)     │   │ /photography/southwest, …     │
│  metadata)   │   └─────────────────┘   └───────────────────────────────┘
└──────────────┘           ▲                          │
                           │                          ▼
                  content/content.json        Served from Vercel's CDN
                  (site text only)            like any static file

        REQUEST TIME (the part that is a real server)
  POST /api/inquiries ──▶ validate + rate-limit ──▶ Postgres
  GET  /admin/comments ─▶ check session ─────────▶ Postgres
  POST /api/admin/artworks ─▶ write Cloudinary ──▶ invalidate the cache above
```

Two things follow, and they explain most of the design tension in this codebase:

1. **Publishing is cache invalidation, not deploying.** Uploading a photo to
   Cloudinary appears within the hour with no deploy, because the *data* changed and
   the build re-runs itself. An admin save doesn't even wait for the TTL — it calls
   `revalidateTag("catalog", "max")` to drop the cache immediately.
2. **The static half must be defended.** Anything that reads a cookie, a header, or
   the database in the public render path silently converts those pages from
   compiled artifacts into per-request renders. A surprising amount of this
   codebase's structure exists purely to prevent that (see §5).

---

## 2. The stack, in one paragraph each

- **Next.js (App Router)** — the framework. Core contract: *the filesystem is the
  router*. A folder under `app/` is a URL segment; a `page.tsx` in it is the handler.
  `[medium]` is a path parameter, exactly like `/{medium}` in a REST route.
- **React** — the templating + composition layer. A *component* is a pure function:
  `props in → UI description out`. Think well-factored private functions whose
  return type is markup. (Modern React needs no `import React`; Next is built *on*
  React the way Spring Boot is built on Spring.)
- **TypeScript** — same role as in backend code. The interfaces in `lib/catalog.ts`
  (`CatalogArtwork`, `CatalogCollection`, `CatalogMedium`) are the domain model.
- **Tailwind CSS** — utility-class styling. Design tokens (colors, fonts,
  breakpoint) are declared once in `app/globals.css` under `@theme` — the front-end
  equivalent of a constants file. Two fonts: Inter for body, Press Start 2P
  (`font-pixel`) for the wordmark and view headings.
- **Prisma + Postgres** — added in Phase D for inquiries. Prisma is the ORM;
  Postgres is Neon in production and a Docker container locally. This is the only
  database in the system, and it holds exactly one table.
- **iron-session** — stateless session auth: the session *is* an encrypted cookie,
  so there's no session store to run.

---

## 3. The layers (backend architecture mapping)

A layered architecture you'll recognize immediately:

| Layer (backend term) | Here | Files |
|---|---|---|
| Config / static data | site text | `content/content.json`, `lib/content.ts` |
| External client / gateway | Cloudinary Admin API wrapper | `lib/cloudinaryAdmin.ts` (`apiGet`) |
| Repository / service | catalog assembly, domain types | `lib/catalog.ts` |
| ORM / persistence | Prisma client singleton | `lib/db.ts`, `prisma/schema.prisma` |
| Domain service | inquiry hashing + rate limiting | `lib/inquiries.ts` |
| Auth / security | session, credentials | `lib/auth.ts`, `proxy.ts` |
| DTO builder | nav tree for the sidebar | `lib/nav.ts` |
| URL helpers | Cloudinary delivery URLs | `lib/cloudinary.ts` |
| Controllers | one per view / endpoint | `app/**/page.tsx`, `app/api/**/route.ts` |
| Views / templates | reusable UI pieces | `components/*.tsx` |
| Base template | chrome around every page | `app/layout.tsx` + `components/AppShell.tsx` |

The interesting one is still **`lib/catalog.ts`**. `getCatalog()` walks Cloudinary's
folder tree — root folders become mediums, subfolders become collections, assets
become artworks — and transforms each asset: `display_name` → sort key + URL slug;
context `Title Name`/`caption` → artwork name; context `Film`/`Medium`/`Dimensions`/
`Year` → a pre-rendered `metaLine`; real `width`/`height` → aspect ratio for layout.

Note what *isn't* there: no medium is named anywhere in the code. `content.json`
used to carry a medium list; it doesn't anymore. Add a root folder in Cloudinary and
a new medium appears. That genericity was a deliberate Phase 0.5 refactor.

`getCatalog()` is wrapped in React's `cache()` — request-scoped memoization, so the
layout and every page share one fetch per render instead of each re-querying (think:
a per-request DI container caching a repository call). `getArtworkIndex()`, added in
Phase D, is a second cached view: a flat `public_id → artwork + location` map, used
to validate inquiry submissions and to join the comment log back to artworks.

---

## 4. Views vs components — the distinction that matters

"View" (our design vocabulary) = a full screen the router can land on: Landing,
About, Collections, Collection, WIP, and now the comment log. In code, views are
just the `page.tsx` files.

"Component" = a reusable fragment a view composes: `ArtworkImage`, `NavTree`, etc.

The relationship is exactly *handler → helper functions*. Views own route concerns
(params, 404s, metadata, auth); components own presentation and are route-agnostic.
That's why `CollectionCover` takes `collection` + `mediumSlug` as props instead of
reading the URL itself.

**Props** are function arguments flowing strictly downward. When two siblings need
the same state (the top bar button opens the drawer), the state lives in their
common parent — "lifting state up." When *many* distant components need the same
state, you reach for context instead (§5).

---

## 5. Server vs client components — and the pressure that shapes everything

Every component is one of two kinds:

- **Server components** (default): run only during build/regeneration or on the
  server per request. They may do I/O, they can hold secrets (the Cloudinary key
  never reaches a browser), and they ship **zero JavaScript** — output is pure HTML.
- **Client components** (`"use client"`): also server-rendered for first paint, but
  their JS additionally ships to the browser and "hydrates" so they can respond to
  events and hold state.

At Phase 0 there were exactly two client components. There are now nine — `AppShell`,
`NavTree`, `AdminProvider`, `ArtworkCaption`, `ReorderPanel`, `ReorderableArtworkList`,
`AdminBar`, `InquiryForm`, `DeleteInquiryButton` — and every one of them exists
because something needed to be interactive *without* making the page dynamic.

The boundary rule that shaped `lib/nav.ts`: **server → client data must cross as
serializable props** (it's marshalled into the page payload — think JSON over a
process boundary). The layout (server) fetches the catalog and passes a plain
`NavNode[]` into `AppShell` (client). `NavTree` can't call `getCatalog()` itself — it
runs in the browser, where there is no API secret and no server.

### The trick worth understanding: how the admin UI stays off the static pages

The admin needs to know "am I logged in?" to show the admin bar, the reorder panel,
the sidebar's admin entry, and to *hide* the inquiry form. The obvious move — read
the session in the root layout — would make **every page on the site dynamic**, and
the whole static architecture collapses.

Instead: the server renders the public page exactly as a visitor sees it, and the
client asks *afterward*. `AdminProvider` does one small `fetch("/api/admin/session")`
on mount (the cookie is HttpOnly, so JS can't read it directly), and admin UI appears
post-hydration. The static HTML is byte-identical for everyone; the admin layer is
painted on top in the browser.

`ReorderableArtworkList` is the sharpest example. It takes the *server-rendered*
artwork blocks as children and re-emits them in the admin's staged order. React
reconciles by key, so thumbnails slide without reloading — and for visitors it
returns the children untouched, so the SSG output is unchanged and there's zero
hydration mismatch.

### Why `AdminProvider` has four contexts

Context is React's dependency injection: a provider makes a value available to any
descendant without threading props through every level. The catch is that **every
consumer re-renders when the provider's value identity changes** — so a single
context holding all admin state would re-render every caption on every keystroke.

Hence four contexts split by *churn profile*:

| Context | Changes when | Consumers |
|---|---|---|
| `EditContext` | hydration + discard | every caption |
| `OrderContext` | every drop | reorder panel, artwork list |
| `BarContext` | every keystroke | the admin bar only |
| `AdminStatusContext` | login/logout only | nav splice, inquiry form |

The staged values themselves live in **refs**, not state — mutating a ref doesn't
re-render at all, so those counters are the only re-render triggers, deliberately
and narrowly. This is the front-end equivalent of picking your cache invalidation
granularity.

### Staging: an optimistic edit buffer in the browser

Admin edits don't hit Cloudinary as you type. They're staged in `localStorage`
(`sbh_admin_edits`, `sbh_admin_order`) and published in one bulk `Save all`. So
`localStorage` is doing the job a Redis scratch space might do in a backend design —
except it's per-browser and free. Edits survive refreshes and navigation; failures
stay staged so nothing is lost; reorders are idempotent, so retrying heals a partial
apply.

---

## 6. Routing & navigation (why the site feels like an SPA)

`<Link>` intercepts clicks and performs **client-side navigation**: instead of a
full page load, Next fetches the target page's payload and swaps only `<main>`'s
contents. The layout — sidebar included — never remounts. That's the "persistent
sidebar, only the main area changes" behavior from the original plan, and it's why
nav expansion state survives navigation for free.

Artwork links (`/photography/southwest#02-colorado-yxbd6m`) are plain **anchor
navigation**: the `#fragment` scrolls to the `ArtworkBlock` with the matching `id`.
`scroll-margin-top` in `globals.css` keeps targets off the container edge.

Layout mechanics: the shell is `body { h-screen; overflow-hidden }` with a flex row
inside — sidebar and `<main>` are each `overflow-y-auto`, i.e. two independent
scroll regions. Responsive switching is pure CSS: below the custom `desk:` breakpoint
(900px, defined in `globals.css`) the sidebar is `display:none` and the top bar +
drawer render instead. Nothing measures the window in JS.

---

## 7. The image pipeline

Two source types, one component (`ArtworkImage`):

1. **Local** (`/images/hero.jpg`): files in `public/` are served verbatim at the site
   root — `public/` is the static-assets mount. No transformation happens, so we
   pre-compressed them (4032px/3–4.6MB originals → 2000px/~0.5MB, EXIF orientation
   baked in).
2. **Cloudinary** (everything artwork): the URL *is* the transform API —
   `f_auto,q_auto,c_limit,w_2048` = "best format for this browser (AVIF/WebP), auto
   quality, cap long edge at 2048." The `srcset` lists 640/1024/1536/2048 variants;
   the browser requests the smallest that satisfies the layout — content negotiation
   for images. This is also the image-protection story: visitors can only obtain
   capped display copies; originals never leave Saad's drive.

`ArtworkImage` reserves the aspect ratio *before* load so the page doesn't reflow
(CLS prevention), and caps width so that the image's height stays around 66vh —
which is what keeps the caption on screen for tall portrait shots.

---

## 8. Cloudinary — what we learned the hard way

These cost real debugging time; recorded so they never do again.

1. **Product environments.** One Cloudinary *account* can hold several isolated
   *environments*, each with its own cloud name and API keys. Admin API calls are
   validated against the environment in the URL (`cloud_name mismatch` otherwise).
2. **API key roles.** A key without the right role **authenticates but returns empty
   payloads**: listings came back `{"resources": [], "total_count": 27}` — counts
   visible, data withheld — and only a direct asset GET surfaced the real error:
   `403 … missing permissions (actions=["read"])`. Fix: grant *Master Admin*. If
   listings return counts with empty arrays, suspect the key role first.
3. **Dynamic folders mode.** An asset's `public_id` is an opaque string
   (`01-muyThai_s2deee`) with **no folder path in it**. The folder lives in the
   `asset_folder` attribute, the human filename in `display_name`. Consequences:
   prefix-based queries return nothing; list folders via `GET /folders/<path>` and
   members via `GET /resources/by_asset_folder`. ("Home" in the Media Library UI is
   just the root — never part of any path.)
4. **Built-in metadata field names lie.** The field labeled **Title** is stored as
   context key **`caption`** (and Description as `alt`). Our lookup chain —
   `Title Name` → `caption` → `Title` → `title` — absorbs this.
5. **Context updates REPLACE, they don't merge.** Verified empirically: posting
   `context` wipes every key you didn't send. `updateArtworkContext` therefore reads
   the current context fresh, merges, and writes back — which is why an admin save
   doesn't destroy the `alt` field it never touched.
6. **`display_name` and `public_id` are independent** — and that's the load-bearing
   fact behind reordering. Renaming via the *Admin API update* endpoint changes the
   filename while leaving `public_id`, `asset_folder`, and context intact. (The
   Upload API's `rename` would change `public_id` and break every staged edit,
   delivery URL, and inquiry row pointing at it.) So "reorder" = renumber `NN-`
   filename prefixes, and the stable key survives.
7. **Secrets discipline.** Credentials live in `.env.local` (gitignored) and Vercel's
   environment settings — never in code, never in the committed example templates.
   (One near-miss: credentials pasted into the example file, caught before commit.)

---

## 9. The database — and what's different about it here

You know Postgres. What's worth flagging is what *serverless* changes.

- **The build must not need the database.** `lib/db.ts` connects lazily and the
  public pages never query, so `next build` succeeds with Postgres switched off
  entirely. This is verified, not assumed — it's why content redeploys can't be
  taken down by a database problem.
- **Migrations are manual** (`npx prisma migrate deploy`), deliberately *not* part
  of the Vercel build, for the same decoupling reason. The committed
  `prisma/migrations/` folder is the schema's audit trail.
- **Two connection strings, because they do different jobs.** `DATABASE_URL` points
  at Neon's PgBouncer pooler (many serverless instances, one connection cap);
  `DIRECT_URL` bypasses it for migrations, which need a real session for advisory
  locks and DDL. The pooled URL carries `pgbouncer=true` to disable prepared
  statements, which transaction pooling can't support — omit it and you get
  *intermittent* `prepared statement "s0" already exists` errors, which is the worst
  kind.
- **In-memory rate limiting is useless here.** Each serverless invocation may be a
  fresh instance, so a counter in a module-level variable protects nothing. The rate
  limit is therefore a DB query: count rows with this `ipHash` in the last 10
  minutes, reject at 5. The `@@index([ipHash, createdAt])` exists for exactly that
  query, and `@@index([createdAt desc])` for exactly the log's ordering.
- **Privacy by construction.** We never store a raw IP — only `sha256(ip + salt)`
  with a dedicated `IP_HASH_SALT`. It's enough to count submissions per sender and
  useless for anything else.
- **Snapshots over joins.** An inquiry stores `artworkPublicId` *and* a server-
  resolved `artworkTitle`. Cloudinary is a separate system with no referential
  integrity to lean on, so the snapshot is what lets the log stay readable after an
  artwork is renamed or deleted. The title is resolved server-side from the catalog
  and never taken from the client payload — a client-supplied title would be an
  injection vector into your own admin page.

---

## 10. Auth — two layers, one boundary

Single admin, no user table. The session **is** an encrypted HttpOnly cookie
(iron-session) carrying one flag, so there's no session store. Credentials are an
env-var username plus a bcrypt hash.

The part worth internalizing: **`proxy.ts` is not a security boundary.** It checks
only that a cookie is *present* — not that it's valid — because it runs on every
matched request and should stay cheap. The real check is `isAdmin()` in `lib/auth.ts`,
which unseals and verifies, and **every protected page and handler calls it itself**.
The proxy is a UX optimization that bounces logged-out users to the login page early;
if it were the only gate, a forged cookie name would walk straight through.

(`proxy.ts` is Next 16's rename of `middleware.ts`, and it duplicates the cookie name
as a literal rather than importing `lib/auth.ts` — importing it would drag bcryptjs
into the edge bundle.)

Two related habits in the code: Server Actions re-check `isAdmin()` even though the
page already did, and `/api/inquiries` deliberately sits *outside* the proxy's
matcher because it's public by design.

---

## 11. Deployment & operations

- **Pipeline:** push to `main` → Vercel builds (`next build`, which runs the
  Cloudinary ETL using the env vars) → atomic deploy to the CDN. A failed build never
  takes the site down; the previous deploy stays live.
- **Domain:** `saadbhatti.studio` (Porkbun DNS → Vercel); apex 308-redirects to `www`.
- **Content ops (the payoff):** upload to `photography/<Collection Name>/` in the
  Media Library, set Title + Film, prefix filenames `01-`, `02-`… for order. Folder
  name = collection title; rename the folder and the site follows. Live within the
  1-hour ISR window, or immediately via an admin save. Zero code, zero JSON, zero
  deploys for day-to-day content.
- **Database ops:** local Postgres is `docker compose up -d`; schema changes are
  `npx prisma migrate dev` locally and a manual `migrate deploy` against Neon. See
  [README.md](../README.md).
- **Env split:** DB URLs live in `.env` because the **Prisma CLI reads `.env` and
  never `.env.local`**; everything else lives in `.env.local`. A literal `$` in a
  local env value must be escaped `\$` — dotenv-expand runs in both Next and Prisma,
  and quoting does not protect you. Vercel takes raw values.
- **Analytics:** Vercel Analytics via one `<Analytics />` component in the layout.

---

## 12. Glossary (front-end term → nearest backend concept)

| Front-end term | Nearest backend concept |
|---|---|
| Component | Pure function returning markup; composable unit |
| Props | Function arguments / DTO passed downward |
| State (`useState`) | In-memory per-instance variable that triggers re-render on write |
| Ref (`useRef`) | Mutable field that does *not* trigger a re-render |
| Context | Dependency injection scoped to a subtree |
| `useEffect` | Post-render hook reacting to dependency changes |
| Server component | Code that runs on the server; can do I/O, keeps secrets |
| Client component (`"use client"`) | Code shipped to the browser; interactive |
| Hydration | Attaching live behavior to server-rendered HTML |
| SSG | Ahead-of-time compilation of routes to HTML |
| ISR / `revalidate` | Cache TTL + background refresh of compiled output |
| `revalidateTag` | Targeted cache invalidation by key |
| `generateStaticParams` | Enumerating path-parameter values to precompile |
| Route Handler (`route.ts`) | A controller method — plain HTTP endpoint |
| Server Action (`"use server"`) | An RPC endpoint the framework wires to a form |
| Proxy / middleware | Request filter running before the handler |
| Client-side navigation | Partial response swap instead of full page reload |
| Layout (App Router) | Base template persisting across routes |
| `public/` | Static file mount at the web root |
| `srcset` / `sizes` | Content negotiation for image resolution |
| Blur-up placeholder / CLS | Space reservation to avoid layout shift |
| Tailwind `@theme` tokens | Central constants file for the design system |
| `localStorage` | Per-browser key-value store (our staging buffer) |
| Honeypot | Bait field; filled ⇒ bot |

---

## 13. What got built, and where it plugs in next

The Phase 0 version of this doc ended with "where Phase 1 will plug in." It landed
roughly as predicted, so here's the actual history:

| Phase | What shipped |
|---|---|
| **0** | The site: views, nav tree, Cloudinary catalog, image pipeline, live on Vercel. |
| **0.5** | Visual polish: pixel display font, carpet border frame, fit-to-screen images, fluid motion. Plus the genericity refactor — mediums derived from Cloudinary, `content.json` reduced to site text. |
| **1a** | Admin auth + **inline** metadata editing on CollectionView (not a separate dashboard), staged in `localStorage`, bulk-saved to Cloudinary. |
| **1b** | Drag-to-reorder via dnd-kit, with live sliding preview; reorder = renumbering filename prefixes. |
| **D** | Private inquiries: the first database, the first public write endpoint, the admin comment log. |

The seams that are already cut for what's next:

- **An order log** reuses Phase D wholesale: same model shape (`artworkPublicId` +
  snapshots + status enum) via one migration, an "order log" sibling under the admin
  nav node with zero `NavTree` changes, and the same honeypot → validate →
  catalog-check → rate-limit → insert pipeline that checkout-intent needs.
- **An ArtWorkView** (per-artwork page) would be a detail route reading the same
  catalog; `availability`/`price` would come from Cloudinary context keys exactly
  like `Film` does today.
- **Email on new inquiry** is the one obvious gap — the comment log is pull-only.
  A fire-and-forget send after insert is the natural place.
