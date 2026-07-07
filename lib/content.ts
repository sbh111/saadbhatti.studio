import raw from "@/content/content.json";

export interface ArtWorkBase {
  slug: string;
  name: string;
  /** Cloudinary public id, e.g. "photography/pakistan2023/photo-01" */
  image: string;
  /** Optional intrinsic aspect ratio (width / height) for layout reservation */
  aspect?: number;
}

export interface Photograph extends ArtWorkBase {
  type: "photograph";
  film?: string | null;
}

export interface Painting extends ArtWorkBase {
  type: "painting";
  medium?: string | null;
  dimensions?: string | null;
  year?: string | null;
  /** Reserved for Phase 1 purchasing — never rendered in Phase 0 */
  availability?: string | null;
  price?: string | null;
}

export type ArtWork = Photograph | Painting;

export interface Collection {
  slug: string;
  name: string;
  /** Cloudinary public id override; null → first artwork's image */
  cover: string | null;
  artworks: ArtWork[];
}

export interface ArtMedium {
  slug: string;
  displayName: string;
  status: "published" | "wip";
  collections: Collection[];
}

export interface SiteContent {
  site: {
    title: string;
    intro: string;
    bio: string[];
    contact: { instagram?: string; email?: string };
    heroImage: string;
    headshotImage: string;
  };
  mediums: ArtMedium[];
}

export const content = raw as SiteContent;

export function getMedium(slug: string): ArtMedium | undefined {
  return content.mediums.find((m) => m.slug === slug);
}

export function getCollection(
  mediumSlug: string,
  collectionSlug: string
): Collection | undefined {
  return getMedium(mediumSlug)?.collections.find(
    (c) => c.slug === collectionSlug
  );
}

export function coverImage(collection: Collection): string | null {
  return collection.cover ?? collection.artworks[0]?.image ?? null;
}

/** "Film: Portra 400" or "Medium: Oil on Canvas · Dimensions: 24x36in · Year: 2026" — blanks skipped */
export function artworkMeta(artwork: ArtWork): string {
  const parts: string[] = [];
  if (artwork.type === "photograph") {
    if (artwork.film) parts.push(`Film: ${artwork.film}`);
  } else {
    if (artwork.medium) parts.push(`Medium: ${artwork.medium}`);
    if (artwork.dimensions) parts.push(`Dimensions: ${artwork.dimensions}`);
    if (artwork.year) parts.push(`Year: ${artwork.year}`);
  }
  return parts.join(" · ");
}

export function countLabel(collection: Collection, mediumSlug: string): string {
  const n = collection.artworks.length;
  const noun =
    mediumSlug === "photography"
      ? n === 1
        ? "photograph"
        : "photographs"
      : n === 1
        ? "painting"
        : "paintings";
  return `${n} ${noun}`;
}
