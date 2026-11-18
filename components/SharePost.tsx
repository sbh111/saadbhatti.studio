"use client";

import { useEffect, useState } from "react";
import { shareTargets } from "@/lib/share";

/**
 * Share controls under a post.
 *
 * A client component for two reasons only — the clipboard API and
 * `navigator.share`. Every network target is a plain `<a>` that works with
 * JavaScript disabled, so the useful half of this degrades to nothing worse
 * than "no copy button".
 *
 * Nothing is stored and no count is shown: none of these targets reports one,
 * a click on an outbound anchor is not a share, and an inflated number is
 * worse than no number. See lib/share.ts.
 *
 * ── Mounted AROUND PostArticle, never inside it ───────────────────────────
 * PostArticle is shared with the admin draft preview, and a draft has no
 * public URL to share. Composing engagement controls into the page rather than
 * into the article is what keeps the preview honest — the same reason the back
 * link is an opt-in `backHref` prop there.
 */
export default function SharePost({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  /**
   * Capability detection has to happen after mount, not during render: the
   * server has no `navigator`, so deciding on the server would produce markup
   * that disagrees with the client and a hydration mismatch. The prerendered
   * HTML therefore shows the link targets only, and the two JS-dependent
   * buttons appear once we know they will work.
   */
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
    setCanCopy(
      typeof navigator !== "undefined" && !!navigator.clipboard?.writeText
    );
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Permission denied, or a non-secure context. Show the URL instead so
      // the visitor can copy it by hand rather than being told nothing.
      setRevealed(true);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ url, title });
    } catch {
      // AbortError when the sheet is dismissed — the overwhelmingly common
      // case, and not a failure worth reporting.
    }
  }

  const control =
    "rounded-[2px] border border-hairline px-2.5 py-1 text-[13px] text-ink-muted hover:text-steel";

  return (
    <section
      aria-labelledby="share-heading"
      className="mx-auto max-w-[680px] px-[30px] pb-10"
    >
      <h2
        id="share-heading"
        className="text-[13px] font-medium text-ink-muted"
      >
        share
      </h2>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* The native sheet is listed first on purpose: it is the only route to
            Instagram, which has no web intent for an arbitrary link, and on a
            phone it is the control people actually use. */}
        {canNativeShare && (
          <button type="button" onClick={nativeShare} className={control}>
            share…
          </button>
        )}

        {canCopy && (
          <button
            type="button"
            onClick={copy}
            className={control}
            aria-live="polite"
          >
            {copied ? "link copied" : "copy link"}
          </button>
        )}

        {shareTargets(url, title).map((target) => (
          <a
            key={target.id}
            href={target.href}
            // noopener is what stops the opened page reaching back through
            // window.opener, and is only meaningful alongside target.
            target="_blank"
            rel="noopener noreferrer"
            data-track={`share:${target.id}`}
            className={control}
          >
            {target.label}
          </a>
        ))}
      </div>

      {revealed && (
        <p className="mt-2 text-[13px] text-ink-faint">
          Copy this:{" "}
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-[2px] border border-hairline bg-panel px-2 py-1 font-mono text-[12px] text-ink"
          />
        </p>
      )}
    </section>
  );
}
