/**
 * Small values shared across otherwise-unrelated files, kept here so they
 * can't drift out of sync with each other. Each export says where its other
 * copies (if any — some genuinely can't import this, see below) live.
 */

/**
 * The canonical site origin. Non-redirecting: the bare apex
 * (`https://saadbhatti.studio`) 308-redirects to this www host, and a
 * redirect across origins drops the `Authorization` header — see the
 * `CATALOG_INDEX_URL` comment in docker-compose.yml, which independently
 * needs the same fact and can't import this file.
 */
export const SITE_ORIGIN = "https://www.saadbhatti.studio";

/**
 * Desktop sidebar width (components/AppShell.tsx's `w-[var(--sidebar-width)]`).
 * Mirrored as the CSS custom property `--sidebar-width` in app/globals.css for
 * Tailwind/CSS consumers; kept here too because ArtworkImage's `sizes` string
 * needs the raw number and the `sizes` attribute can't resolve a CSS var.
 * Change both together — a mismatch makes the browser pick the wrong srcset
 * candidate.
 */
export const SIDEBAR_WIDTH_PX = 236;

/** Cache tag for the Cloudinary-backed catalog read, invalidated together
 *  with a bulk admin save (see app/api/admin/artworks/route.ts). */
export const CATALOG_CACHE_TAG = "catalog";

/**
 * How long the cached catalog read (lib/cloudinaryAdmin.ts's `apiGet`) is
 * allowed to go stale, in seconds.
 *
 * app/layout.tsx's `export const revalidate = 3600` MUST stay a static
 * literal — Next.js reads route segment config statically at build time and
 * can't resolve an imported constant there — so that copy has to be kept in
 * sync with this one by hand instead.
 */
export const CATALOG_REVALIDATE_SECONDS = 3600;

/**
 * The Cloudinary folder whose SUBFOLDERS are the site's mediums — the catalog
 * root (lib/catalog.ts's `getCatalog`). Everything artwork-related lives under
 * it, so sibling root folders (e.g. "blog assets") are invisible to the
 * catalog by construction rather than by a filter that has to be maintained.
 *
 * Deliberately NOT the same constant as `ART_BASE_PATH` in lib/urls.ts, which
 * is the public URL prefix: renaming this folder in Cloudinary must not
 * silently rewrite every public URL on the site.
 */
export const CATALOG_ROOT_FOLDER = "art";

/**
 * Cache tag for every blog read (lib/posts.ts) — the catalog's
 * CATALOG_CACHE_TAG twin. Invalidated by the admin post lifecycle actions, so
 * publishing a post is cache invalidation rather than a deploy.
 */
export const BLOG_CACHE_TAG = "blog";

/**
 * Per-post tag, so editing one post does not restage every other post's
 * cached HTML.
 */
export function blogPostTag(slug: string): string {
  return `blog:post:${slug}`;
}

/**
 * How long a cached blog read may go stale, in seconds.
 *
 * Unlike CATALOG_REVALIDATE_SECONDS this one can actually be IMPORTED where
 * it is used, because it is passed as an `unstable_cache` option (an ordinary
 * runtime argument) rather than declared as a route segment `export const
 * revalidate` — Next reads segment config statically at build time and cannot
 * resolve an imported constant there, which is why the layout's copy has to be
 * a hand-synced literal.
 *
 * It matches the catalog's hour deliberately: Next reduces a route's ISR
 * window to the MINIMUM revalidate of everything the render touched, so a
 * shorter value here would silently drag /blog and /blog/[slug] down with it
 * and put a database read on every window. Owner edits propagate immediately
 * via updateTag regardless, so a long window costs nothing.
 */
export const BLOG_REVALIDATE_SECONDS = 3600;
