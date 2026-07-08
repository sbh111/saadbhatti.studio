import type { CatalogArtwork } from "@/lib/catalog";
import ArtworkImage from "./ArtworkImage";

/** One artwork in a CollectionView: fit-to-screen image, name + metadata below. */
export default function ArtworkBlock({
  artwork,
  priority = false,
}: {
  artwork: CatalogArtwork;
  priority?: boolean;
}) {
  return (
    <figure id={artwork.slug} className="px-2 pb-10">
      <ArtworkImage
        src={artwork.image}
        alt={artwork.name}
        aspect={artwork.aspect}
        priority={priority}
      />
      <figcaption
        className="mx-auto mt-3 max-w-full"
        style={{ width: `min(100%, calc(${artwork.aspect} * 66vh))` }}
      >
        <div className="text-lg font-medium text-ink">{artwork.name}</div>
        {artwork.metaLine && (
          <div className="mt-0.5 text-[15px] text-ink-muted">
            {artwork.metaLine}
          </div>
        )}
      </figcaption>
    </figure>
  );
}
