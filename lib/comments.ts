import { CommentStatus } from "@prisma/client";
import { prisma } from "./db";

/**
 * Comment reads — the public list, and the moderation queue.
 *
 * Server-only (it imports Prisma). None of these go through Next's data cache:
 * the public list is fetched client-side and cached at the CDN by the route's
 * headers, for the reasons `lib/engagement.ts` sets out. The upshot is worth
 * stating out loud, because it is the opposite of what a reader familiar with
 * `lib/posts.ts` will expect:
 *
 *   **No comment path ever calls `updateTag` or `revalidateTag`.**
 *
 * Nothing a visitor writes enters cached HTML, so there is nothing to
 * invalidate — and the route-handler-versus-Server-Action trap (`updateTag`
 * throws outside a Server Action) simply never arises. That is a property of
 * the design, not an oversight. Do not "fix" it by adding one.
 */

/** One comment as a visitor may see it. */
export interface PublicComment {
  id: string;
  authorName: string;
  body: string;
  /** ISO 8601 — components/LocalTime.tsx accepts either, but a string travels. */
  createdAt: string;
  /** Renders the owner's badge. */
  isOwner: boolean;
}

/** How many comments one public request returns. */
export const COMMENT_PAGE_SIZE = 50;

/**
 * Published comments on a post, oldest first.
 *
 * Oldest-first because a conversation reads that way — and the index
 * (`postId, status, createdAt`) is declared ascending to match, so this is an
 * index scan with no sort step.
 *
 * The projection is deliberately narrow and must stay that way: **never
 * `ipHash`, never `status`, never `spamReason`.** A held comment is absent
 * from the response, not flagged within it, and the reason a comment was held
 * must never reach the person who wrote it — it tells a spammer exactly which
 * rule to route around.
 */
export async function listPublishedComments(
  postId: string
): Promise<PublicComment[]> {
  const rows = await prisma.postComment.findMany({
    where: { postId, status: CommentStatus.PUBLISHED },
    orderBy: { createdAt: "asc" },
    take: COMMENT_PAGE_SIZE,
    select: {
      id: true,
      authorName: true,
      body: true,
      createdAt: true,
      isOwner: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ─── Admin reads ────────────────────────────────────────────────────────────
// Uncached on purpose: every /admin page is force-dynamic and must show what
// is actually in the database right now, held and binned comments included.

/** How many rows one page of the moderation queue shows. */
export const MODERATION_PAGE_SIZE = 50;

/**
 * One page of comments in a given state, newest first — the moderation queue
 * reads newest-first even though the public list reads oldest-first, because
 * this is a work queue rather than a conversation.
 *
 * Paginated from the first commit. `inquiries` had to be retrofitted for this
 * (tech debt 2.7) after shipping with a hard 200-row ceiling, and the lesson
 * was cheap to learn once.
 *
 * `WHERE status = ?` is a deliberate sequential scan — there is no index on
 * `status`, the same call `docs/schema-design.md` §4 records for
 * `inquiries.emailStatus`. An index must serve a real access pattern, and an
 * admin page reading one page of a small table is not one.
 */
export async function listCommentsForModeration(
  status: CommentStatus | undefined,
  page: number
) {
  return prisma.postComment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * MODERATION_PAGE_SIZE,
    take: MODERATION_PAGE_SIZE,
    select: {
      id: true,
      authorName: true,
      body: true,
      status: true,
      isOwner: true,
      spamReason: true,
      createdAt: true,
      post: { select: { slug: true, title: true } },
    },
  });
}

/** Per-status totals, for the queue's tab counts and its pager. */
export async function countCommentsByStatus(): Promise<
  Record<CommentStatus, number>
> {
  const groups = await prisma.postComment.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const counts: Record<CommentStatus, number> = {
    [CommentStatus.PUBLISHED]: 0,
    [CommentStatus.HELD]: 0,
    [CommentStatus.SPAM]: 0,
  };
  for (const group of groups) counts[group.status] = group._count.status;
  return counts;
}
