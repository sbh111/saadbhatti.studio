import { describe, expect, it } from "vitest";
import { mergeContext, type ContextFieldUpdate } from "@/lib/cloudinaryAdmin";

// Pure logic only — no fetch/Cloudinary involved, and none should be: this
// pins the read-modify-write merge behind updateArtworkContext (tech debt
// 3.2) without touching the network.

const TITLE_KEYS = ["Title Name", "caption", "Title", "title"] as const;
const FILM_KEYS = ["Film", "film"] as const;

describe("mergeContext", () => {
  it("clearing a field deletes every key in its chain, not just the canonical one", () => {
    // A stale `caption` (an old alias) lingers alongside the canonical key —
    // exactly the shape that resurfaced a "cleared" title before this fix.
    const current = { "Title Name": "Sunset", caption: "Old Caption", unrelated: "kept" };
    const fields: ContextFieldUpdate[] = [{ keys: TITLE_KEYS, value: "" }];

    const merged = mergeContext(current, fields);

    expect(merged).toEqual({ unrelated: "kept" });
  });

  it("setting a field writes only the canonical key, leaving aliases untouched", () => {
    // The alias is stale but harmless once the canonical key is set: the
    // read chain (lib/catalog.ts) always tries the canonical key first.
    const current = { caption: "Old Caption" };
    const fields: ContextFieldUpdate[] = [{ keys: TITLE_KEYS, value: "New Title" }];

    const merged = mergeContext(current, fields);

    expect(merged).toEqual({ "Title Name": "New Title", caption: "Old Caption" });
  });

  it("trims the incoming value before deciding set vs. clear", () => {
    const merged = mergeContext(
      { Film: "Portra 400" },
      [{ keys: FILM_KEYS, value: "   " }]
    );
    expect(merged).toEqual({});
  });

  it("handles multiple fields independently in one call", () => {
    const current = { "Title Name": "Old Title", film: "Ektar 100", Medium: "Oil" };
    const fields: ContextFieldUpdate[] = [
      { keys: TITLE_KEYS, value: "" }, // clear title
      { keys: FILM_KEYS, value: "Portra 400" }, // set film (canonical only)
      { keys: ["Medium", "medium"], value: "" }, // clear medium
    ];

    const merged = mergeContext(current, fields);

    expect(merged).toEqual({ film: "Ektar 100", Film: "Portra 400" });
  });

  it("leaves the original object untouched (returns a new one)", () => {
    const current = { "Title Name": "Sunset" };
    mergeContext(current, [{ keys: TITLE_KEYS, value: "" }]);
    expect(current).toEqual({ "Title Name": "Sunset" });
  });
});
