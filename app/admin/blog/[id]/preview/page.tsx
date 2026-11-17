import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { content } from "@/lib/content";
import { getPostById } from "@/lib/posts";
import PostArticle from "@/components/PostArticle";

/**
 * Draft preview, admin-only.
 *
 * This route exists so that /blog/[slug] never has to. Letting the public post
 * page render drafts for a logged-in owner would mean reading the session
 * there, which makes the route dynamic and breaks the static-public-route
 * invariant (docs/architecture.md §13.2) — the whole blog would stop being
 * CDN-cacheable to serve one person. A `force-dynamic` admin route rendering
 * the SAME PostArticle component costs nothing architecturally and cannot
 * drift from what visitors see.
 */

export const metadata: Metadata = {
  title: `preview - ${content.site.title}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function PreviewPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { id } = await params;
  const post = await getPostById(id);
  if (!post) notFound();

  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-hairline bg-panel px-[30px] py-2">
        <span className="font-pixel text-[10px] text-steel">
          PREVIEW · {post.status}
        </span>
        <Link
          href={`/admin/blog/${post.id}`}
          className="text-[13px] text-ink-faint hover:text-steel"
        >
          ← back to editor
        </Link>
      </div>
      <PostArticle
        title={post.title}
        publishedAt={post.publishedAt ? post.publishedAt.toISOString() : null}
        body={post.body}
      />
    </div>
  );
}
