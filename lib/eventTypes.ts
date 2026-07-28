/**
 * Shared, client-safe definitions for the (optional, toggleable) Kafka event
 * stream. Deliberately free of any server/Prisma import so both the client
 * EventTracker and the server /api/events validator pull from ONE source of
 * truth — the same pattern as lib/inquiryLimits.ts. See docs/kafkaEventsPlan.md.
 */

export const EVENT_SCHEMA_VERSION = 1;

export type EventType =
  | "page_view"
  | "click"
  | "artwork_view"
  | "artwork_intent"
  | "artwork_like"; // server-emitted by /api/likes, not the client batch

/** Runtime-checkable set of the union above (the server validates against it). */
export const EVENT_TYPES: readonly EventType[] = [
  "page_view",
  "click",
  "artwork_view",
  "artwork_intent",
  "artwork_like",
];

export type IntentGesture = "middle_click" | "modifier_click" | "context_menu";

export const INTENT_GESTURES: readonly IntentGesture[] = [
  "middle_click",
  "modifier_click",
  "context_menu",
];

/** One event as the browser produces it (before server enrichment). */
export interface ClientEvent {
  v: number;
  type: EventType;
  ts: string; // ISO8601, client clock
  sessionId: string; // uuid in sessionStorage — dies with the tab, not a cookie
  path: string;
  referrer: string | null;
  artworkPublicId?: string; // artwork_* events
  target?: string; // click: a semantic label, never a raw selector
  gesture?: IntentGesture; // artwork_intent only
  viewport?: { w: number; h: number };
}

/** Batch shaping — the client flushes at whichever comes first. */
export const MAX_BATCH = 25;
export const FLUSH_INTERVAL_MS = 15_000;

/** Field length caps the server enforces (clients are untrusted). */
export const PATH_MAX = 512;
export const REFERRER_MAX = 512;
export const TARGET_MAX = 64;
export const SESSION_ID_MAX = 64;
export const ARTWORK_PUBLIC_ID_MAX = 255;
export const TS_MAX = 40;
