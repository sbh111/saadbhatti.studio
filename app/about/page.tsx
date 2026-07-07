import type { Metadata } from "next";
import { content } from "@/lib/content";
import ArtworkImage from "@/components/ArtworkImage";

export const metadata: Metadata = { title: `about — ${content.site.title}` };

export default function AboutMeView() {
  const { site } = content;
  return (
    <div className="px-5 pb-16 pt-10 desk:px-[60px] desk:pt-[72px]">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">about</h1>
      <div className="mt-8 flex flex-col gap-8 desk:flex-row desk:gap-11">
        <div className="w-full max-w-[300px] shrink-0">
          <ArtworkImage
            src={site.headshotImage}
            alt="Saad Bhatti"
            aspect={300 / 380}
            priority
            sizes="300px"
          />
        </div>
        <div className="max-w-[640px] space-y-4">
          {site.bio.map((paragraph) => (
            <p key={paragraph} className="text-[17px] leading-relaxed text-ink">
              {paragraph}
            </p>
          ))}
          <div className="pt-4">
            <h2 className="text-[17px] font-medium text-ink">Contact</h2>
            {site.contact.instagram && (
              <a
                href={site.contact.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 block text-[17px] text-steel underline-offset-4 hover:underline"
              >
                Instagram — @sbhphotographyaccount
              </a>
            )}
            {!site.contact.email && (
              <p className="mt-1 text-sm text-ink-muted">
                Business email coming soon
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
