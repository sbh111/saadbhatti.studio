import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PostStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { content } from "@/lib/content";
import { countPostsByStatus, listAllPosts } from "@/lib/posts";
import { postHref } from "@/lib/urls";
import LocalTime from "@/components/LocalTime";
import { createPostAction } from "./actions";

export const metadata: Metadata = {
  title: `blog - ${content.site.title}`,
  robots: { index: false },
};

// Reads the session and the database on every request, and must show drafts.
// Nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * The filter is a URL parameter rather than client state, so a view is
 * bookmarkable and survives a refresh — the same reasoning the comment log's
 * `?page=` records. An unrecognised value falls back to "all" instead of
 * erroring on a hand-edited URL.
 */
const FILTERS = {
  all: undefined,
  draft: PostStatus.DRAFT,
  published: PostStatus.PUBLISHED,
  archived: PostStatus.ARCHIVED,
} as const;

type FilterKey = keyof typeof FILTERS;

function parseFilter(raw: string | undefined): FilterKey {
  return raw && raw in FILTERS ? (raw as FilterKey) : "all";
}

const ERRORS: Record<string, string> = {
  title: "A title is required.",
  slug: "That slug is not a valid URL fragment.",
  missing: "That post no longer exists.",
};

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { status: rawStatus, error } = await searchParams;
  const filter = parseFilter(rawStatus);

  const [posts, counts] = await Promise.all([
    listAllPosts(FILTERS[filter]),
    countPostsByStatus(),
  ]);
  const total =
    counts.DRAFT + counts.PUBLISHED + counts.ARCHIVED;

  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "all", count: total },
    { key: "draft", label: "drafts", count: counts.DRAFT },
    { key: "published", label: "published", count: counts.PUBLISHED },
    { key: "archived", label: "archived", count: counts.ARCHIVED },
  ];

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">blog</h1>

      {error && ERRORS[error] && (
        <p className="mt-2 text-[13px] text-steel">{ERRORS[error]}</p>
      )}

      <form action={createPostAction} className="mt-4 flex gap-2">
        <input
          type="text"
          name="title"
          required
          placeholder="New post title"
          className="grow rounded-[2px] border border-hairline bg-panel px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint"
        />
        <button
          type="submit"
          className="rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink-muted hover:text-steel"
        >
          new draft
        </button>
      </form>

      <nav className="mt-6 flex gap-4 border-b border-hairline pb-2 text-[13px]">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/blog?status=${tab.key}`}
            className={
              tab.key === filter
                ? "text-ink"
                : "text-ink-faint hover:text-steel"
            }
          >
            {tab.label} ({tab.count})
          </Link>
        ))}
      </nav>

      {posts.length === 0 ? (
        <p className="mt-6 text-[13px] text-ink-faint">
          {total === 0 ? "No posts yet." : `No ${filter} posts.`}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {posts.map((post) => (
            <li
              key={post.id}
              className="rounded-[2px] border border-hairline bg-panel p-3"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-pixel text-[10px] text-steel">
                  {post.status}
                </span>
                <Link
                  href={`/admin/blog/${post.id}`}
                  className="truncate text-[15px] font-medium text-ink hover:text-steel"
                >
                  {post.title}
                </Link>
              </div>
              <div className="mt-0.5 text-[13px] text-ink-muted">
                /{post.slug} · edited <LocalTime date={post.updatedAt} />
                {post.status === PostStatus.PUBLISHED && (
                  <>
                    {" · "}
                    <Link
                      href={postHref(post.slug)}
                      className="hover:text-steel"
                    >
                      view
                    </Link>
                  </>
                )}
              </div>
              {post.excerpt && (
                <p className="mt-1 text-[13px] text-ink-faint">
                  {post.excerpt}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
