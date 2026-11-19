import { type NextRequest, NextResponse } from "next/server";
import { CommentStatus } from "@prisma/client";
import { checkComment } from "@/lib/akismet";
import { isAdmin } from "@/lib/auth";
import { isValidSlug } from "@/lib/blogLimits";
import { screenComment } from "@/lib/commentHeuristics";
import {
  COMMENT_BODY_BYTES_MAX,
  COMMENT_RATE_MAX,
  COMMENT_RATE_WINDOW_MS,
  isValidCommentInput,
} from "@/lib/commentLimits";
import { listPublishedComments } from "@/lib/comments";
import { prisma } from "@/lib/db";
import { resolvePublishedPostId } from "@/lib/engagement";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import {
  busy,
  invalid,
  rateLimited,
  readCappedText,
  str,
  unavailable,
} from "@/lib/http";
import {
  BLOG_COMMENT_GLOBAL_MAX,
  BLOG_COMMENT_GLOBAL_WINDOW_MS,
  BLOG_READ_MAX,
  BLOG_READ_WINDOW_MS,
  isRateLimited,
} from "@/lib/rateLimit";
import {
  COMMENTS_ENABLED_KEY,
  COMMENT_AUTO_PUBLISH_KEY,
  getBooleanSetting,
} from "@/lib/settings";
import { postUrl } from "@/lib/urls";

/**
 * Visitor comments on a post: read the published ones, submit a new one.
 *
 * Public, so NOT under /api/admin/ — proxy.ts would 401 every visitor.
 *
 * ── Neither handler invalidates any cache ─────────────────────────────────
 * Comments are fetched client-side and cached at the CDN by the headers below,
 * never baked into prerendered HTML. So nothing here calls `updateTag` (which
 * would throw — it is Server-Action-only) or `revalidateTag`. That is the
 * design working, not a missing line: a visitor write can never trigger an ISR
 * regeneration, which is a publicly reachable amplifier this route therefore
 * does not have. See lib/comments.ts.
 */

export const dynamic = "force-dynamic";

/* ────────────────────────────── GET ────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const slug = str(request.nextUrl.searchParams.get("slug"));
  if (!isValidSlug(slug)) return invalid();

  const ipHash = hashIp(clientIpOf(request));
  if (
    await isRateLimited("blog_read", ipHash, BLOG_READ_MAX, BLOG_READ_WINDOW_MS)
  ) {
    return rateLimited();
  }

  try {
    const postId = await resolvePublishedPostId(slug);
    // An unpublished or unknown slug returns an empty list, not a 404: this
    // endpoint must not become an existence oracle for drafts.
    if (!postId) {
      return NextResponse.json(
        { comments: [] },
        { headers: { "Cache-Control": "public, s-maxage=15" } }
      );
    }

    const comments = await listPublishedComments(postId);
    return NextResponse.json(
      { comments },
      {
        headers: {
          // Shorter than the engagement counts: a commenter reloading to see
          // their own approved comment should not wait thirty seconds.
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
        },
      }
    );
  } catch (err) {
    console.error(
      "[blog/comments] read failed:",
      err instanceof Error ? err.message : err
    );
    return unavailable();
  }
}

/* ────────────────────────────── POST ───────────────────────────────────── */

/**
 * The response shape, identical for every outcome a submitter is allowed to
 * distinguish. "held" and "published" are both honest and both harmless to
 * reveal — a reload would show the same thing. What is never revealed is WHY
 * something was held.
 */
function accepted(status: "published" | "held") {
  return NextResponse.json({ ok: true, status }, { status: 201 });
}

