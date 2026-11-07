"use client";

import { useEffect } from "react";
import { resolveLegacyHash } from "@/lib/slug";

/**
 * Reordering a collection used to change every artwork's slug; it no longer
 * does (lib/slug.ts, tech debt 1.8) — but a link sent BEFORE that fix (an
 * inquiry-notification email, a row in the admin comment log, a bookmarked
 * search result or like event) can still carry the old, prefixed hash, e.g.
 * "#03-desert-sunset" for an artwork whose current slug is "desert-sunset".
 *
 * On mount and on `hashchange`, if the current hash doesn't match any element
 * on THIS page, try the reorder-prefix-stripped form; if that matches, scroll
 * to it and swap the URL to the canonical hash via `replaceState` so a
 * refresh or re-share carries the new form forward. Renders nothing.
 */
export default function LegacyHashResolver() {
  useEffect(() => {
    const resolve = () => {
      const hash = window.location.hash;
      if (!hash) return;
      const canonicalId = resolveLegacyHash(hash, (id) =>
        document.getElementById(id) !== null
      );
      if (!canonicalId) return;
      document.getElementById(canonicalId)?.scrollIntoView();
      history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${canonicalId}`
      );
    };
    resolve();
    window.addEventListener("hashchange", resolve);
    return () => window.removeEventListener("hashchange", resolve);
  }, []);

  return null;
}
