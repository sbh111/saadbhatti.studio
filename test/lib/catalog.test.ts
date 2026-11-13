import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The regression this file exists for: mediums are the subfolders of the
 * `art/` folder (CATALOG_ROOT_FOLDER), NOT the account's root folders.
 *
 * Reading the root instead is not a loud failure — it returns `art` and
 * `blog assets` as two "mediums", neither of which holds assets directly, so
 * every collection is dropped as empty and the entire site quietly renders the
 * WIP view. That is exactly the state the Cloudinary restructure left the site
 * in, and nothing in the suite would have caught it. So the headline assertion
 * here is a negative one: `/folders` is never requested.
 *
 * `apiGet` is faked (recording every path it is asked for) while the real
 * `fetchAllPages` is kept, so the paging/encoding contract under test is the
 * production one.
 */

const ROOT = "/folders/art?max_results=500";
const PHOTOGRAPHY = "/folders/art%2Fphotography?max_results=500";
const PAINTINGS = "/folders/art%2Fpaintings?max_results=500";
const SOUTHWEST =
  "/resources/by_asset_folder?asset_folder=art%2Fphotography%2FSouthWest&max_results=500&context=true";
const EMPTY =
  "/resources/by_asset_folder?asset_folder=art%2Fphotography%2FEmpty&max_results=500&context=true";

const RESPONSES: Record<string, unknown> = {
  [ROOT]: {
    // Returned out of alphabetical order on purpose — getCatalog sorts.
    folders: [
      { name: "photography", path: "art/photography" },
      { name: "paintings", path: "art/paintings" },
    ],
  },
  [PHOTOGRAPHY]: {
    folders: [
      { name: "SouthWest", path: "art/photography/SouthWest" },
      { name: "Empty", path: "art/photography/Empty" },
    ],
  },
  [PAINTINGS]: { folders: [] },
  [SOUTHWEST]: {
    resources: [
      {
        public_id: "colorado_iejdgb",
        display_name: "01-colorado",
        asset_folder: "art/photography/SouthWest",
        width: 3000,
        height: 2000,
        context: { custom: { "Title Name": "Colorado", Film: "Portra 400" } },
      },
    ],
  },
  [EMPTY]: { resources: [] },
};

const requested: string[] = [];

vi.mock("@/lib/cloudinaryAdmin", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/cloudinaryAdmin")>();
  return {
    ...actual,
    apiGet: vi.fn(async (path: string) => {
      requested.push(path);
      if (!(path in RESPONSES)) {
        throw new Error(`unstubbed Cloudinary path: ${path}`);
      }
      return RESPONSES[path];
    }),
  };
});

// getCatalog is wrapped in React cache(); re-import per test so no memoized
// result leaks between cases.
async function loadCatalog() {
  vi.resetModules();
  requested.length = 0;
  const { getCatalog } = await import("@/lib/catalog");
  return { catalog: await getCatalog(), requested: [...requested] };
}

beforeEach(() => {
  requested.length = 0;
});

describe("getCatalog folder rooting", () => {
  it("lists the art folder's subfolders and never the account root", async () => {
    const { requested } = await loadCatalog();
    expect(requested).toContain(ROOT);
    expect(requested).not.toContain("/folders");
    expect(requested.some((p) => p.startsWith("/folders?"))).toBe(false);
  });

  it("treats the art folder's subfolders as the mediums, name-sorted", async () => {
    const { catalog } = await loadCatalog();
    expect(catalog.map((m) => m.slug)).toEqual(["paintings", "photography"]);
    expect(catalog.map((m) => m.displayName)).toEqual([
      "paintings",
      "photography",
    ]);
  });

  it("keeps a medium with no subfolders (the WIPView case)", async () => {
    const { catalog } = await loadCatalog();
    const paintings = catalog.find((m) => m.slug === "paintings");
    expect(paintings).toBeDefined();
    expect(paintings?.collections).toEqual([]);
  });

  it("drops a collection with no artworks but keeps the rest", async () => {
    const { catalog } = await loadCatalog();
    const photography = catalog.find((m) => m.slug === "photography");
    expect(photography?.collections.map((c) => c.slug)).toEqual(["southwest"]);
  });

  it("carries the full multi-segment folder path as the reorder key", async () => {
    // collection.path is handed straight to reorderCollection, which queries
    // by_asset_folder with it — it must be the whole `art/...` path, not the
    // leaf.
    const { catalog } = await loadCatalog();
    const southwest = catalog
      .find((m) => m.slug === "photography")
      ?.collections.find((c) => c.slug === "southwest");
    expect(southwest?.path).toBe("art/photography/SouthWest");
    expect(southwest?.name).toBe("SouthWest");
    expect(southwest?.artworks.map((a) => a.slug)).toEqual(["colorado"]);
  });

  it("names CATALOG_ROOT_FOLDER when the root folder is gone", async () => {
    vi.resetModules();
    const admin = await import("@/lib/cloudinaryAdmin");
    vi.mocked(admin.apiGet).mockRejectedValueOnce(
      new Error("Cloudinary Admin API /folders/art failed: HTTP 404")
    );
    const { getCatalog } = await import("@/lib/catalog");
    await expect(getCatalog()).rejects.toThrow(/CATALOG_ROOT_FOLDER/);
  });
});
