import { createHash } from "node:crypto";
import { isValidPostId } from "./blogLimits";
import { CLOUD_NAME } from "./cloudinary";

/**
 * Signed, browser-direct Cloudinary uploads for blog images.
 *
 * ── Why the browser uploads, not the server ───────────────────────────────
 * The alternative is to POST the file to a route handler and have it forward
 * the bytes to Cloudinary. That puts every image through a Vercel serverless
 * function: a 4.5 MB request-body limit, the function's whole duration spent
 * relaying bytes it does not need to see, and a second full transfer of the
 * file. Signing instead means the server sends ~200 bytes of signature and the
 * file goes straight from the browser to Cloudinary. No new dependency — this
 * is a SHA-1 over sorted params, which node's `crypto` already does.
 *
 * ── What a signature permits ──────────────────────────────────────────────
 * A signature is a capability, so it is scoped as tightly as Cloudinary allows
 * and every scoping parameter is itself signed (an unsigned parameter is one
 * the client can change freely):
 *
 *   folder          — uploads land in `blog/<slug>-<postId>/`, never in the
 *                     catalog's `art/`, and never in another post's folder
 *   allowed_formats — image formats only, so a leaked signature cannot be
 *                     used to park arbitrary files on the account. This one
 *                     matters more than it looks: `resource_type` lives in the
 *                     upload URL's PATH and is excluded from the signature, so
 *                     without it the same signature would work against
 *                     /raw/upload.
 *   timestamp       — Cloudinary rejects a signature whose timestamp is more
 *                     than an hour old, which bounds the replay window.
 *
 * The signature endpoint (app/api/admin/blog/upload-signature/route.ts) is
 * admin-only, so minting one already requires the owner's session.
 *
 * ── Why `blog/` is safe to write into ─────────────────────────────────────
 * `getCatalog()` reads only subfolders of CATALOG_ROOT_FOLDER ("art"), so a
 * sibling `blog/` folder is invisible to the catalog by construction rather
 * than by a filter — lib/constants.ts names "blog assets" as exactly this
 * case. And per docs/architecture.md, nothing in this app ever DELETES a
 * Cloudinary asset; that holds here too, so a replaced cover image leaves its
 * predecessor in place to be cleaned up by hand.
 */

/** The blog's asset root. A sibling of the catalog root, never inside it. */
export const BLOG_UPLOAD_ROOT = "blog";

/**
 * How much of the slug goes into a folder name. Long enough to recognise a
 * post at a glance, short enough that `blog/<label>-<id>/<asset>` stays well
 * inside the 255-character `coverPublicId` column even with a 160-character
 * slug and a 64-character id.
 */
export const FOLDER_LABEL_MAX = 60;

/**
 * The human-readable half of a folder name, derived from a post's slug.
 *
 * Defensive about its input even though a stored slug has already passed
 * `isValidSlug`: this string ends up in a SIGNED path, and the cost of being
 * wrong is a signature for a folder nobody chose. Anything outside
 * `[a-z0-9-]` is dropped rather than escaped, and a trailing dash left by
 * truncation is trimmed so folder names never end in `-`.
 */
export function folderLabelFromSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .slice(0, FOLDER_LABEL_MAX)
    .replace(/^-+|-+$/g, "");
}

/**
 * Where one post's images land: `blog/<slug>-<postId>/`, e.g.
 * `blog/on-shooting-portra-clq2x8k9p0000abcd1234efgh/`.
 *
 * Per-post rather than a flat `blog/` because one folder accumulating every
 * image from every post is unnavigable within a few posts, and — since
 * nothing in this app ever deletes a Cloudinary asset — it only ever grows.
 * Grouping by post makes an abandoned post's images identifiable as a unit
 * when clearing them out by hand, which is the only way they are ever cleared.
 *
 * **Both halves earn their place.** The slug is what makes the folder
 * recognisable in the Cloudinary console, where a bare cuid tells you nothing.
 * The id is what makes it unique and unambiguous: two posts can hold the same
 * title at different times, and a slug is editable while a post is a draft
 * (invariant 12), so the slug alone is not a stable key.
 *
 * **The consequence of recomputing this per upload:** renaming a draft after
 * uploading an image leaves the earlier images in the old folder, so one post
 * can span two. That is cosmetic rather than lossy — both folders carry the
 * same id suffix, so they are still identifiable as one post's — and it is the
 * price of the folder name always matching the post's current slug. Freezing
 * the name at first upload instead would need a column to remember it, and
 * would trade this for stale folder names after a retitle.
 *
 * The caller MUST have validated `postId` with `isValidPostId` first — this
 * string is signed, so an id containing `/` or `.` would sign an upload into
 * a folder of the caller's choosing.
 */
