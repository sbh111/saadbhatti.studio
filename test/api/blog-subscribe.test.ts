import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.IP_HASH_SALT = "test-salt";
process.env.SUBSCRIBE_TOKEN_SECRET = "test-secret";

const findUnique = vi.fn();
const upsert = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    subscriber: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      upsert: (...a: unknown[]) => upsert(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

const sendSubscribeConfirmation = vi.fn();
vi.mock("@/lib/subscribeMail", () => ({
  sendSubscribeConfirmation: (...a: unknown[]) =>
    sendSubscribeConfirmation(...a),
}));

const isRateLimited = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, isRateLimited: (...a: unknown[]) => isRateLimited(...a) };
});

// Run after() inline so the confirmation send is observable.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void fn() };
});

const { POST } = await import("@/app/api/blog/subscribe/route");
const { NextRequest } = await import("next/server");
const { SUBSCRIBE_RESEND_COOLDOWN_MS } = await import("@/lib/rateLimit");

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/blog/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** The one response every allowed branch must produce, byte for byte. */
const EXPECTED = { ok: true };

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(null);
  upsert.mockReset().mockResolvedValue({ id: "sub_1" });
  deleteMany.mockReset().mockResolvedValue({ count: 0 });
  sendSubscribeConfirmation.mockReset().mockResolvedValue(true);
  isRateLimited.mockReset().mockResolvedValue(false);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * THE property of this endpoint. Anything that distinguishes these branches
 * turns it into an email-existence oracle — a way for anyone to test whether a
 * given person subscribes to this blog.
 */
describe("POST /api/blog/subscribe — no existence oracle", () => {
  const branches: [string, () => void][] = [
    ["a brand new address", () => findUnique.mockResolvedValue(null)],
    [
      "a pending address past its cooldown",
      () =>
        findUnique.mockResolvedValue({
          id: "sub_1",
          status: "PENDING",
          tokenSentAt: new Date(Date.now() - SUBSCRIBE_RESEND_COOLDOWN_MS - 1000),
        }),
    ],
    [
      "a pending address WITHIN its cooldown",
      () =>
        findUnique.mockResolvedValue({
          id: "sub_1",
          status: "PENDING",
          tokenSentAt: new Date(),
        }),
    ],
    [
      "an already-confirmed address",
      () =>
        findUnique.mockResolvedValue({
          id: "sub_1",
          status: "CONFIRMED",
          tokenSentAt: null,
        }),
    ],
    [
      "a previously unsubscribed address",
      () =>
        findUnique.mockResolvedValue({
          id: "sub_1",
          status: "UNSUBSCRIBED",
          tokenSentAt: null,
        }),
    ],
    ["the database being down", () => findUnique.mockRejectedValue(new Error("down"))],
  ];

  it.each(branches)("answers an identical 200 for %s", async (_label, setup) => {
    setup();
    const response = await POST(req({ email: "someone@example.com" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EXPECTED);
  });

  it("answers the same for a tripped honeypot, and writes nothing", async () => {
    const response = await POST(
      req({ email: "someone@example.com", website: "http://spam" })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EXPECTED);
    expect(upsert).not.toHaveBeenCalled();
    expect(sendSubscribeConfirmation).not.toHaveBeenCalled();
  });
});

describe("POST /api/blog/subscribe — when mail is actually sent", () => {
  it("mails a new address", async () => {
    await POST(req({ email: "new@example.com" }));
    expect(upsert).toHaveBeenCalled();
    expect(sendSubscribeConfirmation).toHaveBeenCalledTimes(1);
  });

  it("does NOT mail an already-confirmed address", async () => {
    // An "already subscribed" email would both leak membership and burn quota.
    findUnique.mockResolvedValue({ id: "sub_1", status: "CONFIRMED", tokenSentAt: null });
    await POST(req({ email: "known@example.com" }));
    expect(upsert).not.toHaveBeenCalled();
    expect(sendSubscribeConfirmation).not.toHaveBeenCalled();
  });

  it("does NOT re-mail inside the cooldown", async () => {
    findUnique.mockResolvedValue({
      id: "sub_1",
      status: "PENDING",
      tokenSentAt: new Date(),
    });
    await POST(req({ email: "pending@example.com" }));
    expect(sendSubscribeConfirmation).not.toHaveBeenCalled();
  });

  it("re-consents a resubscriber rather than silently reinstating them", async () => {
    findUnique.mockResolvedValue({ id: "sub_1", status: "UNSUBSCRIBED", tokenSentAt: null });
    await POST(req({ email: "back@example.com" }));
    expect(upsert.mock.calls[0][0].update.status).toBe("PENDING");
    expect(upsert.mock.calls[0][0].update.unsubscribedAt).toBeNull();
    expect(sendSubscribeConfirmation).toHaveBeenCalledTimes(1);
  });

  it("stores only the token HASH, never the token", async () => {
    await POST(req({ email: "new@example.com" }));
    const created = upsert.mock.calls[0][0].create;
    const sentUrl = sendSubscribeConfirmation.mock.calls[0][0].confirmUrl;
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created).not.toHaveProperty("token");
    // The plaintext appears in the link and nowhere else.
    expect(sentUrl).not.toContain(created.tokenHash);
  });

  it("normalises the address before storing it", async () => {
    await POST(req({ email: "  MixedCase@Example.COM " }));
    expect(upsert.mock.calls[0][0].create.email).toBe("mixedcase@example.com");
  });

  it("keeps the row but skips the send when the daily cap is reached", async () => {
    isRateLimited.mockImplementation(async (bucket: string) => bucket === "subscribe_email");
    await POST(req({ email: "new@example.com" }));
    expect(upsert).toHaveBeenCalled();
    expect(sendSubscribeConfirmation).not.toHaveBeenCalled();
  });

  it("still answers 200 when the send throws", async () => {
    sendSubscribeConfirmation.mockRejectedValue(new Error("resend down"));
    const response = await POST(req({ email: "new@example.com" }));
    expect(response.status).toBe(200);
  });
});

describe("POST /api/blog/subscribe — rejections", () => {
  it("rate-limits BEFORE the honeypot", async () => {
    isRateLimited.mockResolvedValue(true);
    const response = await POST(
      req({ email: "x@example.com", website: "http://spam" })
    );
    expect(response.status).toBe(429);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("400s a malformed address or body", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ email: "not-an-email" }))).status).toBe(400);
    expect((await POST(req({ email: `${"a".repeat(250)}@example.com` }))).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
