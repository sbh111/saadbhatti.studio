"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { content } from "@/lib/content";

interface NavNode {
  id: string;
  label: string;
  /** undefined → expand/collapse only (the "art" group) */
  href?: string;
  depth: number;
  children: NavNode[];
  nested?: boolean;
}

function buildTree(): NavNode[] {
  const nodes: NavNode[] = [
    { id: "/about", label: "about me", href: "/about", depth: 0, children: [] },
  ];
  const art: NavNode = { id: "art", label: "art", depth: 0, children: [] };
  for (const medium of content.mediums) {
    const mediumNode: NavNode = {
      id: `/${medium.slug}`,
      label: medium.displayName,
      href: `/${medium.slug}`,
      depth: 1,
      children: [],
    };
    for (const collection of medium.collections) {
      const base = `/${medium.slug}/${collection.slug}`;
      const collectionNode: NavNode = {
        id: base,
        label: collection.name,
        href: base,
        depth: 2,
        children: collection.artworks.map((a) => ({
          id: `${base}#${a.slug}`,
          label: a.name,
          href: `${base}#${a.slug}`,
          depth: 3,
          children: [],
          nested: true,
        })),
      };
      mediumNode.children.push(collectionNode);
    }
    art.children.push(mediumNode);
  }
  nodes.push(art);
  return nodes;
}

const TREE = buildTree();
const INDENT = [14, 26, 38, 52];

function ancestorsOf(pathname: string): string[] {
  const ids = ["art"];
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 1) ids.push(`/${parts[0]}`);
  if (parts.length >= 2) ids.push(`/${parts[0]}/${parts[1]}`);
  return ids;
}

function Chevron({ open, active }: { open: boolean; active: boolean }) {
  return (
    <svg
      viewBox="0 0 10 6"
      className={`h-[6px] w-[10px] shrink-0 transition-transform motion-reduce:transition-none ${
        open ? "" : "-rotate-90"
      } ${active ? "stroke-steel" : "stroke-ink-faint"}`}
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 1 L5 5 L9 1" />
    </svg>
  );
}

export default function NavTree({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestorsOf(pathname))
  );

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ancestorsOf(pathname)) next.add(id);
      return next;
    });
  }, [pathname]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expand(id: string) {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function renderNode(node: NavNode): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const isActive = node.href === pathname;
    const pad = INDENT[Math.min(node.depth, INDENT.length - 1)];

    const rowClasses = `flex items-center justify-between gap-2 border-l-2 py-1.5 pr-3.5 ${
      isActive
        ? "border-steel bg-nav-active"
        : "border-transparent hover:bg-nav-active/50"
    }`;

    const labelClasses = node.nested
      ? "text-sm text-ink-muted"
      : isActive
        ? "text-[15px] font-semibold text-steel"
        : "text-[15px] text-ink";

    return (
      <li key={node.id}>
        <div className={rowClasses} style={{ paddingLeft: pad }}>
          {node.href ? (
            <Link
              href={node.href}
              className={`min-w-0 grow truncate ${labelClasses}`}
              onClick={() => {
                if (hasChildren) expand(node.id);
                onNavigate?.();
              }}
            >
              {node.label}
            </Link>
          ) : (
            <button
              type="button"
              className={`min-w-0 grow truncate text-left ${labelClasses}`}
              aria-expanded={isOpen}
              onClick={() => toggle(node.id)}
            >
              {node.label}
            </button>
          )}
          {hasChildren && (
            <button
              type="button"
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.label}`}
              aria-expanded={isOpen}
              className="-m-1 p-1"
              onClick={() => toggle(node.id)}
            >
              <Chevron open={isOpen} active={isActive} />
            </button>
          )}
        </div>
        {hasChildren && isOpen && (
          <ul>{node.children.map((child) => renderNode(child))}</ul>
        )}
      </li>
    );
  }

  return (
    <nav aria-label="Site">
      <ul>{TREE.map((node) => renderNode(node))}</ul>
    </nav>
  );
}
