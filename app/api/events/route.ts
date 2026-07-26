import { NextResponse, after, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import { isEventStreamingEnabled } from "@/lib/settings";
import { forwardEvents, type EnrichedEvent } from "@/lib/collector";
import {
  ARTWORK_PUBLIC_ID_MAX,
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  INTENT_GESTURES,
  MAX_BATCH,
  PATH_MAX,
  REFERRER_MAX,
  SESSION_ID_MAX,
  TARGET_MAX,
  TS_MAX,
  type ClientEvent,
  type EventType,
  type IntentGesture,
} from "@/lib/eventTypes";

/**
 * Public clickstream ingest for the (optional, toggleable) Kafka pipeline.
 * Deliberately NOT under /api/admin so the proxy never intercepts visitor
 * traffic (same reasoning as /api/inquiries). Contract mirrors the mail phase:
 * ALWAYS 204, never blocks — the collector forward runs in after() with every
 * error swallowed, so a dead broker is invisible to visitors.
 *
 *   toggle off / admin / empty|malformed batch → 204, nothing forwarded
 *   valid batch                                 → 204, forwarded in after()
 *
 * We never surface validation errors (204 regardless): this endpoint carries no
 * user-facing meaning, and terse responses give bots nothing.
 */
export const dynamic = "force-dynamic";

const noContent = () => new NextResponse(null, { status: 204 });

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);
const GESTURE_SET = new Set<string>(INTENT_GESTURES);

/** Trimmed string within [1, max], else undefined. */
function boundedStr(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : undefined;
}

/** Validate + normalize one raw client event, or drop it (null). */
function sanitize(raw: unknown): ClientEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;

  if (typeof e.type !== "string" || !EVENT_TYPE_SET.has(e.type)) return null;
  const path = boundedStr(e.path, PATH_MAX);
  const sessionId = boundedStr(e.sessionId, SESSION_ID_MAX);
  if (!path || !sessionId) return null;

  const clean: ClientEvent = {
    v: EVENT_SCHEMA_VERSION,
    type: e.type as EventType,
    ts: boundedStr(e.ts, TS_MAX) ?? new Date().toISOString(),
    sessionId,
    path,
    referrer: boundedStr(e.referrer, REFERRER_MAX) ?? null,
  };

  const artworkPublicId = boundedStr(e.artworkPublicId, ARTWORK_PUBLIC_ID_MAX);
  if (artworkPublicId) clean.artworkPublicId = artworkPublicId;
  const target = boundedStr(e.target, TARGET_MAX);
  if (target) clean.target = target;
  if (typeof e.gesture === "string" && GESTURE_SET.has(e.gesture)) {
    clean.gesture = e.gesture as IntentGesture;
  }
  const vp = e.viewport as { w?: unknown; h?: unknown } | undefined;
  if (vp && typeof vp.w === "number" && typeof vp.h === "number") {
    clean.viewport = { w: vp.w | 0, h: vp.h | 0 };
  }
  return clean;
}

export async function POST(request: NextRequest) {
  // Cheapest outs first. The toggle is checked before any body parse or session
  // unseal, so the default (off) path costs almost nothing.
  if (!(await isEventStreamingEnabled())) return noContent();
  // Don't record ourselves. Defense-in-depth: the tracker also suppresses
  // client-side, but the client flag resolves async and can be spoofed.
  if (await isAdmin()) return noContent();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noContent();
  }
  const list = (body as { events?: unknown })?.events;
  if (!Array.isArray(list)) return noContent();

  const clean: ClientEvent[] = [];
  for (const raw of list.slice(0, MAX_BATCH)) {
    const ev = sanitize(raw);
    if (ev) clean.push(ev);
  }
  if (clean.length === 0) return noContent();

  const ipHash = hashIp(clientIpOf(request));
  const country = request.headers.get("x-vercel-ip-country");
  const userAgent = request.headers.get("user-agent");
  const receivedAt = new Date().toISOString();

  const enriched: EnrichedEvent[] = clean.map((c) => ({
    ...c,
    ipHash,
    country,
    userAgent,
    receivedAt,
  }));

  after(() => forwardEvents(enriched).catch(() => {}));
  return noContent();
}
