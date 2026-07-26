import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getArtworkIndex } from "@/lib/catalog";
import { imageUrl } from "@/lib/cloudinary";
import { content } from "@/lib/content";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: `likes - ${content.site.title}`,
  robots: { index: false },
};

// Reads the session + aggregates the DB on every request.
export const dynamic = "force-dynamic";

export default async function LikesPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const [grouped, index] = await Promise.all([
    prisma.like.groupBy({
      by: ["artworkPublicId"],
      _count: { artworkPublicId: true },
      orderBy: { _count: { artworkPublicId: "desc" } },
    }),
    getArtworkIndex(),
  ]);

  const total = grouped.reduce((sum, g) => sum + g._count.artworkPublicId, 0);

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">likes</h1>
      <p className="mt-1 text-[13px] text-ink-faint">
        {grouped.length === 0
          ? "No likes yet."
          : `${total} like${total === 1 ? "" : "s"} across ${
              grouped.length
            } piece${grouped.length === 1 ? "" : "s"}`}
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        {grouped.map((g) => {
          const ref = index.get(g.artworkPublicId);
          return (
            <li
              key={g.artworkPublicId}
              className="flex items-center gap-3 rounded-[2px] border border-hairline bg-panel p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(g.artworkPublicId, 200)}
                alt=""
                className="h-16 w-24 shrink-0 rounded-[1px] bg-placeholder object-cover"
              />
              <div className="min-w-0 grow">
                {ref ? (
                  <Link
                    href={`/${ref.mediumSlug}/${ref.collectionSlug}#${ref.artwork.slug}`}
                    className="truncate text-[15px] font-medium text-ink hover:text-steel"
                  >
                    {ref.artwork.name}
                  </Link>
                ) : (
                  <span className="truncate text-[15px] font-medium text-ink">
                    {g.artworkPublicId}{" "}
                    <span className="text-ink-faint">(no longer listed)</span>
                  </span>
                )}
              </div>
              <div className="shrink-0 font-pixel text-[13px] text-steel">
                {g._count.artworkPublicId}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
