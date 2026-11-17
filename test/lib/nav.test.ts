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
  // Looked up by id, not by position: the top level has gained entries before
  // (/art) and will again, and a positional destructure turns every such
  // addition into five unrelated failures.
  const byId = (id: string) => {
    const node = tree.find((n) => n.id === id);
    if (!node) throw new Error(`no top-level node ${id}`);
    return node;
  };
  const about = byId("/about");
  const art = byId("/art");
  const blog = byId("/blog");

  it("has exactly the expected top-level entries, in order", () => {
    expect(tree.map((n) => n.id)).toEqual(["/about", "/blog", "/art"]);
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

  it("keeps the blog entry flat and childless", () => {
    // Load-bearing, not cosmetic: children here would mean a Postgres read
    // inside buildNavTree, which app/layout.tsx runs on EVERY route — that
    // would make the whole public site dynamic and break invariant 2.
    expect(blog).toMatchObject({
      id: "/blog",
      href: "/blog",
      depth: 0,
      children: [],
    });
  });

  it("never emits a catalog href outside /art", () => {
    // Scoped to the art subtree rather than the whole tree, so adding a
    // sibling section (/blog, and whatever comes after it) can never launder a
    // bare catalog href past this check — which is the point of the test.
    const hrefs = flatten(art.children)
      .map((n) => n.href)
      .filter((href): href is string => Boolean(href));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith("/art")).toBe(true);
    }
  });

  it("emits no unexpected top-level hrefs", () => {
    const topLevel = tree
      .map((n) => n.href)
      .filter((href): href is string => Boolean(href));
    expect(topLevel).toEqual(["/about", "/blog", "/art"]);
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

  it("expands the blog index for a post path", () => {
    // /blog/[slug] has no nav node of its own, so this is what keeps the
    // "blog" row highlighted while reading a post.
    expect(ancestorsOf("/blog/on-shooting-portra")).toEqual([
      "/blog",
      "/blog/on-shooting-portra",
    ]);
  });

  it("handles the root and a flat page without throwing", () => {
    expect(ancestorsOf("/")).toEqual([]);
    expect(ancestorsOf("/about")).toEqual(["/about"]);
  });
});
