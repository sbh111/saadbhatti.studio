/**
 * The single source of truth for every artwork metadata field — the title
 * plus the generic fields (Film, Medium, Dimensions, Year) rendered under it.
 * Client-safe: no server/Cloudinary/Prisma import, so both server code
 * (lib/catalog.ts, the admin artworks route) and client components
 * (AdminProvider, ArtworkCaption) can import it directly. lib/catalog.ts
 * itself is NOT safe for client code — it imports the Cloudinary admin
 * client — which is exactly why this had to be its own module.
 *
 * TO ADD A FIELD: append one entry to METADATA_FIELDS below. Everything else
 * — the catalog's read side, the admin form's inputs, the save payload, and
 * the clear-vs-set write logic — derives from it. Before this module the
 * field list existed three times (lib/catalog.ts's META_KEYS,
 * AdminProvider.tsx's FIELD_KEYS, and hardcoded again in
 * ArtworkCaption.tsx's `original` object and inputs); adding a field to only
 * one of them meant the admin form silently submitted `""` for the new
 * field on every save, which the write path (lib/cloudinaryAdmin.ts) treats
 * as "clear this key" — wiping the field on the very next bulk save (tech
 * debt 3.1).
 */

/** One metadata field: its admin-form label and its full context read chain. */
export interface MetadataField {
  /** The admin form's input label AND the canonical (write) key. */
  label: string;
  /**
   * Every context key this field is read from, in read-priority order — the
   * canonical key first, then any historical aliases (e.g. a lowercase
   * `film`). Clearing the field deletes every key here; setting it writes
   * only the first (tech debt 3.2 — see lib/cloudinaryAdmin.ts's mergeContext).
   */
  keys: readonly string[];
}

/** Metadata fields rendered under the title, in this order, blanks skipped. */
export const METADATA_FIELDS: readonly MetadataField[] = [
  { label: "Film", keys: ["Film", "film"] },
  { label: "Medium", keys: ["Medium", "medium"] },
  { label: "Dimensions", keys: ["Dimensions", "dimensions"] },
  { label: "Year", keys: ["Year", "year"] },
];

/**
 * The title's read chain, kept separate from METADATA_FIELDS because the
 * title has no admin-form label of its own (the fixed key "title" is used
 * instead — see FIELD_KEYS) and renders above the metadata grid, not in it.
 */
export const TITLE_KEYS: readonly string[] = ["Title Name", "caption", "Title", "title"];

/** Every field key the admin form/save-payload carries, title first. */
export const FIELD_KEYS = [
  "title",
  ...METADATA_FIELDS.map((f) => f.label),
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type Fields = Record<FieldKey, string>;

/**
 * Build a form's starting values from what the catalog resolved: the
 * (already-fallback-resolved) title plus whichever metadata labels are
 * present. Shared by ArtworkCaption so its `original` object can't drift
 * from FIELD_KEYS the way the old hardcoded literal did.
 */
export function fieldsFromContext(
  contextTitle: string,
  metaFields: Record<string, string>
): Fields {
  const fields = { title: contextTitle } as Fields;
  for (const { label } of METADATA_FIELDS) {
    fields[label as FieldKey] = metaFields[label] ?? "";
  }
  return fields;
}
