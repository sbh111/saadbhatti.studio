import { type NextRequest, NextResponse } from "next/server";
import {
  ENGAGEMENT_SLUG_MAX,
  countEngagement,
} from "@/lib/engagement";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import { invalid, rateLimited, unavailable } from "@/lib/http";
import {
  BLOG_READ_MAX,
  BLOG_READ_WINDOW_MS,
  isRateLimited,
} from "@/lib/rateLimit";

/**
 * Public like and comment counts, batched.
 *
 *     GET /api/blog/engagement?slugs=a,b,c
 *     → 200 { "a": { likes, comments }, … }
 *
 * This endpoint is what lets `/blog` and `/blog/[slug]` stay prerendered while
 * still showing live numbers — `docs/architecture.md` invariant 2(c)
 * prescribes exactly this shape, pointing at how AdminProvider fetches
 * /api/admin/session. `lib/engagement.ts` explains why a cached server read
 * was the wrong answer.
 *
 * ── It is CDN-cacheable, and that is load-bearing ─────────────────────────
 * The response contains no per-visitor data at all. Notably it does NOT say
 * whether *you* have liked something: that stays in `localStorage`, exactly as
 * components/LikeButton.tsx already does it. Returning it would be more honest
 * across devices, and would make every single request a cache miss — which is
 * the only thing standing between a post that does well and per-visitor QPS on
 * Neon's pooler. The accepted cost is small and already precedented: the same
 * person on a second device sees an empty heart, clicks, and the number does
 * not move because their IP hash already liked.
 *
 * Batched because `/blog` renders N cards and N requests would be absurd.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("slugs");
  if (!raw) return invalid();

  // Split and bound before anything else. `countEngagement` validates each
  // slug and caps the list again — this is the cheap early-out, not the
  // guarantee.
  const slugs = raw.split(",").slice(0, ENGAGEMENT_SLUG_MAX);
  if (slugs.length === 0) return invalid();

  // Bounds precede the limiter here, unlike /api/inquiries. The "limit first"
  // rule exists because a honeypot could short-circuit to SUCCESS before the
  // limiter ran; a read has no such path, and a 400 bypasses nothing. The
  // limiter is present at all because `?slugs=a&_=random` busts the CDN cache
  // key and turns every request into a database query — without it the
  // s-maxage below is advisory rather than protective.
  const ipHash = hashIp(clientIpOf(request));
  if (
    await isRateLimited("blog_read", ipHash, BLOG_READ_MAX, BLOG_READ_WINDOW_MS)
  ) {
    return rateLimited();
  }

  try {
    const counts = await countEngagement(slugs);
    return NextResponse.json(counts, {
      headers: {
        // Shared cache only. Thirty seconds is short enough that a count feels
        // live and long enough that a burst of readers costs one query.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    // 503 rather than an empty object, and the client renders NO count rather
    // than a zero. A fabricated zero is indistinguishable from real data and
    // would turn a database outage into "nobody liked this post".
    console.error(
      "[blog/engagement] failed:",
      err instanceof Error ? err.message : err
    );
    return unavailable();
  }
}
