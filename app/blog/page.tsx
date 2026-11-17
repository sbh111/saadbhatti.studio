import type { Metadata } from "next";
import Link from "next/link";
import { imageUrl } from "@/lib/cloudinary";
import { content } from "@/lib/content";
import { formatPostDate } from "@/lib/postDate";
import { listPublishedPosts } from "@/lib/posts";
import { postHref } from "@/lib/urls";

/**
 * The blog index — every published post, newest first.
 *
 * Static like every other public route, inheriting `revalidate = 3600` from
 * the root layout. It DOES read Postgres, which the catalog pages never do;
 * that is the amendment to docs/architecture.md §13.2, and it is safe because
 * the read is cached (lib/posts.ts) and degrades instead of throwing, so
 * `next build` never depends on the database being reachable.
 */

export const metadata: Metadata = {
  title: `blog — ${content.site.title}`,
};

export default async function BlogIndex() {
  const { posts, degraded } = await listPublishedPosts();

  const label = degraded
    ? "temporarily unavailable"
    : posts.length === 1
      ? "1 post"
      : `${posts.length} posts`;

  return (
    // Centred to the same 680px measure as a post (components/PostArticle.tsx),
    // so moving from the index into a post does not shift the column.
    <div className="mx-auto max-w-[680px] pb-10">
      <header className="px-[30px] pb-5 pt-[34px]">
        <h1 className="font-pixel text-xl leading-relaxed text-ink">blog</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">{label}</p>
      </header>

      {/* A database outage must not look like an empty blog. The read already
          returned a flag rather than throwing (see lib/posts.ts) so the page
          renders and self-heals on the next revalidation. */}
      {degraded && (
        <p className="px-[30px] text-[15px] text-steel">
          Couldn&apos;t reach the database just now — this list will fill in
          shortly.
        </p>
      )}

      {!degraded && posts.length === 0 && (
        <p className="px-[30px] text-[15px] text-ink-muted">
          Nothing published yet.
        </p>
      )}

      <ul className="px-[30px]">
        {posts.map((post) => (
          <li key={post.slug} className="border-t border-ink-faint/20">
            <Link
              href={postHref(post.slug)}
              className="flex gap-4 py-4 hover:bg-nav-active/50"
            >
              {post.cover && (
                // alt="" on purpose: the card's own title is the link text, so
                // a described thumbnail would make a screen reader announce
                // the same post twice. The cover's real alt text belongs on
                // the post page, where the image is content rather than
                // decoration.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(post.cover.publicId, 320)}
                  alt=""
                  width={120}
                  height={80}
                  loading="lazy"
                  decoding="async"
                  className="h-[80px] w-[120px] shrink-0 rounded-[2px] border border-hairline bg-placeholder object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="text-lg font-medium text-ink">{post.title}</div>
                <div className="mt-0.5 text-[13px] text-ink-faint">
                  {formatPostDate(post.publishedAt)}
                  {post.readingMinutes > 0 &&
                    ` · ${post.readingMinutes} min read`}
                </div>
                <p className="mt-1.5 text-[15px] text-ink-muted">
                  {post.excerpt}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
