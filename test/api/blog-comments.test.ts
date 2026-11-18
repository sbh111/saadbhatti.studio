import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.IP_HASH_SALT = "test-salt";

const create = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    postComment: {
      create: (...a: unknown[]) => create(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
    },
  },
}));

const isAdmin = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/auth", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));

const resolvePublishedPostId = vi.fn();
vi.mock("@/lib/engagement", () => ({
  resolvePublishedPostId: (...a: unknown[]) => resolvePublishedPostId(...a),
}));

const listPublishedComments = vi.fn();
vi.mock("@/lib/comments", () => ({
  listPublishedComments: (...a: unknown[]) => listPublishedComments(...a),
}));

const checkComment = vi.fn();
vi.mock("@/lib/akismet", () => ({
  checkComment: (...a: unknown[]) => checkComment(...a),
}));

const getBooleanSetting = vi.fn();
vi.mock("@/lib/settings", () => ({
  COMMENTS_ENABLED_KEY: "blog_comments_enabled",
  COMMENT_AUTO_PUBLISH_KEY: "blog_comment_auto_publish",
  getBooleanSetting: (...a: unknown[]) => getBooleanSetting(...a),
}));

const isRateLimited = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, isRateLimited: (...a: unknown[]) => isRateLimited(...a) };
});

const { GET, POST } = await import("@/app/api/blog/comments/route");
const { NextRequest } = await import("next/server");

const POST_ID = "cmwmftghq0000ghyv1bpoma0q";
const good = { slug: "a-post", name: "Visitor", body: "A thoughtful remark about the grain.", elapsedMs: 30_000 };

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/blog/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "UA" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const get = (qs: string) =>
  new NextRequest(`http://localhost/api/blog/comments${qs}`);

/** The status the route asked the database to store. */
const storedStatus = () => create.mock.calls[0][0].data.status;
const storedReason = () => create.mock.calls[0][0].data.spamReason;

beforeEach(() => {
  create.mockReset().mockResolvedValue({});
  findFirst.mockReset().mockResolvedValue(null);
  isAdmin.mockReset().mockResolvedValue(false);
  resolvePublishedPostId.mockReset().mockResolvedValue(POST_ID);
  listPublishedComments.mockReset().mockResolvedValue([]);
  checkComment.mockReset().mockResolvedValue({ verdict: "ham", reason: null });
  // Comments on, auto-publish off — the shipped defaults.
  getBooleanSetting.mockReset().mockImplementation(async (_k: string, fallback: boolean) => fallback);
  isRateLimited.mockReset().mockResolvedValue(false);
});

