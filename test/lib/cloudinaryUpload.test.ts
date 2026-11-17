import { describe, expect, it } from "vitest";
import {
  BLOG_UPLOAD_FORMATS,
  BLOG_UPLOAD_ROOT,
  FOLDER_LABEL_MAX,
  blogUploadFolder,
  folderLabelFromSlug,
  mintBlogUploadTicket,
  signUploadParams,
  uploadStringToSign,
} from "@/lib/cloudinaryUpload";
import { COVER_PUBLIC_ID_MAX, isValidCoverPublicId } from "@/lib/blogLimits";

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
 *
 * Its literal values are left exactly as Cloudinary echoed them (a flat
 * `folder=blog`, from before uploads were scoped per post). It is a record of
 * the ENCODING, not of today's folder layout — rewriting it to match the
 * current folder would throw away the only independent evidence here.
 */

const ECHOED_BY_CLOUDINARY =
  "allowed_formats=jpg,jpeg,png,webp,avif,gif&folder=blog&timestamp=1794915831";

const POST_ID = "clq2x8k9p0000abcd1234efgh";

describe("uploadStringToSign", () => {
  it("reproduces the string Cloudinary echoed for a real blog upload", () => {
    expect(
      uploadStringToSign({
        allowed_formats: BLOG_UPLOAD_FORMATS,
        folder: "blog",
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
        folder: "blog",
        allowed_formats: BLOG_UPLOAD_FORMATS,
      })
    ).toBe(ECHOED_BY_CLOUDINARY);
  });

  it("does not URL-encode values", () => {
    // The commas in allowed_formats survive as commas; percent-encoding them
    // produces a valid-looking signature that Cloudinary rejects. The `/` in a
    // per-post folder must survive for the same reason.
    expect(uploadStringToSign({ allowed_formats: "a,b" })).toBe(
      "allowed_formats=a,b"
    );
    expect(uploadStringToSign({ folder: "blog/abc" })).toBe("folder=blog/abc");
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
          folder: "blog",
          timestamp: 1794915831,
        },
        "dummy-secret"
      )
    ).toBe("1f2d3bd1a0214fb6a17205a39bc15735dc346fdb");
  });

  it("changes when the timestamp changes, so a signature cannot be replayed forever", () => {
    const base = { folder: "blog", timestamp: 1 };
    const later = { folder: "blog", timestamp: 2 };
    expect(signUploadParams(base, "s")).not.toBe(signUploadParams(later, "s"));
  });

  it("changes when the folder changes, so one post's ticket cannot target another", () => {
    const a = { folder: blogUploadFolder("aaaaaaaa"), timestamp: 1 };
    const b = { folder: blogUploadFolder("bbbbbbbb"), timestamp: 1 };
    expect(signUploadParams(a, "s")).not.toBe(signUploadParams(b, "s"));
  });
});

describe("folderLabelFromSlug", () => {
  it("keeps a normal slug as-is", () => {
    expect(folderLabelFromSlug("on-shooting-portra")).toBe("on-shooting-portra");
  });

  it("truncates a long slug without leaving a trailing dash", () => {
    // A 160-character slug is legal (SLUG_MAX), and a folder ending in "-"
    // reads like a mistake.
    const long = "a".repeat(55) + "-" + "b".repeat(100);
    const label = folderLabelFromSlug(long);
    expect(label.length).toBeLessThanOrEqual(FOLDER_LABEL_MAX);
    expect(label.endsWith("-")).toBe(false);
  });

  it("drops anything outside the safe alphabet", () => {
    // Defensive: this string is interpolated into a path that gets SIGNED.
    expect(folderLabelFromSlug("a/b")).toBe("ab");
    expect(folderLabelFromSlug("../art")).toBe("art");
    expect(folderLabelFromSlug("a.b")).toBe("ab");
    expect(folderLabelFromSlug("Mixed Case")).toBe("mixedcase");
  });

  it("returns empty for a slug that reduces to nothing", () => {
    expect(folderLabelFromSlug("...")).toBe("");
    expect(folderLabelFromSlug("")).toBe("");
  });
});

