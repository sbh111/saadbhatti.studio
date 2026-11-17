import { describe, expect, it } from "vitest";
import {
  COVER_DIMENSION_MAX,
  COVER_PUBLIC_ID_MAX,
  SLUG_MAX,
  isValidCoverPublicId,
  isValidSlug,
  parseCoverDimension,
} from "@/lib/blogLimits";
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

describe("isValidCoverPublicId", () => {
  it("accepts a Cloudinary auto-generated id under blog/", () => {
    expect(isValidCoverPublicId("blog/kq3n8xj2")).toBe(true);
    expect(isValidCoverPublicId("blog/a_b-c123")).toBe(true);
  });

  it("requires the blog/ prefix, so the catalog folder cannot be targeted", () => {
    expect(isValidCoverPublicId("art/photography/thing")).toBe(false);
    expect(isValidCoverPublicId("kq3n8xj2")).toBe(false);
    expect(isValidCoverPublicId("blog")).toBe(false);
    expect(isValidCoverPublicId("blog/")).toBe(false);
  });

  it("rejects anything that could change the meaning of a delivery URL", () => {
    // This value is interpolated into a Cloudinary URL by imageUrl().
    // `,` and `:` are Cloudinary's own transformation separators, and `.`
    // is excluded outright so `..` is not expressible.
    expect(isValidCoverPublicId("blog/../art/secret")).toBe(false);
    expect(isValidCoverPublicId("blog/a,w_9999")).toBe(false);
    expect(isValidCoverPublicId("blog/a:b")).toBe(false);
    expect(isValidCoverPublicId("blog/a/b")).toBe(false);
    expect(isValidCoverPublicId("blog/a b")).toBe(false);
    expect(isValidCoverPublicId("blog/a?x=1")).toBe(false);
    expect(isValidCoverPublicId("blog/a#b")).toBe(false);
    expect(isValidCoverPublicId("blog/a.jpg")).toBe(false);
  });

  it("rejects an empty value and one past the column width", () => {
    expect(isValidCoverPublicId("")).toBe(false);
    expect(isValidCoverPublicId(`blog/${"a".repeat(COVER_PUBLIC_ID_MAX)}`)).toBe(
      false
    );
  });
});

describe("parseCoverDimension", () => {
  it("accepts a positive integer, as a number or a form string", () => {
    expect(parseCoverDimension(3000)).toBe(3000);
    expect(parseCoverDimension("3000")).toBe(3000);
    expect(parseCoverDimension(1)).toBe(1);
  });

  it("rejects what a form can legitimately send when there is no cover", () => {
    // The hidden inputs submit "" when the cover has been removed, and
    // formData.get returns null when the field is absent entirely.
    expect(parseCoverDimension("")).toBeUndefined();
    expect(parseCoverDimension(null)).toBeUndefined();
    expect(parseCoverDimension(undefined)).toBeUndefined();
  });

  it("rejects zero, negatives, fractions and nonsense", () => {
    expect(parseCoverDimension(0)).toBeUndefined();
    expect(parseCoverDimension(-5)).toBeUndefined();
    expect(parseCoverDimension(1.5)).toBeUndefined();
    expect(parseCoverDimension("abc")).toBeUndefined();
    expect(parseCoverDimension(Number.NaN)).toBeUndefined();
    expect(parseCoverDimension(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("rejects a value past the sanity bound", () => {
    expect(parseCoverDimension(COVER_DIMENSION_MAX)).toBe(COVER_DIMENSION_MAX);
    expect(parseCoverDimension(COVER_DIMENSION_MAX + 1)).toBeUndefined();
  });
});
