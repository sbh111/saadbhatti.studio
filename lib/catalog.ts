import { cache } from "react";
import { apiGet } from "./cloudinaryAdmin";

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
 * - metadata:    any of the contextual keys Film, Medium, Dimensions, Year —
 *                whichever are present render, in that order
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

/**
 * All context keys the title is read from, in read-priority order — every
 * historical "spelling" of the same logical field. The first entry is
 * canonical: the only key the admin write path ever sets. Clearing the title
 * must delete every key here, or an old alias (e.g. a stray `caption`) would
 * resurface through the fallback below (tech debt 3.2).
 */
export const TITLE_KEYS: readonly string[] = ["Title Name", "caption", "Title", "title"];

/**
 * Contextual metadata rendered for any medium, in this order, blanks skipped.
 * Each entry is `[label, ...contextKeys]` — the same shape/reasoning as
 * `TITLE_KEYS`: `contextKeys` is that field's full read chain (canonical key
 * first), so `Film` clearing has to delete both `Film` and `film`, not just
 * the canonical one.
 */
export const META_KEYS: [label: string, ...contextKeys: string[]][] = [
  ["Film", "Film", "film"],
  ["Medium", "Medium", "medium"],
  ["Dimensions", "Dimensions", "dimensions"],
  ["Year", "Year", "year"],
];

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
  for (const [label, ...keys] of META_KEYS) {
    const value = contextValue(resource, ...keys);
    if (value) fields[label] = value;
  }
  return fields;
}

function metaLineOf(metaFields: Record<string, string>): string {
  return META_KEYS.filter(([label]) => metaFields[label])
    .map(([label]) => `${label}: ${metaFields[label]}`)
    .join(" · ");
}

async function fetchCollection(
  folderPath: string,
  folderName: string
): Promise<CatalogCollection> {
  const data = await apiGet<{ resources?: CloudinaryResource[] }>(
    `/resources/by_asset_folder?asset_folder=${encodeURIComponent(folderPath)}&max_results=500&context=true`
  );
  const artworks = (data.resources ?? [])
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
  const data = await apiGet<{ folders?: CloudinaryFolder[] }>(
    `/folders/${encodeURIComponent(folder.path)}?max_results=100`
  );
  const subfolders = (data.folders ?? []).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
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
  const data = await apiGet<{ folders?: CloudinaryFolder[] }>(
    "/folders?max_results=100"
  );
  const roots = (data.folders ?? []).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
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
