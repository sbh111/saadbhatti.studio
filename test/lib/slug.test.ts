import { describe, expect, it } from "vitest";
import {
  baseArtworkSlug,
  disambiguateSlugs,
  resolveLegacyHash,
  slugify,
  stripReorderPrefix,
} from "@/lib/slug";

// Tech debt 1.8: reordering a collection renumbers the NN- filename prefix,
// and the slug used to be slugify(filename) directly — so every reorder
// changed every slug and broke every link ever shared. These pin the fix:
// slugs are derived with the prefix stripped, and stay stable under any
// renumbering.

describe("stripReorderPrefix", () => {
  it("strips a dash-separated numeric prefix", () => {
    expect(stripReorderPrefix("03-Desert Sunset")).toBe("Desert Sunset");
  });

  it("strips underscore- and space-separated prefixes the same way", () => {
    expect(stripReorderPrefix("03_Desert Sunset")).toBe("Desert Sunset");
    expect(stripReorderPrefix("03 Desert Sunset")).toBe("Desert Sunset");
  });

  it("leaves a name with no leading digits untouched", () => {
    expect(stripReorderPrefix("Desert Sunset")).toBe("Desert Sunset");
  });
});

describe("baseArtworkSlug", () => {
  it("derives the same slug regardless of the reorder prefix", () => {
    const publicId = "photography/southwest/abc123";
    expect(baseArtworkSlug("01-Desert Sunset", publicId)).toBe(
      baseArtworkSlug("03-Desert Sunset", publicId)
    );
    expect(baseArtworkSlug("12-Desert Sunset", publicId)).toBe(
      "desert-sunset"
    );
  });

  it("falls back to a slug of the public_id when stripping leaves nothing", () => {
    // display_name is purely digits/separators (e.g. "03-" or "12") — nothing
    // survives prefix-stripping, so fall back to the public_id rather than
    // emitting an empty slug.
    expect(baseArtworkSlug("03-", "photography/southwest/abc123")).toBe(
      slugify("photography/southwest/abc123")
    );
    expect(baseArtworkSlug("12", "xyz789")).toBe(slugify("xyz789"));
  });
});

describe("disambiguateSlugs", () => {
  it("leaves unique base slugs alone", () => {
    const result = disambiguateSlugs([
      { publicId: "a", baseSlug: "desert-sunset" },
      { publicId: "b", baseSlug: "canyon-view" },
    ]);
    expect(result.get("a")).toBe("desert-sunset");
    expect(result.get("b")).toBe("canyon-view");
  });

  it("suffixes colliding slugs by public_id order, not input order", () => {
    // "z" sorts after "a" by public_id, so it must get "-2" even though it
    // appears FIRST in the input array — collision resolution must not be
    // sensitive to array order (which tracks display/reorder position).
    const result = disambiguateSlugs([
      { publicId: "z", baseSlug: "desert-sunset" },
      { publicId: "a", baseSlug: "desert-sunset" },
    ]);
    expect(result.get("a")).toBe("desert-sunset");
    expect(result.get("z")).toBe("desert-sunset-2");
  });

  it("stays stable across a reorder (input array order shuffled)", () => {
    const items = [
      { publicId: "b", baseSlug: "desert-sunset" },
      { publicId: "a", baseSlug: "desert-sunset" },
      { publicId: "c", baseSlug: "desert-sunset" },
    ];
    const before = disambiguateSlugs(items);
    const afterReorder = disambiguateSlugs([...items].reverse());
    expect(afterReorder.get("a")).toBe(before.get("a"));
    expect(afterReorder.get("b")).toBe(before.get("b"));
    expect(afterReorder.get("c")).toBe(before.get("c"));
  });

  it("handles three-way collisions with -2, -3 suffixes in public_id order", () => {
    const result = disambiguateSlugs([
      { publicId: "c", baseSlug: "x" },
      { publicId: "a", baseSlug: "x" },
      { publicId: "b", baseSlug: "x" },
    ]);
    expect(result.get("a")).toBe("x");
    expect(result.get("b")).toBe("x-2");
    expect(result.get("c")).toBe("x-3");
  });
});

describe("resolveLegacyHash", () => {
  it("returns null when the hash already matches an element (nothing to do)", () => {
    expect(
      resolveLegacyHash("#desert-sunset", (id) => id === "desert-sunset")
    ).toBeNull();
  });

  it("strips a legacy digit prefix and resolves to the canonical id", () => {
    expect(
      resolveLegacyHash(
        "#03-desert-sunset",
        (id) => id === "desert-sunset"
      )
    ).toBe("desert-sunset");
  });

  it("returns null when neither the raw nor stripped hash matches anything", () => {
    expect(resolveLegacyHash("#03-nonexistent", () => false)).toBeNull();
  });

  it("returns null for an empty hash", () => {
    expect(resolveLegacyHash("#", () => false)).toBeNull();
    expect(resolveLegacyHash("", () => false)).toBeNull();
  });

  it("does not strip a prefix that isn't purely leading digits + dash", () => {
    // No legacy prefix here — must not match a partial/garbage strip.
    expect(
      resolveLegacyHash("#not-a-legacy-hash", (id) => id === "a-legacy-hash")
    ).toBeNull();
  });
});
