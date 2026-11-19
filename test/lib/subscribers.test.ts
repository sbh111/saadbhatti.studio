import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  confirmPath,
  hashToken,
  mintConfirmToken,
  normalizeEmail,
  unsubscribeMac,
  unsubscribePath,
  verifyUnsubscribeMac,
} from "@/lib/subscribers";
import { UNSUBSCRIBE_PLACEHOLDER, buildPostBroadcast } from "@/lib/subscribeMail";

/**
 * Two credentials with deliberately different designs, so the tests are mostly
 * about keeping them different: the confirmation token must never be
 * recoverable from what is stored, and the unsubscribe MAC must be verifiable
 * forever without anything being stored at all.
 */

beforeEach(() => {
  process.env.SUBSCRIBE_TOKEN_SECRET = "test-secret";
});
afterEach(() => {
  delete process.env.SUBSCRIBE_TOKEN_SECRET;
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  A@Example.COM ")).toBe("a@example.com");
  });

  it("is what makes the unique index actually unique", () => {
    // A Postgres unique index on text is case-sensitive, so without this
    // "A@x.com" and "a@x.com" would both be storable AND both be mailed.
    expect(normalizeEmail("A@x.com")).toBe(normalizeEmail("a@x.com"));
  });
});

describe("confirmation token", () => {
  it("returns a token and its hash, and they are different things", () => {
    const { token, tokenHash } = mintConfirmToken();
    expect(token).not.toBe(tokenHash);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is unguessable and never repeats", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => mintConfirmToken().token)
    );
    expect(seen.size).toBe(50);
    // 32 bytes base64url — long enough that brute force is not the threat.
    expect([...seen][0].length).toBeGreaterThanOrEqual(40);
  });

  it("is URL-safe, so the link survives being pasted", () => {
    for (let i = 0; i < 20; i++) {
      const { token } = mintConfirmToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it("hashes independently of the signing secret", () => {
    // The token hash is a plain digest, NOT an HMAC: rotating
    // SUBSCRIBE_TOKEN_SECRET must not invalidate pending confirmations.
    const { token, tokenHash } = mintConfirmToken();
    process.env.SUBSCRIBE_TOKEN_SECRET = "a-completely-different-secret";
    expect(hashToken(token)).toBe(tokenHash);
  });
});

describe("unsubscribe MAC", () => {
  it("verifies a MAC it produced", () => {
    const mac = unsubscribeMac("sub_123");
    expect(verifyUnsubscribeMac("sub_123", mac)).toBe(true);
  });

  it("is stable across calls, so a link stays valid forever", () => {
    // Nothing is stored, so this is the only thing making an old link work.
    expect(unsubscribeMac("sub_123")).toBe(unsubscribeMac("sub_123"));
  });

  it("is bound to the id — one person's link cannot unsubscribe another", () => {
    expect(verifyUnsubscribeMac("sub_456", unsubscribeMac("sub_123"))).toBe(false);
  });

  it("rejects a tampered, truncated or lengthened MAC", () => {
    const mac = unsubscribeMac("sub_123");
    expect(verifyUnsubscribeMac("sub_123", mac.slice(0, -1))).toBe(false);
    expect(verifyUnsubscribeMac("sub_123", `${mac}0`)).toBe(false);
    expect(verifyUnsubscribeMac("sub_123", `0${mac.slice(1)}`)).toBe(false);
  });

  it("rejects empty inputs rather than throwing", () => {
    expect(verifyUnsubscribeMac("", "")).toBe(false);
    expect(verifyUnsubscribeMac("sub_123", "")).toBe(false);
    expect(verifyUnsubscribeMac("", unsubscribeMac("sub_123"))).toBe(false);
  });

  it("changes entirely when the secret rotates — which is how links are revoked", () => {
    const before = unsubscribeMac("sub_123");
    process.env.SUBSCRIBE_TOKEN_SECRET = "rotated";
    expect(unsubscribeMac("sub_123")).not.toBe(before);
    expect(verifyUnsubscribeMac("sub_123", before)).toBe(false);
  });

  it("throws rather than signing under an empty secret", () => {
    delete process.env.SUBSCRIBE_TOKEN_SECRET;
    expect(() => unsubscribeMac("sub_123")).toThrow(/SUBSCRIBE_TOKEN_SECRET/);
  });
});

describe("paths", () => {
  it("encodes the token into the confirm link", () => {
    expect(confirmPath("abc-_123")).toBe(
      "/api/blog/subscribe/confirm?t=abc-_123"
    );
  });

  it("carries both the id and the MAC on the unsubscribe link", () => {
    const path = unsubscribePath("sub_123");
    const parsed = new URL(path, "https://example.com");
    expect(parsed.searchParams.get("s")).toBe("sub_123");
    expect(parsed.searchParams.get("t")).toBe(unsubscribeMac("sub_123"));
  });
});

describe("buildPostBroadcast", () => {
  const post = {
    title: "Portra 400 & me",
    excerpt: "Notes on <film> and light",
    url: "https://www.saadbhatti.studio/blog/portra",
    coverUrl: null,
  };

  it("escapes the title and excerpt in the HTML", () => {
    const { html } = buildPostBroadcast(post);
    expect(html).toContain("Portra 400 &amp; me");
    expect(html).toContain("&lt;film&gt;");
    expect(html).not.toContain("<film>");
  });

  it("leaves Resend's unsubscribe placeholder UNESCAPED", () => {
    // The whole mechanism depends on Resend finding this string verbatim; a
    // stray escape would turn every broadcast's unsubscribe link into text.
    const { html, text } = buildPostBroadcast(post);
    expect(html).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(text).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(html).not.toContain("&#123;");
  });

  it("uses the title as the subject, unescaped", () => {
    // A subject is a header, not HTML — escaping it would mail "&amp;".
    expect(buildPostBroadcast(post).subject).toBe("Portra 400 & me");
  });

  it("links to the post and includes no body text", () => {
    const { html, text } = buildPostBroadcast(post);
    expect(html).toContain(post.url);
    expect(text).toContain(post.url);
    // A pointer, not a copy — rendering Markdown into email would be a whole
    // second pipeline with its own escaping questions.
    expect(html).not.toContain("body");
  });

  it("omits the cover block entirely when there is no cover", () => {
    expect(buildPostBroadcast(post).html).not.toContain("<img");
    expect(
      buildPostBroadcast({ ...post, coverUrl: "https://img.example/x.jpg" }).html
    ).toContain("<img");
  });
});
