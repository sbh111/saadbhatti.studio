const CLOUD_NAME = "sbh111";
const BASE = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload`;

/** Display cap: long edge 2048px (originals stay off-site) */
export const MAX_WIDTH = 2048;
export const SRCSET_WIDTHS = [640, 1024, 1536, 2048];

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
