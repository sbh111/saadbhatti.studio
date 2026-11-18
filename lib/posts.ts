import { cache } from "react";
import { unstable_cache } from "next/cache";
import { CommentStatus, PostStatus } from "@prisma/client";
import {
  BLOG_CACHE_TAG,
  BLOG_REVALIDATE_SECONDS,
  blogPostTag,
} from "./constants";
import { prisma } from "./db";
import { isValidSlug } from "./blogLimits";
import { readingMinutes } from "./readingTime";
import { slugify } from "./slug";

/**
 * The blog's data access layer. Server-only — it imports Prisma, so it must
 * never be pulled into a client component (lib/blogLimits.ts exists to hold
 * the numbers both sides need).
 *
 * Three cooperating cache layers, deliberately mirroring the catalog's
 * (docs/system-overview.md §2) so this codebase has ONE caching mental model
 * rather than two:
 *
 *   1. Data cache  — `unstable_cache`, tagged, so Postgres is read once per
 *                    revalidation window instead of once per request.
 *   2. Route cache — the hourly `revalidate` inherited from app/layout.tsx.
 *   3. Per render  — React `cache()`, so a page whose `generateMetadata` and
 *                    body both need the post reads it once.
 *
 * `unstable_cache` rather than the newer `"use cache"` directive: that one
 * requires `cacheComponents: true` in next.config.ts, an app-WIDE change to
 * how every route caches, which is not something a blog feature should drag in.
 *
 * ── The build must never need a database ──────────────────────────────────
 * .github/workflows/ci.yml points DATABASE_URL at an unreachable placeholder
 * on purpose, and lib/db.ts connects lazily so `next build` succeeds with no
 * database at all. Keeping that true is what `listPublishedPosts`'s degraded
 * return value and app/blog/[slug]'s empty `generateStaticParams` are for.
 * See docs/architecture.md §13.2.
 *
 * ── Dates are ISO strings, not Date objects ───────────────────────────────
 * Values crossing Next's data cache are serialized, so a `Date` is not
 * guaranteed to survive the round trip as a `Date`. Everything cached here
 * carries `publishedAt` as an ISO string instead of relying on that;
 * components/LocalTime.tsx accepts either. The uncached admin reads below
 * keep Prisma's own `Date`s.
 */

/**
 * A post's cover image, flattened from the four nullable `cover*` columns into
 * one value that is either present or absent. Callers then ask one question
 * ("is there a cover?") instead of four, and cannot render a publicId with a
 * missing alt by accident.
 */
export interface PostCover {
  /** Cloudinary public_id under `blog/` — never a delivery URL. */
  publicId: string;
  /** "" is meaningful: a deliberately decorative cover. */
  alt: string;
  /** Intrinsic pixels, for reserving the aspect ratio. Null on older rows. */
  width: number | null;
  height: number | null;
}

/** One row of the public index. */
export interface PostCard {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO 8601 — see the serialization note above. */
  publishedAt: string;
  /**
   * Derived from the body at read time, NOT stored — see the note on
   * `readPublishedPosts` for why the index pays to read bodies it does not
   * render, and when that stops being the right trade.
   */
  readingMinutes: number;
  cover: PostCover | null;
  /**
   * Published comments only. Derived, like reading time — and read on the
   * SERVER here rather than client-side as the like count is, because a
   * comment count is not per-visitor data and so does not need the treatment
   * invariant 2(c) prescribes.
   *
   * It therefore inherits the index's hourly cache: a new comment shows up in
   * this number within the revalidation window, or immediately if the owner
   * edits the post. That staleness is fine for a teaser on a list — the post
   * page itself counts the comments it has actually loaded.
   *
   * Like counts are deliberately NOT here. They would have to be fetched
   * client-side (the "have I liked this" state is per-visitor and shares the
   * request), and that is the post page's job.
   */
  commentCount: number;
}

/** One public post. `body` is Markdown as of Phase 1 (see lib/markdown.ts). */
export interface PostDetail extends PostCard {
  body: string;
}

