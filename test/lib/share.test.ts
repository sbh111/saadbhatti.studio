import { describe, expect, it } from "vitest";
import {
  emailShareUrl,
  facebookShareUrl,
  linkedInShareUrl,
  redditShareUrl,
  shareTargets,
  whatsAppShareUrl,
  xShareUrl,
} from "@/lib/share";

/**
 * The failure these tests exist to prevent is the quiet one: a share link that
 * works for every post until someone writes a title with an `&` or a `?` in
 * it, at which point the target silently receives a truncated URL. So the
 * assertions are mostly about ENCODING, not about the hostnames.
 */

const URL_ = "https://www.saadbhatti.studio/blog/on-shooting-portra";
const TITLE = "Portra 400 & me: what I learned (so far)?";

describe("encoding", () => {
  it("encodes a title containing & and ? so nothing is truncated", () => {
    const href = xShareUrl(URL_, TITLE);
    // The raw characters must not survive — they would end the parameter.
    expect(href).not.toContain("& me");
    expect(href).not.toContain("(so far)?");
    expect(href).toContain(encodeURIComponent(TITLE));
  });

  it("encodes the url in every builder", () => {
    const encoded = encodeURIComponent(URL_);
    for (const href of [
      xShareUrl(URL_, TITLE),
      facebookShareUrl(URL_),
      linkedInShareUrl(URL_),
      redditShareUrl(URL_, TITLE),
      whatsAppShareUrl(URL_, TITLE),
      emailShareUrl(URL_, TITLE),
    ]) {
      expect(href).toContain(encoded);
      // A bare, unencoded URL would mean the encoding was skipped.
      expect(href).not.toContain(`=${URL_}`);
    }
  });

  it("round-trips every parameter back to its input", () => {
    const parsed = new URL(xShareUrl(URL_, TITLE));
    expect(parsed.searchParams.get("url")).toBe(URL_);
    expect(parsed.searchParams.get("text")).toBe(TITLE);
  });

  it("builds a valid URL even for a title of only punctuation", () => {
    expect(() => new URL(xShareUrl(URL_, "&?=#"))).not.toThrow();
    expect(new URL(redditShareUrl(URL_, "&?=#")).searchParams.get("title")).toBe("&?=#");
  });
});

describe("per-target shape", () => {
  it("points X at x.com/intent/post, not the twitter.com redirect", () => {
    // The old path still redirects, but pointing at a redirect makes every
    // share pay a hop and depend on that redirect surviving.
    expect(xShareUrl(URL_, TITLE)).toMatch(/^https:\/\/x\.com\/intent\/post\?/);
  });

  it("sends LinkedIn and Facebook only a url — they read Open Graph for the rest", () => {
    const linkedIn = new URL(linkedInShareUrl(URL_));
    expect([...linkedIn.searchParams.keys()]).toEqual(["url"]);
    const facebook = new URL(facebookShareUrl(URL_));
    expect([...facebook.searchParams.keys()]).toEqual(["u"]);
  });

  it("joins title and url into WhatsApp's single text field", () => {
    expect(new URL(whatsAppShareUrl(URL_, TITLE)).searchParams.get("text")).toBe(
      `${TITLE} ${URL_}`
    );
  });

  it("puts the title in the subject and the url in the body for email", () => {
    const parsed = new URL(emailShareUrl(URL_, TITLE));
    expect(parsed.protocol).toBe("mailto:");
    expect(parsed.searchParams.get("subject")).toBe(TITLE);
    expect(parsed.searchParams.get("body")).toBe(URL_);
  });
});

describe("shareTargets", () => {
  it("returns every link target with a stable id and an https or mailto href", () => {
    const targets = shareTargets(URL_, TITLE);
    expect(targets.map((t) => t.id)).toEqual([
      "x",
      "facebook",
      "linkedin",
      "reddit",
      "whatsapp",
      "email",
    ]);
    for (const target of targets) {
      expect(target.label).toBeTruthy();
      expect(target.href).toMatch(/^(https:|mailto:)/);
    }
  });

  it("does NOT include Instagram", () => {
    // It has no web intent for an arbitrary link; the native share sheet is
    // the only route, so it cannot be a button.
    const ids = shareTargets(URL_, TITLE).map((t) => t.id);
    expect(ids).not.toContain("instagram");
  });
});
