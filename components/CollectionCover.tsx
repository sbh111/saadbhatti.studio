import Link from "next/link";
import { countLabel, type CatalogCollection } from "@/lib/catalog";
import ArtworkImage from "./ArtworkImage";

/**
 * One collection in a CollectionsView: full-width cover spanning the main
 * area (same treatment as CollectionView artworks), name + count below.
 * The whole block is one clickable box.
 */
export default function CollectionCover({
  collection,
  mediumSlug,
  priority = false,
}: {
  collection: CatalogCollection;
  mediumSlug: string;
  priority?: boolean;
}) {
  const coverAspect =
    collection.artworks.find((a) => a.image === collection.cover)?.aspect ?? 1.5;
  return (
    <Link
      href={`/${mediumSlug}/${collection.slug}`}
      className="block px-2 pb-8"
    >
      {collection.cover && (
        <ArtworkImage
          src={collection.cover}
          alt={`${collection.name} — cover`}
          aspect={coverAspect}
          priority={priority}
        />
      )}
      <div className="mt-2.5 pl-0.5">
        <div className="text-[17px] font-medium text-ink">
          {collection.name}
        </div>
        <div className="mt-0.5 text-sm text-ink-muted">
          {countLabel(collection, mediumSlug)}
        </div>
      </div>
    </Link>
  );
}
