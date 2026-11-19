import { after, type NextRequest, NextResponse } from "next/server";
import { SubscriberStatus } from "@prisma/client";
import { SITE_ORIGIN } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import { EMAIL_MAX, EMAIL_RE } from "@/lib/inquiryLimits";
import { invalid, rateLimited, readCappedText, str } from "@/lib/http";
import {
  DAY_MS,
  SUBSCRIBE_EMAIL_DAILY_CAP,
  SUBSCRIBE_MAX,
  SUBSCRIBE_RESEND_COOLDOWN_MS,
  SUBSCRIBE_TOKEN_TTL_MS,
  SUBSCRIBE_WINDOW_MS,
  isRateLimited,
} from "@/lib/rateLimit";
import {
  confirmPath,
  mintConfirmToken,
  normalizeEmail,
  unsubscribePath,
} from "@/lib/subscribers";
import { sendSubscribeConfirmation } from "@/lib/subscribeMail";

/**
 * Double opt-in signup.
 *
 * ── Every branch returns an identical 200 ─────────────────────────────────
 * This is the most important property of the route, and the easiest to break
 * by being helpful. "Created", "already pending", "within cooldown", "already
 * confirmed" and "resubscribing" all answer `200 {ok:true}`, byte for byte.
 *
 * Anything else turns the endpoint into an **email-existence oracle**: a 201
 * for new addresses and a 200 for known ones would let anyone test whether a
 * given person subscribes to this blog. A `409 "already subscribed"` would be
 * worse still. The send happens in `after()` partly so response TIMING does
 * not vary by branch either.
 *
 * ── It is an abuse vector pointed at third parties ────────────────────────
 * A confirmation email goes to an address the submitter does not have to own,
 * so the real risk here is not spam *to this site* but mailbombing a stranger.
 * Four things bound it: a tight per-IP limit (3/hour), a 15-minute per-address
 * cooldown, a site-wide daily send cap, and copy written so the recipient can
 * ignore it safely. Never add an "already subscribed" reply.
 */

export const dynamic = "force-dynamic";

const BODY_BYTES_MAX = 1_024;

/** The one response. */
function accepted() {
  return NextResponse.json({ ok: true });
}

/**
 * Opportunistically drop pending signups whose token has expired.
 *
 * Unconfirmed rows are both the growth path and the abuse sink, and this
 * project has no cron on purpose (runtime-agnostic, no new infrastructure), so
 * the sweep piggybacks the signup path exactly as `sweepStaleRateWindows`
 * piggybacks the limiter. Bounded, fire-and-forget, and its failure is
 * swallowed — a sweep that cannot run must never fail a signup.
 */
function sweepExpiredPending(): void {
  const cutoff = new Date(Date.now() - SUBSCRIBE_TOKEN_TTL_MS);
  prisma.subscriber
    .deleteMany({
      where: { status: SubscriberStatus.PENDING, tokenSentAt: { lt: cutoff } },
    })
    .catch(() => {});
}

export async function POST(request: NextRequest) {
  const raw = await readCappedText(request, BODY_BYTES_MAX);
  if (raw === null) return invalid();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const fields = (body ?? {}) as Record<string, unknown>;

  // Rate limit first — nothing below, honeypot included, may bypass it.
  const ipHash = hashIp(clientIpOf(request));
  if (
    await isRateLimited("subscribe", ipHash, SUBSCRIBE_MAX, SUBSCRIBE_WINDOW_MS)
  ) {
    return rateLimited();
  }

  // Honeypot: indistinguishable from success, and nothing is written or sent.
  if (str(fields.website)) return accepted();

  const email = normalizeEmail(str(fields.email));
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return invalid();
  }

  try {
    const existing = await prisma.subscriber.findUnique({
      where: { email },
      select: { id: true, status: true, tokenSentAt: true },
    });

    // Already confirmed: do nothing at all. An "already subscribed" email
    // would both leak membership and burn quota.
    if (existing?.status === SubscriberStatus.CONFIRMED) return accepted();

    // Pending and recently mailed: do nothing. This cooldown is what stops the
    // endpoint being used to send one person the same mail repeatedly.
    if (
      existing?.status === SubscriberStatus.PENDING &&
      existing.tokenSentAt &&
      Date.now() - existing.tokenSentAt.getTime() < SUBSCRIBE_RESEND_COOLDOWN_MS
    ) {
      return accepted();
    }

    // A new signup, a stale pending one, or a resubscribe. All three mint a
    // fresh token and send — a resubscribe must re-consent rather than being
    // silently reinstated.
    const { token, tokenHash } = mintConfirmToken();
    const row = await prisma.subscriber.upsert({
      where: { email },
      create: {
        email,
        ipHash,
        tokenHash,
        tokenSentAt: new Date(),
        status: SubscriberStatus.PENDING,
      },
      update: {
        tokenHash,
        tokenSentAt: new Date(),
        status: SubscriberStatus.PENDING,
        // Cleared so a resubscriber's record does not keep claiming they left.
        unsubscribedAt: null,
      },
      select: { id: true },
    });

    after(async () => {
      sweepExpiredPending();

      // Site-wide daily ceiling, shared with inquiry notifications under
      // Resend's real 100/day. Over the cap the ROW stays and only the send is
      // skipped, so the visitor can retry after the cooldown — the same shape
      // the inquiry cap uses.
      if (
        await isRateLimited(
          "subscribe_email",
          "__global__",
          SUBSCRIBE_EMAIL_DAILY_CAP,
          DAY_MS
        )
      ) {
        console.warn("[blog/subscribe] daily confirmation cap reached");
        return;
      }

      try {
        await sendSubscribeConfirmation({
          email,
          confirmUrl: `${SITE_ORIGIN}${confirmPath(token)}`,
          unsubscribeUrl: `${SITE_ORIGIN}${unsubscribePath(row.id)}`,
        });
      } catch (err) {
        // Never the address, and never the token — both are the whole secret.
        console.error(
          "[blog/subscribe] confirmation send failed:",
          err instanceof Error ? err.message : err
        );
      }
    });

    return accepted();
  } catch (err) {
    console.error(
      "[blog/subscribe] failed:",
      err instanceof Error ? err.message : err
    );
    // Still 200. A 503 here would distinguish "database down" from the happy
    // path, which is information this endpoint does not owe anyone — and the
    // visitor's correct action is the same either way: try again later.
    return accepted();
  }
}
