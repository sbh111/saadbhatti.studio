import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signature endpoint hands out a capability: a valid ticket authorises an
 * upload into the Cloudinary account. So the tests that matter are the gate
 * (admin only), the scope (one post's folder, and only a real post's), and
 * the refusal of anything that could widen either.
 */

const isAdmin = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/auth", () => ({
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { post: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

// Real credentials are never needed — mintBlogUploadTicket only reads these to
// sign, and the signature itself is covered by test/lib/cloudinaryUpload.ts
// against a fixture taken from Cloudinary's own error response.
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const { POST } = await import("@/app/api/admin/blog/upload-signature/route");
const { BLOG_UPLOAD_FORMATS } = await import("@/lib/cloudinaryUpload");

const POST_ID = "clq2x8k9p0000abcd1234efgh";

const request = (body: unknown) =>
  new Request("http://localhost/api/admin/blog/upload-signature", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  isAdmin.mockReset().mockResolvedValue(false);
  findUnique.mockReset().mockResolvedValue({ id: POST_ID, slug: "on-shooting-portra" });
});

describe("POST /api/admin/blog/upload-signature", () => {
  it("401s when there is no admin session", async () => {
    const response = await POST(request({ postId: POST_ID }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("checks the session itself rather than trusting the proxy", async () => {
    // docs/architecture.md invariant 3: proxy.ts is a UX gate, never the
    // security boundary. The route must ask.
    await POST(request({ postId: POST_ID }));
    expect(isAdmin).toHaveBeenCalled();
  });

  it("never reaches the database when the caller is not an admin", async () => {
    await POST(request({ postId: POST_ID }));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns a ticket scoped to that post's folder", async () => {
    isAdmin.mockResolvedValue(true);
    const response = await POST(request({ postId: POST_ID }));
    expect(response.status).toBe(200);

    const ticket = await response.json();
    expect(ticket.folder).toBe(`blog/on-shooting-portra-${POST_ID}`);
    expect(ticket.allowedFormats).toBe(BLOG_UPLOAD_FORMATS);
    expect(ticket.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(ticket.uploadUrl).toMatch(/^https:\/\/api\.cloudinary\.com\//);
    // Seconds, not milliseconds — Cloudinary compares against a Unix
    // timestamp and would reject a millisecond value as an hour-old one.
    expect(ticket.timestamp).toBeLessThan(Date.now() / 1000 + 5);
    expect(ticket.timestamp).toBeGreaterThan(Date.now() / 1000 - 5);
  });

  it("takes the folder's readable half from the database, not the request", async () => {
    // Otherwise a hand-crafted POST could name the folder whatever it liked,
    // and the name is part of what gets signed.
    isAdmin.mockResolvedValue(true);
    const response = await POST(
      request({ postId: POST_ID, slug: "../art/photography" })
    );
    const ticket = await response.json();
    expect(ticket.folder).toBe(`blog/on-shooting-portra-${POST_ID}`);
  });

  it("400s on a post id that could escape the blog folder", async () => {
    isAdmin.mockResolvedValue(true);
    for (const bad of ["../art", "blog/../art", "a/b", "a.b", "", "x"]) {
      const response = await POST(request({ postId: bad }));
      expect(response.status, `${JSON.stringify(bad)} should be rejected`).toBe(
        400
      );
    }
    // Rejected on shape alone — no query, so a malformed id costs nothing.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("400s for a well-formed id that is not a real post", async () => {
    isAdmin.mockResolvedValue(true);
    findUnique.mockResolvedValue(null);
    const response = await POST(request({ postId: POST_ID }));
    expect(response.status).toBe(400);
  });

  it("400s on a malformed or missing body rather than throwing", async () => {
    isAdmin.mockResolvedValue(true);
    expect((await POST(request("not json"))).status).toBe(400);
    expect((await POST(request({}))).status).toBe(400);
  });

  it("never returns the API secret", async () => {
    isAdmin.mockResolvedValue(true);
    const body = await (await POST(request({ postId: POST_ID }))).text();
    expect(body).not.toContain("test-secret");
    // The api_key is an identifier, not a secret, and the browser needs it to
    // upload — so it IS present, deliberately.
    expect(body).toContain("test-key");
  });

  it("is uncacheable — a ticket expires and is post-specific", async () => {
    isAdmin.mockResolvedValue(true);
    const response = await POST(request({ postId: POST_ID }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