export async function POST(request: NextRequest) {
  // Bound the raw body before parsing or normalising anything (tech debt 3.3).
  const raw = await readCappedText(request, COMMENT_BODY_BYTES_MAX);
  if (raw === null) return invalid();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const fields = (body ?? {}) as Record<string, unknown>;

  // ── Rate limit FIRST. Nothing below may short-circuit past it, the honeypot
  // included — tech debt 3.8 was exactly that bypass, where a bot keeping the
  // hidden field filled got a 200 before the limiter ever ran.
  const ipHash = hashIp(clientIpOf(request));
  if (
    await isRateLimited(
      "blog_comment",
      ipHash,
      COMMENT_RATE_MAX,
      COMMENT_RATE_WINDOW_MS
    )
  ) {
    return rateLimited();
  }

  // Site-wide ceiling, for the distributed flood the per-IP limit cannot see.
  // `busy()` rather than `rateLimited()`: it is not this caller's fault.
  if (
    await isRateLimited(
      "blog_comment_global",
      "__global__",
      BLOG_COMMENT_GLOBAL_MAX,
      BLOG_COMMENT_GLOBAL_WINDOW_MS
    )
  ) {
    return busy();
  }

  // Honeypot. Mimics the HELD path exactly and writes nothing — a held
  // comment is a real outcome, so this is perfect camouflage AND honest to a
  // human who tripped it by accident. Claiming "published" would be a lie
  // visible on the next reload.
  if (str(fields.website)) return accepted("held");

  const authorName = str(fields.name);
  const commentBody = str(fields.body);
  if (!isValidCommentInput(authorName, commentBody)) return invalid();

  const slug = str(fields.slug);
  if (!isValidSlug(slug)) return invalid();

  // Elapsed milliseconds the form was on screen. Undefined when absent or
  // unparseable — "no signal" rather than zero, so a stale cached form is not
  // punished for it.
  const rawElapsed = fields.elapsedMs;
  const elapsedMs =
    typeof rawElapsed === "number" && Number.isFinite(rawElapsed)
      ? rawElapsed
      : undefined;

  try {
    if (!(await getBooleanSetting(COMMENTS_ENABLED_KEY, true))) {
      return invalid();
    }

    const postId = await resolvePublishedPostId(slug);
    if (!postId) return invalid();

    // The owner's own reply: published immediately with a badge, and it skips
    // the filter entirely. Note this diverges from InquiryForm and LikeButton,
    // which hide themselves from admins — here the owner genuinely wants the
    // form, to answer people on their own posts.
    if (await isAdmin()) {
      await prisma.postComment.create({
        data: {
          postId,
          authorName,
          body: commentBody,
          ipHash,
          isOwner: true,
          status: CommentStatus.PUBLISHED,
        },
      });
      return accepted("published");
    }

    // Exact duplicate from the same visitor: idempotent success, no second
    // row. Doubles as double-click protection.
    const duplicate = await prisma.postComment.findFirst({
      where: { postId, ipHash, body: commentBody },
      select: { status: true },
    });
    if (duplicate) {
      return accepted(
        duplicate.status === CommentStatus.PUBLISHED ? "published" : "held"
      );
    }

    // ── The filter. Runs IN BAND, before the insert, so no unscored row ever
    // exists — the schema's `DEFAULT 'HELD'` stays a genuine backstop rather
    // than the mechanism. The cost is latency, bounded by Akismet's 2.5s
    // timeout; the worst case is a held comment, never a hung request.
    const local = screenComment(authorName, commentBody, elapsedMs);

    let status: CommentStatus = CommentStatus.HELD;
    let spamReason: string | null = local?.reason ?? null;

    if (!local) {
      const verdict = await checkComment({
        authorName,
        body: commentBody,
        userIp: clientIpOf(request),
        userAgent: request.headers.get("user-agent"),
        referrer: request.headers.get("referer"),
        permalink: postUrl(slug),
      });
      spamReason = verdict.reason;

      if (verdict.verdict === "blatant") {
        status = CommentStatus.SPAM;
      } else if (verdict.verdict === "ham") {
        // Auto-publish is OFF by default — see COMMENT_AUTO_PUBLISH_KEY. A
        // clean verdict is merely RECORDED until the owner has read a few
        // weeks of them and chosen to trust it.
        status = (await getBooleanSetting(COMMENT_AUTO_PUBLISH_KEY, false))
          ? CommentStatus.PUBLISHED
          : CommentStatus.HELD;
        if (status === CommentStatus.HELD) {
          spamReason = "awaiting review (auto-publish off)";
        }
      }
      // "spam" and "unavailable" both fall through to HELD, with the reason
      // already set — fail closed.
    }

    await prisma.postComment.create({
      data: {
        postId,
        authorName,
        body: commentBody,
        ipHash,
        status,
        spamReason: spamReason?.slice(0, 200) ?? null,
      },
    });

    return accepted(
      status === CommentStatus.PUBLISHED ? "published" : "held"
    );
  } catch (err) {
    console.error(
      "[blog/comments] write failed:",
      err instanceof Error ? err.message : err
    );
    return unavailable();
  }
}
