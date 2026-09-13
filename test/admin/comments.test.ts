import { describe, expect, it, vi } from "vitest";

// The page is a Server Component: auth + the catalog index are irrelevant to
// the pagination math under test, so they're stubbed to the "logged in, empty
// catalog" case and only prisma.inquiry's count/findMany calls are asserted on.
vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/catalog", () => ({
  getArtworkIndex: vi.fn().mockResolvedValue(new Map()),
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
