import { blurUrl, imageSrcSet, imageUrl } from "@/lib/cloudinary";
import { SIDEBAR_WIDTH_PX } from "@/lib/constants";

/**
 * Responsive image with reserved aspect ratio to avoid layout shift.
 *
 * Scales to fit the screen: width is capped both by the container and by
 * whatever width puts the image's height at ~66vh (--fit-height in
 * globals.css) — so the title + metadata below it stay on screen even for
 * tall portrait shots. Centered when narrower than the container.
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
  // The `sizes` attribute isn't part of the CSS cascade, so it can't resolve
  // --sidebar-width — hence the plain TS constant instead of the CSS var
  // every other consumer of the sidebar width uses.
  sizes = `(min-width: 900px) calc(100vw - ${SIDEBAR_WIDTH_PX}px - 16px), calc(100vw - 16px)`,
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
        width: fitViewport
          ? `min(100%, calc(${aspect} * var(--fit-height)))`
          : "100%",
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
