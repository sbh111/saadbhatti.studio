import { describe, expect, it } from "vitest";
import type { CatalogMedium } from "@/lib/catalog";
import {
  ancestorsOf,
  buildAdminNavNode,
  buildNavTree,
  type NavNode,
} from "@/lib/nav";

// The sidebar is the only place every catalog URL appears at once, so this is
// where a missed /art prefix would be most visible — and, before this file,
// least tested (lib/nav.ts had no coverage at all). The negative test at the
// bottom is the real point: it fails if ANY medium, collection or artwork ever
// gets a bare top-level href again.

const CATALOG: CatalogMedium[] = [
  {
    slug: "paintings",
    displayName: "paintings",
    collections: [],
  },
  {
    slug: "photography",
    displayName: "photography",
    collections: [
      {
        slug: "southwest",
        name: "SouthWest",
        path: "art/photography/SouthWest",
        cover: "colorado_iejdgb",
        coverAspect: 1.5,
        artworks: [
          {
            slug: "colorado-iejdgb",
            name: "Colorado",
            image: "colorado_iejdgb",
            aspect: 1.5,
            metaLine: "Film: Portra 400",
            contextTitle: "Colorado",
            metaFields: { Film: "Portra 400" },
          },
        ],
      },
    ],
  },
];

function flatten(nodes: NavNode[]): NavNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

describe("buildNavTree", () => {
  const tree = buildNavTree(CATALOG);
  const [about, art] = tree;

  it("keeps 'about me' first and the art group second", () => {
    expect(tree).toHaveLength(2);
    expect(about).toMatchObject({ id: "/about", href: "/about", depth: 0 });
    expect(art).toMatchObject({ id: "/art", href: "/art", depth: 0 });
  });

  it("gives the art group an href now that /art is a real page", () => {
    // It used to be href-less (toggle only). NavTree renders a node with both
    // an href and children as a Link plus a separate chevron, so it still
    // expands — but a missing href here would silently make the landing page
    // unreachable from the sidebar.
    expect(art.href).toBe("/art");
    expect(art.children).toHaveLength(2);
  });

  it("nests medium → collection → artwork at depths 1, 2, 3 under /art", () => {
    const [paintings, photography] = art.children;
    expect(paintings).toMatchObject({
      id: "/art/paintings",
      href: "/art/paintings",
      depth: 1,
      children: [],
    });

    const [southwest] = photography.children;
    expect(southwest).toMatchObject({
      id: "/art/photography/southwest",
      href: "/art/photography/southwest",
      label: "SouthWest",
      depth: 2,
    });

    const [colorado] = southwest.children;
    expect(colorado).toMatchObject({
      id: "/art/photography/southwest#colorado-iejdgb",
      href: "/art/photography/southwest#colorado-iejdgb",
      label: "Colorado",
      depth: 3,
      nested: true,
    });
  });

  it("keeps an empty medium in the tree as its WIPView entry point", () => {
    // fetchMedium drops empty COLLECTIONS but keeps the medium, which is what
    // makes `paintings` appear in the sidebar and render "Work in progress".
    const paintings = art.children.find((n) => n.id === "/art/paintings");
    expect(paintings?.href).toBe("/art/paintings");
    expect(paintings?.children).toEqual([]);
  });

  it("never emits a catalog href outside /art", () => {
    const hrefs = flatten(tree)
      .map((n) => n.href)
      .filter((href): href is string => Boolean(href));
    for (const href of hrefs) {
      expect(href === "/about" || href.startsWith("/art")).toBe(true);
    }
  });
});

describe("ancestorsOf", () => {
  it("expands every ancestor of a collection path", () => {
    expect(ancestorsOf("/art/photography/southwest")).toEqual([
      "/art",
      "/art/photography",
      "/art/photography/southwest",
    ]);
  });

  it("still expands the admin parent, which buildAdminNavNode relies on", () => {
    // buildAdminNavNode's href-less "/admin" node is only ever openable
    // because this function names it on any /admin/* pathname.
    const ids = ancestorsOf("/admin/comments");
    expect(ids).toContain(buildAdminNavNode().id);
    expect(ids).toContain("/admin/comments");
  });

  it("handles the root and a flat page without throwing", () => {
    expect(ancestorsOf("/")).toEqual([]);
    expect(ancestorsOf("/about")).toEqual(["/about"]);
  });
});
