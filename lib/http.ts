import { NextResponse } from "next/server";

/**
 * Shared response/coercion helpers for every route under app/api/.
 *
 * Public routes deliberately return terse, generic errors — never explaining
 * *why* input was rejected, since that only helps a bot iterate — and before
 * this module each route re-invented that contract slightly differently: four
 * ad hoc string normalizers (`str`, `strOf`, `boundedStr`, `sanitize`) and, in
 * one route, an outlier error code ("bad request" instead of "invalid", the
 * only space-separated code in an otherwise snake_case codebase). Centralizing
 * the handful of shapes that recur means a new route reaches for one of these
 * instead of writing its own (tech debt 3.5).
 *
 * A route that needs more than trimming/bounding a string — the search query
 * normalizer, the per-event validator in lib/eventTypes-adjacent code — keeps
 * its own function, built out of `str`/`boundedStr` where that's natural.
 *
 * `readCappedText` is a separate concern (bounding a request body BEFORE it's
 * parsed at all) — currently adopted only by the search route, the one place
 * an unbounded body was actually exploitable, but written here so any other
 * route can reach for it too.
 */

/** 400 — malformed shape, or a field outside its bounds. */
export function invalid() {
  return NextResponse.json({ error: "invalid" }, { status: 400 });
}

/** 429 — this IP has used up its budget for the window. */
export function rateLimited() {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}

/** 503 — a site-wide cost ceiling has been reached (not this caller's fault). */
export function busy() {
  return NextResponse.json({ error: "busy" }, { status: 503 });
}

/** 503 — a dependency the request needed is down or misbehaving. */
export function unavailable() {
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

/** 401 — no valid admin session / bearer token. */
export function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** 204 — accepted, nothing to report back (idempotent writes, dropped events). */
export function noContent() {
  return new NextResponse(null, { status: 204 });
}

/** Trimmed string, or "" for anything that isn't a string. */
export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Trimmed string within [1, max], else undefined. */
export function boundedStr(v: unknown, max: number): string | undefined {
  const t = str(v);
  return t.length >= 1 && t.length <= max ? t : undefined;
}

/**
 * Reads a request body as text, capped at `maxBytes`, without ever buffering
 * more than that — a route with no default body-size limit (every route
 * handler here) would otherwise fully read/parse/scan whatever an
 * unauthenticated caller sends before any real validation runs (tech debt
 * 3.3). `Content-Length` is checked first as a cheap early-out, but is NOT
 * trusted alone — it can be absent (chunked transfer) or simply wrong — so
 * the stream itself is read incrementally and cancelled the moment it
 * exceeds the cap, before the whole body is ever assembled.
 *
 * @returns the body text, or `null` if it is (or turns out to be) oversized.
 */
export async function readCappedText(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) return null;

  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
