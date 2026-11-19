import { after, type NextRequest, NextResponse } from "next/server";
import { SubscriberStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { unsubscribeContact } from "@/lib/resendSegment";
import { verifyUnsubscribeMac } from "@/lib/subscribers";

/**
 * One-click unsubscribe, verified by HMAC.
 *
 *     /api/blog/unsubscribe?s=<subscriberId>&t=<mac>
 *
 * Works with no session, no login and no confirmation step. That is a
 * requirement rather than a courtesy: an unsubscribe that asks "are you sure"
 * is an unsubscribe some people will fail to complete.
 *
 * ── Why a derived MAC and not a stored token ──────────────────────────────
 * This link has to stay valid forever and be mintable fresh whenever we mail
 * someone, which a stored single-use hash cannot do. So it is recomputed from
 * the subscriber id under `SUBSCRIBE_TOKEN_SECRET` and compared in constant
 * time — nothing at rest, nothing to leak, and rotating the secret revokes
 * every link ever sent. lib/subscribers.ts states the general rule.
 *
 * ── POST as well as GET ───────────────────────────────────────────────────
 * RFC 8058 one-click unsubscribe requires a POST endpoint, and
 * lib/subscribeMail.ts sets `List-Unsubscribe-Post` on the confirmation email,
 * so a mail client may POST here without a human involved. Both verbs do
 * exactly the same thing; only the response differs — a human gets a redirect,
 * a machine gets a 204.
 *
 * ── This is NOT how a broadcast unsubscribe works ─────────────────────────
 * A broadcast is one message for many recipients and cannot carry a
 * per-subscriber link, so it uses Resend's own `{{{RESEND_UNSUBSCRIBE_URL}}}`
 * placeholder instead. Those unsubscribes update Resend and not Postgres,
 * which is drift by design — a broadcast only ever reaches Resend contacts, so
 * leaving that way works regardless of what Postgres believes. This route is
 * the Postgres-authoritative path: the "this wasn't me" escape in a
 * confirmation email, which has to work before any Resend contact exists.
 */

export const dynamic = "force-dynamic";

async function unsubscribe(request: NextRequest): Promise<boolean> {
  const id = request.nextUrl.searchParams.get("s")?.trim() ?? "";
  const mac = request.nextUrl.searchParams.get("t")?.trim() ?? "";

  if (!verifyUnsubscribeMac(id, mac)) return false;

  const row = await prisma.subscriber.findUnique({
    where: { id },
    select: { id: true, status: true, resendContactId: true },
  });
  // A valid MAC for a row that no longer exists is still a success from the
  // visitor's point of view: they are not subscribed, which is what they asked
  // for. Reporting "no such subscriber" would leak whether the id was real.
  if (!row) return true;

  if (row.status !== SubscriberStatus.UNSUBSCRIBED) {
    await prisma.subscriber.update({
      where: { id: row.id },
      data: {
        status: SubscriberStatus.UNSUBSCRIBED,
        unsubscribedAt: new Date(),
        // Any live confirmation token is void now — leaving one would let an
        // old email re-subscribe them without consent.
        tokenHash: null,
      },
    });
  }

  if (row.resendContactId) {
    const contactId = row.resendContactId;
    after(async () => {
      // Marked unsubscribed rather than deleted, so Resend keeps suppressing
      // them even if the contact is later re-imported by hand.
      const result = await unsubscribeContact(contactId);
      if (!result.ok) {
        console.warn(
          "[blog/unsubscribe] Resend contact not updated:",
          result.reason
        );
      }
    });
  }

  return true;
}

export async function GET(request: NextRequest) {
  const ok = await unsubscribe(request).catch((err) => {
    console.error(
      "[blog/unsubscribe] failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  });

  // Both outcomes land on a plain prerendered page. A failed MAC goes to the
  // expired-link page — the same destination a bad confirmation token gets, so
  // neither reveals whether the identifier was ever real.
  return NextResponse.redirect(
    new URL(
      ok ? "/subscribe/unsubscribed" : "/subscribe/link-expired",
      request.nextUrl.origin
    ),
    303
  );
}

export async function POST(request: NextRequest) {
  // The RFC 8058 path: a mail client acting without a human, which wants a
  // status code rather than somewhere to navigate.
  const ok = await unsubscribe(request).catch(() => false);
  return new NextResponse(null, { status: ok ? 204 : 400 });
}
