import { after, type NextRequest, NextResponse } from "next/server";
import { SubscriberStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addContact } from "@/lib/resendSegment";
import { hashToken } from "@/lib/subscribers";
import { SUBSCRIBE_TOKEN_TTL_MS } from "@/lib/rateLimit";

/**
 * Complete double opt-in: the link in the confirmation email lands here.
 *
 * ── A route handler, not a page ───────────────────────────────────────────
 * This mutates, and a page that mutates during render gets re-run by Next's
 * own rendering in development and by any prefetch. A route handler that
 * redirects is the only shape that runs exactly once per click.
 *
 * ── The outcome is the destination, never a query parameter ───────────────
 * Every branch 303s to one of three plain, prerendered pages under
 * `/subscribe/`. Nothing is passed in the URL, so there is no `?status=`
 * for anyone to forge and nothing dynamic about the pages themselves.
 *
 * "Wrong token" and "expired token" land on the SAME page, deliberately: two
 * different outcomes would tell someone holding a guessed token whether it had
 * ever been real.
 *
 * ── Why /subscribe/ and not /blog/ ───────────────────────────────────────
 * A page at `/blog/confirm` would silently steal the slug `confirm` from the
 * post namespace — Next resolves a static segment before `[slug]` — and would
 * sit inside the namespace `scripts/assert-static-routes.mjs` polices. Neither
 * problem exists one level up.
 *
 * Known weakness, shared by every double opt-in scheme: a mail scanner or link
 * prefetcher that follows the link confirms the subscription. The alternative
 * is a page with a "yes, confirm" button, which costs a click and conversions.
 * Not worth it here.
 */

export const dynamic = "force-dynamic";

function outcome(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t")?.trim();

  // A human who clicked a link in an email must never see a bare JSON 400, so
  // even a missing or malformed token redirects.
  if (!token) return outcome(request, "/subscribe/link-expired");

  try {
    // Looked up by HASH — the token itself is never stored, so a database leak
    // does not let the reader confirm anybody.
    const row = await prisma.subscriber.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, email: true, status: true, tokenSentAt: true },
    });

    const expired =
      !row?.tokenSentAt ||
      Date.now() - row.tokenSentAt.getTime() > SUBSCRIBE_TOKEN_TTL_MS;

    if (!row || expired) return outcome(request, "/subscribe/link-expired");

    // Already confirmed is a success, not an error: someone clicking the link
    // twice should see the same friendly page, and the token was nulled on the
    // first click so this is only reachable for a row mid-rotation.
    if (row.status === SubscriberStatus.CONFIRMED) {
      return outcome(request, "/subscribe/confirmed");
    }

    await prisma.subscriber.update({
      where: { id: row.id },
      data: {
        status: SubscriberStatus.CONFIRMED,
        confirmedAt: new Date(),
        // NULLING the hash is what makes the link single-use. The unique index
        // permits many NULLs, so confirmed rows cost nothing there.
        tokenHash: null,
      },
    });

    after(async () => {
      // Resend is reached only AFTER consent is recorded in Postgres, which is
      // the whole point of the pending state: an unconfirmed address can never
      // reach the segment, so it can never receive a broadcast even if
      // something else here goes wrong.
      const result = await addContact(row.email);
      if (result.ok) {
        await prisma.subscriber
          .update({
            where: { id: row.id },
            data: { resendContactId: result.value },
          })
          .catch(() => {});
        return;
      }
      // A confirmed row with a null resendContactId is drift the admin panel
      // reports and every broadcast heals before sending — not a silent loss.
      console.warn(
        "[blog/confirm] contact not added to segment:",
        result.reason
      );
    });

    return outcome(request, "/subscribe/confirmed");
  } catch (err) {
    console.error(
      "[blog/confirm] failed:",
      err instanceof Error ? err.message : err
    );
    // The same page as a bad token. A distinct "something went wrong" would be
    // honest but would also distinguish a real token from a forged one.
    return outcome(request, "/subscribe/link-expired");
  }
}
