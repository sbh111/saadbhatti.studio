import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostStatus } from "@prisma/client";

/**
 * lib/posts.ts is where the blog's build-safety guarantees live, so these
 * tests are mostly about FAILURE behaviour rather than happy paths.
 *
 * The one that matters most is the asymmetry: the index degrades to an empty,
 * flagged result so `next build` can never be broken by an unreachable
 * database, while a single post RE-THROWS so a transient failure can never be
 * cached as a 404 for a post that really exists. Those two opposite choices
 * are easy to "tidy" into one, which is exactly why they are asserted here.
 */

const findMany = vi.fn();
const findFirst = vi.fn();
const groupBy = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    post: {
      findMany: (...args: unknown[]) => findMany(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
      groupBy: (...args: unknown[]) => groupBy(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

// `unstable_cache` is a Next runtime primitive with no store to attach to
// outside a request, and these tests are about our logic rather than Next's
// caching. Passthrough.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));

// React's cache() memoizes per request scope. Outside one its behaviour is not
// something to rely on, and a memoized first result would silently poison
// every later assertion in this file (listPublishedPosts takes no arguments).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: unknown) => fn };
});

const {
  listPublishedPosts,
  getPublishedPost,
  uniqueSlugFor,
  countPostsByStatus,
} = await import("@/lib/posts");

beforeEach(() => {
  findMany.mockReset();
  findFirst.mockReset();
  groupBy.mockReset();
  findUnique.mockReset();
});

describe("listPublishedPosts", () => {
  it("returns posts with ISO date strings", async () => {
    findMany.mockResolvedValue([
      {
        slug: "a",
        title: "A",
        excerpt: "x",
        body: "one two three",
        publishedAt: new Date("2026-11-16T10:00:00.000Z"),
        coverPublicId: null,
        coverAlt: null,
        coverWidth: null,
        coverHeight: null,
        _count: { comments: 0 },
      },
    ]);
    const { posts, degraded } = await listPublishedPosts();
    expect(degraded).toBe(false);
    // ISO strings, not Date objects: values crossing Next's data cache are
    // serialized, so a Date is not guaranteed to survive as a Date.
    //
    // Note what is NOT here: `body`. The index reads it to count words and
    // then discards it, so the cached value stays small no matter how long
    // the posts are.
    expect(posts).toEqual([
      {
        slug: "a",
        title: "A",
        excerpt: "x",
        publishedAt: "2026-11-16T10:00:00.000Z",
        readingMinutes: 1,
        cover: null,
        commentCount: 0,
      },
    ]);
  });

  it("flattens the four cover columns into one present-or-absent value", async () => {
    findMany.mockResolvedValue([
      {
        slug: "a",
        title: "A",
        excerpt: "x",
        body: "hi",
        publishedAt: new Date("2026-11-16T10:00:00.000Z"),
        coverPublicId: "blog/kq3n8x",
        coverAlt: "a lake at dusk",
        coverWidth: 3000,
        coverHeight: 2000,
        _count: { comments: 0 },
      },
    ]);
    const { posts } = await listPublishedPosts();
    expect(posts[0].cover).toEqual({
      publicId: "blog/kq3n8x",
      alt: "a lake at dusk",
      width: 3000,
      height: 2000,
    });
  });

  it("treats a cover with no alt as decorative rather than as missing", async () => {
    // "" is a deliberate statement (alt="" is correct for a decorative
    // image); null in the column means nobody filled it in. Both render the
    // same way, so they collapse to "".
    findMany.mockResolvedValue([
      {
        slug: "a",
        title: "A",
        excerpt: "x",
        body: "hi",
        publishedAt: new Date("2026-11-16T10:00:00.000Z"),
        coverPublicId: "blog/kq3n8x",
        coverAlt: null,
        coverWidth: null,
        coverHeight: null,
        _count: { comments: 0 },
      },
    ]);
    const { posts } = await listPublishedPosts();
    expect(posts[0].cover).toEqual({
      publicId: "blog/kq3n8x",
      alt: "",
      width: null,
      height: null,
    });
  });

  it("reads the body so it can report reading time", async () => {
    // Guards the trade recorded in lib/posts.ts: the index pays to read
    // bodies it never renders, rather than carrying a denormalised
    // readingMinutes column that can drift. If someone drops `body` from
    // this select to save I/O, reading time silently becomes 0.
    findMany.mockResolvedValue([]);
    await listPublishedPosts();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ body: true }),
      })
    );
  });

  it("DEGRADES rather than throwing when the database is unreachable", async () => {
    // The whole point: /blog is prerendered at build time, so a throw here
    // would fail `next build` and couple every deploy to Neon being up.
    findMany.mockRejectedValue(new Error("connection refused"));
    await expect(listPublishedPosts()).resolves.toEqual({
      posts: [],
      degraded: true,
    });
  });

  it("drops a PUBLISHED row that has no publishedAt", async () => {
    // Only reachable by publishing a row by hand in psql or Prisma Studio.
    // Omitting it beats rendering an undated post or throwing on a null.
    findMany.mockResolvedValue([
      { slug: "a", title: "A", excerpt: "x", publishedAt: null },
    ]);
    const { posts } = await listPublishedPosts();
    expect(posts).toEqual([]);
  });

  it("asks only for PUBLISHED rows, newest first", async () => {
    findMany.mockResolvedValue([]);
    await listPublishedPosts();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: PostStatus.PUBLISHED }),
        orderBy: { publishedAt: "desc" },
      })
    );
  });
});

