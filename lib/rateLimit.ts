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
  } catch {
    // Fail OPEN: the safeguard must never take the site down for a real visitor
    // because of a transient DB hiccup. A flood is a lesser harm than an outage.
    return false;
  }
}

/**
 * Server-only tuning constants. Deliberately generous — far above any human
 * interaction rate, so a real visitor never notices, while a script is capped.
 */
export const LIKE_MAX = 30; // like/unlike toggles ...
export const LIKE_WINDOW_MS = 60_000; // ... per minute (shared POST+DELETE budget)

export const EVENTS_MAX = 120; // clickstream batches (each already ≤25 events) ...
export const EVENTS_WINDOW_MS = 60_000; // ... per minute

// Site-wide daily ceiling on inquiry notification emails (keyed "__global__", not
// per-IP). Bounds Resend spend even under a distributed / IP-rotating flood that
// each per-IP limit misses. Set far above real inquiry volume so it only ever
// trips under attack; over the cap the inquiry is still stored, only the email is
// skipped (and flagged in the comment log for manual resend).
export const DAILY_EMAIL_CAP = 200;
export const DAY_MS = 24 * 60 * 60 * 1000;
