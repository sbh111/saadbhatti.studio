import { cache } from "react";
import { METADATA_FIELDS, TITLE_KEYS } from "./artworkFields";
import { apiGet, fetchAllPages } from "./cloudinaryAdmin";

/**
 * Cloudinary is the source of truth for ALL artwork structure (Pattern A).
 * The environment uses DYNAMIC FOLDERS: an asset's folder is the
 * `asset_folder` attribute and its filename is the `display_name` —
 * public ids are opaque strings.
 *
 * - mediums:     the ROOT folders (folder name = medium label in the sidebar)
 * - collections: the subfolders of each medium (folder name = collection title)
 * - membership:  assets whose asset_folder is `<medium>/<collection>`
 * - order:       alphabetical by display_name — prefix files 01-, 02-, …
 * - name:        contextual metadata "Title Name" (falls back to the built-in
 *                Title/caption, then to a prettified display_name)
 * - metadata:    whichever of lib/artworkFields.ts's METADATA_FIELDS are
 *                present render, in that order — the field list (and each
 *                field's alias chain) is defined there ONCE and shared with
 *                the admin form and the admin write path (tech debt 3.1).
 *
 * A medium with no artworks renders the WIP view. Nothing here is
 * medium-specific: add any new root folder in Cloudinary and it appears.
 */

export interface CatalogArtwork {
  slug: string;
  name: string;
  /** Cloudinary public id */
  image: string;
  /** width / height from Cloudinary — reserves layout space */
  aspect: number;
  /** Pre-rendered metadata line, e.g. "Film: Portra 400"; empty if none */
  metaLine: string;
  /** Raw context title ("Title Name"/caption), if set — empty when the name is filename-derived */
  contextTitle: string;
  /** Raw per-label metadata values (Film/Medium/Dimensions/Year), blanks omitted — admin form prefill */
  metaFields: Record<string, string>;
}

export interface CatalogCollection {
  slug: string;
  name: string;
  /** Cloudinary folder path (e.g. "photography/SouthWest") — the reorder key */
  path: string;
  cover: string | null;
  coverAspect: number;
  artworks: CatalogArtwork[];
}

export interface CatalogMedium {
  slug: string;
  /** The root folder name, displayed verbatim in the sidebar */
  displayName: string;
  collections: CatalogCollection[];
}

interface CloudinaryResource {
  public_id: string;
  display_name?: string;
  asset_folder?: string;
  width: number;
  height: number;
  context?: { custom?: Record<string, string> } & Record<string, unknown>;
}

interface CloudinaryFolder {
  name: string;
  path: string;
}

