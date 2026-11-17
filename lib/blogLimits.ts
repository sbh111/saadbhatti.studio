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
 * The shape of a post's primary key, as a regex fragment.
 *
 * Prisma generates these with `cuid()` — 25 lowercase alphanumerics starting
 * with `c` — but the bound is deliberately looser than that so switching to
 * cuid2 or a uuid later is not a migration of this file. What it is strict
 * about is the alphabet: lowercase alphanumerics and dashes only.
 *
 * That strictness is the security property, not a tidiness one. A post id is
 * interpolated into a Cloudinary folder path (`blog/<id>`) which is then
 * SIGNED, so an id containing `/` or `.` could sign an upload into a folder
 * of the caller's choosing — `blog/../art/photography`, say. No dot is
 * accepted at all, so `..` is not expressible.
 */
const POST_ID_PATTERN = "[a-z0-9][a-z0-9-]{7,63}";

export const POST_ID_RE = new RegExp(`^${POST_ID_PATTERN}$`);

/** A plausible post id — see POST_ID_PATTERN for why the alphabet matters. */
export function isValidPostId(value: string): boolean {
  return POST_ID_RE.test(value);
}

/**
 * A cover image's public_id must name an asset inside a post folder
 * (`blog/<slug>-<postId>/<asset>`) and contain nothing that could change the
 * meaning of a URL.
 *
 * This is validated rather than trusted because the value is interpolated
 * straight into a Cloudinary delivery URL by `imageUrl()` (lib/cloudinary.ts).
 * Only the owner can submit one today, so the realistic risk is a typo rather
 * than an attack — but the check costs a regex and removes the question.
 *
 * Alphanumerics, underscore and dash only, in both segments:
 *   - no `.`, so `..` can never appear and no traversal is expressible
 *   - no extra `/`, so neither the `blog/` root nor the post's own folder can
 *     be escaped
 *   - no `,` or `:`, which are Cloudinary's own transformation separators —
 *     a public_id containing them could otherwise inject transformations
 *
 * **What this deliberately does NOT check** is that the folder ends with a
 * real post id. The folder is `<label>-<id>` where the label comes from a
 * slug, and both halves draw on the same `[a-z0-9-]` alphabet, so there is no
 * unambiguous boundary for a regex to find — a uuid contains dashes too. The
 * tie to a post is enforced where the folder is BUILT
 * (`blogUploadFolder()`, from an already-validated id), not here. This regex
 * is the URL-safety boundary, and that is the job it can actually do.
 *
 * Cloudinary auto-generates the asset segment (the upload is signed WITHOUT
 * `use_filename`, so an original filename never becomes the id), and the
 * extension is not part of a public_id at all.
 */
export const COVER_PUBLIC_ID_RE =
  /^blog\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_-]*$/;

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
