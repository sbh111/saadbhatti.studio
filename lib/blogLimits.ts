/**
 * Shared blog field bounds — deliberately free of any Prisma or server import
 * so the admin editor can pull in the same numbers the server validates
 * against (`maxLength` attributes, character counters) without dragging the DB
 * layer into the browser bundle. The same split as lib/inquiryLimits.ts, and
 * for the same reason.
 *
 * Keep in sync with prisma/schema.prisma: every one of these has a matching
 * `@db.VarChar(n)`, so the database is a second line of defence rather than
 * the only one.
 */

export const TITLE_MAX = 160;
export const SLUG_MAX = 160;
export const EXCERPT_MAX = 300;
export const BODY_MAX = 60_000;

/**
 * The shape `slugify()` (lib/slug.ts) produces: lowercase alphanumerics in
 * dash-separated runs, no leading or trailing dash. Used to reject a garbage
 * `/blog/<junk>` path *before* it costs a database round trip or mints an
 * `unstable_cache` key — see app/blog/[slug]/page.tsx.
 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A post slug is a permanent public URL, so it is validated on both shape
 *  and length before it ever reaches a query. */
export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= SLUG_MAX && SLUG_RE.test(value);
}
