export const CLOUD_NAME = "sbh111";
const BASE = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload`;

/** Display cap: long edge 2048px (originals stay off-site) */
const MAX_WIDTH = 2048;
const SRCSET_WIDTHS = [640, 1024, 1536, 2048];

/** Capped, auto-format/quality delivery URL for a Cloudinary public id */
export function imageUrl(publicId: string, width: number = MAX_WIDTH): string {
  return `${BASE}/f_auto,q_auto,c_limit,w_${width}/${publicId}`;
}

export function imageSrcSet(publicId: string): string {
  return SRCSET_WIDTHS.map((w) => `${imageUrl(publicId, w)} ${w}w`).join(", ");
}

/** Tiny blurred stand-in loaded eagerly behind the real image */
export function blurUrl(publicId: string): string {
  return `${BASE}/f_auto,q_auto,w_16,e_blur:200/${publicId}`;
}

/**
 * Delivery URL for an image embedded in a Markdown post body.
 *
 * Markdown has no notion of "a Cloudinary asset", so a body has to hold
 * something a browser can fetch directly — which means the transformation is
 * baked into the text of the post rather than applied at render time. The
 * consequence is that body images get no `srcset`; the 1600px cap is what
 * stops a phone downloading a 4000px original. Cover images go through
 * ArtworkImage and DO get a full srcset.
 *
 * Lives here rather than in lib/markdown.ts because the admin editor (a client
 * component) inserts these URLs, and lib/markdown.ts imports `marked` — one
 * import away from shipping a Markdown parser to the browser to build a
 * string.
 */
export function bodyImageUrl(publicId: string): string {
  return `${BASE}/f_auto,q_auto,c_limit,w_1600/${publicId}`;
}
