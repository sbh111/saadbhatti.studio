import { blurUrl, imageSrcSet, imageUrl } from "@/lib/cloudinary";

/**
 * Cloudinary responsive image: capped at 2048 long edge, srcset for smaller
 * devices, lazy-loaded, blur-up placeholder behind, space reserved via aspect
 * ratio to avoid layout shift.
 */
export default function ArtworkImage({
  publicId,
  alt,
  aspect = 1.5,
  priority = false,
  sizes = "(min-width: 900px) calc(100vw - 220px - 16px), calc(100vw - 16px)",
}: {
  publicId: string;
  alt: string;
  aspect?: number;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <div
      className="w-full overflow-hidden rounded-[2px] bg-placeholder bg-cover bg-center"
      style={{
        aspectRatio: aspect,
        backgroundImage: `url(${blurUrl(publicId)})`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl(publicId)}
        srcSet={imageSrcSet(publicId)}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
