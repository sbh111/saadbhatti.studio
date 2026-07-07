import type { CatalogArtwork } from "@/lib/catalog";
import ArtworkImage from "./ArtworkImage";

/** One artwork in a CollectionView: near-full-width image, name + metadata below. */
export default function ArtworkBlock({
  artwork,
  priority = false,
}: {
  artwork: CatalogArtwork;
  priority?: boolean;
}) {
  return (
    <figure id={artwork.slug} className="px-2 pb-8">
      <ArtworkImage
        src={artwork.image}
        alt={artwork.name}
        aspect={artwork.aspect}
        priority={priority}
      />
      <figcaption className="mt-2.5 pl-0.5">
        <div className="text-[17px] font-medium text-ink">{artwork.name}</div>
        {artwork.metaLine && (
          <div className="mt-0.5 text-sm text-ink-muted">{artwork.metaLine}</div>
        )}
      </figcaption>
    </figure>
  );
}
