import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import { formatPostDate } from "@/lib/postDate";
import type { PostCover } from "@/lib/posts";
import ArtworkImage from "./ArtworkImage";

/**
 * One post's rendered article, shared by the public page
 * (app/blog/[slug]/page.tsx) and the admin draft preview
 * (app/admin/blog/[id]/preview/page.tsx).
 *
 * Shared ON PURPOSE: a preview that renders through a different code path from
 * production is a preview that can lie. One component means what the owner
 * approves is what visitors get — which matters more now than it did in Phase
 * 0, because the body goes through a Markdown pipeline whose output the owner
 * cannot predict by reading the source.
 *
 * A server component — no "use client", so the Markdown parser stays on the
 * server and this ships no JavaScript.
 *
 * ── On dangerouslySetInnerHTML ────────────────────────────────────────────
 * Phase 0's version of this file promised that "Phase 1's Markdown pipeline is
 * the commit that introduces one, and the sanitisation question along with
 * it". This is that commit, and the answer is lib/markdown.ts: raw HTML in a
 * body is escaped to visible text, and link/image URLs are scheme-allowlisted,
 * so `renderMarkdown` returns HTML built only from markup it generated itself.
 * That module's tests are written as attacks for exactly this reason. Do not
 * pass anything else to this prop — in particular, Phase 3's visitor comments
 * must render as escaped plain text and must never come through here.
 */
export default function PostArticle({
  title,
  publishedAt,
  body,
  readingMinutes,
  cover,
  backHref,
}: {
  title: string;
  /** ISO 8601, or null for a draft that has never been published. */
  publishedAt: string | null;
  body: string;
  readingMinutes: number;
  cover: PostCover | null;
  /**
   * Where "all posts" goes, or omitted for no back link.
   *
   * A post needs one in a way a collection page does not: `lib/nav.ts` makes
   * the blog's nav node deliberately childless (listing posts there would put
   * a Postgres read in the root layout and make the whole site dynamic), so
   * `/blog/<slug>` has no ancestor in the sidebar tree to climb. The catalog's
   * deeper pages are all in that tree, which is why none of them carries one.
   *
   * A prop rather than a hardcoded link because the admin preview renders this
   * same component and already has its own "back to editor" bar — sending the
   * owner to the public index from a draft preview would be wrong. It passes
   * nothing, so it gets nothing.
   */
  backHref?: string;
}) {
  const html = renderMarkdown(body);
  const meta = [
    publishedAt ? formatPostDate(publishedAt) : "not published yet",
    readingMinutes > 0 ? `${readingMinutes} min read` : "",
  ].filter(Boolean);

  // One centred reading column. `mx-auto` sits on the <article> rather than on
  // each child so the header, cover and body cannot drift out of alignment
  // with one another; 680px is the measure the body was already set to.
  return (
    <article className="mx-auto max-w-[680px] pb-16">
      <header className="px-[30px] pb-5 pt-[34px]">
        {/* Inside the header so one place owns the spacing above the title —
            putting it in the page would stack a second pt-[34px] on top. */}
        {backHref && (
          <Link
            href={backHref}
            className="mb-3 inline-block text-[13px] text-ink-faint hover:text-steel"
          >
            ← all posts
          </Link>
        )}
        <h1 className="font-pixel text-xl leading-relaxed text-ink">{title}</h1>
        <p className="mt-1.5 text-[13px] text-ink-faint">{meta.join(" · ")}</p>
      </header>

      {cover && (
        <div className="px-[30px] pb-6">
          {/* Reuses the catalog's image component, so a cover gets the same
              srcset, blur-up placeholder and reserved aspect ratio as artwork.
              `fitViewport` is off: a cover is part of the reading flow and
              should not be sized to fill the viewport the way a single artwork
              is. Falls back to 3:2 when the dimensions predate those columns. */}
          <ArtworkImage
            src={cover.publicId}
            alt={cover.alt}
            aspect={
              cover.width && cover.height ? cover.width / cover.height : 1.5
            }
            fitViewport={false}
            priority
            sizes="(min-width: 900px) 620px, calc(100vw - 60px)"
          />
        </div>
      )}

      {html ? (
        <div
          className="post-body px-[30px] text-[15px] leading-relaxed text-ink"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="px-[30px] text-[15px] leading-relaxed">
          <span className="text-ink-faint">This post has no body yet.</span>
        </div>
      )}
    </article>
  );
}