/** The four `cover*` columns as one present-or-absent value. */
function coverFrom(row: {
  coverPublicId: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
}): PostCover | null {
  if (!row.coverPublicId) return null;
  return {
    publicId: row.coverPublicId,
    alt: row.coverAlt ?? "",
    width: row.coverWidth,
    height: row.coverHeight,
  };
}

/**
 * `degraded` is true when the database could not be reached. The index
 * renders an explanatory note rather than an empty blog, and — because the
 * failure is caught OUTSIDE the cache — nothing stores the empty result, so
 * the next request retries instead of serving emptiness for an hour.
 */
export interface PostListResult {
  posts: PostCard[];
  degraded: boolean;
}

const readPublishedPosts = unstable_cache(
  async (): Promise<PostCard[]> => {
    const rows = await prisma.post.findMany({
      // `publishedAt: not null` is belt-and-braces: publishPostAction always
      // sets it, so this only excludes a row published by hand in psql or
      // Prisma Studio without a date. Omitting such a row is a safer failure
      // than rendering an undated post or crashing on a null.
      where: { status: PostStatus.PUBLISHED, publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      select: {
        slug: true,
        title: true,
        excerpt: true,
        publishedAt: true,
        coverPublicId: true,
        coverAlt: true,
        coverWidth: true,
        coverHeight: true,
        // One filtered relation count rather than a second query. Verified
        // against the real database — filtered `_count` is supported in the
        // installed Prisma 6.19 — and it costs one more aggregate per
        // revalidation window, not per request.
        _count: { select: { comments: { where: { status: CommentStatus.PUBLISHED } } } },
        // Read, used to count words, and then DISCARDED — the body never
        // reaches the cached value or the index's HTML.
        //
        // The alternative is a stored `readingMinutes` column, recomputed on
        // every save. That was rejected: it is a denormalisation that can
        // drift (a row edited in psql or Prisma Studio keeps a stale number)
        // in exchange for I/O this site does not notice. Bodies are TOASTed
        // out-of-line, this query runs ONCE per hour behind the data cache,
        // and the blog has single digits of posts.
        //
        // Revisit at roughly a hundred published posts, or if bodies grow
        // towards the 60 kB cap: a few megabytes per revalidation is the point
        // at which the column earns its drift risk. Reading `body` here is the
        // one thing in this file that scales with content rather than traffic.
        body: true,
      },
    });
    return rows.flatMap(({ body, _count, ...row }) =>
      row.publishedAt
        ? [
            {
              slug: row.slug,
              title: row.title,
              excerpt: row.excerpt,
              publishedAt: row.publishedAt.toISOString(),
              readingMinutes: readingMinutes(body),
              cover: coverFrom(row),
              commentCount: _count.comments,
            },
          ]
        : []
    );
  },
  ["blog:list"],
  { revalidate: BLOG_REVALIDATE_SECONDS, tags: [BLOG_CACHE_TAG] }
);

/**
 * Every published post, newest first, for the public index.
 *
 * DEGRADES on a database failure — the opposite of `getPublishedPost` below,
 * and the asymmetry is deliberate. `/blog` is a static route that Next
 * prerenders at build time, so a throw here would fail `next build` outright
 * and couple every deploy to Neon's availability (and to the manually applied
 * migration having landed first). Returning an empty, flagged result keeps the
 * build green and self-heals on the next revalidation — the same call
 * app/layout.tsx makes for a Cloudinary outage (tech debt 1.4).
 */
export const listPublishedPosts = cache(async (): Promise<PostListResult> => {
  try {
    return { posts: await readPublishedPosts(), degraded: false };
  } catch (err) {
    // Never the connection string or any row contents — just enough to know
    // which subsystem degraded and why.
    console.error(
      "[blog] post list unavailable:",
      err instanceof Error ? err.message : err
    );
    return { posts: [], degraded: true };
  }
});

const readPublishedPost = (slug: string) =>
  unstable_cache(
    async (): Promise<PostDetail | null> => {
      const row = await prisma.post.findFirst({
        where: {
          slug,
          status: PostStatus.PUBLISHED,
          publishedAt: { not: null },
        },
        select: {
          slug: true,
          title: true,
          excerpt: true,
          body: true,
          publishedAt: true,
          coverPublicId: true,
          coverAlt: true,
          coverWidth: true,
          coverHeight: true,
        },
      });
      if (!row?.publishedAt) return null;
      return {
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        body: row.body,
        publishedAt: row.publishedAt.toISOString(),
        readingMinutes: readingMinutes(row.body),
        cover: coverFrom(row),
        // Not used by the post page — CommentThread counts what it loaded, so
        // the number a reader sees is never stale. Present only because
        // PostDetail extends PostCard.
        commentCount: 0,
      };
    },
    ["blog:post", slug],
    {
      revalidate: BLOG_REVALIDATE_SECONDS,
      // Both tags: the per-post one so editing one post doesn't restage every
      // other post's HTML, and the broad one so a publish/unpublish that
      // changes the index invalidates this page too.
      tags: [BLOG_CACHE_TAG, blogPostTag(slug)],
    }
  )();

/**
 * One published post, or null if it does not exist, is still a draft, or has
 * been archived.
 *
 * RE-THROWS on a database failure — deliberately NOT the degrade-to-null that
 * `listPublishedPosts` does. Returning null here would make the page call
 * `notFound()`, and Next would then cache that 404 for a post that really
 * exists. A thrown error is not cached, so ISR keeps serving the last good
 * HTML and only a genuinely cold path 500s. These two opposite behaviours are
 * the single most likely thing in this file for someone to "fix" into a bug.
 */
export const getPublishedPost = cache(
  async (slug: string): Promise<PostDetail | null> => {
    // Checked BEFORE the cached read, so a garbage /blog/<junk> path costs
    // neither a database round trip nor a new entry in the data cache.
    if (!isValidSlug(slug)) return null;
    return readPublishedPost(slug);
  }
);

// ─── Admin reads ───────────────────────────────────────────────────────────
// Uncached on purpose: every /admin page is `force-dynamic` and must show the
// owner what is actually in the database right now, including drafts. These
// also keep Prisma's own `Date` objects, since nothing serializes them.

/** Every post in a given state (or all of them), most recently edited first. */
export async function listAllPosts(status?: PostStatus) {
  return prisma.post.findMany({
    where: status ? { status } : undefined,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
}

/** Per-status totals, for the admin filter's counts. */
export async function countPostsByStatus(): Promise<
  Record<PostStatus, number>
> {
  const groups = await prisma.post.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const counts: Record<PostStatus, number> = {
    [PostStatus.DRAFT]: 0,
    [PostStatus.PUBLISHED]: 0,
    [PostStatus.ARCHIVED]: 0,
  };
  for (const group of groups) counts[group.status] = group._count.status;
  return counts;
}

/** One post by id, drafts included — the editor's read. */
export async function getPostById(id: string) {
  return prisma.post.findUnique({ where: { id } });
}

/**
 * A slug that is free, derived from the title.
 *
 * The slug is a permanent public contract, so collisions resolve by suffixing
 * `-2`, `-3`, … rather than by mutating an existing post's URL.
 * `disambiguateSlugs` in lib/slug.ts solves the artwork version of this
 * problem, but it ranks by Cloudinary `public_id` across one collection; posts
 * need "first one to claim it keeps it", which is a different rule.
 *
 * `excludeId` lets a draft keep its own slug when its title is re-saved
 * unchanged. The unique constraint in the database remains the real guarantee
 * — two concurrent creates could both pass this check, which is why
 * createPostAction handles P2002.
 */
export async function uniqueSlugFor(
  title: string,
  excludeId?: string
): Promise<string> {
  // A title of only punctuation or non-Latin characters slugifies to "" —
  // fall back rather than generating an empty, invalid URL.
  const base = slugify(title) || "post";
  const taken = new Set(
    (
      await prisma.post.findMany({
        where: {
          slug: { startsWith: base },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { slug: true },
      })
    ).map((row) => row.slug)
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
