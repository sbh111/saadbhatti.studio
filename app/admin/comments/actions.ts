"use server";

import { revalidatePath } from "next/cache";
import { CommentStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { str } from "@/lib/http";

/**
 * Moderation actions for visitor comments.
 *
 * Server Actions on a server page, following the `loginAction` and inquiry-log
 * precedents. proxy.ts gates the page, but every action re-checks `isAdmin()`
 * as the authoritative boundary (docs/architecture.md invariant 3).
 *
 * ── Note what is NOT here: any cache tag invalidation ─────────────────────
 * `app/admin/blog/actions.ts` calls `updateTag(BLOG_CACHE_TAG)` on every post
 * write, and its absence here will look like an omission to anyone who read
 * that file first. It is not. Comments are fetched client-side and cached only
 * at the CDN by the route's own headers (lib/comments.ts explains why), so
 * they never enter the prerendered HTML that those tags invalidate. There is
 * nothing to drop — only this admin page itself needs revalidating.
 *
 * Approving a comment therefore shows up to a visitor within the comment
 * endpoint's fifteen-second shared-cache window, with no page regeneration.
 */

/**
 * Every transition is one conditional-free UPDATE by id. No status guard,
 * deliberately: all four transitions are legal from any state, and a stale
 * form re-approving an already-approved comment is a no-op rather than a
 * problem worth a round trip to find out about.
 */
async function setCommentStatus(
  formData: FormData,
  status: CommentStatus
): Promise<void> {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;

  await prisma.postComment.update({ where: { id }, data: { status } });
  revalidatePath("/admin/comments");
}

/** HELD or SPAM → PUBLISHED. The common case, and the reason this page exists. */
export async function approveCommentAction(formData: FormData) {
  return setCommentStatus(formData, CommentStatus.PUBLISHED);
}

/** PUBLISHED → HELD. Takes a comment off the post without judging it spam. */
export async function holdCommentAction(formData: FormData) {
  return setCommentStatus(formData, CommentStatus.HELD);
}

/**
 * → SPAM. Kept rather than deleted: a binned comment stays recoverable if the
 * filter was wrong, and the row is what makes the filter tunable at all —
 * the same reasoning behind `inquiries.emailStatus`.
 */
export async function markCommentSpamAction(formData: FormData) {
  return setCommentStatus(formData, CommentStatus.SPAM);
}

/**
 * Hard delete, behind a confirmation. The only irreversible action here, which
 * is why SPAM exists as a separate state — binning is the reversible default
 * and this is for genuine removal.
 */
export async function deleteCommentAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;

  await prisma.postComment.delete({ where: { id } });
  revalidatePath("/admin/comments");
}
