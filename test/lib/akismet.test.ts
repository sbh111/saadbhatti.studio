import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkComment } from "@/lib/akismet";

/**
 * The only behaviour here worth testing hard is FAILING CLOSED. lib/akismet.ts
 * inverts this codebase's "warn and no-op" convention on purpose — its verdict
 * decides whether a comment is publicly visible — so every path that cannot
 * produce a real answer must resolve to `unavailable`, which the route maps to
 * HELD.
 *
 * test/setup.ts deletes AKISMET_API_KEY before every file, so the unconfigured
 * case is the default and a test cannot reach the real service by accident.
 */

const input = {
  authorName: "Visitor",
  body: "Lovely photograph.",
  userIp: "203.0.113.4",
  userAgent: "Mozilla/5.0",
  referrer: null,
  permalink: "https://www.saadbhatti.studio/blog/a-post",
};

/**
 * A fresh Response per call. `Response` bodies are single-use, so handing the
 * same instance to two invocations throws "Body has already been read" — which
 * is a property of the test double, not of the code under test.
 */
const replyWith = (
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {}
) =>
  () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: init.headers ?? {},
    });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.AKISMET_API_KEY;
});

describe("checkComment — fails closed", () => {
  it("returns unavailable, and makes NO request, with no key configured", async () => {
    const result = await checkComment(input);
    expect(result.verdict).toBe("unavailable");
    expect(result.reason).toMatch(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unavailable when the request throws (timeout, DNS, offline)", async () => {
    process.env.AKISMET_API_KEY = "test-key";
    fetchMock.mockRejectedValue(new Error("The operation was aborted"));
    expect((await checkComment(input)).verdict).toBe("unavailable");
  });

  it("returns unavailable on a non-2xx response", async () => {
    process.env.AKISMET_API_KEY = "test-key";
    fetchMock.mockImplementation(replyWith("", { status: 500 }));
    const result = await checkComment(input);
    expect(result.verdict).toBe("unavailable");
    expect(result.reason).toMatch(/500/);
  });

  it("returns unavailable on a body that is neither true nor false", async () => {
    // What a bad key or a missing required field actually produces — which is
    // "we are calling the API wrong", not "this is spam".
    process.env.AKISMET_API_KEY = "test-key";
    fetchMock.mockImplementation(
      replyWith("invalid", { headers: { "x-akismet-debug-help": "empty blog" } })
    );
    const result = await checkComment(input);
    expect(result.verdict).toBe("unavailable");
    expect(result.reason).toMatch(/bad response/);
  });

  it("never throws, whatever happens", async () => {
    process.env.AKISMET_API_KEY = "test-key";
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(checkComment(input)).resolves.toBeDefined();
  });
});

describe("checkComment — real verdicts", () => {
  beforeEach(() => {
    process.env.AKISMET_API_KEY = "test-key";
  });

  it('maps "false" to ham with no reason', async () => {
    fetchMock.mockImplementation(replyWith("false"));
    expect(await checkComment(input)).toEqual({ verdict: "ham", reason: null });
  });

  it('maps "true" to spam — held, not binned, so the owner can audit', async () => {
    fetchMock.mockImplementation(replyWith("true"));
    expect((await checkComment(input)).verdict).toBe("spam");
  });

  it("maps the discard pro-tip to blatant", async () => {
    fetchMock.mockImplementation(
      replyWith("true", { headers: { "x-akismet-pro-tip": "discard" } })
    );
    expect((await checkComment(input)).verdict).toBe("blatant");
  });

  it("tolerates surrounding whitespace in the body", async () => {
    fetchMock.mockImplementation(replyWith("false\n"));
    expect((await checkComment(input)).verdict).toBe("ham");
  });
});

describe("checkComment — the request it sends", () => {
  beforeEach(() => {
    process.env.AKISMET_API_KEY = "test-key";
    fetchMock.mockImplementation(replyWith("false"));
  });

  const sentBody = async () => {
    await checkComment(input);
    const [, init] = fetchMock.mock.calls[0];
    return (init.body as URLSearchParams).toString();
  };

  it("puts the key in the hostname, not the body", async () => {
    await checkComment(input);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test-key.rest.akismet.com/1.1/comment-check");
    expect((init.body as URLSearchParams).toString()).not.toContain("test-key");
  });

  it("sends user_ip — Akismet cannot score without it", async () => {
    expect(await sentBody()).toContain("user_ip=203.0.113.4");
  });

  it("sends no email field, because no email is collected", async () => {
    expect(await sentBody()).not.toContain("comment_author_email");
  });

  it("marks non-production traffic as a test so it does not train the model", async () => {
    // NODE_ENV is "test" under vitest.
    expect(await sentBody()).toContain("is_test=1");
  });

  it("omits optional fields rather than sending empty ones", async () => {
    // referrer is null here; an empty referrer= is not the same as absent.
    expect(await sentBody()).not.toContain("referrer=");
  });
});
