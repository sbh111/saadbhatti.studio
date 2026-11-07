import { describe, expect, it, vi } from "vitest";
import {
  fetchAllPages,
  mergeContext,
  type ContextFieldUpdate,
} from "@/lib/cloudinaryAdmin";
import { METADATA_FIELDS, TITLE_KEYS } from "@/lib/artworkFields";

// Pure logic only — no fetch/Cloudinary involved, and none should be: this
// pins the read-modify-write merge behind updateArtworkContext (tech debt
// 3.2) without touching the network. Chains come from lib/artworkFields.ts
// (the single source of truth, tech debt 3.1) rather than being retyped here.
const FILM_KEYS = METADATA_FIELDS.find((f) => f.label === "Film")!.keys;

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
      { keys: METADATA_FIELDS.find((f) => f.label === "Medium")!.keys, value: "" }, // clear medium
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

// The shared paging helper behind tech debt 2.2 — every call site that used
// to trust a single max_results page (getCatalog's /folders, fetchMedium's
// /folders/:folder, fetchCollection's and reorderCollection's
// /resources/by_asset_folder) now goes through this. Tested here against a
// fake fetchPage rather than a real fetch mock: the helper doesn't know or
// care whether it's wrapping apiGet or apiGetFresh, only that it's handed a
// function from path to a parsed page.
describe("fetchAllPages", () => {
  it("returns a single page's items unmodified when there is no next_cursor", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ resources: ["a", "b"] });
    const items = await fetchAllPages(
      fetchPage,
      (cursor) => `/x${cursor ? `?next_cursor=${cursor}` : ""}`,
      (page: { resources: string[] }) => ({ items: page.resources })
    );
    expect(items).toEqual(["a", "b"]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith("/x");
  });

  it("follows next_cursor across pages and accumulates items in order", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ resources: ["a"], next_cursor: "cursor1" })
      .mockResolvedValueOnce({ resources: ["b"], next_cursor: "cursor2" })
      .mockResolvedValueOnce({ resources: ["c"] }); // no next_cursor: last page

    const items = await fetchAllPages(
      fetchPage,
      (cursor) => `/x${cursor ? `?next_cursor=${cursor}` : ""}`,
      (page: { resources: string[]; next_cursor?: string }) => ({
        items: page.resources,
        next_cursor: page.next_cursor,
      })
    );

    expect(items).toEqual(["a", "b", "c"]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, "/x");
    expect(fetchPage).toHaveBeenNthCalledWith(2, "/x?next_cursor=cursor1");
    expect(fetchPage).toHaveBeenNthCalledWith(3, "/x?next_cursor=cursor2");
  });

  it("hands the raw cursor to buildPath so callers control URL-encoding", async () => {
    // A cursor containing characters that need escaping (Cloudinary's cursors
    // are opaque tokens, not guaranteed to be URL-safe as-is) — buildPath is
    // documented to encode it itself, the same as every other query value
    // this module builds, so verify the RAW value reaches buildPath and the
    // helper doesn't double-encode or mangle it.
    const trickyCursor = "a b/c=d";
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ resources: ["a"], next_cursor: trickyCursor })
      .mockResolvedValueOnce({ resources: ["b"] });

    await fetchAllPages(
      fetchPage,
      (cursor) =>
        `/x${cursor ? `?next_cursor=${encodeURIComponent(cursor)}` : ""}`,
      (page: { resources: string[]; next_cursor?: string }) => ({
        items: page.resources,
        next_cursor: page.next_cursor,
      })
    );

    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      `/x?next_cursor=${encodeURIComponent(trickyCursor)}`
    );
  });

  it("throws rather than truncating silently if next_cursor never clears", async () => {
    // A never-ending next_cursor must not become a SECOND silent truncation
    // (just at a bigger, still-arbitrary number) — it must be loud.
    const fetchPage = vi.fn().mockResolvedValue({
      resources: ["x"],
      next_cursor: "always-more",
    });

    await expect(
      fetchAllPages(
        fetchPage,
        (cursor) => `/x${cursor ? `?next_cursor=${cursor}` : ""}`,
        (page: { resources: string[]; next_cursor?: string }) => ({
          items: page.resources,
          next_cursor: page.next_cursor,
        })
      )
    ).rejects.toThrow(/did not terminate within \d+ pages/);

    // Exactly the documented cap (40) — bounded, not an infinite loop.
    expect(fetchPage).toHaveBeenCalledTimes(40);
  });
});
