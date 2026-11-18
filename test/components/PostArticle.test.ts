import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import PostArticle from "@/components/PostArticle";

/**
 * PostArticle is a server component with no state and no data access, so it is
 * called as a plain function and its returned element tree is inspected —
 * the same approach test/admin/comments.test.ts takes, and the reason this
 * repo needs no jsdom or RTL.
 *
 * The property worth pinning here is the ASYMMETRY of the back link: the
 * public post gets one, and the admin draft preview must not, because it
 * renders this same component and already has its own "back to editor" bar.
 * Sending the owner to the public index from a draft preview would be wrong,
 * and it is the kind of thing a later "consistency" tidy-up would introduce.
 */

/** Every `href` prop anywhere in the tree. */
function collectHrefs(node: ReactNode): string[] {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(collectHrefs);
  if (typeof node === "object" && "props" in node) {
    const props = node.props as { href?: unknown; children?: ReactNode };
    const here = typeof props.href === "string" ? [props.href] : [];
    return [...here, ...collectHrefs(props.children)];
  }
  return [];
}

/** All literal text in the tree, so a label can be asserted. */
function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (typeof node === "object" && "props" in node) {
    return collectText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

const base = {
  title: "On Shooting Portra",
  publishedAt: "2026-11-16T10:00:00.000Z",
  body: "Some body text.",
  readingMinutes: 1,
  cover: null,
};

describe("PostArticle back link", () => {
  it("renders a link to the index when given backHref", () => {
    const tree = PostArticle({ ...base, backHref: "/blog" });
    expect(collectHrefs(tree)).toContain("/blog");
    expect(collectText(tree)).toContain("all posts");
  });

  it("renders NO back link when backHref is omitted", () => {
    // This is what the admin draft preview relies on.
    const tree = PostArticle(base);
    expect(collectHrefs(tree)).not.toContain("/blog");
    expect(collectText(tree)).not.toContain("all posts");
  });

  it("still renders the post itself either way", () => {
    for (const props of [base, { ...base, backHref: "/blog" }]) {
      expect(collectText(PostArticle(props))).toContain("On Shooting Portra");
    }
  });
});
