import { beforeEach, describe, expect, it, vi } from "vitest";

// clientIpOf/hashIp (lib/inquiries.ts) run for real — hashIp throws without
// this, and the leak assertion at the bottom recomputes the hash the route
// would have produced in order to assert its ABSENCE from the log.
process.env.IP_HASH_SALT = "test-salt";

const create = vi.fn();
const deleteMany = vi.fn();
const count = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    postLike: {
      create: (...a: unknown[]) => create(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));

const isAdmin = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/auth", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));

const resolvePublishedPostId = vi.fn();
vi.mock("@/lib/engagement", () => ({
  resolvePublishedPostId: (...a: unknown[]) => resolvePublishedPostId(...a),
  ENGAGEMENT_SLUG_MAX: 20,
}));

const isRateLimited = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, isRateLimited: (...a: unknown[]) => isRateLimited(...a) };
});

const { POST, DELETE } = await import("@/app/api/blog/likes/route");
const { NextRequest } = await import("next/server");
const { Prisma } = await import("@prisma/client");
const { hashIp, clientIpOf } = await import("@/lib/inquiries");

const POST_ID = "cmwmftghq0000ghyv1bpoma0q";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/blog/likes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  create.mockReset().mockResolvedValue({});
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  count.mockReset().mockResolvedValue(7);
  isAdmin.mockReset().mockResolvedValue(false);
  resolvePublishedPostId.mockReset().mockResolvedValue(POST_ID);
  isRateLimited.mockReset().mockResolvedValue(false);
});

/**
 * POST and DELETE are asserted through the SAME table, because the route
 * implements them as one function with one parameter. Tech debt 3.4 was a
 * DELETE that skipped two guards its own POST applied; this is the test that
 * would catch that regression — and the implementation makes it structurally
 * hard, since there is only one guard sequence to skip.
 */
describe.each([
  ["POST", POST, () => create],
  ["DELETE", DELETE, () => deleteMany],
] as const)("%s /api/blog/likes — shared guard order", (_label, handler, dbCall) => {
  it("400s a missing or malformed slug without touching anything downstream", async () => {
    for (const body of [{}, { slug: "" }, { slug: "Not A Slug" }, { slug: "../../etc" }]) {
      const response = await handler(req(body));
      expect(response.status).toBe(400);
    }
    expect(isAdmin).not.toHaveBeenCalled();
    expect(isRateLimited).not.toHaveBeenCalled();
    expect(resolvePublishedPostId).not.toHaveBeenCalled();
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("400s an unparseable body", async () => {
    expect((await handler(req("not json"))).status).toBe(400);
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("204s for the owner, before the limiter and before any query", async () => {
    isAdmin.mockResolvedValue(true);
    const response = await handler(req({ slug: "a-post" }));
    expect(response.status).toBe(204);
    expect(isRateLimited).not.toHaveBeenCalled();
    expect(resolvePublishedPostId).not.toHaveBeenCalled();
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("429s when rate limited, BEFORE resolving the post", async () => {
    isRateLimited.mockResolvedValue(true);
    const response = await handler(req({ slug: "a-post" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    // The thing this pins: a flood is short-circuited before it costs a query.
    expect(resolvePublishedPostId).not.toHaveBeenCalled();
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("400s an unknown or unpublished slug without writing", async () => {
    resolvePublishedPostId.mockResolvedValue(null);
    expect((await handler(req({ slug: "a-draft" }))).status).toBe(400);
    expect(dbCall()).not.toHaveBeenCalled();
  });

  it("uses the server-resolved post id, never one from the body", async () => {
    await handler(req({ slug: "a-post", postId: "spoofed-id" }));
    const arg = dbCall().mock.calls[0][0];
    const usedId = (arg.data ?? arg.where).postId;
    expect(usedId).toBe(POST_ID);
    expect(usedId).not.toBe("spoofed-id");
  });

  it("returns the fresh count on success, uncached", async () => {
    const response = await handler(req({ slug: "a-post" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likes: 7 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("503s on a database failure and never logs the ipHash", async () => {
    const logged: unknown[][] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args) => void logged.push(args));
    dbCall().mockRejectedValue(new Error("pooler died"));

    const response = await handler(req({ slug: "a-post" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(logged[0][0])).toMatch(/^\[blog\/likes\]/);

    // Invariant 6: the salted hash is PII-adjacent and must never be logged.
    const expectedHash = hashIp(clientIpOf(req({ slug: "a-post" })));
    expect(logged.flat().join(" ")).not.toContain(expectedHash);
    spy.mockRestore();
  });
});

describe("POST /api/blog/likes — dedup", () => {
  it("treats a repeat like as success with an unchanged count", async () => {
    // The unique index IS the dedup mechanism, so P2002 is the normal
    // idempotent path rather than an error.
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "6.19.3",
      })
    );
    count.mockResolvedValue(7);
    const response = await POST(req({ slug: "a-post" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likes: 7 });
  });

  it("does NOT swallow a non-P2002 database error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("gone", {
        code: "P1001",
        clientVersion: "6.19.3",
      })
    );
    expect((await POST(req({ slug: "a-post" }))).status).toBe(503);
    spy.mockRestore();
  });
});

describe("DELETE /api/blog/likes — idempotence", () => {
  it("unliking something never liked is a no-op, not a 404", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    count.mockResolvedValue(0);
    const response = await DELETE(req({ slug: "a-post" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likes: 0 });
  });
});
