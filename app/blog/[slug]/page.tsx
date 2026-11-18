import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ogCoverImage } from "@/lib/cloudinary";
import { content } from "@/lib/content";
import { getPublishedPost } from "@/lib/posts";
import { blogHref, postUrl } from "@/lib/urls";
import CommentThread from "@/components/CommentThread";
import PostArticle from "@/components/PostArticle";
import PostLikeButton from "@/components/PostLikeButton";
import SharePost from "@/components/SharePost";

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

  // Open Graph is a hard prerequisite for the share controls, not polish.
  // LinkedIn ignores the title and summary parameters on its own share URL
  // entirely and scrapes these tags; Facebook and X do the same. Shipping a
  // share button without them produces a bare grey card.
  //
  // `openGraph` REPLACES the root layout's object rather than merging field by
  // field, so the hero-image fallback has to be explicit here — omitting
  // `images` would leave a post with no card image at all rather than
  // inheriting the site's.
  const cover = post.cover
    ? ogCoverImage(post.cover.publicId, post.cover.width, post.cover.height)
    : null;
  const images = cover
    ? [{ ...cover, alt: post.cover?.alt || post.title }]
    : [
        content.site.heroImage.startsWith("/")
          ? content.site.heroImage
          : ogCoverImage(content.site.heroImage, 1200, 800)?.url ??
            content.site.heroImage,
      ];

  return {
    title: `${post.title} — ${content.site.title}`,
    description: post.excerpt,
    // metadataBase is set in app/layout.tsx, so a relative path resolves.
    alternates: { canonical: postUrl(slug) },
    openGraph: {
      type: "article",
      url: postUrl(slug),
      siteName: content.site.title,
      title: post.title,
      description: post.excerpt,
      publishedTime: post.publishedAt,
      images,
    },
    twitter: {
      // Requires an image to actually render large; the fallback above is what
      // guarantees there always is one.
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
    },
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

  // Engagement is composed AROUND PostArticle, never into it. PostArticle is
  // shared with the admin draft preview (app/admin/blog/[id]/preview), and a
  // draft has no public URL to share, no published post to like, and no
  // comments. Putting these inside would break the preview — or, worse, make
  // it quietly lie about what a visitor sees.
  return (
    <>
      <PostArticle
        title={post.title}
        publishedAt={post.publishedAt}
        body={post.body}
        readingMinutes={post.readingMinutes}
        cover={post.cover}
        backHref={blogHref()}
      />

      <div className="mx-auto max-w-[680px] px-[30px] pb-8">
        <PostLikeButton slug={post.slug} />
      </div>

      <SharePost url={postUrl(post.slug)} title={post.title} />

      <CommentThread slug={post.slug} />
    </>
  );
}
