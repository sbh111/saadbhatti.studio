import { content } from "@/lib/content";
import ArtworkImage from "@/components/ArtworkImage";

export default function LandingView() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-12 desk:px-20">
      <div className="w-full max-w-[780px]">
        <ArtworkImage
          publicId={content.site.heroImage}
          alt="Saad Bhatti in the studio"
          aspect={1.56}
          priority
          sizes="(min-width: 900px) 780px, calc(100vw - 40px)"
        />
      </div>
      <p className="max-w-[600px] text-center text-[17px] leading-relaxed text-ink">
        {content.site.intro}
      </p>
    </div>
  );
}
