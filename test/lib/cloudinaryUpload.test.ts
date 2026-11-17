import { describe, expect, it } from "vitest";
import {
  BLOG_UPLOAD_FORMATS,
  BLOG_UPLOAD_FOLDER,
  signUploadParams,
  uploadStringToSign,
} from "@/lib/cloudinaryUpload";

/**
 * The string-to-sign fixture below is not a guess at Cloudinary's spec — it is
 * Cloudinary's own words. POSTing a deliberately wrong signature to the upload
 * endpoint makes the API echo back the string it expected:
 *
 *   {"error":{"message":"Invalid Signature 000…000. String to sign -
 *    'allowed_formats=jpg,jpeg,png,webp,avif,gif&folder=blog&timestamp=1794915831'."}}
 *
 * A matching request with the signature this module produces got past
 * signature validation to "Missing required parameter - file" — i.e. accepted,
 * and no asset created. That round trip is what these assertions pin down, so
 * a future refactor that changes ordering, separators or encoding fails here
 * rather than in the browser.
 */

const ECHOED_BY_CLOUDINARY =
  "allowed_formats=jpg,jpeg,png,webp,avif,gif&folder=blog&timestamp=1794915831";

describe("uploadStringToSign", () => {
  it("reproduces the string Cloudinary echoed for a real blog upload", () => {
    expect(
      uploadStringToSign({
        allowed_formats: BLOG_UPLOAD_FORMATS,
        folder: BLOG_UPLOAD_FOLDER,
        timestamp: 1794915831,
      })
    ).toBe(ECHOED_BY_CLOUDINARY);
  });

  it("sorts by key rather than trusting insertion order", () => {
    // Same three params, declared backwards — Cloudinary requires them sorted,
    // and object key order is otherwise preserved in JS.
    expect(
      uploadStringToSign({
        timestamp: 1794915831,
        folder: BLOG_UPLOAD_FOLDER,
        allowed_formats: BLOG_UPLOAD_FORMATS,
      })
    ).toBe(ECHOED_BY_CLOUDINARY);
  });

  it("does not URL-encode values", () => {
    // The commas in allowed_formats survive as commas; percent-encoding them
    // produces a valid-looking signature that Cloudinary rejects.
    expect(uploadStringToSign({ allowed_formats: "a,b" })).toBe(
      "allowed_formats=a,b"
    );
  });

  it("emits nothing for no params", () => {
    expect(uploadStringToSign({})).toBe("");
  });
});

describe("signUploadParams", () => {
  it("appends the secret directly, with no separator", () => {
    // sha1("<string to sign>" + "dummy-secret"), computed independently.
    expect(
      signUploadParams(
        {
          allowed_formats: BLOG_UPLOAD_FORMATS,
          folder: BLOG_UPLOAD_FOLDER,
          timestamp: 1794915831,
        },
        "dummy-secret"
      )
    ).toBe("1f2d3bd1a0214fb6a17205a39bc15735dc346fdb");
  });

  it("changes when the timestamp changes, so a signature cannot be replayed forever", () => {
    const base = { folder: BLOG_UPLOAD_FOLDER, timestamp: 1 };
    const later = { folder: BLOG_UPLOAD_FOLDER, timestamp: 2 };
    expect(signUploadParams(base, "s")).not.toBe(signUploadParams(later, "s"));
  });
});

describe("upload scoping", () => {
  it("targets a folder outside the catalog root", () => {
    // lib/constants.ts's CATALOG_ROOT_FOLDER is "art"; getCatalog() reads only
    // its subfolders, so blog uploads must not land under it.
    expect(BLOG_UPLOAD_FOLDER).toBe("blog");
    expect(BLOG_UPLOAD_FOLDER.startsWith("art")).toBe(false);
  });

  it("does not allow SVG uploads", () => {
    // An SVG is a script-bearing document; serving one from the account is
    // equivalent to hosting HTML there.
    expect(BLOG_UPLOAD_FORMATS).not.toContain("svg");
  });
});
