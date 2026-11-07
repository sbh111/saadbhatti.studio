/**
 * Artwork slug derivation, shared by lib/catalog.ts (read side) and
 * lib/cloudinaryAdmin.ts (the reorder writer) so the two can never diverge.
 *
 * Reordering a collection renumbers each asset's `NN-` filename prefix (see
 * `reorderCollection` in lib/cloudinaryAdmin.ts) — that prefix exists purely
 * to control `localeCompare(display_name)` order and is NOT part of an
 * artwork's identity. The slug — the `#anchor` on `/[medium]/[collection]`,
 * used in inquiry-notification emails, the admin comment log, search
 * results, and like-event snapshots — must not change when an artwork is
 * merely renumbered, or every previously shared link breaks (tech debt 1.8).
 * So the slug is derived from the filename with that SAME prefix stripped
 * first, using the one regex both sides share below.
 */

/** Matches a reorder prefix like "03-", "12_", "7 " at the start of a filename. */
export const REORDER_PREFIX_RE = /^\d+[-_ ]*/;

/** Strip the reorder prefix, if any. Used identically by the catalog read
 *  side (slug + display-name prettification) and by reorderCollection when
 *  it rebuilds the prefix around whatever suffix survives. */
export function stripReorderPrefix(name: string): string {
  return name.replace(REORDER_PREFIX_RE, "");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * One artwork's slug candidate before collision disambiguation: strip the
 * reorder prefix, then slugify. If nothing survives (a display_name that is
 * only digits/separators, e.g. "03-" or "12"), fall back to a slug of the
 * public_id — reorder never touches public_id, so this fallback is stable
 * too, just uglier.
 */
export function baseArtworkSlug(filename: string, publicId: string): string {
  const stripped = slugify(stripReorderPrefix(filename));
  return stripped || slugify(publicId);
}

/**
 * Deterministically resolve slug collisions within one collection, WITHOUT
 * depending on display order (reordering must never reshuffle which artwork
 * gets the bare slug and which gets "-2", "-3", …). Artworks sharing a base
 * slug are ranked by `public_id` — reorder never changes public_id — and the
 * lowest sorts as the bare slug; the rest get `-2`, `-3`, … in that order.
 */
export function disambiguateSlugs(
  items: readonly { publicId: string; baseSlug: string }[]
): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const { publicId, baseSlug } of items) {
    const group = groups.get(baseSlug);
    if (group) group.push(publicId);
    else groups.set(baseSlug, [publicId]);
  }
  const slugByPublicId = new Map<string, string>();
  for (const [baseSlug, publicIds] of groups) {
    const ranked = [...publicIds].sort();
    ranked.forEach((publicId, i) => {
      slugByPublicId.set(publicId, i === 0 ? baseSlug : `${baseSlug}-${i + 1}`);
    });
  }
  return slugByPublicId;
}

/**
 * Resolve a possibly-legacy `location.hash` against the artwork ids actually
 * on the page. Before this fix, the slug baked the reorder prefix in, so a
 * link sent before a collection was ever reordered (an inquiry-notification
 * email, a row in the admin comment log, a bookmarked search result) can
 * carry an old hash like "#03-desert-sunset" for an artwork whose current,
 * reorder-stable slug is just "desert-sunset".
 *
 * `hasElement` is injected (rather than reading `document` here) so this
 * stays a pure, unit-testable function — see components/LegacyHashResolver.tsx
 * for the effect that calls it.
 *
 * Returns the canonical id to adopt (scroll to + replaceState), or null if
 * the hash already resolves as-is (nothing to do) or resolves nowhere even
 * after stripping (a genuinely missing anchor).
 */
export function resolveLegacyHash(
  hash: string,
  hasElement: (id: string) => boolean
): string | null {
  const id = hash.replace(/^#/, "");
  if (!id || hasElement(id)) return null;
  // The slugified form of a reorder prefix is always "digits-", regardless of
  // whether the original separator was "-", "_", or " " (slugify collapses
  // any run of non-alphanumerics to a single dash).
  const stripped = id.replace(/^\d+-/, "");
  return stripped !== id && hasElement(stripped) ? stripped : null;
}