describe("getPublishedPost", () => {
  it("rejects a malformed slug WITHOUT touching the database", async () => {
    // Checked before the cached read, so a garbage /blog/<junk> path costs
    // neither a round trip nor a new data-cache entry.
    await expect(getPublishedPost("Not A Slug")).resolves.toBeNull();
    await expect(getPublishedPost("../../etc/passwd")).resolves.toBeNull();
    await expect(getPublishedPost("")).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns null for a post that is absent, draft or archived", async () => {
    findFirst.mockResolvedValue(null);
    await expect(getPublishedPost("missing")).resolves.toBeNull();
  });

  it("RE-THROWS when the database is unreachable", async () => {
    // Degrading to null here would make the page call notFound(), and Next
    // would cache that 404 for a post that really exists.
    findFirst.mockRejectedValue(new Error("connection refused"));
    await expect(getPublishedPost("real-post")).rejects.toThrow(
      "connection refused"
    );
  });

  it("returns the post with an ISO date", async () => {
    findFirst.mockResolvedValue({
      slug: "a",
      title: "A",
      excerpt: "x",
      body: "hello",
      publishedAt: new Date("2026-11-16T10:00:00.000Z"),
      coverPublicId: null,
      coverAlt: null,
      coverWidth: null,
      coverHeight: null,
    });
    await expect(getPublishedPost("a")).resolves.toEqual({
      slug: "a",
      title: "A",
      excerpt: "x",
      body: "hello",
      publishedAt: "2026-11-16T10:00:00.000Z",
      readingMinutes: 1,
      cover: null,
      commentCount: 0,
    });
  });

  it("reports the same reading time the index would", async () => {
    // Both surfaces derive it from the body with the same function, so a post
    // cannot advertise "3 min" on the index and "4 min" on the page.
    const body = Array(440).fill("word").join(" ");
    findFirst.mockResolvedValue({
      slug: "a",
      title: "A",
      excerpt: "x",
      body,
      publishedAt: new Date("2026-11-16T10:00:00.000Z"),
      coverPublicId: null,
      coverAlt: null,
      coverWidth: null,
      coverHeight: null,
    });
    findMany.mockResolvedValue([
      {
        slug: "a",
        title: "A",
        excerpt: "x",
        body,
        publishedAt: new Date("2026-11-16T10:00:00.000Z"),
        coverPublicId: null,
        coverAlt: null,
        coverWidth: null,
        coverHeight: null,
        _count: { comments: 0 },
      },
    ]);
    const post = await getPublishedPost("a");
    const { posts } = await listPublishedPosts();
    expect(post?.readingMinutes).toBe(2);
    expect(posts[0].readingMinutes).toBe(2);
  });
});

describe("uniqueSlugFor", () => {
  it("uses the bare slug when nothing has claimed it", async () => {
    findMany.mockResolvedValue([]);
    await expect(uniqueSlugFor("On Shooting Portra")).resolves.toBe(
      "on-shooting-portra"
    );
  });

  it("suffixes rather than mutating an existing post's URL", async () => {
    findMany.mockResolvedValue([{ slug: "hello" }]);
    await expect(uniqueSlugFor("Hello")).resolves.toBe("hello-2");
  });

  it("keeps counting past the first collision", async () => {
    findMany.mockResolvedValue([
      { slug: "hello" },
      { slug: "hello-2" },
      { slug: "hello-3" },
    ]);
    await expect(uniqueSlugFor("Hello")).resolves.toBe("hello-4");
  });

  it("falls back for a title that slugifies to nothing", async () => {
    // "!!!" or a non-Latin title would otherwise produce an empty, invalid URL.
    findMany.mockResolvedValue([]);
    await expect(uniqueSlugFor("!!!")).resolves.toBe("post");
  });

  it("lets a draft keep its own slug when excluded", async () => {
    findMany.mockResolvedValue([]);
    await uniqueSlugFor("Hello", "post-id");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: "post-id" } }),
      })
    );
  });
});

describe("countPostsByStatus", () => {
  it("reports zero for states with no rows", async () => {
    groupBy.mockResolvedValue([
      { status: PostStatus.DRAFT, _count: { status: 2 } },
    ]);
    await expect(countPostsByStatus()).resolves.toEqual({
      DRAFT: 2,
      PUBLISHED: 0,
      ARCHIVED: 0,
    });
  });
});

describe("comment counts on the index", () => {
  it("surfaces only PUBLISHED comments in the count", async () => {
    // The filter lives in the query, so a held or binned comment can never
    // reach a number a visitor sees.
    findMany.mockResolvedValue([]);
    await listPublishedPosts();
    const select = findMany.mock.calls[0][0].select;
    expect(select._count.select.comments.where).toEqual({ status: "PUBLISHED" });
  });

  it("passes the count through to the card", async () => {
    findMany.mockResolvedValue([
      {
        slug: "a",
        title: "A",
        excerpt: "x",
        body: "hi",
        publishedAt: new Date("2026-11-16T10:00:00.000Z"),
        coverPublicId: null,
        coverAlt: null,
        coverWidth: null,
        coverHeight: null,
        _count: { comments: 4 },
      },
    ]);
    const { posts } = await listPublishedPosts();
    expect(posts[0].commentCount).toBe(4);
  });
});