function contextValue(
  resource: CloudinaryResource,
  ...keys: string[]
): string | undefined {
  const custom = resource.context?.custom ?? resource.context ?? {};
  for (const key of keys) {
    const value = (custom as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prettifyFilename(basename: string): string {
  return (
    basename.replace(/^\d+[-_ ]*/, "").replace(/[-_]+/g, " ").trim() || basename
  );
}

function metaFieldsOf(resource: CloudinaryResource): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const { label, keys } of METADATA_FIELDS) {
    const value = contextValue(resource, ...keys);
    if (value) fields[label] = value;
  }
  return fields;
}

function metaLineOf(metaFields: Record<string, string>): string {
  return METADATA_FIELDS.filter(({ label }) => metaFields[label])
    .map(({ label }) => `${label}: ${metaFields[label]}`)
    .join(" · ");
}

async function fetchCollection(
  folderPath: string,
  folderName: string
): Promise<CatalogCollection> {
  // Follow next_cursor rather than trusting the first 500 to be everything —
  // the 501st artwork used to just vanish with no error (tech debt 2.2), and
  // that silence cascaded: getArtworkIndex() wouldn't see it either, so an
  // inquiry/like against it was rejected as invalid and the embedder pruned
  // its search vector as "no longer in the catalog."
  const allResources = await fetchAllPages<
    { resources?: CloudinaryResource[]; next_cursor?: string },
    CloudinaryResource
  >(
    apiGet,
    (cursor) =>
      `/resources/by_asset_folder?asset_folder=${encodeURIComponent(folderPath)}&max_results=500&context=true` +
      (cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ""),
    (page) => ({ items: page.resources ?? [], next_cursor: page.next_cursor })
  );
  const artworks = allResources
    .map((resource) => {
      const filename =
        resource.display_name ??
        resource.public_id.split("/").pop() ??
        resource.public_id;
      return { resource, filename };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map(({ resource, filename }) => {
      const contextTitle =
        contextValue(resource, ...TITLE_KEYS) ?? "";
      const metaFields = metaFieldsOf(resource);
      return {
        slug: slugify(filename),
        name: contextTitle || prettifyFilename(filename),
        image: resource.public_id,
        aspect:
          resource.width && resource.height
            ? resource.width / resource.height
            : 1.5,
        metaLine: metaLineOf(metaFields),
        contextTitle,
        metaFields,
      };
    });
  return {
    // folder name IS the collection title (may contain spaces/capitals);
    // the URL uses a clean slug of it
    slug: slugify(folderName),
    name: folderName,
    path: folderPath,
    cover: artworks[0]?.image ?? null,
    coverAspect: artworks[0]?.aspect ?? 1.5,
    artworks,
  };
}

async function fetchMedium(folder: CloudinaryFolder): Promise<CatalogMedium> {
  // Subfolders (collections) of one medium — max_results tops out at 500 for
  // this endpoint, but the real fix (tech debt 2.2) is following next_cursor
  // rather than trusting one page to be everything, so a medium's 101st
  // collection can't silently disappear the way it used to at the old
  // max_results=100 with no cursor follow.
  const subfolders = (
    await fetchAllPages<
      { folders?: CloudinaryFolder[]; next_cursor?: string },
      CloudinaryFolder
    >(
      apiGet,
      (cursor) =>
        `/folders/${encodeURIComponent(folder.path)}?max_results=500` +
        (cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ""),
      (page) => ({ items: page.folders ?? [], next_cursor: page.next_cursor })
    )
  ).sort((a, b) => a.name.localeCompare(b.name));
  const collections = await Promise.all(
    subfolders.map((sub) => fetchCollection(sub.path, sub.name))
  );
  return {
    slug: slugify(folder.name),
    displayName: folder.name,
    collections: collections.filter((c) => c.artworks.length > 0),
  };
}

/** Full catalog straight from Cloudinary's folder tree. Deduped per render. */
export const getCatalog = cache(async (): Promise<CatalogMedium[]> => {
  // Root folders (mediums) — this endpoint doesn't document a max_results
  // parameter at all (just an overall 2000-result ceiling), so next_cursor is
  // the only lever; following it costs nothing extra when there's only one
  // page, and is the whole fix when there isn't (tech debt 2.2).
  const roots = (
    await fetchAllPages<
      { folders?: CloudinaryFolder[]; next_cursor?: string },
      CloudinaryFolder
    >(
      apiGet,
      (cursor) =>
        `/folders${cursor ? `?next_cursor=${encodeURIComponent(cursor)}` : ""}`,
      (page) => ({ items: page.folders ?? [], next_cursor: page.next_cursor })
    )
  ).sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(roots.map((folder) => fetchMedium(folder)));
});

export async function getCatalogMedium(
  slug: string
): Promise<CatalogMedium | undefined> {
  return (await getCatalog()).find((m) => m.slug === slug);
}

export async function getCatalogCollection(
  mediumSlug: string,
  collectionSlug: string
): Promise<CatalogCollection | undefined> {
  return (await getCatalogMedium(mediumSlug))?.collections.find(
    (c) => c.slug === collectionSlug
  );
}

export function countLabel(collection: CatalogCollection): string {
  const n = collection.artworks.length;
  return n === 1 ? "1 piece" : `${n} pieces`;
}

/** An artwork plus where it lives — the value type of the public_id index. */
interface CatalogArtworkRef {
  artwork: CatalogArtwork;
  mediumSlug: string;
  collectionSlug: string;
}

/**
 * Flat `public_id → artwork + location` view of the catalog. Phase D uses it to
 * validate an inquiry's artworkPublicId + snapshot its trusted title (server
 * side, never client-supplied) and to join the admin comment log back to a
 * thumbnail and a `/[medium]/[collection]#slug` link. Deduped per render.
 */
export const getArtworkIndex = cache(
  async (): Promise<Map<string, CatalogArtworkRef>> => {
    const index = new Map<string, CatalogArtworkRef>();
    for (const medium of await getCatalog()) {
      for (const collection of medium.collections) {
        for (const artwork of collection.artworks) {
          index.set(artwork.image, {
            artwork,
            mediumSlug: medium.slug,
            collectionSlug: collection.slug,
          });
        }
      }
    }
    return index;
  }
);
