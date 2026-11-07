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
