import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { content } from "@/lib/content";
import { isAdmin } from "@/lib/auth";
import { getCatalog, META_KEYS, type CatalogArtwork } from "@/lib/catalog";
import { imageUrl } from "@/lib/cloudinary";
import { logoutAction } from "./login/actions";

export const metadata: Metadata = {
  title: `admin - ${content.site.title}`,
  robots: { index: false },
};

const inputClasses =
  "w-full rounded-[2px] border border-hairline bg-page px-2.5 py-1.5 text-[15px] text-ink outline-none focus:border-steel";

function ArtworkEditor({ artwork }: { artwork: CatalogArtwork }) {
  return (
    <details className="border-b border-hairline py-2">
      <summary className="flex cursor-pointer items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(artwork.image, 200)}
          alt=""
          className="h-12 w-12 shrink-0 rounded-[2px] object-cover"
          loading="lazy"
        />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium text-ink">
            {artwork.name}
          </span>
          <span className="block truncate text-sm text-ink-muted">
            {artwork.metaLine || "no metadata"}
          </span>
        </span>
      </summary>
      <form
        method="POST"
        action={`/api/admin/artwork/${encodeURIComponent(artwork.image)}`}
        className="mt-3 grid max-w-[560px] gap-3 pb-2 pl-[60px]"
      >
        <label className="block text-sm text-ink-muted">
          Title
          <input
            name="title"
            defaultValue={artwork.contextTitle}
            placeholder={artwork.contextTitle ? undefined : artwork.name}
            className={`mt-1 ${inputClasses}`}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          {META_KEYS.map(([label]) => (
            <label key={label} className="block text-sm text-ink-muted">
              {label}
              <input
                name={label.toLowerCase()}
                defaultValue={artwork.metaFields[label] ?? ""}
                className={`mt-1 ${inputClasses}`}
              />
            </label>
          ))}
        </div>
        <button
          type="submit"
          className="w-fit rounded-[2px] bg-steel px-4 py-1.5 text-[15px] font-medium text-page hover:opacity-90"
        >
          Save
        </button>
      </form>
    </details>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const [catalog, { error, saved }] = await Promise.all([
    getCatalog(),
    searchParams,
  ]);

  return (
    <div className="px-[30px] pb-16 pt-[34px]">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-pixel text-xl leading-relaxed text-ink">admin</h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            Edit artwork titles and metadata — changes write to Cloudinary and
            go live within seconds.
          </p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-[2px] border border-hairline px-3 py-1.5 text-[15px] text-ink-muted hover:border-steel hover:text-steel"
          >
            Log out
          </button>
        </form>
      </header>

      {error && (
        <p className="mt-4 rounded-[2px] border border-steel px-3 py-2 text-[15px] text-steel">
          Saving failed — the change was not applied. Check the server logs and
          try again.
        </p>
      )}
      {saved && (
        <p className="mt-4 rounded-[2px] border border-hairline bg-nav-active px-3 py-2 text-[15px] text-ink">
          Saved. The live site reflects the change now.
        </p>
      )}

      {catalog.map((medium) => (
        <section key={medium.slug} className="mt-8">
          <h2 className="text-lg font-semibold text-ink">
            {medium.displayName}
          </h2>
          {medium.collections.length === 0 && (
            <p className="mt-2 text-[15px] text-ink-muted">
              No collections yet.
            </p>
          )}
          {medium.collections.map((collection) => (
            <div key={collection.slug} className="mt-3">
              <h3 className="text-[15px] font-medium text-ink-muted">
                {collection.name} · {collection.artworks.length}
              </h3>
              <div className="mt-1">
                {collection.artworks.map((artwork) => (
                  <ArtworkEditor key={artwork.image} artwork={artwork} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
