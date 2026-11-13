import type { Metadata } from "next";
import Link from "next/link";
import { content } from "@/lib/content";
import { getCatalog } from "@/lib/catalog";
import { mediumHref } from "@/lib/urls";
import WIPView from "@/components/WIPView";

/**
 * The catalog landing page — an index of mediums, one level above
 * `/art/[medium]`'s index of collections.
 *
 * Static like every other public route (no session reads, no DB, no
 * cookies()/headers()), inheriting `revalidate = 3600` from the root layout;
 * see docs/architecture.md §13.2.
 */

export const metadata: Metadata = {
  title: `art — ${content.site.title}`,
};

function mediumLabel(collectionCount: number): string {
  if (collectionCount === 0) return "work in progress";
  return collectionCount === 1 ? "1 collection" : `${collectionCount} collections`;
}

export default async function MediumsView() {
  const mediums = await getCatalog();

  // Nothing under art/ in Cloudinary yet — same placeholder a medium with no
  // collections gets, rather than an empty page with a count of zero.
  if (mediums.length === 0) {
    return <WIPView />;
  }

  const label = mediums.length === 1 ? "1 medium" : `${mediums.length} mediums`;

  return (
    <div className="pb-10">
      <header className="px-[30px] pb-5 pt-[34px]">
        <h1 className="font-pixel text-xl leading-relaxed text-ink">art</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">{label}</p>
      </header>
      <ul className="px-[30px]">
        {mediums.map((medium) => (
          <li key={medium.slug} className="border-t border-ink-faint/20">
            <Link
              href={mediumHref(medium.slug)}
              className="block py-4 hover:bg-nav-active/50"
            >
              <div className="text-lg font-medium text-ink">
                {medium.displayName}
              </div>
              <div className="mt-0.5 text-[15px] text-ink-muted">
                {mediumLabel(medium.collections.length)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
