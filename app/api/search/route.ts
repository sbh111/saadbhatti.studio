import { NextResponse, type NextRequest } from "next/server";
import { getArtworkIndex } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { busy, invalid, rateLimited, readCappedText, unavailable } from "@/lib/http";
import { clientIpOf, hashIp } from "@/lib/inquiries";
import {
  isRateLimited,
  SEARCH_MAX,
  SEARCH_WINDOW_MS,
  SEARCH_GLOBAL_MAX,
  SEARCH_GLOBAL_WINDOW_MS,
  QUERY_MAX_CHARS,
  MIN_SCORE,
} from "@/lib/rateLimit";
import { embedText, EMBED_DIM } from "@/lib/clip";

/**
 * Public visual search — POST { query } → up to 5 matching artworks.
 *
 * This is the only endpoint that runs ML inference per request, so it is the most
 * expensive to abuse. Ordering is load-bearing: the body is read under a byte cap
 * BEFORE it's parsed as JSON at all, the raw query is bounded BEFORE it's
 * normalized/regex-scanned, and only then do the DB-backed rate limits run —
 * all of it before the CLIP text encoding, so throttled (or oversized) requests
 * never pay for inference or even for a full sanitize pass. Errors are terse;
 * the query/internal state is never echoed. Node runtime (transformers.js needs
 * Node, not Edge).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const empty = () => NextResponse.json({ results: [] });

// A search query is a couple hundred chars at most; 4 KiB is a generous cap on
// the WHOLE json body (not just the query string) that's dirt cheap to enforce
// up front and stops a multi-megabyte POST from ever reaching JSON.parse.
const MAX_BODY_BYTES = 4096;

// Bound the RAW query length before normalize/regex ever touch it. This can't
// just be QUERY_MAX_CHARS: sanitize() collapses runs of whitespace/control
// characters down to single spaces, so a query well over QUERY_MAX_CHARS
// pre-sanitize can still land under it post-sanitize without being abusive
// input (e.g. lots of padding around a short real query). A generous multiple
// gives real queries all the slack sanitize() needs while still bounding an
// attacker's payload to a few KB before any regex pass runs.
const RAW_QUERY_MAX_CHARS = QUERY_MAX_CHARS * 10;

// C0 control range + DEL. Built via RegExp string (escapes, not literal bytes).
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/** NFC-normalize, strip control chars, collapse whitespace; bound length. */
function sanitize(raw: string): string | null {
  const cleaned = raw
    .normalize("NFC")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 1 || cleaned.length > QUERY_MAX_CHARS) return null;
  return cleaned;
}

export async function POST(request: NextRequest) {
  // Bound the body BEFORE it's parsed as JSON at all — the cheapest possible
  // check, and the one that stops an unbounded stream from being fully read
  // into memory in the first place.
  const rawBody = await readCappedText(request, MAX_BODY_BYTES);
  if (rawBody === null) return invalid();

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalid();
  }
  const rawQuery = (body as Record<string, unknown>)?.query;
  if (typeof rawQuery !== "string") return invalid();

  // Same terse "no results" outcome as the post-sanitize cap below — an
  // oversize raw query is treated as no match, not an error, before it ever
  // reaches normalize()/regex.
  if (rawQuery.length > RAW_QUERY_MAX_CHARS) return empty();

  // Cheap sanitize (in-memory). Empty/over-cap → no results, not an error.
  const query = sanitize(rawQuery);
  if (query === null) return empty();

  // Per-IP limit, then global cost ceiling — both before the expensive encode.
  const ipHash = hashIp(clientIpOf(request));
  if (await isRateLimited("search", ipHash, SEARCH_MAX, SEARCH_WINDOW_MS)) {
    return rateLimited();
  }
  if (
    await isRateLimited(
      "search_global",
      "__global__",
      SEARCH_GLOBAL_MAX,
      SEARCH_GLOBAL_WINDOW_MS
    )
  ) {
    return busy();
  }

  // The expensive step, last. Await the single shared init (concurrent-safe).
  let vec: Float32Array;
  try {
    vec = await embedText(query);
  } catch (err) {
    console.error("search: embed failed", err);
    return unavailable();
  }
  // Guard against a malformed encoder output reaching the SQL cast.
  if (vec.length !== EMBED_DIM || !vec.every((n) => Number.isFinite(n))) {
    return unavailable();
  }

  // pgvector cosine ranking. The vector is our own computed floats, passed as a
  // BOUND parameter (never concatenated) then cast to ::vector. MIN_SCORE floors
  // out non-matches so a nonsense query returns few/none instead of 5 randoms.
  const literal = `[${Array.from(vec).join(",")}]`;
  const rows = await prisma.$queryRaw<{ publicId: string }[]>`
    SELECT "publicId"
    FROM "artwork_embeddings"
    WHERE 1 - (embedding <=> ${literal}::vector) >= ${MIN_SCORE}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT 5`;

  // Map winning public_ids back to display data + a deep link. A miss here means
  // the vector is stale — the artwork was deleted (or never embedded) but
  // artwork_embeddings hasn't caught up — see docs/operations.md §1 (drift
  // detection). Log it: this is the only place that would ever notice.
  const index = await getArtworkIndex();
  const misses: string[] = [];
  const results = rows.flatMap(({ publicId }) => {
    const ref = index.get(publicId);
    if (!ref) {
      misses.push(publicId);
      return [];
    }
    return [
      {
        image: publicId,
        name: ref.artwork.name,
        href: `/${ref.mediumSlug}/${ref.collectionSlug}#${ref.artwork.slug}`,
      },
    ];
  });
  if (misses.length > 0) {
    console.warn(
      `search: ${misses.length} vector hit(s) did not map to a catalog artwork — stale embeddings? re-run the embedder (docs/operations.md §1):`,
      misses
    );
  }

  return NextResponse.json({ results });
}
