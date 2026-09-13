import { prisma } from "./db";

/**
 * Generic per-IP rate limiter, shared by every public write endpoint. Postgres-
 * backed (no external infra): in-memory counters are useless on serverless where
 * each invocation is a fresh instance.
 *
 * Fixed-window scheme — one `rate_windows` row per (bucket, ipHash, windowStart),
 * bumped with an atomic `upsert … increment`. This counts *requests*, not stored
 * domain rows, so it works even where the request produces no row (a deduped
 * like, a DELETE, an events forward). The window boundary is derived from the
 * clock (floor(now / windowMs) * windowMs), so no timers or cleanup are needed on
 * the hot path; stale windows are inert and can be swept occasionally by
 * `windowStart`.
 *
 * @returns true when this key has already used up its budget for the window.
 */
export async function isRateLimited(
  bucket: string,
  ipHash: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  try {
    const row = await prisma.rateWindow.upsert({
      where: {
        bucket_ipHash_windowStart: { bucket, ipHash, windowStart },
      },
      create: { bucket, ipHash, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    return row.count > max;
  } catch (err) {
    // Fail OPEN: the safeguard must never take the site down for a real visitor
    // because of a transient DB hiccup. A flood is a lesser harm than an outage.
    // But failing open silently means a degraded DB disables every rate limit
    // on the site (search's inference-cost ceiling included) with nothing
    // anywhere recording that it happened — so log it, matching settings.ts's
    // equivalent read failure.
    warnRateLimitFailure(bucket, err instanceof Error ? err.message : String(err));
    return false;
  }
}

// A real DB outage means EVERY call above hits the catch — logging on each
// would flood Vercel's (short-retention) logs with one identical line per
// request for the duration of the outage, burying the one fact that matters
// ("it's down") under volume. Log at most once per instance per window and
// fold whatever else happened in between into a suppressed-count on the next
// line that does log, so the operator still learns how bad it was.
const WARN_THROTTLE_MS = 60_000;
let lastWarnAt = -Infinity;
let suppressedSinceLastWarn = 0;

function warnRateLimitFailure(bucket: string, message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_THROTTLE_MS) {
    suppressedSinceLastWarn++;
    return;
  }
  const suffix =
    suppressedSinceLastWarn > 0
      ? ` (${suppressedSinceLastWarn} more suppressed in the last minute)`
      : "";
  suppressedSinceLastWarn = 0;
  lastWarnAt = now;
  // Never log ipHash here — this line is meant to be safe to alert on/read
  // broadly, and the bucket name is all an operator needs to know what's hit.
  console.warn(
    `isRateLimited: DB error for bucket "${bucket}", failing open: ${message}${suffix}`
  );
}

/**
 * Server-only tuning constants. Deliberately generous — far above any human
 * interaction rate, so a real visitor never notices, while a script is capped.
 */
export const LIKE_MAX = 30; // like/unlike toggles ...
export const LIKE_WINDOW_MS = 60_000; // ... per minute (shared POST+DELETE budget)

export const EVENTS_MAX = 120; // clickstream batches (each already ≤25 events) ...
export const EVENTS_WINDOW_MS = 60_000; // ... per minute

// Search is the one endpoint that runs ML inference per request, so it's the most
// expensive to abuse — a strict per-IP limit, plus a global ceiling that bounds
// total inference cost under a distributed / IP-rotating flood the per-IP limit
// can't see. Values are starting points; tune against real traffic.
export const SEARCH_MAX = 20; // searches per IP ...
export const SEARCH_WINDOW_MS = 60_000; // ... per minute
export const SEARCH_GLOBAL_MAX = 300; // site-wide searches ...
export const SEARCH_GLOBAL_WINDOW_MS = 60_000; // ... per minute (cost ceiling)

// Query hygiene + result quality for search.
export const QUERY_MAX_CHARS = 200; // CLIP truncates at ~77 tokens anyway
// Minimum cosine similarity for a result to count. CLIP text↔image similarities run
// low in absolute terms (~0.15–0.35), so this floor is deliberately small — TUNE it
// against real queries so nonsense returns nothing but real matches survive.
export const MIN_SCORE = 0.18;

// Site-wide daily ceiling on inquiry notification emails (keyed "__global__", not
// per-IP). Bounds Resend spend even under a distributed / IP-rotating flood that
// each per-IP limit misses. Set far above real inquiry volume so it only ever
// trips under attack; over the cap the inquiry is still stored, only the email is
// skipped (and flagged in the comment log for manual resend).
export const DAILY_EMAIL_CAP = 200;
export const DAY_MS = 24 * 60 * 60 * 1000;
