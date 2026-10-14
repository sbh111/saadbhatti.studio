import { beforeEach, describe, expect, it, vi } from "vitest";

// hashIp() throws without this — see lib/inquiries.ts. Set before any module
// under test is imported; clientIpOf/hashIp are exercised for real below, only
// the rate limiter and every networked module are mocked (test/setup.ts also
// blanks it, and everything else dangerous, as a belt-and-braces guard).
process.env.IP_HASH_SALT = "test-salt";

const create = vi.fn();
const update = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: { inquiry: { create: (...args: unknown[]) => create(...args), update: (...args: unknown[]) => update(...args) } },
}));

const getArtworkIndex = vi.fn();
vi.mock("@/lib/catalog", () => ({
  getArtworkIndex: (...args: unknown[]) => getArtworkIndex(...args),
}));

const sendInquiryNotification = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/mail", () => ({
  sendInquiryNotification: (...args: unknown[]) => sendInquiryNotification(...args),
}));

// clientIpOf/hashIp (lib/inquiries.ts) run for real, unmocked — only the
// shared limiter (lib/rateLimit.ts) is faked, since the route now calls it
// directly for both the per-IP inquiry budget and, inside the fire-and-forget
// after() callback, the daily email-notification cap. A single mock covers
// both call sites; none of the assertions below distinguish which bucket a
// call was for.
const isRateLimited = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimited(...args),
  DAILY_EMAIL_CAP: 200,
  DAY_MS: 86_400_000,
}));

// after() normally requires a request-scoped context (App Router internals);
// route handlers invoked directly from a test have none. Run the callback
// immediately instead — its own effects (email + status update) are on mocked
// modules already, so nothing here can reach a real service.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void fn() };
});

const { POST } = await import("@/app/api/inquiries/route");
const { NextRequest } = await import("next/server");

function req(body: unknown) {
  return new NextRequest("http://localhost/api/inquiries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "Is this piece available?",
  artworkPublicId: "collection/artwork-1",
};

describe("POST /api/inquiries", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: "inquiry-1" });
    update.mockClear();
    getArtworkIndex.mockReset();
    sendInquiryNotification.mockClear();
    isRateLimited.mockReset().mockResolvedValue(false);
  });

  it("honeypot: under the limit, returns 200 and touches nothing else", async () => {
    const res = await POST(req({ ...validBody, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    // The limiter IS consulted (and so counts this request) — only the db
    // write, catalog lookup, and email are skipped.
    expect(isRateLimited).toHaveBeenCalledTimes(1);
    expect(getArtworkIndex).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("honeypot: over the limit, 429 like any other submission — no bypass", async () => {
    isRateLimited.mockResolvedValue(true);
    const res = await POST(req({ ...validBody, website: "http://spam.example" }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "rate_limited" });
    expect(getArtworkIndex).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("invalid fields: 400 once the request is under the rate limit", async () => {
    const res = await POST(req({ ...validBody, name: "" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid" });
    expect(isRateLimited).toHaveBeenCalledTimes(1);
  });

  it("over the rate limit: 429 before the honeypot check or catalog lookup", async () => {
    isRateLimited.mockResolvedValue(true);
    const res = await POST(req(validBody));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "rate_limited" });
    expect(getArtworkIndex).not.toHaveBeenCalled();
  });

  it("unknown artwork: 400 and no row is inserted", async () => {
    getArtworkIndex.mockResolvedValue(new Map()); // artworkPublicId not present
    const res = await POST(req(validBody));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid" });
    expect(create).not.toHaveBeenCalled();
  });

  it("accepted: 201, and the stored title comes from the catalog, not the client", async () => {
    getArtworkIndex.mockResolvedValue(
      new Map([
        [
          "collection/artwork-1",
          {
            artwork: { name: "Trusted Catalog Title", slug: "artwork-1" },
            mediumSlug: "paintings",
            collectionSlug: "collection",
          },
        ],
      ])
    );

    // A payload can't actually smuggle a title (the route never reads
    // raw.artworkTitle) — spoofing it here just makes the assertion concrete.
    const res = await POST(req({ ...validBody, artworkTitle: "Spoofed Title" }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    const { data } = create.mock.calls[0][0];
    expect(data.artworkTitle).toBe("Trusted Catalog Title");
    expect(data.artworkPublicId).toBe("collection/artwork-1");
  });
});
