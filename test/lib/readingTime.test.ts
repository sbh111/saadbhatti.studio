import { describe, expect, it } from "vitest";
import {
  WORDS_PER_MINUTE,
  countWords,
  readingMinutes,
  readingTimeLabel,
} from "@/lib/readingTime";

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("collapses runs of whitespace, including newlines", () => {
    expect(countWords("one\n\n  two\t\tthree ")).toBe(3);
  });

  it("returns 0 for empty and whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });
});

describe("readingMinutes", () => {
  it("returns 0 for an empty body — not 1", () => {
    // A blank draft must be able to render no label at all, rather than
    // claiming it takes a minute to read nothing.
    expect(readingMinutes("")).toBe(0);
  });

  it("floors a non-empty body at 1 minute", () => {
    expect(readingMinutes("hi")).toBe(1);
  });

  it("rounds to the nearest minute", () => {
    const words = (n: number) => Array(n).fill("word").join(" ");
    expect(readingMinutes(words(WORDS_PER_MINUTE))).toBe(1);
    expect(readingMinutes(words(WORDS_PER_MINUTE * 2))).toBe(2);
    // 2.4 minutes rounds down, 2.6 rounds up.
    expect(readingMinutes(words(Math.round(WORDS_PER_MINUTE * 2.4)))).toBe(2);
    expect(readingMinutes(words(Math.round(WORDS_PER_MINUTE * 2.6)))).toBe(3);
  });
});

describe("readingTimeLabel", () => {
  it("formats the minute count", () => {
    expect(readingTimeLabel("hello")).toBe("1 min read");
  });

  it("returns an empty string for an empty body", () => {
    expect(readingTimeLabel("")).toBe("");
  });
});
