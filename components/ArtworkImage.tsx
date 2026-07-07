import { blurUrl, imageSrcSet, imageUrl } from "@/lib/cloudinary";

/**
 * Responsive image with reserved aspect ratio to avoid layout shift.
 *
 * `src` is either a local path under /public (starts with "/", e.g.
 * "/images/hero.jpg") served as-is, or a Cloudinary public id delivered
 * capped at 2048 long edge with srcset + blur-up placeholder.
 */
export default function ArtworkImage({
  src,
  alt,
  aspect = 1.5,
  priority = false,
  sizes = "(min-width: 900px) calc(100vw - 220px - 16px), calc(100vw - 16px)",
}: {
  src: string;
  alt: string;
  aspect?: number;
  priority?: boolean;
  sizes?: string;
}) {
  const isLocal = src.startsWith("/");
  return (
    <div
      className="w-full overflow-hidden rounded-[2px] bg-placeholder bg-cover bg-center"
      style={{
        aspectRatio: aspect,
        backgroundImage: isLocal ? undefined : `url(${blurUrl(src)})`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={isLocal ? src : imageUrl(src)}
        srcSet={isLocal ? undefined : imageSrcSet(src)}
        sizes={isLocal ? undefined : sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
