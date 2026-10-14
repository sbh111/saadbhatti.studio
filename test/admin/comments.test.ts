import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// The page is a Server Component: auth + the catalog index are irrelevant to
// the pagination math under test, so they're stubbed to the "logged in, empty
// catalog" case and only prisma.inquiry's count/findMany calls are asserted on.
vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn().mockResolvedValue(true) }));
const getArtworkIndex = vi.fn().mockResolvedValue(new Map());
vi.mock("@/lib/catalog", () => ({
  getArtworkIndex: (...args: unknown[]) => getArtworkIndex(...args),
}));

const count = vi.fn();
const findMany = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  prisma: {
    inquiry: {
      count: (...args: unknown[]) => count(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

const { default: CommentLogPage } = await import(
  "@/app/admin/comments/page"
);

function searchParams(page?: string) {
  return Promise.resolve(page === undefined ? {} : { page });
}

/** Walk a React element tree (unrendered — plain {type, props} objects) and
 * collect every string/number leaf, so a test can assert on visible text
 * without a DOM renderer (the vitest env is node, no jsdom). */
function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (typeof node === "object" && "props" in node) {
    return collectText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Walk the same tree and report whether any element has the given `type`
 * (e.g. "img") anywhere in the subtree. */
function containsElementType(node: ReactNode, type: string): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (Array.isArray(node)) return node.some((n) => containsElementType(n, type));
  if (typeof node === "object" && "type" in node) {
    if (node.type === type) return true;
    return containsElementType(
      (node.props as { children?: ReactNode })?.children,
      type
    );
  }
  return false;
}

describe("CommentLogPage pagination", () => {
  it("defaults to page 1, skip 0", async () => {
    count.mockResolvedValue(0);
    await CommentLogPage({ searchParams: searchParams() });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 })
    );
  });

  it("offsets by (page - 1) * PAGE_SIZE for an in-range page", async () => {
    count.mockResolvedValue(500); // 10 pages at 50/page
    await CommentLogPage({ searchParams: searchParams("3") });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 50 })
    );
  });

  it("clamps a garbage page param to page 1", async () => {
    count.mockResolvedValue(500);
    for (const garbage of ["abc", "-5", "0", "1.5", ""]) {
      findMany.mockClear();
      await CommentLogPage({ searchParams: searchParams(garbage) });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 })
      );
    }
  });

  it("clamps an out-of-range page down to the last real page", async () => {
    count.mockResolvedValue(120); // 3 pages at 50/page
    await CommentLogPage({ searchParams: searchParams("999") });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100 }) // page 3: (3-1)*50
    );
  });

  it("always orders newest-first", async () => {
    count.mockResolvedValue(0);
    await CommentLogPage({ searchParams: searchParams() });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });
});

// Tech debt 1.4: a Cloudinary outage (getArtworkIndex rejecting) must not take
// this page down — it should still render from the database alone, using each
// inquiry's own snapshotted artworkTitle, with no thumbnail and a visible note.
describe("CommentLogPage catalog degrade (tech debt 1.4)", () => {
  it("renders from the DB alone, with a note and no thumbnail, when the catalog is unavailable", async () => {
    count.mockResolvedValue(1);
    findMany.mockResolvedValueOnce([
      {
        id: "inq1",
        artworkPublicId: "some/public-id",
        artworkTitle: "Snapshot Title",
        name: "Jane",
        email: "jane@example.com",
        message: "Interested in this piece",
        status: "NEW",
        emailStatus: "SENT",
        emailError: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    getArtworkIndex.mockRejectedValueOnce(new Error("cloudinary down"));

    const result = await CommentLogPage({ searchParams: searchParams() });

    const text = collectText(result);
    expect(text).toContain("Catalog unavailable");
    expect(text).toContain("Snapshot Title");
    expect(text).not.toContain("no longer listed"); // that note means something different
    expect(containsElementType(result, "img")).toBe(false);
  });

  it("does not throw, and shows the normal page, when the catalog resolves", async () => {
    count.mockResolvedValue(0);
    findMany.mockResolvedValueOnce([]);
    getArtworkIndex.mockResolvedValueOnce(new Map());

    const result = await CommentLogPage({ searchParams: searchParams() });

    expect(collectText(result)).not.toContain("Catalog unavailable");
  });
});
