import type { CatalogArtwork } from "@/lib/catalog";
import ArtworkImage from "./ArtworkImage";
import ArtworkCaption from "./ArtworkCaption";
import InquiryForm from "./InquiryForm";
import LikeButton from "./LikeButton";

/** One artwork in a CollectionView: fit-to-screen image, name + metadata below
 *  (inline-editable when logged in as admin — see ArtworkCaption). */
export default function ArtworkBlock({
  artwork,
  priority = false,
}: {
  artwork: CatalogArtwork;
  priority?: boolean;
}) {
  return (
    <figure
      id={artwork.slug}
      data-artwork-id={artwork.image}
      className="px-2 pb-10"
    >
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
        <ArtworkCaption
          publicId={artwork.image}
          name={artwork.name}
          metaLine={artwork.metaLine}
          contextTitle={artwork.contextTitle}
          metaFields={artwork.metaFields}
        />
        <div>
          <LikeButton publicId={artwork.image} />
        </div>
        <InquiryForm
          artworkPublicId={artwork.image}
          artworkName={artwork.name}
        />
      </figcaption>
    </figure>
  );
}
