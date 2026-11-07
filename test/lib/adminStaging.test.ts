import { describe, expect, it } from "vitest";
import { applyStagingChange, parseStagingMap, pruneSaved } from "@/lib/adminStaging";

// These pin the read-merge-write property tech debt 1.6 exists for: two tabs
// each staging a DIFFERENT key must both survive, because each write reads a
// fresh map and applies only its own key's change — never trusting (or
// clobbering with) a possibly-stale in-memory snapshot.

describe("parseStagingMap", () => {
  it("parses a valid JSON object", () => {
    expect(parseStagingMap<string>('{"a":"1","b":"2"}')).toEqual({
      a: "1",
      b: "2",
    });
  });

  it("defaults to {} for null/undefined/empty (no staged key yet)", () => {
    expect(parseStagingMap(null)).toEqual({});
    expect(parseStagingMap(undefined)).toEqual({});
    expect(parseStagingMap("")).toEqual({});
  });

  it("defaults to {} for malformed JSON rather than throwing", () => {
    expect(parseStagingMap("{not json")).toEqual({});
  });

  it("defaults to {} for valid JSON that isn't a plain object", () => {
    expect(parseStagingMap("[1,2,3]")).toEqual({});
    expect(parseStagingMap("42")).toEqual({});
    expect(parseStagingMap('"a string"')).toEqual({});
    expect(parseStagingMap("null")).toEqual({});
  });
});

describe("applyStagingChange", () => {
  it("sets a key when given a non-null value", () => {
    const next = applyStagingChange({ a: 1 }, "b", 2);
    expect(next).toEqual({ a: 1, b: 2 });
  });

  it("deletes a key when given null", () => {
    const next = applyStagingChange({ a: 1, b: 2 }, "a", null);
    expect(next).toEqual({ b: 2 });
  });

  it("deleting an absent key is a no-op", () => {
    const next = applyStagingChange({ a: 1 }, "missing", null);
    expect(next).toEqual({ a: 1 });
  });

  it("does not mutate the input map (callers persist the return value)", () => {
    const original = { a: 1 };
    const next = applyStagingChange(original, "b", 2);
    expect(original).toEqual({ a: 1 });
    expect(next).not.toBe(original);
  });

  it("two tabs staging different keys both survive under read-merge-write", () => {
    // Simulates the exact 1.6 scenario: tab A and tab B both start from the
    // same persisted map, each stage a DIFFERENT artwork, and each write goes
    // through a fresh read (not a stale in-memory copy) before writing back.
    let storage: Record<string, string> = {};

    const stageFromTab = (key: string, value: string) => {
      const merged = applyStagingChange(storage, key, value);
      storage = merged;
    };

    stageFromTab("artwork-a", "edited by tab A");
    stageFromTab("artwork-b", "edited by tab B");

    expect(storage).toEqual({
      "artwork-a": "edited by tab A",
      "artwork-b": "edited by tab B",
    });
  });
});

describe("pruneSaved", () => {
  const eq = (a: string, b: string) => a === b;

  it("drops an id that was sent, didn't fail, and is unchanged since", () => {
    const current = { a: "v1", b: "v2" };
    const sent = { a: "v1" };
    expect(pruneSaved(current, sent, [], eq)).toEqual({ b: "v2" });
  });

  it("keeps a failed id staged even though it was sent", () => {
    const current = { a: "v1" };
    const sent = { a: "v1" };
    expect(pruneSaved(current, sent, ["a"], eq)).toEqual({ a: "v1" });
  });

  it("keeps an id edited again mid-save — tech debt 1.5's whole point", () => {
    // The admin kept typing while the request was in flight: `current` (read
    // fresh, post-response) no longer matches what was actually `sent`, so
    // this must NOT be dropped even though its id succeeded and isn't failed.
    const current = { a: "v2-typed-during-save" };
    const sent = { a: "v1-sent-to-server" };
    expect(pruneSaved(current, sent, [], eq)).toEqual({
      a: "v2-typed-during-save",
    });
  });

  it("is a no-op for an id already gone from current (e.g. discarded mid-save)", () => {
    const current: Record<string, string> = {};
    const sent = { a: "v1" };
    expect(pruneSaved(current, sent, [], eq)).toEqual({});
  });

  it("leaves ids not present in `sent` untouched", () => {
    const current = { a: "v1", untouched: "v9" };
    const sent = { a: "v1" };
    expect(pruneSaved(current, sent, [], eq)).toEqual({ untouched: "v9" });
  });

  it("does not mutate its `current` argument", () => {
    const current = { a: "v1" };
    pruneSaved(current, { a: "v1" }, [], eq);
    expect(current).toEqual({ a: "v1" });
  });
});
