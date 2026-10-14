import { beforeEach, describe, expect, it, vi } from "vitest";

// clientIpOf/hashIp run for real (see lib/inquiries.ts) — hashIp throws without this.
process.env.IP_HASH_SALT = "test-salt";

// Never let the real CLIP model load — it downloads weights and is the whole
// reason encoding must be gated behind every cheap check first.
const embedText = vi.fn();
vi.mock("@/lib/clip", () => ({
  embedText: (...args: unknown[]) => embedText(...args),
  EMBED_DIM: 512,
}));

const queryRaw = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

vi.mock("@/lib/catalog", () => ({
  getArtworkIndex: vi.fn().mockResolvedValue(new Map()),
}));

// Only isRateLimited is faked; QUERY_MAX_CHARS/MIN_SCORE/etc. stay the real
// tuning constants so the "over the cap" test pins the real threshold.
const rateLimited = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, isRateLimited: (...args: unknown[]) => rateLimited(...args) };
});

const { POST } = await import("@/app/api/search/route");
const { NextRequest } = await import("next/server");
const { QUERY_MAX_CHARS } = await import("@/lib/rateLimit");

function req(body: unknown) {
  return new NextRequest("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const okVector = new Float32Array(512).fill(0.02);

describe("POST /api/search", () => {
  beforeEach(() => {
    embedText.mockReset().mockResolvedValue(okVector);
    queryRaw.mockClear().mockResolvedValue([]);
    rateLimited.mockReset().mockResolvedValue(false);
  });

  it("rejects a non-string query with 400", async () => {
    const res = await POST(req({ query: 42 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid" });
    expect(rateLimited).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  it("returns empty results for a blank query, without touching the limiter or encoder", async () => {
    const res = await POST(req({ query: "    " }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
    expect(rateLimited).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  it("returns empty results for a query over QUERY_MAX_CHARS", async () => {
    const res = await POST(req({ query: "a".repeat(QUERY_MAX_CHARS + 1) }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
    expect(rateLimited).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  it("rejects an oversized body with 400, before it's even parsed as JSON", async () => {
    // Comfortably over the route's 4 KiB body cap — big enough that if this
    // were parsed/sanitized instead of rejected up front, it'd also trip the
    // raw-query bound below, but the point of this test is that it never
    // gets that far: the byte cap is checked before JSON.parse.
    const res = await POST(req({ query: "a".repeat(20_000) }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid" });
    expect(rateLimited).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  it("returns empty results for a raw query over the raw bound, without normalizing", async () => {
    // Under the 4 KiB body cap, but over the route's RAW_QUERY_MAX_CHARS (a
    // generous multiple of QUERY_MAX_CHARS — not exported, so mirrored here)
    // — this must be rejected before sanitize()'s normalize/regex passes run.
    const res = await POST(req({ query: "a".repeat(QUERY_MAX_CHARS * 10 + 1) }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
    expect(rateLimited).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  it("strips control characters and collapses whitespace before encoding", async () => {
    const raw = "  Sunset\x00\x07 over    the\x1F ocean  ";
    const res = await POST(req({ query: raw }));
    expect(res.status).toBe(200);
    expect(embedText).toHaveBeenCalledWith("Sunset over the ocean");
  });

  it("429s when the per-IP limit trips, without calling the encoder", async () => {
    rateLimited.mockImplementation((bucket: string) =>
      Promise.resolve(bucket === "search")
    );
    const res = await POST(req({ query: "a boat at dusk" }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "rate_limited" });
    expect(embedText).not.toHaveBeenCalled();
  });

  it("503s when the global cost ceiling trips, without calling the encoder", async () => {
    rateLimited.mockImplementation((bucket: string) =>
      Promise.resolve(bucket === "search_global")
    );
    const res = await POST(req({ query: "a boat at dusk" }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "busy" });
    expect(embedText).not.toHaveBeenCalled();
  });
});
