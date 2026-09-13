import { NextResponse, after, type NextRequest } from "next/server";
import { EmailStatus } from "@prisma/client";
import { getArtworkIndex } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { invalid, rateLimited, str } from "@/lib/http";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import { isRateLimited, DAILY_EMAIL_CAP, DAY_MS } from "@/lib/rateLimit";
import { sendInquiryNotification } from "@/lib/mail";
import {
  EMAIL_MAX,
  EMAIL_RE,
  MESSAGE_MAX,
  NAME_MAX,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/inquiryLimits";

/**
 * Public inquiry endpoint — the site's first public write. Deliberately NOT
 * under /api/admin so the proxy's admin matcher never intercepts it. The rate
 * limit is checked first, before anything (honeypot included) can short-circuit
 * the request — so "over the rate limit → 429" has no bypass. Responses stay
 * terse (never enumerate why input was rejected — that only helps bots):
 *   over the rate limit → 429 {error:"rate_limited"}
 *   honeypot tripped    → 200 {ok:true} with NO db write (looks like success)
 *   bad shape/fields    → 400 {error:"invalid"}
 *   accepted            → 201 {ok:true}
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  if (typeof body !== "object" || body === null) {
    return invalid();
  }

  const raw = body as Record<string, unknown>;
  const name = str(raw.name);
  const email = str(raw.email);
  const message = str(raw.message);
  const artworkPublicId = str(raw.artworkPublicId);

  // DB-backed rate limit (in-memory would be per-serverless-instance = useless),
  // checked before the honeypot branch below so a bot that keeps the `website`
  // field filled is still capped like any other submission — it used to return
  // 200 before this check ever ran, an unlimited bypass. Only requests that
  // clear the budget reach the cheap short-circuits (honeypot, field shape)
  // and the expensive one (the catalog/Cloudinary lookup further down).
  const ipHash = hashIp(clientIpOf(request));
  if (await isRateLimited("inquiry", ipHash, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return rateLimited();
  }

  // Honeypot: a filled `website` field means a bot. Mimic success exactly
  // (200 {ok:true}) and touch nothing further — no field validation, no
  // catalog lookup, no db write, no email.
  if (str(raw.website)) {
    return NextResponse.json({ ok: true });
  }

  // Field validation — bounds mirror the schema; one generic 400 for any miss.
  if (
    name.length < 1 ||
    name.length > NAME_MAX ||
    message.length < 1 ||
    message.length > MESSAGE_MAX ||
    email.length > EMAIL_MAX ||
    !EMAIL_RE.test(email)
  ) {
    return invalid();
  }

  // The artwork must exist in the live catalog; its title is snapshotted from
  // there (trusted), never from the client payload. A miss is just "invalid".
  const ref = (await getArtworkIndex()).get(artworkPublicId);
  if (!ref) {
    return invalid();
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      artworkPublicId,
      artworkTitle: ref.artwork.name,
      name,
      email,
      message,
      ipHash,
    },
  });

  // Best-effort notification, after the response is flushed (never blocks or
  // fails the submission — the row is already saved and shown in the admin log).
  // The outcome is recorded on the row so the comment log can flag an un-emailed
  // inquiry and offer a one-click resend.
  after(async () => {
    const mark = (emailStatus: EmailStatus, emailError: string | null) =>
      prisma.inquiry
        .update({
          where: { id: inquiry.id },
          data: { emailStatus, emailError: emailError?.slice(0, 500) ?? null },
        })
        .catch((err) => console.error("inquiry email-status update failed", err));

    // Global daily ceiling — independent of IP, so it holds even against a
    // distributed / IP-rotating flood the per-IP limit can't see. Over the cap
    // we skip the email (the lead is already stored) and flag it for resend.
    if (await isRateLimited("inquiry_email", "__global__", DAILY_EMAIL_CAP, DAY_MS)) {
      await mark(EmailStatus.SKIPPED, "Daily email cap reached");
      return;
    }

    try {
      const dispatched = await sendInquiryNotification({
        name,
        email,
        message,
        artworkTitle: ref.artwork.name,
        artworkPublicId,
        artworkSlug: ref.artwork.slug,
        mediumSlug: ref.mediumSlug,
        collectionSlug: ref.collectionSlug,
      });
      await mark(
        dispatched ? EmailStatus.SENT : EmailStatus.SKIPPED,
        dispatched ? null : "Email notifications are not configured"
      );
    } catch (err) {
      console.error("inquiry notification failed", err);
      await mark(
        EmailStatus.FAILED,
        err instanceof Error ? err.message : "Unknown send error"
      );
    }
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
