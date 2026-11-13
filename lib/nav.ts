import type { CatalogMedium } from "./catalog";
import { artHref, artworkHref, collectionHref, mediumHref } from "./urls";

/**
 * Serializable nav-tree node, built on the server, rendered by NavTree.
 *
 * A node's `id` IS its href wherever it has one, which is what lets
 * `ancestorsOf` below derive the branch to auto-expand from nothing but the
 * current pathname.
 */
export interface NavNode {
  id: string;
  label: string;
  /** undefined → expand/collapse only (e.g. the href-less "/admin" parent) */
  href?: string;
  depth: number;
  children: NavNode[];
  nested?: boolean;
}

export function buildNavTree(mediums: CatalogMedium[]): NavNode[] {
  // The "art" group is a real page now (/art lists the mediums), so unlike the
  // "/admin" parent it carries an href. NavTree renders an href-bearing node
  // with children as a <Link> plus a separate chevron toggle, so it still
  // expands — clicking the label navigates AND expands, exactly like a medium
  // row. Every href here comes from lib/urls.ts so the /art prefix is typed
  // once, not once per nav depth.
  const art: NavNode = {
    id: artHref(),
    label: "art",
    href: artHref(),
    depth: 0,
    children: [],
  };
  for (const medium of mediums) {
    const mediumNode: NavNode = {
      id: mediumHref(medium.slug),
      label: medium.displayName,
      href: mediumHref(medium.slug),
      depth: 1,
      children: medium.collections.map((collection) => {
        const base = collectionHref(medium.slug, collection.slug);
        return {
          id: base,
          label: collection.name,
          href: base,
          depth: 2,
          children: collection.artworks.map((artwork) => {
            const href = artworkHref(
              medium.slug,
              collection.slug,
              artwork.slug
            );
            return {
              id: href,
              label: artwork.name,
              href,
              depth: 3,
              children: [],
              nested: true,
            };
          }),
        };
      }),
    };
    art.children.push(mediumNode);
  }
  return [
    { id: "/about", label: "about me", href: "/about", depth: 0, children: [] },
    art,
  ];
}

/**
 * Node ids to auto-expand for a pathname — every ancestor prefix of the path.
 * Node ids are hrefs (see NavNode), so a path prefix is exactly its ancestor's
 * id: `/art/photography/southwest` expands `/art` and `/art/photography`, and
 * `/admin/comments` expands `/admin` (which `buildAdminNavNode` below depends
 * on — that parent has no href, but its id is still the path).
 *
 * Lives here rather than in NavTree so it sits next to the function that
 * decides what the ids are, and so it can be unit-tested without a DOM.
 */
export function ancestorsOf(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((_, i) => `/${parts.slice(0, i + 1).join("/")}`);
}

/**
 * The admin nav entry, spliced in client-side (AppShell) only when logged in.
 * Kept out of buildNavTree so the public tree stays fully static — reading the
 * session in the root layout would force every page dynamic.
 *
 * Expand-only parent (no href — /admin has no page; NavTree renders href-less
 * nodes as toggle buttons, and ancestorsOf auto-expands id "/admin" on any
 * /admin/* child). Siblings drop in as more children.
 */
export function buildAdminNavNode(): NavNode {
  return {
    id: "/admin",
    label: "admin",
    depth: 0,
    children: [
      {
        id: "/admin/comments",
        label: "comment log",
        href: "/admin/comments",
        depth: 1,
        children: [],
      },
      {
        id: "/admin/likes",
        label: "likes",
        href: "/admin/likes",
        depth: 1,
        children: [],
      },
      {
        id: "/admin/settings",
        label: "settings",
        href: "/admin/settings",
        depth: 1,
        children: [],
      },
    ],
  };
}
