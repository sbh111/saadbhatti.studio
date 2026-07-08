import Link from "next/link";
import { countLabel, type CatalogCollection } from "@/lib/catalog";
import ArtworkImage from "./ArtworkImage";

/**
 * One collection in a CollectionsView: fit-to-screen cover (same treatment
 * as CollectionView artworks), name + count below. One clickable box.
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
  return (
    <Link
      href={`/${mediumSlug}/${collection.slug}`}
      className="block px-2 pb-10"
    >
      {collection.cover && (
        <ArtworkImage
          src={collection.cover}
          alt={`${collection.name} — cover`}
          aspect={collection.coverAspect}
          priority={priority}
        />
      )}
      <div
        className="mx-auto mt-3 max-w-full"
        style={{
          width: `min(100%, calc(${collection.coverAspect} * 66vh))`,
        }}
      >
        <div className="text-lg font-medium text-ink">{collection.name}</div>
        <div className="mt-0.5 text-[15px] text-ink-muted">
          {countLabel(collection)}
        </div>
      </div>
    </Link>
  );
}
