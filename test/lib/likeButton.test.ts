import { describe, expect, it } from "vitest";
import { shouldRollbackLike } from "@/lib/likeButton";

// Tech debt 1.7: LikeButton used to write the optimistic state + localStorage
// before the request and never check res.ok, so a failed request left a
// "liked" heart and localStorage entry with no matching db row, forever.
// shouldRollbackLike is the pure decision behind the fix — extracted since
// this repo's vitest environment is "node" (no DOM), so a real click-and-fetch
// component test isn't available without adding a heavier test setup.
describe("shouldRollbackLike", () => {
  it("does not roll back a successful, current request", () => {
    expect(shouldRollbackLike(true, 1, 1)).toBe(false);
  });

  it("rolls back a failed, current request", () => {
    expect(shouldRollbackLike(false, 1, 1)).toBe(true);
  });

  it("never rolls back a stale (superseded) request, even if it failed", () => {
    // requestSeq (1) !== latestSeq (2): a later click already changed state.
    expect(shouldRollbackLike(false, 1, 2)).toBe(false);
  });

  it("a stale successful request is also a no-op", () => {
    expect(shouldRollbackLike(true, 1, 2)).toBe(false);
  });
});
