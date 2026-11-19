import { describe, expect, it } from "vitest";
import {
  CAPS_MIN_LETTERS,
  MAX_LINKS,
  MAX_REPEAT_RUN,
  MIN_ELAPSED_MS,
  SHORT_BODY_CHARS,
  longestRun,
  screenComment,
} from "@/lib/commentHeuristics";

/**
 * Written as attacks, like test/lib/markdown.test.ts — each case is something
 * a real comment spammer does. The assertions deliberately check *that* a rule
 * fired and not its exact wording: the reason string is for a human reading
 * the moderation queue, and pinning its prose would make every rewording a
 * failing test.
 */

const clean = (body = "This is a perfectly ordinary comment about the photo.") =>
  screenComment("Visitor", body, 30_000);

describe("screenComment — passes", () => {
  it("lets an ordinary comment through", () => {
    expect(clean()).toBeNull();
  });

  it("allows up to MAX_LINKS links", () => {
    const body = `See ${"https://example.com ".repeat(MAX_LINKS)} for context here.`;
    expect(screenComment("Visitor", body, 30_000)).toBeNull();
  });

  it("does not punish a missing elapsed time", () => {
    // An old cached form, or JS partly broken — "no signal", not "zero".
    expect(screenComment("Visitor", "A thoughtful remark about grain.")).toBeNull();
  });

  it("allows emphatic capitals below the ratio, and short all-caps", () => {
    expect(clean("I LOVE this one, the light is unreal and so is the grain"))
      .toBeNull();
    // Under CAPS_MIN_LETTERS, so the ratio is not even computed.
    expect(clean("WOW!!")).toBeNull();
  });

  it("allows non-Latin text", () => {
    // Deliberately not a signal: wrong for an international readership, and a
    // poor spam indicator.
    expect(clean("この写真はとても美しいです、光がすばらしい")).toBeNull();
  });
});

describe("screenComment — holds", () => {
  it("holds a body stuffed with links", () => {
    const body = `${"https://spam.example ".repeat(MAX_LINKS + 1)}buy now`;
    expect(screenComment("Visitor", body, 30_000)?.reason).toMatch(/links/);
  });

  it("counts bare www. and BBCode as links", () => {
    expect(clean("www.a.com www.b.com www.c.com")?.reason).toMatch(/links/);
    expect(clean("[url=http://a.com]a[/url] [url=http://b.com]b[/url] [url=http://c.com]c[/url]")?.reason)
      .toMatch(/links/);
  });

  it("holds a link in the author name — a byline is never a URL", () => {
    expect(screenComment("https://buy-pills.example", "Nice photo, really.", 30_000)?.reason)
      .toMatch(/name/);
  });

  it("holds zero-width and bidi-override characters", () => {
    expect(clean("Totally​normal‮text here honestly")?.reason)
      .toMatch(/zero-width|bidi/);
  });

  it("holds a submission faster than a human could write it", () => {
    expect(screenComment("Visitor", "Great shot, love the tones.", 100)?.reason)
      .toMatch(/ms/);
    expect(screenComment("Visitor", "Great shot, love the tones.", MIN_ELAPSED_MS - 1))
      .not.toBeNull();
    expect(screenComment("Visitor", "Great shot, love the tones.", MIN_ELAPSED_MS))
      .toBeNull();
  });

  it("holds a body too short to say anything", () => {
    expect(clean("ok")?.reason).toMatch(/short/);
    expect(clean("a".repeat(SHORT_BODY_CHARS - 1))?.reason).toBeDefined();
  });

  it("holds long runs of one character", () => {
    expect(clean(`nice${"!".repeat(MAX_REPEAT_RUN)} photo`)?.reason)
      .toMatch(/repeated/);
  });

  it("holds shouting once there are enough letters to judge", () => {
    expect(clean("BUY CHEAP WATCHES ONLINE RIGHT NOW")?.reason)
      .toMatch(/capital/);
  });

  it("ignores a negative elapsed time rather than trusting it", () => {
    // A hostile client can send anything; a negative number is not a signal.
    expect(screenComment("Visitor", "A genuinely fine photograph.", -5)).toBeNull();
  });
});

describe("longestRun", () => {
  it("counts the longest run of a single character", () => {
    expect(longestRun("")).toBe(0);
    expect(longestRun("abc")).toBe(1);
    expect(longestRun("aaab")).toBe(3);
    expect(longestRun("abbbbc")).toBe(4);
  });

  it("counts by code point, not UTF-16 unit", () => {
    // "😀" is a surrogate pair; a naive index loop would report 6 here.
    expect(longestRun("😀😀😀")).toBe(3);
  });
});

describe("rule ordering", () => {
  it("reports links first when several rules would fire", () => {
    // First-match-wins: the owner needs one sentence, not an audit trail, and
    // links are the most decisive signal.
    const body = "HTTP://A.COM HTTP://B.COM HTTP://C.COM!!!!!!!!!!!!";
    expect(screenComment("Visitor", body, 10)?.reason).toMatch(/links/);
  });

  it("returns a reason short enough for the column", () => {
    // spamReason is VarChar(200).
    const reason = clean("ok")?.reason ?? "";
    expect(reason.length).toBeLessThanOrEqual(200);
  });
});
