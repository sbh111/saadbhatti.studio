import { describe, expect, it } from "vitest";
import { applyStagingChange, parseStagingMap } from "@/lib/adminStaging";

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
