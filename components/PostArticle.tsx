import { formatPostDate } from "@/lib/postDate";

/**
 * One post's rendered article, shared by the public page
 * (app/blog/[slug]/page.tsx) and the admin draft preview
 * (app/admin/blog/[id]/preview/page.tsx).
 *
 * Shared ON PURPOSE: a preview that renders through a different code path from
 * production is a preview that can lie. One component means what the owner
 * approves is what visitors get.
 *
 * A server component — no "use client", so this ships no JavaScript. Phase 0
 * renders the body as plain text with `whitespace-pre-wrap`: blank lines and
 * indentation survive, and no markup is ever interpreted, so a literal
 * <script> in a post body appears as visible text. There is deliberately no
 * `dangerouslySetInnerHTML` here — Phase 1's Markdown pipeline is the commit
 * that introduces one, and the sanitisation question along with it.
 */
export default function PostArticle({
  title,
  publishedAt,
  body,
}: {
  title: string;
  /** ISO 8601, or null for a draft that has never been published. */
  publishedAt: string | null;
  body: string;
}) {
  return (
    <article className="pb-16">
      <header className="px-[30px] pb-5 pt-[34px]">
        <h1 className="font-pixel text-xl leading-relaxed text-ink">{title}</h1>
        <p className="mt-1.5 text-[13px] text-ink-faint">
          {publishedAt ? formatPostDate(publishedAt) : "not published yet"}
        </p>
      </header>
      <div className="max-w-[680px] whitespace-pre-wrap px-[30px] text-[15px] leading-relaxed text-ink">
        {body || (
          <span className="text-ink-faint">This post has no body yet.</span>
        )}
      </div>
    </article>
  );
}
