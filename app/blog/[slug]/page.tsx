import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { content } from "@/lib/content";
import { getPublishedPost } from "@/lib/posts";
import PostArticle from "@/components/PostArticle";

/**
 * One published post. Drafts and archived posts 404 here — the owner previews
 * a draft at /admin/blog/[id]/preview instead, because reading the session on
 * THIS page would make it dynamic and break the static-public-route invariant
 * (docs/architecture.md §13.2).
 */

/**
 * Deliberately returns an EMPTY list and queries nothing.
 *
 * Exporting this function at all is what keeps the route statically cached
 * rather than rendered per request: Next treats the presence of a
 * `generateStaticParams` export as "this route is prerenderable", and an empty
 * return means zero paths are built. So `next build` opens no database
 * connection — which .github/workflows/ci.yml depends on, since it points
 * DATABASE_URL at an unreachable placeholder on purpose. Verified in the build
 * route table: this route is `●` with no child paths listed beneath it.
 *
 * Each post's HTML is instead generated on its FIRST request and served from
 * the CDN afterwards, invalidated by the `blog` cache tag when the owner
 * publishes or edits.
 *
 * Do NOT "optimize" this by listing published slugs here. That reintroduces a
 * build-time query, coupling every Vercel deploy to Neon being reachable AND
 * to the (manually applied) migration having already landed. `dynamicParams`
 * is left at its default `true`; setting it false would 404 every post, since
 * nothing is prerendered.
 *
 * scripts/assert-static-routes.mjs fails the build if this guarantee breaks.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Shares one read with the body below via React cache() in lib/posts.ts.
  const post = await getPublishedPost(slug);
  if (!post) return { title: `not found — ${content.site.title}` };
  return {
    title: `${post.title} — ${content.site.title}`,
    description: post.excerpt,
  };
}

export default async function PostView({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();

  return (
    <PostArticle
      title={post.title}
      publishedAt={post.publishedAt}
      body={post.body}
    />
  );
}
