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

/** Cloudinary public_id of a cover image, e.g. "blog/kq3n8xj2". */
export const COVER_PUBLIC_ID_MAX = 255;

/** Alt text for a cover image. Short on purpose — it is read aloud. */
export const COVER_ALT_MAX = 200;

/**
 * A cover image's public_id must name an asset inside the `blog/` folder and
 * contain nothing that could change the meaning of a URL.
 *
 * This is validated rather than trusted because the value is interpolated
 * straight into a Cloudinary delivery URL by `imageUrl()` (lib/cloudinary.ts).
 * Only the owner can submit one today, so the realistic risk is a typo rather
 * than an attack — but the check costs a regex and removes the question.
 *
 * Alphanumerics, underscore and dash only, after the required `blog/` prefix:
 *   - no `.`, so `..` can never appear and no traversal is expressible
 *   - no `/` beyond the prefix, so the folder cannot be escaped
 *   - no `,` or `:`, which are Cloudinary's own transformation separators —
 *     a public_id containing them could otherwise inject transformations
 *
 * Cloudinary auto-generates ids from this alphabet (the upload is signed
 * WITHOUT `use_filename`, so an original filename never becomes the id), and
 * the extension is not part of a public_id at all.
 */
export const COVER_PUBLIC_ID_RE = /^blog\/[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isValidCoverPublicId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= COVER_PUBLIC_ID_MAX &&
    COVER_PUBLIC_ID_RE.test(value)
  );
}

/**
 * Cover dimensions are reported by Cloudinary, not typed by a human, so the
 * bound here is a sanity check on a number that arrives over the wire rather
 * than a UI limit. 20000 is comfortably past any real photograph and well
 * inside Postgres `INTEGER`.
 */
export const COVER_DIMENSION_MAX = 20_000;

/** A positive, integral pixel dimension within bounds, or undefined. */
export function parseCoverDimension(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return undefined;
  if (n < 1 || n > COVER_DIMENSION_MAX) return undefined;
  return n;
}
