import { artworkMeta, type ArtWork } from "@/lib/content";
import ArtworkImage from "./ArtworkImage";

/** One artwork in a CollectionView: near-full-width image, name + metadata below. */
export default function ArtworkBlock({
  artwork,
  priority = false,
}: {
  artwork: ArtWork;
  priority?: boolean;
}) {
  const meta = artworkMeta(artwork);
  return (
    <figure id={artwork.slug} className="px-2 pb-8">
      <ArtworkImage
        publicId={artwork.image}
        alt={artwork.name}
        aspect={artwork.aspect ?? 1.5}
        priority={priority}
      />
      <figcaption className="mt-2.5 pl-0.5">
        <div className="text-[17px] font-medium text-ink">{artwork.name}</div>
        {meta && <div className="mt-0.5 text-sm text-ink-muted">{meta}</div>}
      </figcaption>
    </figure>
  );
}
