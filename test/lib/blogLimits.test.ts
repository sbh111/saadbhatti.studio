import { describe, expect, it } from "vitest";
import { SLUG_MAX, isValidSlug } from "@/lib/blogLimits";
import { slugify } from "@/lib/slug";

describe("isValidSlug", () => {
  it("accepts what slugify produces", () => {
    // The two must agree, or the admin could save a slug its own public route
    // then refuses to resolve.
    for (const title of [
      "On Shooting Portra",
      "Why 35mm",
      "a",
      "Trip: Japan, 2026!",
    ]) {
      expect(isValidSlug(slugify(title))).toBe(true);
    }
  });

  it("rejects anything that is not a clean lowercase slug", () => {
    for (const bad of [
      "",
      "Capitalised",
      "with space",
      "trailing-",
      "-leading",
      "double--dash",
      "under_score",
      "../../etc/passwd",
      "slash/es",
      "percent%20",
      "emoji-🎞",
    ]) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });

  it("rejects an over-long slug before it can reach a query", () => {
    expect(isValidSlug("a".repeat(SLUG_MAX))).toBe(true);
    expect(isValidSlug("a".repeat(SLUG_MAX + 1))).toBe(false);
  });
});
