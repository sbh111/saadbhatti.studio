import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signature endpoint hands out a capability: anyone holding a valid
 * ticket can upload into the Cloudinary account. So the tests that matter are
 * the gate (admin only) and the scope (what the ticket permits), not the
 * happy-path shape.
 */

const isAdmin = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/auth", () => ({
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));

// Real credentials are never needed — mintBlogUploadTicket only reads these to
// sign, and the signature itself is covered by test/lib/cloudinaryUpload.ts
// against a fixture taken from Cloudinary's own error response.
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const { POST } = await import("@/app/api/admin/blog/upload-signature/route");
const { BLOG_UPLOAD_FOLDER, BLOG_UPLOAD_FORMATS } = await import(
  "@/lib/cloudinaryUpload"
);

beforeEach(() => {
  isAdmin.mockReset().mockResolvedValue(false);
});

describe("POST /api/admin/blog/upload-signature", () => {
  it("401s when there is no admin session", async () => {
    const response = await POST();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("checks the session itself rather than trusting the proxy", async () => {
    // docs/architecture.md invariant 3: proxy.ts is a UX gate, never the
    // security boundary. The route must ask.
    await POST();
    expect(isAdmin).toHaveBeenCalled();
  });

  it("returns a ticket scoped to the blog folder and image formats", async () => {
    isAdmin.mockResolvedValue(true);
    const response = await POST();
    expect(response.status).toBe(200);

    const ticket = await response.json();
    expect(ticket.folder).toBe(BLOG_UPLOAD_FOLDER);
    expect(ticket.allowedFormats).toBe(BLOG_UPLOAD_FORMATS);
    expect(ticket.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(ticket.uploadUrl).toMatch(/^https:\/\/api\.cloudinary\.com\//);
    // Seconds, not milliseconds — Cloudinary compares against a Unix
    // timestamp and would reject a millisecond value as an hour-old one.
    expect(ticket.timestamp).toBeLessThan(Date.now() / 1000 + 5);
    expect(ticket.timestamp).toBeGreaterThan(Date.now() / 1000 - 5);
  });

  it("never returns the API secret", async () => {
    isAdmin.mockResolvedValue(true);
    const body = await (await POST()).text();
    expect(body).not.toContain("test-secret");
    // The api_key is an identifier, not a secret, and the browser needs it to
    // upload — so it IS present, deliberately.
    expect(body).toContain("test-key");
  });

  it("is uncacheable — a ticket expires, so a cached one is a broken one", async () => {
    isAdmin.mockResolvedValue(true);
    const response = await POST();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
