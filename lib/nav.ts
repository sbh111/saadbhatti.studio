import type { CatalogMedium } from "./catalog";

/** Serializable nav-tree node, built on the server, rendered by NavTree. */
export interface NavNode {
  id: string;
  label: string;
  /** undefined → expand/collapse only (the "art" group) */
  href?: string;
  depth: number;
  children: NavNode[];
  nested?: boolean;
}

export function buildNavTree(mediums: CatalogMedium[]): NavNode[] {
  const art: NavNode = { id: "art", label: "art", depth: 0, children: [] };
  for (const medium of mediums) {
    const mediumNode: NavNode = {
      id: `/${medium.slug}`,
      label: medium.displayName,
      href: `/${medium.slug}`,
      depth: 1,
      children: medium.collections.map((collection) => {
        const base = `/${medium.slug}/${collection.slug}`;
        return {
          id: base,
          label: collection.name,
          href: base,
          depth: 2,
          children: collection.artworks.map((artwork) => ({
            id: `${base}#${artwork.slug}`,
            label: artwork.name,
            href: `${base}#${artwork.slug}`,
            depth: 3,
            children: [],
            nested: true,
          })),
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
