import { beforeEach, describe, expect, it, vi } from "vitest";

// clientIpOf/hashIp (lib/inquiries.ts) run for real — hashIp throws without this.
process.env.IP_HASH_SALT = "test-salt";

const create = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    like: {
      create: (...args: unknown[]) => create(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}));

const getArtworkIndex = vi.fn();
vi.mock("@/lib/catalog", () => ({
  getArtworkIndex: (...args: unknown[]) => getArtworkIndex(...args),
}));

const isAdmin = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/auth", () => ({
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));

const isRateLimited = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, isRateLimited: (...args: unknown[]) => isRateLimited(...args) };
});

// The Kafka forward is only reachable past a genuinely new like; irrelevant to
// the guard ordering these tests pin, so streaming stays off throughout.
vi.mock("@/lib/settings", () => ({
  isEventStreamingEnabled: vi.fn().mockResolvedValue(false),
}));
const forwardEvents = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/collector", () => ({
  forwardEvents: (...args: unknown[]) => forwardEvents(...args),
}));

const { POST, DELETE } = await import("@/app/api/likes/route");
const { NextRequest } = await import("next/server");
const { ARTWORK_PUBLIC_ID_MAX } = await import("@/lib/eventTypes");

function req(method: "POST" | "DELETE", body: unknown) {
  return new NextRequest("http://localhost/api/likes", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const knownArtwork = "collection/artwork-1";
const catalogWithArtwork = new Map([
  [
    knownArtwork,
    {
      artwork: { name: "Known Piece", slug: "artwork-1" },
      mediumSlug: "paintings",
      collectionSlug: "collection",
    },
  ],
]);

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "like-1" });
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  getArtworkIndex.mockReset().mockResolvedValue(catalogWithArtwork);
  isAdmin.mockReset().mockResolvedValue(false);
  isRateLimited.mockReset().mockResolvedValue(false);
  forwardEvents.mockClear();
});

describe.each([
  { method: "POST" as const, handler: () => POST, dbCall: () => create },
  { method: "DELETE" as const, handler: () => DELETE, dbCall: () => deleteMany },
])("$method /api/likes", ({ method, handler, dbCall }) => {
  it("invalid id: missing artworkPublicId is rejected before any guard runs", async () => {
    const res = await handler()(req(method, {}));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid" });
    expect(isAdmin).not.toHaveBeenCalled();
    expect(isRateLimited).not.toHaveBeenCalled();
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("over-long id: rejected before any guard runs (mirrors POST's cap)", async () => {
    const res = await handler()(
      req(method, { artworkPublicId: "x".repeat(ARTWORK_PUBLIC_ID_MAX + 1) })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid" });
    expect(isAdmin).not.toHaveBeenCalled();
    expect(isRateLimited).not.toHaveBeenCalled();
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("admin: 204 no-op, never reaches the rate limiter or the db", async () => {
    isAdmin.mockResolvedValue(true);
    const res = await handler()(req(method, { artworkPublicId: knownArtwork }));
    expect(res.status).toBe(204);
    expect(isRateLimited).not.toHaveBeenCalled();
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("rate limited: 204, never reaches the catalog lookup or the db", async () => {
    isRateLimited.mockResolvedValue(true);
    const res = await handler()(req(method, { artworkPublicId: knownArtwork }));
    expect(res.status).toBe(204);
    expect(getArtworkIndex).not.toHaveBeenCalled();
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("unknown artwork: 400 invalid, and the db is never touched", async () => {
    getArtworkIndex.mockResolvedValue(new Map());
    const res = await handler()(req(method, { artworkPublicId: knownArtwork }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid" });
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("success: 204, and the db call receives the artwork id", async () => {
    const res = await handler()(req(method, { artworkPublicId: knownArtwork }));
    expect(res.status).toBe(204);
    expect(dbCall()).toHaveBeenCalledTimes(1);
    const { data, where } = dbCall().mock.calls[0][0];
    const artworkPublicId = (data ?? where).artworkPublicId;
    expect(artworkPublicId).toBe(knownArtwork);
  });
});
