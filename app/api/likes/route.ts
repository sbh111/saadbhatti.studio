import { after, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { getArtworkIndex } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { invalid, noContent, str } from "@/lib/http";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import { isRateLimited, LIKE_MAX, LIKE_WINDOW_MS } from "@/lib/rateLimit";
import { isEventStreamingEnabled } from "@/lib/settings";
import { forwardEvents, type EnrichedEvent } from "@/lib/collector";
import {
  ARTWORK_PUBLIC_ID_MAX,
  EVENT_SCHEMA_VERSION,
  SESSION_ID_MAX,
} from "@/lib/eventTypes";

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

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  const artworkPublicId = str((body as Record<string, unknown>)?.artworkPublicId);
  if (!artworkPublicId || artworkPublicId.length > ARTWORK_PUBLIC_ID_MAX) {
    return invalid();
  }

  // sessionId only feeds the optional Kafka event (guarded below), so a bogus
  // over-long value shouldn't fail the like — just drop it. Cap shared with the
  // /api/events contract.
  const rawSessionId = str((body as Record<string, unknown>)?.sessionId);
  const sessionId = rawSessionId.length <= SESSION_ID_MAX ? rawSessionId : "";

  // Owner liking own work is noise; re-check server-side (client flag untrusted).
  // Cheap cookie unseal (no DB) — also keeps the owner out of the rate limiter.
  if (await isAdmin()) return noContent();

  // Per-IP throughput gate BEFORE the (potentially expensive) catalog rebuild,
  // so a flood is short-circuited cheaply. Terse 204 like the dedup path — a
  // like is idempotent, so bots learn nothing and the optimistic UI is harmless.
  const ipHash = hashIp(clientIpOf(request));
  if (await isRateLimited("like", ipHash, LIKE_MAX, LIKE_WINDOW_MS)) {
    return noContent();
  }

  // The artwork must exist in the live catalog (same trust rule as inquiries).
  const ref = (await getArtworkIndex()).get(artworkPublicId);
  if (!ref) return invalid();

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
  const artworkPublicId = str((body as Record<string, unknown>)?.artworkPublicId);
  if (!artworkPublicId || artworkPublicId.length > ARTWORK_PUBLIC_ID_MAX) {
    return invalid();
  }
  if (await isAdmin()) return noContent();

  // Same "like" bucket as POST, so a like/unlike toggle-flood shares one budget.
  const ipHash = hashIp(clientIpOf(request));
  if (await isRateLimited("like", ipHash, LIKE_MAX, LIKE_WINDOW_MS)) {
    return noContent();
  }

  // Same trust rule as POST: the artwork must exist in the live catalog.
  // Mirrors POST's guard order (length cap → admin no-op → rate limit →
  // catalog check) so DELETE can't be used to probe the DB with an
  // unbounded or nonexistent id that POST would have rejected first.
  const ref = (await getArtworkIndex()).get(artworkPublicId);
  if (!ref) return invalid();

  // deleteMany → idempotent (unliking something not liked is a no-op, not a 404).
  await prisma.like.deleteMany({ where: { artworkPublicId, ipHash } });
  return noContent();
}
