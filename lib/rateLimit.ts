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
 * the hot path. Stale windows ARE swept — not by a cron (this project
 * deliberately has none — runtime-agnostic, no new infra) but opportunistically,
 * piggybacking on a small random sample of these very calls; see
 * `sweepStaleRateWindows` below.
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
  let limited: boolean;
  try {
    const row = await prisma.rateWindow.upsert({
      where: {
        bucket_ipHash_windowStart: { bucket, ipHash, windowStart },
      },
      create: { bucket, ipHash, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    limited = row.count > max;
  } catch (err) {
    // Fail OPEN: the safeguard must never take the site down for a real visitor
    // because of a transient DB hiccup. A flood is a lesser harm than an outage.
    // But failing open silently means a degraded DB disables every rate limit
    // on the site (search's inference-cost ceiling included) with nothing
    // anywhere recording that it happened — so log it, matching settings.ts's
    // equivalent read failure.
    warnThrottled(
      `isRateLimited: DB error for bucket "${bucket}", failing open: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    limited = false;
  }
  // Fire-and-forget, regardless of the outcome above — a sweep riding along
  // with a rate-limited (or errored) call is just as valid a chance to sweep
  // as a normal one, and this must never make the decision above wait.
  sweepStaleRateWindows();
  return limited;
}

// A real DB outage means EVERY call above hits the catch — logging on each
// would flood Vercel's (short-retention) logs with one identical line per
// request for the duration of the outage, burying the one fact that matters
// ("it's down") under volume. Log at most once per instance per window and
// fold whatever else happened in between into a suppressed-count on the next
// line that does log, so the operator still learns how bad it was. Shared by
// isRateLimited's own DB-failure log and sweepStaleRateWindows' below — a
// degraded database hits both around the same time, so they share one budget
// rather than each keeping a separate counter that would still add up to a
// flood between them.
const WARN_THROTTLE_MS = 60_000;
let lastWarnAt = -Infinity;
let suppressedSinceLastWarn = 0;

function warnThrottled(message: string): void {
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
  // broadly, and the bucket name (or "sweep") is all an operator needs.
  console.warn(`${message}${suffix}`);
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

// --- Stale-window sweep (tech debt 2.1) ----------------------------------
//
// Both this comment's predecessor and prisma/schema.prisma used to say stale
// windows "can be swept occasionally" — aspirational; nothing ever did it, so
// rate_windows grew one row per (bucket, ipHash, windowStart) forever, on the
// hot path of every public write. This is the sweep, and it is deliberately
// NOT a cron job or scheduled function: this project has neither, on purpose
// (runtime-agnostic, no new infra — see docs/schema-design.md §7). Instead it
// piggybacks on isRateLimited itself, on a small random sample of calls.

// One in a hundred calls triggers a sweep attempt. Small enough that the
// amortized per-request cost (one extra fire-and-forget query, most of the
// time zero) is negligible; frequent enough that even modest traffic sweeps
// many times an hour. Exposed as a parameter below (not a bare Math.random()
// call) so tests can force the sampled/not-sampled branch deterministically.
const SWEEP_SAMPLE_RATE = 0.01;

// A window row is only safe to delete once it's well past every bucket's
// window — deleting one still inside its window would let a request that
// started before the sweep re-create a row an upsert had already counted
// against, resetting that IP's budget early. DAY_MS (the inquiry_email
// bucket) is the longest window among the six buckets in use; the cutoff is
// derived from it (doubled, as a safety margin) rather than a hardcoded
// duration, so a future bucket with an even longer window can't silently
// reintroduce that race by outliving a hardcoded cutoff.
const SWEEP_SAFE_AGE_MS = DAY_MS * 2;

// Bounds ONE sweep's DELETE so the first sweep after this ships — with
// however many months of un-swept backlog already accumulated — can't turn
// one unlucky request's fire-and-forget call into a full-table delete that
// competes with real traffic for lock/IO time. The backlog drains over many
// subsequent sampled sweeps instead of one giant one.
const SWEEP_BATCH_LIMIT = 5000;

/**
 * Opportunistically deletes a bounded batch of `rate_windows` rows older than
 * `SWEEP_SAFE_AGE_MS`. Called from every `isRateLimited` invocation, but only
 * acts on ~1% of them (`SWEEP_SAMPLE_RATE`) — see the block comment above for
 * why this exists instead of a scheduled job.
 *
 * Fire-and-forget BY CONTRACT: callers never await this, and every error is
 * caught right here (never left to reject an unawaited promise) and logged
 * through the same throttled warn `isRateLimited`'s own DB-failure path
 * uses. A sweep must never delay or fail the rate-limit decision it rides
 * along with — that decision fails open on its own terms (above); the sweep
 * riding along with it must be invisible if it goes wrong.
 *
 * The DELETE targets a bounded batch via `ctid` (Postgres's physical row
 * identifier) rather than a plain `LIMIT`, because `DELETE ... LIMIT` isn't
 * valid SQL on its own — `ctid IN (SELECT ctid ... LIMIT $n)` is the standard
 * way to bound a delete by row count.
 *
 * @param random injectable for tests (defaults to `Math.random`) so the
 *   sampled/not-sampled branch can be forced deterministically.
 */
export function sweepStaleRateWindows(random: () => number = Math.random): void {
  if (random() >= SWEEP_SAMPLE_RATE) return;
  const onError = (err: unknown) =>
    warnThrottled(
      `sweepStaleRateWindows: DB error (ignored): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  // Wrapped in try/catch, not just a `.catch()` on the returned promise:
  // building/sending the query can itself throw synchronously (a malformed
  // client, a mocked prisma in a test) before there's any promise to attach
  // a handler to — this must swallow BOTH failure shapes.
  try {
    const cutoff = new Date(Date.now() - SWEEP_SAFE_AGE_MS);
    prisma.$executeRaw`
      DELETE FROM rate_windows
      WHERE ctid IN (
        SELECT ctid FROM rate_windows WHERE "windowStart" < ${cutoff} LIMIT ${SWEEP_BATCH_LIMIT}
      )
    `.catch(onError);
  } catch (err) {
    onError(err);
  }
}
