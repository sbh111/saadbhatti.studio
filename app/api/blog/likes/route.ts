import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { isValidSlug } from "@/lib/blogLimits";
import { prisma } from "@/lib/db";
import { resolvePublishedPostId } from "@/lib/engagement";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import {
  invalid,
  noContent,
  rateLimited,
  str,
  unavailable,
  readCappedText,
} from "@/lib/http";
import {
  BLOG_LIKE_MAX,
  BLOG_LIKE_WINDOW_MS,
  isRateLimited,
} from "@/lib/rateLimit";

/**
 * Likes on a blog post. Not under /api/admin/ — proxy.ts's matcher is
 * ["/admin/:path*", "/api/admin/:path*"], so anything under it 401s for a
 * visitor. Same reason /api/inquiries sits where it does.
 *
 * ── POST and DELETE share one function, deliberately ──────────────────────
 * Tech debt 3.4 was a DELETE on /api/likes that skipped the length cap and the
 * existence check its own POST applied — "the one public write path with
 * neither guard", forty lines below a POST that had both. The artwork route's
 * fix was to repeat the guards in both handlers and add a test that they
 * match. This route goes further: there is only ONE guard sequence, and the
 * two exports differ by a single parameter. A guard cannot be present in one
 * handler and absent in the other, because there is only one handler.
 *
 * ── Unlike /api/likes, this one returns a count ───────────────────────────
 * Blog likes show a public number, so a rate-limited request gets a 429 rather
 * than the artwork route's terse 204. The artwork route can answer 204 because
 * it has nothing to report; here, answering 2xx without a count would leave the
 * client showing an optimistic number it never earned. The client treats any
 * non-2xx as "roll back", so the heart and the number revert together.
 */

export const dynamic = "force-dynamic";

/** Generous: a slug and a session id, nothing else. Bounded before parsing. */
const BODY_BYTES_MAX = 1_024;

async function toggleLike(
  request: NextRequest,
  intent: "like" | "unlike"
): Promise<NextResponse> {
  // Bound the body BEFORE parsing it. Tech debt 3.3 recorded the existing
  // routes disagreeing about this ordering; `readCappedText` exists for it.
  const raw = await readCappedText(request, BODY_BYTES_MAX);
  if (raw === null) return invalid();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return invalid();
  }

  const fields = (body ?? {}) as Record<string, unknown>;

  // A SLUG, never a post id. The slug is the public contract; a post id is
  // interpolated into a signed Cloudinary folder path (invariant 15), so
  // accepting one from a visitor hands them a reason to probe it.
  const slug = str(fields.slug);
  if (!isValidSlug(slug)) return invalid();

  // The owner liking their own post is noise. A cheap cookie unseal with no
  // database access, and it keeps the owner out of the rate limiter — the same
  // ordering and the same reasoning as /api/likes.
  if (await isAdmin()) return noContent();

  const ipHash = hashIp(clientIpOf(request));
  if (
    await isRateLimited("blog_like", ipHash, BLOG_LIKE_MAX, BLOG_LIKE_WINDOW_MS)
  ) {
    return rateLimited();
  }

  try {
    // Server-resolved: the post must exist AND be published. The blog's
    // equivalent of the artwork routes' catalog-existence check.
    const postId = await resolvePublishedPostId(slug);
    if (!postId) return invalid();

    if (intent === "like") {
      try {
        await prisma.postLike.create({ data: { postId, ipHash } });
      } catch (err) {
        // Already liked. The unique index IS the dedup mechanism, so a
        // violation is the normal idempotent path, not an error — fall through
        // and report the unchanged count.
        if (
          !(
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          )
        ) {
          throw err;
        }
      }
    } else {
      // deleteMany, not delete: unliking something never liked is a no-op
      // rather than a 404.
      await prisma.postLike.deleteMany({ where: { postId, ipHash } });
    }

    const likes = await prisma.postLike.count({ where: { postId } });
    // Never cached: it is a response to a write, and the count is the point.
    return NextResponse.json(
      { likes },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // Never the ipHash — it is PII-adjacent and useless for debugging
    // (invariant 6, and the assertion in test/api/likes.test.ts). Logged at
    // all because tech debt 1.7 was like failures being invisible to everyone.
    console.error(
      "[blog/likes] failed:",
      err instanceof Error ? err.message : err
    );
    return unavailable();
  }
}

export async function POST(request: NextRequest) {
  return toggleLike(request, "like");
}

export async function DELETE(request: NextRequest) {
  return toggleLike(request, "unlike");
}
