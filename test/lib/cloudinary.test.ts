import { describe, expect, it } from "vitest";
import { bodyImageUrl } from "@/lib/cloudinary";

describe("bodyImageUrl", () => {
  it("builds a capped, auto-format delivery URL for a public id", () => {
    expect(bodyImageUrl("blog/abc123")).toBe(
      "https://res.cloudinary.com/sbh111/image/upload/f_auto,q_auto,c_limit,w_1600/blog/abc123"
    );
  });
});
