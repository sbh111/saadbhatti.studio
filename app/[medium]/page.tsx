import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { content } from "@/lib/content";
import { getCatalogMedium } from "@/lib/catalog";
import CollectionCover from "@/components/CollectionCover";
import WIPView from "@/components/WIPView";

export function generateStaticParams() {
  return content.mediums.map((m) => ({ medium: m.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ medium: string }>;
}): Promise<Metadata> {
  const { medium } = await params;
  const def = content.mediums.find((m) => m.slug === medium);
  return { title: `${def?.displayName ?? medium} — ${content.site.title}` };
}

export default async function CollectionsView({
  params,
}: {
  params: Promise<{ medium: string }>;
}) {
  const { medium } = await params;
  const data = await getCatalogMedium(medium);
  if (!data) notFound();

  if (data.status === "wip" || data.collections.length === 0) {
    return <WIPView />;
  }

  const label =
    data.collections.length === 1
      ? "1 collection"
      : `${data.collections.length} collections`;

  return (
    <div className="pb-10">
      <header className="px-[30px] pb-5 pt-[34px]">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {data.displayName}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{label}</p>
      </header>
      {data.collections.map((collection, i) => (
        <CollectionCover
          key={collection.slug}
          collection={collection}
          mediumSlug={data.slug}
          priority={i === 0}
        />
      ))}
    </div>
  );
}
