import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { content } from "@/lib/content";
import {
  countLabel,
  getCatalog,
  getCatalogCollection,
  getCatalogMedium,
} from "@/lib/catalog";
import ArtworkBlock from "@/components/ArtworkBlock";
import ReorderableArtworkList from "@/components/ReorderableArtworkList";
import ReorderPanel from "@/components/ReorderPanel";

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
  const [mediumData, data] = await Promise.all([
    getCatalogMedium(medium),
    getCatalogCollection(medium, collection),
  ]);
  if (!data) notFound();

  return (
    // Flex row so the admin-only reorder panel can sit to the right of the image
    // stack. The panel renders null for visitors, leaving the main column full
    // width — logged-out layout is unchanged.
    <div className="flex">
      <div className="min-w-0 grow pb-10">
        <header className="px-[30px] pb-5 pt-[34px]">
          <h1 className="font-pixel text-xl leading-relaxed text-ink">
            {data.name}
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            {countLabel(data)}
            {mediumData ? ` · ${mediumData.displayName}` : ""}
          </p>
        </header>
        <ReorderableArtworkList
          collectionPath={data.path}
          publicIds={data.artworks.map((a) => a.image)}
        >
          {data.artworks.map((artwork, i) => (
            <ArtworkBlock
              key={artwork.slug}
              artwork={artwork}
              priority={i < 2}
            />
          ))}
        </ReorderableArtworkList>
      </div>
      <ReorderPanel
        collectionPath={data.path}
        artworks={data.artworks.map((a) => ({
          slug: a.slug,
          name: a.name,
          image: a.image,
        }))}
      />
    </div>
  );
}