describe("POST — guard order", () => {
  it("rate-limits BEFORE the honeypot, so the honeypot is no bypass", async () => {
    // Tech debt 3.8 exactly: a bot that keeps the hidden field filled used to
    // get a 200 before the limiter ever ran — an unlimited bypass.
    isRateLimited.mockResolvedValue(true);
    const response = await POST(post({ ...good, website: "http://spam" }));
    expect(response.status).toBe(429);
    expect(create).not.toHaveBeenCalled();
  });

  it("mimics the HELD path for a tripped honeypot, writing nothing", async () => {
    const response = await POST(post({ ...good, website: "http://spam" }));
    expect(response.status).toBe(201);
    // "held" and not "published": a held comment is a real outcome, so this is
    // camouflage that survives the bot reloading the page.
    expect(await response.json()).toEqual({ ok: true, status: "held" });
    expect(create).not.toHaveBeenCalled();
  });

  it("503s busy when the site-wide ceiling is reached", async () => {
    isRateLimited.mockImplementation(async (bucket: string) => bucket === "blog_comment_global");
    const response = await POST(post(good));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "busy" });
    expect(create).not.toHaveBeenCalled();
  });

  it("400s out-of-bounds fields and an unparseable body", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ ...good, name: "" }))).status).toBe(400);
    expect((await POST(post({ ...good, body: "x" }))).status).toBe(400);
    expect((await POST(post({ ...good, name: "n".repeat(81) }))).status).toBe(400);
    expect((await POST(post({ ...good, body: "b".repeat(2001) }))).status).toBe(400);
    expect((await POST(post({ ...good, slug: "Not A Slug" }))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when comments are switched off", async () => {
    getBooleanSetting.mockImplementation(async (key: string) => key !== "blog_comments_enabled");
    expect((await POST(post(good))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s an unknown or unpublished slug", async () => {
    resolvePublishedPostId.mockResolvedValue(null);
    expect((await POST(post(good))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST — the filter decides the stored status", () => {
  it("holds a comment a heuristic flagged, WITHOUT calling Akismet", async () => {
    await POST(post({ ...good, body: "spam https://a.com https://b.com https://c.com" }));
    expect(storedStatus()).toBe("HELD");
    expect(storedReason()).toMatch(/links/);
    // The local pass is free; not paying for the network call is the point.
    expect(checkComment).not.toHaveBeenCalled();
  });

  it("holds when Akismet is unavailable — FAIL CLOSED", async () => {
    checkComment.mockResolvedValue({ verdict: "unavailable", reason: "akismet unreachable" });
    await POST(post(good));
    expect(storedStatus()).toBe("HELD");
    expect(storedReason()).toMatch(/unreachable/);
  });

  it("holds a clean verdict while auto-publish is off", async () => {
    await POST(post(good));
    expect(storedStatus()).toBe("HELD");
    expect(storedReason()).toMatch(/auto-publish off/);
  });

  it("publishes a clean verdict once auto-publish is on", async () => {
    getBooleanSetting.mockImplementation(async (key: string) =>
      key === "blog_comment_auto_publish" ? true : true
    );
    const response = await POST(post(good));
    expect(storedStatus()).toBe("PUBLISHED");
    expect(await response.json()).toEqual({ ok: true, status: "published" });
  });

  it("holds — not bins — ordinary Akismet spam, so the owner can audit", async () => {
    checkComment.mockResolvedValue({ verdict: "spam", reason: "akismet: spam" });
    await POST(post(good));
    expect(storedStatus()).toBe("HELD");
  });

  it("bins only a blatant verdict", async () => {
    checkComment.mockResolvedValue({ verdict: "blatant", reason: "akismet: discard" });
    await POST(post(good));
    expect(storedStatus()).toBe("SPAM");
  });

  it("truncates the reason to the column width", async () => {
    checkComment.mockResolvedValue({ verdict: "spam", reason: "x".repeat(400) });
    await POST(post(good));
    expect(storedReason().length).toBeLessThanOrEqual(200);
  });

  it("sends Akismet the raw IP and no email field", async () => {
    await POST(post(good));
    const arg = checkComment.mock.calls[0][0];
    expect(arg).toHaveProperty("userIp");
    expect(arg).not.toHaveProperty("authorEmail");
    expect(arg.permalink).toMatch(/^https:\/\/.+\/blog\/a-post$/);
  });
});

describe("POST — owner and duplicates", () => {
  it("publishes the owner's reply with a badge and skips the filter", async () => {
    isAdmin.mockResolvedValue(true);
    const response = await POST(post(good));
    expect(storedStatus()).toBe("PUBLISHED");
    expect(create.mock.calls[0][0].data.isOwner).toBe(true);
    expect(checkComment).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, status: "published" });
  });

  it("treats an exact duplicate as idempotent success with no second row", async () => {
    findFirst.mockResolvedValue({ status: "HELD" });
    const response = await POST(post(good));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, status: "held" });
    expect(create).not.toHaveBeenCalled();
  });

  it("never stores a client-supplied status or isOwner", async () => {
    await POST(post({ ...good, status: "PUBLISHED", isOwner: true }));
    expect(storedStatus()).toBe("HELD");
    expect(create.mock.calls[0][0].data.isOwner).toBeUndefined();
  });
});

describe("GET", () => {
  it("400s an invalid slug", async () => {
    expect((await GET(get("?slug=Not A Slug"))).status).toBe(400);
    expect((await GET(get(""))).status).toBe(400);
  });

  it("returns an empty list for an unknown slug rather than a 404", async () => {
    // It must not become an existence oracle for drafts.
    resolvePublishedPostId.mockResolvedValue(null);
    const response = await GET(get("?slug=a-draft"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ comments: [] });
  });

  it("returns published comments and is CDN-cacheable", async () => {
    listPublishedComments.mockResolvedValue([
      { id: "1", authorName: "V", body: "hi", createdAt: "2026-11-18T00:00:00.000Z", isOwner: false },
    ]);
    const response = await GET(get("?slug=a-post"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.comments).toHaveLength(1);
    expect(response.headers.get("cache-control")).toMatch(/s-maxage=15/);
    // Never per-visitor, so it is safe in a shared cache.
    expect(response.headers.get("cache-control")).not.toMatch(/private|no-store/);
  });

  it("429s when rate limited", async () => {
    isRateLimited.mockResolvedValue(true);
    expect((await GET(get("?slug=a-post"))).status).toBe(429);
  });

  it("503s on a read failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listPublishedComments.mockRejectedValue(new Error("down"));
    expect((await GET(get("?slug=a-post"))).status).toBe(503);
    spy.mockRestore();
  });
});
