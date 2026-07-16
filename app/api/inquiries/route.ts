import { NextResponse, type NextRequest } from "next/server";
import { getArtworkIndex } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { clientIpOf, hashIp, isRateLimited } from "@/lib/inquiries";
import {
  EMAIL_MAX,
  EMAIL_RE,
  MESSAGE_MAX,
  NAME_MAX,
} from "@/lib/inquiryLimits";

/**
 * Public inquiry endpoint — the site's first public write. Deliberately NOT
 * under /api/admin so the proxy's admin matcher never intercepts it. Responses
 * stay terse (never enumerate why input was rejected — that only helps bots):
 *   honeypot tripped → 200 {ok:true} with NO db write (looks like success)
 *   bad shape/fields → 400 {error:"invalid"}
 *   over the rate limit → 429 {error:"rate_limited"}
 *   accepted         → 201 {ok:true}
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(raw.name);
  const email = str(raw.email);
  const message = str(raw.message);
  const artworkPublicId = str(raw.artworkPublicId);

  // Honeypot first: a filled `website` field means a bot. Mimic success exactly
  // (200 {ok:true}) and touch nothing.
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
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // The artwork must exist in the live catalog; its title is snapshotted from
  // there (trusted), never from the client payload. A miss is just "invalid".
  const ref = (await getArtworkIndex()).get(artworkPublicId);
  if (!ref) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // DB-backed rate limit (in-memory would be per-serverless-instance = useless).
  const ipHash = hashIp(clientIpOf(request));
  if (await isRateLimited(ipHash)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  await prisma.inquiry.create({
    data: {
      artworkPublicId,
      artworkTitle: ref.artwork.name,
      name,
      email,
      message,
      ipHash,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
