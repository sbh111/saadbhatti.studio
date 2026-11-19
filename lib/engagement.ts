import { cache } from "react";
import { unstable_cache } from "next/cache";
import { PostStatus, CommentStatus } from "@prisma/client";
import { isValidSlug } from "./blogLimits";
import {
  BLOG_CACHE_TAG,
  BLOG_REVALIDATE_SECONDS,
  blogPostTag,
} from "./constants";
import { prisma } from "./db";

/**
 * The shared read surface behind blog likes and comments.
 *
 * Two jobs, with deliberately opposite caching:
 *
 *   `resolvePublishedPostId` IS cached in Next's data cache. It answers a
 *   question that only changes when the owner publishes something, and every
 *   public write path calls it, so caching it means a like or comment on a
 *   garbage slug costs no database round trip at all.
 *
 *   `countEngagement` is NOT cached there, on purpose. See below — this is the
 *   decision the whole public-counts design turns on.
 */

/**
 * The post id for a published slug, or null.
 *
 * Reuses `BLOG_REVALIDATE_SECONDS` rather than picking a shorter window, and
 * that is not laziness: `lib/constants.ts` records that Next clamps a route's
 * ISR window to the MINIMUM revalidate anything in the render touched, so a
 * shorter value here could silently drag `/blog` and `/blog/[slug]` down with
 * it. Tagged with both the broad and per-post tags, so the admin lifecycle
 * actions already invalidate it via `updateTag` — publishing a post makes it
 * likeable immediately rather than within the hour.
 */
const readPublishedPostId = (slug: string) =>
  unstable_cache(
    async (): Promise<string | null> => {
      const row = await prisma.post.findFirst({
        where: {
          slug,
          status: PostStatus.PUBLISHED,
          publishedAt: { not: null },
        },
        select: { id: true },
      });
      return row?.id ?? null;
    },
    ["blog:slugid", slug],
    {
      revalidate: BLOG_REVALIDATE_SECONDS,
      tags: [BLOG_CACHE_TAG, blogPostTag(slug)],
    }
  )();

/**
 * Resolve a visitor-supplied slug to a post id, server-side.
 *
 * This is the "server-resolved snapshot" rule applied to the blog: a request
 * body carries a SLUG, never a post id. The slug is the public contract, while
 * a post id is interpolated into a signed Cloudinary folder path (invariant
 * 15) — handing a visitor a reason to send one is handing them a reason to
 * probe it.
 *
 * Re-THROWS on a database failure rather than returning null, matching
 * `getPublishedPost`. A null here would be read as "no such post" and reject a
 * legitimate like with a 400; the caller turns a throw into a 503 instead,
 * which is the honest answer.
 */
export const resolvePublishedPostId = cache(
  async (slug: string): Promise<string | null> => {
    // Before the cached read, so a junk slug mints no cache key — the same
    // guard placement as `getPublishedPost`.
    if (!isValidSlug(slug)) return null;
    return readPublishedPostId(slug);
  }
);

export interface EngagementCounts {
  likes: number;
  comments: number;
}

/** How many slugs one request may ask about. */
export const ENGAGEMENT_SLUG_MAX = 20;

/**
 * Public like and comment counts for a batch of slugs.
 *
 * ── Why this is NOT in Next's data cache ──────────────────────────────────
 * Two reasons, both structural rather than preference:
 *
 *   1. It must not be tagged `blog`. If it were, editing any post would drop
 *      the counts, and — worse — the only way to refresh counts after a like
 *      would be `revalidateTag`, which means one visitor's click restages the
 *      HTML of `/blog` and every post page. That is a publicly reachable
 *      1-request-to-N-regenerations amplifier sitting behind a rate limiter
 *      that fails open.
 *   2. It must not carry a `revalidate`. A short window here would clamp the
 *      ISR window of any route that touched it, per the note in
 *      lib/constants.ts.
 *
 * So counts are cached at the CDN instead, by the route's `Cache-Control`, and
 * never inside a page render. `docs/architecture.md` invariant 2(c) already
 * prescribes the client fetch; this is why it is also the right answer on
 * mechanical grounds and not just invariant-compliance.
 *
 * Unknown, unpublished and misspelled slugs are simply ABSENT from the result
 * — never zero, never an error. A caller cannot use this to discover whether a
 * draft exists, and a missing entry renders as no count rather than as "nobody
 * liked this".
 */
export async function countEngagement(
  slugs: string[]
): Promise<Record<string, EngagementCounts>> {
  const wanted = [...new Set(slugs.filter(isValidSlug))].slice(
    0,
    ENGAGEMENT_SLUG_MAX
  );
  if (wanted.length === 0) return {};

  const rows = await prisma.post.findMany({
    where: {
      slug: { in: wanted },
      status: PostStatus.PUBLISHED,
      publishedAt: { not: null },
    },
    select: {
      slug: true,
      _count: {
        select: {
          likes: true,
          // Only PUBLISHED comments are counted, so a held or binned comment
          // never shows up as a number a visitor can see. Filtered relation
          // counts are supported in the installed Prisma 6.19 — verified
          // against the real database, not assumed.
          comments: { where: { status: CommentStatus.PUBLISHED } },
        },
      },
    },
  });

  const counts: Record<string, EngagementCounts> = {};
  for (const row of rows) {
    counts[row.slug] = {
      likes: row._count.likes,
      comments: row._count.comments,
    };
  }
  return counts;
}
