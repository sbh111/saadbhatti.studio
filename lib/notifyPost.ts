import { NotifyStatus, SubscriberStatus } from "@prisma/client";
import { imageUrl } from "./cloudinary";
import { prisma } from "./db";
import { addContact, createBroadcast, isSegmentConfigured, sendBroadcast } from "./resendSegment";
import { NOTIFY_SUBSCRIBERS_KEY, getBooleanSetting } from "./settings";
import { buildPostBroadcast } from "./subscribeMail";
import { postUrl } from "./urls";

/**
 * Emailing subscribers when a post is published.
 *
 * Split out of `publishPostAction` because it is the only genuinely
 * irreversible thing this application does — a sent email cannot be unsent —
 * and because the claim/send split is subtle enough that it deserves to be
 * readable on its own.
 */

/**
 * Claim the right to notify, atomically.
 *
 * `updateMany` with `notifyStatus: NOT_SENT` in the WHERE clause, checking
 * that exactly one row changed. **Never a read-then-write**: two concurrent
 * publishes (a double-clicked button, a retried form submission) would both
 * see NOT_SENT on a read and both proceed, which is precisely the double send
 * this exists to prevent. Postgres resolves the conditional update for us.
 *
 * Unpublish, archive and restore deliberately do not reset `notifyStatus`, so
 * a re-publish finds it already claimed and this returns false.
 *
 * @returns true if THIS caller owns the send.
 */
export async function claimNotify(postId: string): Promise<boolean> {
  const { count } = await prisma.post.updateMany({
    where: { id: postId, notifyStatus: NotifyStatus.NOT_SENT },
    data: {
      notifyStatus: NotifyStatus.SENDING,
      // When the send was CLAIMED. Nothing reads it as a delivery time.
      notifiedAt: new Date(),
    },
  });
  return count === 1;
}

async function record(
  postId: string,
  status: NotifyStatus,
  error?: string
): Promise<void> {
  await prisma.post
    .update({
      where: { id: postId },
      // Truncated to the column width, the `inquiries.emailError` convention.
      data: { notifyStatus: status, notifyError: error?.slice(0, 500) ?? null },
    })
    .catch(() => {});
}

/**
 * Create and send the broadcast for a post whose send has already been
 * claimed. Call this inside `after()`.
 *
 * Never throws: every outcome is written to `notifyStatus` instead, because
 * this runs after the response has been flushed and there is nobody left to
 * throw to. The owner reads the outcome in the admin list.
 *
 * SKIPPED rather than FAILED when there is nothing to do — no Resend config,
 * or nobody confirmed. The distinction matters because FAILED is worth
 * retrying by hand and SKIPPED usually is not.
 */
export async function notifySubscribers(post: {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverPublicId: string | null;
  notifyBroadcastId: string | null;
}): Promise<void> {
  try {
    if (!(await getBooleanSetting(NOTIFY_SUBSCRIBERS_KEY, true))) {
      await record(post.id, NotifyStatus.SKIPPED, "notifications turned off");
      return;
    }

    if (!isSegmentConfigured()) {
      await record(
        post.id,
        NotifyStatus.SKIPPED,
        "RESEND_API_KEY or RESEND_SEGMENT_ID not set"
      );
      return;
    }

    // Nobody to mail. Checked against Postgres rather than Resend because
    // Postgres is the consent record — and because a broadcast to an empty
    // segment is an error from Resend rather than a no-op.
    const confirmed = await prisma.subscriber.count({
      where: { status: SubscriberStatus.CONFIRMED },
    });
    if (confirmed === 0) {
      await record(post.id, NotifyStatus.SKIPPED, "no confirmed subscribers");
      return;
    }

    // Heal drift before sending: a CONFIRMED row with no Resend contact never
    // made it into the segment and would silently miss this broadcast. Doing
    // it here means every publish repairs the class automatically, rather than
    // waiting for someone to notice the admin panel.
    const missing = await prisma.subscriber.findMany({
      where: {
        status: SubscriberStatus.CONFIRMED,
        resendContactId: null,
      },
      select: { id: true, email: true },
      take: 100,
    });
    for (const row of missing) {
      const added = await addContact(row.email);
      if (added.ok) {
        await prisma.subscriber
          .update({
            where: { id: row.id },
            data: { resendContactId: added.value },
          })
          .catch(() => {});
      }
    }

    const from = process.env.BLOG_NOTIFY_FROM;
    if (!from) {
      await record(post.id, NotifyStatus.SKIPPED, "BLOG_NOTIFY_FROM not set");
      return;
    }

    // Reuse an existing draft if one is here from a failed attempt. This is
    // the whole reason the id is stored: Resend's API is create-then-send, so
    // creating again would produce a SECOND broadcast and mail everyone twice.
    let broadcastId = post.notifyBroadcastId;
    if (!broadcastId) {
      const created = await createBroadcast(
        buildPostBroadcast({
          title: post.title,
          excerpt: post.excerpt,
          url: postUrl(post.slug),
          coverUrl: post.coverPublicId
            ? imageUrl(post.coverPublicId, 600)
            : null,
        }),
        from
      );
      if (!created.ok) {
        await record(post.id, NotifyStatus.FAILED, created.reason);
        return;
      }
      broadcastId = created.value;
      // Stored IMMEDIATELY, before the send is attempted — the window between
      // these two calls is exactly where a dying function would otherwise
      // lose the id.
      await prisma.post
        .update({
          where: { id: post.id },
          data: { notifyBroadcastId: broadcastId },
        })
        .catch(() => {});
    }

    const sent = await sendBroadcast(broadcastId);
    if (!sent.ok) {
      await record(post.id, NotifyStatus.FAILED, sent.reason);
      return;
    }

    await record(post.id, NotifyStatus.SENT);
  } catch (err) {
    // Leaves the post FAILED rather than stuck in SENDING, so the admin list
    // shows something actionable.
    await record(
      post.id,
      NotifyStatus.FAILED,
      err instanceof Error ? err.message : "unknown error"
    );
  }
}
