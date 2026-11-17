import { createHash } from "node:crypto";
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
 *   folder          — uploads land in `blog/`, never in the catalog's `art/`
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

/** Where blog uploads land. A sibling of the catalog root, never inside it. */
export const BLOG_UPLOAD_FOLDER = "blog";

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
 * Mint one upload ticket.
 *
 * `api_key` is an identifier rather than a secret — it travels in the upload
 * request itself, so the browser has to have it — but it is handed out here
 * instead of inlined into the client bundle, so `CLOUDINARY_API_KEY` stays a
 * server-side env var with one reader.
 *
 * Throws, with the same wording as `authHeader()` in lib/cloudinaryAdmin.ts,
 * if the credentials are absent. instrumentation.ts asserts both at boot
 * (lib/env.ts), so in practice this is unreachable.
 */
export function mintBlogUploadTicket(
  now: number = Date.now()
): BlogUploadTicket {
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      "Missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET. Locally: put them in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }

  const timestamp = Math.floor(now / 1000);
  const signed = {
    allowed_formats: BLOG_UPLOAD_FORMATS,
    folder: BLOG_UPLOAD_FOLDER,
    timestamp,
  };

  return {
    uploadUrl: CLOUDINARY_UPLOAD_URL,
    apiKey,
    timestamp,
    folder: BLOG_UPLOAD_FOLDER,
    allowedFormats: BLOG_UPLOAD_FORMATS,
    signature: signUploadParams(signed, apiSecret),
    maxBytes: BLOG_UPLOAD_MAX_BYTES,
  };
}
