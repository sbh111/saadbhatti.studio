import { EVENT_SCHEMA_VERSION, type EventType, type IntentGesture } from "./eventTypes";

/**
 * Server-side "forward events to the EC2 collector" helper — the single egress
 * point shared by /api/events (the client batch) and /api/likes (the
 * server-emitted artwork_like). Best-effort BY CONTRACT: it never throws to the
 * caller, and a missing config or dead collector is a silent no-op, exactly like
 * lib/mail.ts. Callers invoke it inside after() so it runs post-response and can
 * never add latency or fail a request. Imports nothing server-secret but reads
 * env — keep out of the client bundle. See docs/kafkaEventsPlan.md.
 */

/** An event as it leaves Vercel: the client shape plus server enrichment. */
export interface EnrichedEvent {
  v: number;
  type: EventType;
  ts: string;
  sessionId: string;
  path: string;
  referrer: string | null;
  artworkPublicId?: string;
  target?: string;
  gesture?: IntentGesture;
  viewport?: { w: number; h: number };
  // server enrichment (never client-supplied)
  ipHash: string;
  country: string | null;
  userAgent: string | null;
  receivedAt: string;
}

/** A hung collector must not tie up the serverless after() slot indefinitely. */
const COLLECTOR_TIMEOUT_MS = 2500;

export async function forwardEvents(events: EnrichedEvent[]): Promise<void> {
  if (events.length === 0) return;

  const url = process.env.EVENT_COLLECTOR_URL;
  const token = process.env.EVENT_INGEST_TOKEN;
  if (!url || !token) {
    // Streaming is on but the collector isn't wired up — drop, don't crash.
    console.warn(
      "forwardEvents: EVENT_COLLECTOR_URL / EVENT_INGEST_TOKEN unset — dropping batch."
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ v: EVENT_SCHEMA_VERSION, events }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) console.warn(`forwardEvents: collector returned HTTP ${res.status}`);
  } catch (err) {
    // Collector down / timeout / DNS — MUST stay invisible to visitors.
    console.warn("forwardEvents: forward failed (ignored):", (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}