export function blogUploadFolder(postId: string, slug = ""): string {
  const label = folderLabelFromSlug(slug);
  return label
    ? `${BLOG_UPLOAD_ROOT}/${label}-${postId}`
    : // A slug that reduces to nothing is not a reason to fail an upload;
      // `uniqueSlugFor` already falls back to "post", so this is unreachable
      // in practice and exists so the folder is always well-formed.
      `${BLOG_UPLOAD_ROOT}/${postId}`;
}

/**
 * Formats a signed upload may produce. Signed, so the client cannot widen it.
 * Deliberately no SVG: an SVG is a script-bearing document, and serving one
 * from a domain is equivalent to hosting HTML there.
 */
export const BLOG_UPLOAD_FORMATS = "jpg,jpeg,png,webp,avif,gif";

/** The endpoint the browser POSTs the file to. */
export const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

/**
 * Client-side size guard, in bytes. Not a security boundary — Cloudinary's own
 * plan limit is the real one — but it turns "upload silently fails after 40
 * seconds on a phone" into an immediate, explainable refusal.
 */
export const BLOG_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The exact string Cloudinary expects to be hashed: the parameters being
 * signed, sorted by key, joined as `k=v` with `&`. No URL encoding, and no
 * trailing separator before the secret.
 *
 * `file`, `cloud_name`, `resource_type` and `api_key` are excluded from
 * signing by Cloudinary's own spec — pass only the parameters being
 * constrained.
 *
 * Split out from the hashing below because this is the half that can be
 * subtly wrong (ordering, separators, encoding) while still producing a
 * plausible-looking hex digest. Pinned by a fixture taken from Cloudinary
 * ITSELF: a rejected upload echoes the string it expected, and
 * test/lib/cloudinaryUpload.test.ts asserts against that echo.
 */
export function uploadStringToSign(
  params: Record<string, string | number>
): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

/**
 * Cloudinary's upload signature: SHA-1 of `uploadStringToSign(params)` with
 * the API secret appended directly (no separator).
 *
 * Pure — no network, no `process.env` — so it is unit-testable with a dummy
 * secret.
 */
export function signUploadParams(
  params: Record<string, string | number>,
  apiSecret: string
): string {
  return createHash("sha1")
    .update(`${uploadStringToSign(params)}${apiSecret}`)
    .digest("hex");
}

/** Exactly what the browser needs to POST a file to Cloudinary. */
export interface BlogUploadTicket {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
  maxBytes: number;
}

/**
 * Mint one upload ticket, scoped to a single post's folder.
 *
 * `api_key` is an identifier rather than a secret — it travels in the upload
 * request itself, so the browser has to have it — but it is handed out here
 * instead of inlined into the client bundle, so `CLOUDINARY_API_KEY` stays a
 * server-side env var with one reader.
 *
 * Throws on an invalid `postId` rather than sanitising it. A ticket is a
 * signed capability: quietly rewriting a bad id would mint a valid signature
 * for a folder nobody asked for, and the caller cannot tell that happened.
 * Refusing is the only safe failure.
 *
 * Also throws, with the same wording as `authHeader()` in
 * lib/cloudinaryAdmin.ts, if the credentials are absent. instrumentation.ts
 * asserts both at boot (lib/env.ts), so that branch is unreachable in practice.
 */
export function mintBlogUploadTicket(
  postId: string,
  slug = "",
  now: number = Date.now()
): BlogUploadTicket {
  if (!isValidPostId(postId)) {
    throw new Error(`Refusing to sign an upload for an invalid post id.`);
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      "Missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET. Locally: put them in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }

  const folder = blogUploadFolder(postId, slug);
  const timestamp = Math.floor(now / 1000);
  const signed = {
    allowed_formats: BLOG_UPLOAD_FORMATS,
    folder,
    timestamp,
  };

  return {
    uploadUrl: CLOUDINARY_UPLOAD_URL,
    apiKey,
    timestamp,
    folder,
    allowedFormats: BLOG_UPLOAD_FORMATS,
    signature: signUploadParams(signed, apiSecret),
    maxBytes: BLOG_UPLOAD_MAX_BYTES,
  };
}
