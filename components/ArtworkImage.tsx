import { blurUrl, imageSrcSet, imageUrl } from "@/lib/cloudinary";

/**
 * Responsive image with reserved aspect ratio to avoid layout shift.
 *
 * Scales to fit the screen: width is capped both by the container and by
 * whatever width puts the image's height at ~66vh — so the title + metadata
 * below it stay on screen even for tall portrait shots. Centered when
 * narrower than the container.
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
  fitViewport = true,
  sizes = "(min-width: 900px) calc(100vw - 236px - 16px), calc(100vw - 16px)",
}: {
  src: string;
  alt: string;
  aspect?: number;
  priority?: boolean;
  fitViewport?: boolean;
  sizes?: string;
}) {
  const isLocal = src.startsWith("/");
  return (
    <div
      className="mx-auto max-w-full overflow-hidden rounded-[2px] bg-placeholder bg-cover bg-center"
      style={{
        aspectRatio: aspect,
        width: fitViewport ? `min(100%, calc(${aspect} * 66vh))` : "100%",
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
