import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getArtworkIndex } from "@/lib/catalog";
import { content } from "@/lib/content";
import { prisma } from "@/lib/db";
import { EVENT_STREAMING_KEY, getSetting } from "@/lib/settings";
import { setEventStreamingAction } from "./actions";

export const metadata: Metadata = {
  title: `settings - ${content.site.title}`,
  robots: { index: false },
};

// Reads the session + a DB row on every request — nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * Search-index drift: catalog artworks with no vector, and vectors with no
 * catalog artwork (see docs/operations.md §1). Nothing keeps these in sync
 * automatically — the embedder only runs when someone runs it — so this is
 * the one place an admin can see it's needed without reading server logs.
 * Reads both Cloudinary (via getArtworkIndex) and Postgres; either can fail
 * independently, so this must never take the rest of the page down with it.
 */
async function embeddingDrift(): Promise<
  { missing: number; orphaned: number } | null
> {
  try {
    const [index, rows] = await Promise.all([
      getArtworkIndex(),
      prisma.$queryRaw<{ publicId: string }[]>`SELECT "publicId" FROM "artwork_embeddings"`,
    ]);
    const embedded = new Set(rows.map((r) => r.publicId));
    let missing = 0;
    for (const publicId of index.keys()) {
      if (!embedded.has(publicId)) missing++;
    }
    let orphaned = 0;
    for (const publicId of embedded) {
      if (!index.has(publicId)) orphaned++;
    }
    return { missing, orphaned };
  } catch (err) {
    console.warn("settings: embedding drift check failed:", (err as Error).message);
    return null;
  }
}

export default async function SettingsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const enabled = (await getSetting(EVENT_STREAMING_KEY)) === "true";
  const drift = await embeddingDrift();

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">settings</h1>

      <section className="mt-6 rounded-[2px] border border-hairline bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[15px] font-medium text-ink">
              Event streaming
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Stream anonymized page views, artwork views, and likes to the Kafka
              collector. A learning feature — safe to leave off; the site behaves
              identically either way, and likes are recorded regardless.
            </p>
            <div className="mt-2 text-[12px] text-ink-faint">
              Status:{" "}
              <span className={enabled ? "text-steel" : ""}>
                streaming {enabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
          <form action={setEventStreamingAction}>
            <input type="hidden" name="to" value={enabled ? "off" : "on"} />
            <button
              type="submit"
              className="shrink-0 rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink hover:border-steel hover:text-steel"
            >
              {enabled ? "Turn off" : "Turn on"}
            </button>
          </form>
        </div>
      </section>

      <section className="mt-4 rounded-[2px] border border-hairline bg-panel p-4">
        <div className="text-[15px] font-medium text-ink">Search index</div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          The CLIP embedder runs on demand, not automatically — see{" "}
          <span className="text-ink">docs/operations.md §1</span> for when and how
          to re-run it.
        </p>
        <div className="mt-2 text-[12px] text-ink-faint">
          {drift === null ? (
            "Status: unavailable (couldn't reach the database or catalog)"
          ) : drift.missing === 0 && drift.orphaned === 0 ? (
            <span className="text-steel">In sync — every artwork has a vector.</span>
          ) : (
            <>
              {drift.missing > 0 &&
                `${drift.missing} artwork${drift.missing === 1 ? "" : "s"} without a vector. `}
              {drift.orphaned > 0 &&
                `${drift.orphaned} vector${drift.orphaned === 1 ? "" : "s"} with no matching artwork. `}
              Re-run the embedder to fix this.
            </>
          )}
        </div>
      </section>
    </div>
  );
}
