import { describe, expect, it } from "vitest";
import { SITE_ORIGIN } from "@/lib/constants";
import {
  ART_BASE_PATH,
  artHref,
  artworkHref,
  artworkUrl,
  collectionHref,
  mediumHref,
} from "@/lib/urls";

// lib/urls.ts exists because six files each carried their own copy of
// `/${mediumSlug}/${collectionSlug}#${artworkSlug}`. Those copies had no test
// between them, so moving the catalog under /art was six chances to miss one —
// and a miss would surface as a 404 in an email that had already been sent,
// not as a failing build. These tests pin the prefix and the composition rule
// so the next prefix change is one edit plus a green suite.

const MEDIUM = "photography";
const COLLECTION = "southwest";
const ARTWORK = "colorado-iejdgb";

describe("lib/urls", () => {
  it("builds every catalog path under ART_BASE_PATH", () => {
    expect(ART_BASE_PATH).toBe("/art");
    for (const href of [
      artHref(),
      mediumHref(MEDIUM),
      collectionHref(MEDIUM, COLLECTION),
      artworkHref(MEDIUM, COLLECTION, ARTWORK),
    ]) {
      expect(href.startsWith(`${ART_BASE_PATH}/`) || href === ART_BASE_PATH).toBe(
        true
      );
    }
  });

  it("nests each level inside the one above it", () => {
    // The drift that actually bites: a deeper helper that stops agreeing with
    // the shallower one it should be built from.
    expect(mediumHref(MEDIUM)).toBe(`${artHref()}/${MEDIUM}`);
    expect(collectionHref(MEDIUM, COLLECTION)).toBe(
      `${mediumHref(MEDIUM)}/${COLLECTION}`
    );
    expect(artworkHref(MEDIUM, COLLECTION, ARTWORK)).toBe(
      `${collectionHref(MEDIUM, COLLECTION)}#${ARTWORK}`
    );
  });

  it("spells out the exact public shapes", () => {
    expect(artHref()).toBe("/art");
    expect(mediumHref("paintings")).toBe("/art/paintings");
    expect(collectionHref(MEDIUM, COLLECTION)).toBe("/art/photography/southwest");
    expect(artworkHref(MEDIUM, COLLECTION, ARTWORK)).toBe(
      "/art/photography/southwest#colorado-iejdgb"
    );
  });

  it("artworkUrl is the absolute form on the canonical origin, with no double slash", () => {
    // This is the link that goes into an inquiry-notification email
    // (lib/mail.ts), where a relative path is useless and a wrong origin takes
    // the apex 308.
    expect(artworkUrl(MEDIUM, COLLECTION, ARTWORK)).toBe(
      `${SITE_ORIGIN}/art/photography/southwest#colorado-iejdgb`
    );
    expect(artworkUrl(MEDIUM, COLLECTION, ARTWORK)).not.toContain("//art");
    expect(artworkUrl(MEDIUM, COLLECTION, ARTWORK)).toBe(
      `${SITE_ORIGIN}${artworkHref(MEDIUM, COLLECTION, ARTWORK)}`
    );
  });
});
