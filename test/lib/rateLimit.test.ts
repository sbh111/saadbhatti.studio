import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/rateLimit.ts imports `{ prisma } from "./db"`, which vitest resolves to
// the same file as the "@/lib/db" alias — mocking one intercepts both.
const upsert = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { rateWindow: { upsert: (...args: unknown[]) => upsert(...args) } },
}));

const { isRateLimited } = await import("@/lib/rateLimit");

describe("isRateLimited", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    upsert.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keys the window on floor(now / windowMs) * windowMs", async () => {
    const windowMs = 60_000;
    vi.setSystemTime(new Date(123_456_789)); // arbitrary instant mid-window
    upsert.mockResolvedValue({ count: 1 });

    await isRateLimited("bucket", "iphash", 5, windowMs);

    const expectedStart = new Date(
      Math.floor(123_456_789 / windowMs) * windowMs
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bucket_ipHash_windowStart: {
            bucket: "bucket",
            ipHash: "iphash",
            windowStart: expectedStart,
          },
        },
      })
    );
  });

  it("does not limit at or under the max", async () => {
    upsert.mockResolvedValue({ count: 5 });
    await expect(isRateLimited("bucket", "ip", 5, 60_000)).resolves.toBe(
      false
    );
  });

  it("limits once the count exceeds the max", async () => {
    upsert.mockResolvedValue({ count: 6 });
    await expect(isRateLimited("bucket", "ip", 5, 60_000)).resolves.toBe(true);
  });

  it("resets the count on window rollover", async () => {
    const windowMs = 60_000;

    vi.setSystemTime(new Date(0));
    upsert.mockResolvedValue({ count: 6 });
    await expect(isRateLimited("bucket", "ip", 5, windowMs)).resolves.toBe(
      true
    );
    const firstStart =
      upsert.mock.calls[0][0].where.bucket_ipHash_windowStart.windowStart;

    // A fresh window is a fresh upsert row — count starts over.
    vi.setSystemTime(new Date(windowMs));
    upsert.mockResolvedValue({ count: 1 });
    await expect(isRateLimited("bucket", "ip", 5, windowMs)).resolves.toBe(
      false
    );
    const secondStart =
      upsert.mock.calls[1][0].where.bucket_ipHash_windowStart.windowStart;

    expect(secondStart.getTime()).toBeGreaterThan(firstStart.getTime());
  });

  it("fails open when prisma throws", async () => {
    upsert.mockRejectedValue(new Error("connection refused"));
    await expect(isRateLimited("bucket", "ip", 5, 60_000)).resolves.toBe(
      false
    );
  });
});

describe("isRateLimited DB-failure logging (tech debt 2.6)", () => {
  // Each test gets a fresh module instance so the module-level throttle state
  // (lastWarnAt / suppressedSinceLastWarn) doesn't leak between tests — the
  // vi.mock("@/lib/db") factory closes over the shared `upsert` fn above, so
  // resetting the module registry doesn't lose control over it.
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    upsert.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs the bucket and error message, never the ipHash", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { isRateLimited: fresh } = await import("@/lib/rateLimit");
    upsert.mockRejectedValue(new Error("connection refused"));

    await fresh("search", "super-secret-ip-hash", 5, 60_000);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain("search");
    expect(line).toContain("connection refused");
    expect(line).not.toContain("super-secret-ip-hash");
  });

  it("throttles repeated failures to one log line per minute, folding the rest into a count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { isRateLimited: fresh } = await import("@/lib/rateLimit");
    upsert.mockRejectedValue(new Error("timeout"));

    await fresh("like", "ip", 5, 60_000); // first ever failure: logs
    await fresh("like", "ip", 5, 60_000); // within the throttle window: suppressed
    await fresh("like", "ip", 5, 60_000); // ditto
    expect(warn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    await fresh("like", "ip", 5, 60_000); // window elapsed: logs again, with a count
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0] as string).toContain(
      "2 more suppressed in the last minute"
    );
  });
});
