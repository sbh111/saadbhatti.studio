import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { content } from "@/lib/content";
import { countLabel, getCatalog, getCatalogCollection } from "@/lib/catalog";
import ArtworkBlock from "@/components/ArtworkBlock";

export async function generateStaticParams() {
  const catalog = await getCatalog();
  return catalog.flatMap((m) =>
    m.collections.map((c) => ({ medium: m.slug, collection: c.slug }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ medium: string; collection: string }>;
}): Promise<Metadata> {
  const { medium, collection } = await params;
  const data = await getCatalogCollection(medium, collection);
  return { title: `${data?.name ?? collection} — ${content.site.title}` };
}

export default async function CollectionView({
  params,
}: {
  params: Promise<{ medium: string; collection: string }>;
}) {
  const { medium, collection } = await params;
  const data = await getCatalogCollection(medium, collection);
  if (!data) notFound();

  const noun = medium === "photography" ? "film" : "oil";

  return (
    <div className="pb-10">
      <header className="px-[30px] pb-5 pt-[34px]">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {data.name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {countLabel(data, medium)} · {noun}
        </p>
      </header>
      {data.artworks.map((artwork, i) => (
        <ArtworkBlock key={artwork.slug} artwork={artwork} priority={i < 2} />
      ))}
    </div>
  );
}
