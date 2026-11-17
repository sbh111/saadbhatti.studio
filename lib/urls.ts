import { SITE_ORIGIN } from "./constants";

/**
 * Every public URL that points into the artwork catalog is built here, and
 * nowhere else.
 *
 * Six files used to assemble `/${mediumSlug}/${collectionSlug}#${artworkSlug}`
 * by hand — two admin pages, the likes event, the search response, the
 * inquiry-notification email and the collection cover — which meant moving the
 * catalog under `/art` was six separate chances to miss one, with the misses
 * showing up as 404s in already-sent emails rather than as a failing build.
 * Routing them through these helpers makes the prefix a one-line change and
 * gives it a test (test/lib/urls.test.ts).
 *
 * Slugs come from `lib/catalog.ts` (`slugify`'d folder names and
 * reorder-stable artwork slugs — see lib/slug.ts), so they are already
 * URL-safe: no encoding happens here, deliberately, or the `#` in an artwork
 * href would be escaped away.
 */

/**
 * URL prefix for the whole catalog. It mirrors Cloudinary's
 * `CATALOG_ROOT_FOLDER`, but is a SEPARATE constant on purpose — renaming the
 * Cloudinary folder is a content operation and must not silently rewrite every
 * public URL on the site (and vice versa: these paths are in sent emails).
 */
export const ART_BASE_PATH = "/art";

/** The catalog landing page, listing every medium (app/art/page.tsx). */
export function artHref(): string {
  return ART_BASE_PATH;
}

/** One medium's CollectionsView, e.g. "/art/photography". */
export function mediumHref(mediumSlug: string): string {
  return `${ART_BASE_PATH}/${mediumSlug}`;
}

/** One collection's CollectionView, e.g. "/art/photography/southwest". */
export function collectionHref(
  mediumSlug: string,
  collectionSlug: string
): string {
  return `${mediumHref(mediumSlug)}/${collectionSlug}`;
}

/** An artwork's on-page anchor, e.g. "/art/photography/southwest#colorado-iejdgb". */
export function artworkHref(
  mediumSlug: string,
  collectionSlug: string,
  artworkSlug: string
): string {
  return `${collectionHref(mediumSlug, collectionSlug)}#${artworkSlug}`;
}

/**
 * URL prefix for the blog. A sibling of ART_BASE_PATH, and routed through
 * helpers for the same reason: the prefix is typed once here rather than
 * reassembled at every call site.
 */
export const BLOG_BASE_PATH = "/blog";

/** The blog index, listing every published post (app/blog/page.tsx). */
export function blogHref(): string {
  return BLOG_BASE_PATH;
}

/**
 * One post, e.g. "/blog/on-shooting-portra". The slug is a permanent public
 * contract (see the `slug` field in prisma/schema.prisma), so this path is
 * safe to put in anything durable. Slugs come from `slugify()` and are
 * already URL-safe, so nothing is encoded here — matching the catalog
 * helpers above.
 */
export function postHref(slug: string): string {
  return `${BLOG_BASE_PATH}/${slug}`;
}

/**
 * `postHref` against the canonical origin — for share links and, in Phase 5,
 * Open Graph tags. Uses SITE_ORIGIN, the same non-redirecting www host as
 * `artworkUrl` below.
 */
export function postUrl(slug: string): string {
  return `${SITE_ORIGIN}${postHref(slug)}`;
}

/**
 * `artworkHref` against the canonical origin — for anywhere a relative path is
 * useless, i.e. the inquiry-notification email body (lib/mail.ts). Uses
 * SITE_ORIGIN, the same non-redirecting www host the rest of the app uses, so
 * the link never takes the apex 308 that would drop an Authorization header.
 */
export function artworkUrl(
  mediumSlug: string,
  collectionSlug: string,
  artworkSlug: string
): string {
  return `${SITE_ORIGIN}${artworkHref(mediumSlug, collectionSlug, artworkSlug)}`;
}