describe("blogUploadFolder", () => {
  it("names the folder readably AND uniquely", () => {
    // The slug is what makes it recognisable in the Cloudinary console; the
    // id is what makes it unambiguous when two posts share a title.
    expect(blogUploadFolder(POST_ID, "on-shooting-portra")).toBe(
      `blog/on-shooting-portra-${POST_ID}`
    );
  });

  it("falls back to the bare id when the slug reduces to nothing", () => {
    expect(blogUploadFolder(POST_ID, "...")).toBe(`blog/${POST_ID}`);
    expect(blogUploadFolder(POST_ID)).toBe(`blog/${POST_ID}`);
  });

  it("distinguishes two posts that share a title", () => {
    const a = blogUploadFolder("aaaaaaaa", "same-title");
    const b = blogUploadFolder("bbbbbbbb", "same-title");
    expect(a).not.toBe(b);
  });

  it("stays inside the blog root whatever the slug contains", () => {
    for (const slug of ["../art", "a/b", "....", "normal"]) {
      const folder = blogUploadFolder(POST_ID, slug);
      expect(folder.startsWith(`${BLOG_UPLOAD_ROOT}/`)).toBe(true);
      expect(folder).not.toContain("..");
      // Exactly one separator: the one between the root and the folder.
      expect(folder.split("/")).toHaveLength(2);
    }
  });

  it("produces a public_id the cover validator accepts, even at full length", () => {
    // The two sides have to agree, and the worst case is a maximal slug and a
    // maximal id — which must still fit the VARCHAR(255) column.
    const maxId = "c" + "0".repeat(63);
    const publicId = `${blogUploadFolder(maxId, "x".repeat(160))}/abcdefghij123456`;
    expect(isValidCoverPublicId(publicId)).toBe(true);
    expect(publicId.length).toBeLessThanOrEqual(COVER_PUBLIC_ID_MAX);
  });
});

describe("mintBlogUploadTicket", () => {
  const withCredentials = <T,>(fn: () => T): T => {
    const prev = {
      key: process.env.CLOUDINARY_API_KEY,
      secret: process.env.CLOUDINARY_API_SECRET,
    };
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_SECRET = "test-secret";
    try {
      return fn();
    } finally {
      process.env.CLOUDINARY_API_KEY = prev.key;
      process.env.CLOUDINARY_API_SECRET = prev.secret;
    }
  };

  it("scopes the ticket to the post's readable folder", () => {
    const ticket = withCredentials(() =>
      mintBlogUploadTicket(POST_ID, "on-shooting-portra")
    );
    expect(ticket.folder).toBe(`blog/on-shooting-portra-${POST_ID}`);
    expect(ticket.signature).toMatch(/^[0-9a-f]{40}$/);
  });

  it("REFUSES an invalid post id rather than sanitising it", () => {
    // A ticket is a signed capability. Quietly rewriting a bad id would mint a
    // valid signature for a folder nobody asked for, and the caller could not
    // tell. Refusing is the only safe failure.
    for (const bad of [
      "",
      "../art",
      "blog/../art",
      "abc/def",
      "a.b",
      "SHORT",
      "x", // too short
      "a".repeat(100), // too long
    ]) {
      expect(
        () => withCredentials(() => mintBlogUploadTicket(bad)),
        `${JSON.stringify(bad)} should be refused`
      ).toThrow();
    }
  });

  it("cannot be tricked into signing a folder outside blog/", () => {
    // Belt-and-braces on the above: whatever a caller passes, a ticket that is
    // successfully minted always names a folder under blog/.
    const ticket = withCredentials(() => mintBlogUploadTicket(POST_ID));
    expect(ticket.folder.startsWith("blog/")).toBe(true);
    expect(ticket.folder).not.toContain("..");
  });
});

describe("upload scoping", () => {
  it("targets a root outside the catalog", () => {
    // lib/constants.ts's CATALOG_ROOT_FOLDER is "art"; getCatalog() reads only
    // its subfolders, so blog uploads must not land under it.
    expect(BLOG_UPLOAD_ROOT).toBe("blog");
    expect(BLOG_UPLOAD_ROOT.startsWith("art")).toBe(false);
  });

  it("does not allow SVG uploads", () => {
    // An SVG is a script-bearing document; serving one from the account is
    // equivalent to hosting HTML there.
    expect(BLOG_UPLOAD_FORMATS).not.toContain("svg");
  });
});
