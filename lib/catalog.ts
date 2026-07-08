import { cache } from "react";
import { CLOUD_NAME } from "./cloudinary";

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
}

export interface CatalogCollection {
  slug: string;
  name: string;
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

/** Contextual metadata rendered for any medium, in this order, blanks skipped */
const META_KEYS: [label: string, ...contextKeys: string[]][] = [
  ["Film", "Film", "film"],
  ["Medium", "Medium", "medium"],
  ["Dimensions", "Dimensions", "dimensions"],
  ["Year", "Year", "year"],
];

function authHeader(): string {
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET. Locally: put them in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}${path}`,
    {
      headers: { Authorization: authHeader() },
      next: { revalidate: 3600 },
    }
  );
  if (!response.ok) {
    throw new Error(
      `Cloudinary Admin API ${path} failed: HTTP ${response.status} ${await response.text()}`
    );
  }
  return response.json() as Promise<T>;
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

function metaLine(resource: CloudinaryResource): string {
  const parts: string[] = [];
  for (const [label, ...keys] of META_KEYS) {
    const value = contextValue(resource, ...keys);
    if (value) parts.push(`${label}: ${value}`);
  }
  return parts.join(" · ");
}

async function fetchCollection(
  folderPath: string,
  folderName: string
): Promise<CatalogCollection> {
  const data = await api<{ resources?: CloudinaryResource[] }>(
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
    .map(({ resource, filename }) => ({
      slug: slugify(filename),
      name:
        contextValue(resource, "Title Name", "caption", "Title", "title") ??
        prettifyFilename(filename),
      image: resource.public_id,
      aspect:
        resource.width && resource.height
          ? resource.width / resource.height
          : 1.5,
      metaLine: metaLine(resource),
    }));
  return {
    // folder name IS the collection title (may contain spaces/capitals);
    // the URL uses a clean slug of it
    slug: slugify(folderName),
    name: folderName,
    cover: artworks[0]?.image ?? null,
    coverAspect: artworks[0]?.aspect ?? 1.5,
    artworks,
  };
}

async function fetchMedium(folder: CloudinaryFolder): Promise<CatalogMedium> {
  const data = await api<{ folders?: CloudinaryFolder[] }>(
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
  const data = await api<{ folders?: CloudinaryFolder[] }>(
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
