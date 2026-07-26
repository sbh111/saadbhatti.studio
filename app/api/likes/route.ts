import { NextResponse, after, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { getArtworkIndex } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import { isEventStreamingEnabled } from "@/lib/settings";
import { forwardEvents, type EnrichedEvent } from "@/lib/collector";
import { EVENT_SCHEMA_VERSION } from "@/lib/eventTypes";

/**
 * Public like / unlike for an artwork — the one EXPLICIT interest signal. A
 * durable Postgres row (deduped one-per-visitor by salted IP hash), independent
 * of the toggleable Kafka stream, so the button is honest whether streaming is
 * on or off. Not under /api/admin (same proxy reasoning as /api/inquiries).
 *
 *   POST   { artworkPublicId, sessionId }  → like   (idempotent; new like → stream artwork_like)
 *   DELETE { artworkPublicId }             → unlike (idempotent)
 *
 * Admin is a server-side no-op: the owner liking their own work is noise, and
 * the client flag isn't trusted. Errors are terse — bots learn nothing.
 */
export const dynamic = "force-dynamic";

const noContent = () => new NextResponse(null, { status: 204 });
const invalid = () => NextResponse.json({ error: "invalid" }, { status: 400 });

const strOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  const artworkPublicId = strOf((body as Record<string, unknown>)?.artworkPublicId);
  const sessionId = strOf((body as Record<string, unknown>)?.sessionId);
  if (!artworkPublicId) return invalid();

  // The artwork must exist in the live catalog (same trust rule as inquiries).
  const ref = (await getArtworkIndex()).get(artworkPublicId);
  if (!ref) return invalid();

  // Owner liking own work is noise; re-check server-side (client flag untrusted).
  if (await isAdmin()) return noContent();

  const ipHash = hashIp(clientIpOf(request));
  try {
    await prisma.like.create({ data: { artworkPublicId, ipHash } });
  } catch (err) {
    // Already liked (unique [artworkPublicId, ipHash]) → idempotent, no event.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return noContent();
    }
    throw err;
  }

  // A genuinely new like: the strongest signal. Best-effort stream, only when
  // the toggle is on and we have a session key to partition by.
  if (sessionId && (await isEventStreamingEnabled())) {
    const event: EnrichedEvent = {
      v: EVENT_SCHEMA_VERSION,
      type: "artwork_like",
      ts: new Date().toISOString(),
      sessionId,
      path: `/${ref.mediumSlug}/${ref.collectionSlug}#${ref.artwork.slug}`,
      referrer: null,
      artworkPublicId,
      ipHash,
      country: request.headers.get("x-vercel-ip-country"),
      userAgent: request.headers.get("user-agent"),
      receivedAt: new Date().toISOString(),
    };
    after(() => forwardEvents([event]).catch(() => {}));
  }

  return noContent();
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  const artworkPublicId = strOf((body as Record<string, unknown>)?.artworkPublicId);
  if (!artworkPublicId) return invalid();
  if (await isAdmin()) return noContent();

  // deleteMany → idempotent (unliking something not liked is a no-op, not a 404).
  const ipHash = hashIp(clientIpOf(request));
  await prisma.like.deleteMany({ where: { artworkPublicId, ipHash } });
  return noContent();
}
