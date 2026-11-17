import { describe, expect, it } from "vitest";
import { formatPostDate } from "@/lib/postDate";

describe("formatPostDate", () => {
  it("renders a reader-facing date", () => {
    expect(formatPostDate("2026-11-16T10:00:00.000Z")).toBe(
      "November 16, 2026"
    );
  });

  it("is pinned to UTC, so the same input never renders two different days", () => {
    // The point of the fixed timeZone. Just after UTC midnight is the case an
    // implicit timezone gets wrong: formatted in, say, America/Chicago this
    // would read "November 15" — and would then differ between Vercel regions,
    // making the prerendered HTML non-deterministic.
    expect(formatPostDate("2026-11-16T00:30:00.000Z")).toBe(
      "November 16, 2026"
    );
    expect(formatPostDate("2026-11-16T23:30:00.000Z")).toBe(
      "November 16, 2026"
    );
  });

  it("returns an empty string for unparseable input", () => {
    // Better than throwing inside a server component, or rendering the literal
    // text "Invalid Date" into a published post.
    expect(formatPostDate("not a date")).toBe("");
    expect(formatPostDate("")).toBe("");
  });
});
