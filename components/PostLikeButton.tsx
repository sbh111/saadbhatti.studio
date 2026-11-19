"use client";

import { useEffect, useRef, useState } from "react";
import { shouldRollbackLike } from "@/lib/likeButton";
import { useIsAdmin } from "./AdminProvider";

/**
 * The like control under a post, with a public count.
 *
 * ── Two deliberate divergences from components/LikeButton.tsx ─────────────
 * The artwork button shows NO count and does zero network on mount, which is
 * what keeps the collection pages prerendered with no request at all. This one
 * does fetch, because the count is public — and that is permitted by
 * `docs/architecture.md` invariant 2(c), which prescribes exactly this: fetch
 * per-visitor and live data client-side rather than putting it in the render.
 *
 * What it does NOT fetch is whether *this* visitor has liked. That stays in
 * `localStorage`, same as the artwork button, and for a reason that is about
 * the server rather than the client: it keeps `/api/blog/engagement` free of
 * per-visitor data, which is the only thing that lets the counts be cached at
 * the CDN. See the header of app/api/blog/engagement/route.ts.
 *
 * The honest cost: the same person on a second device sees an empty heart,
 * clicks, and the number does not move — their IP hash already liked. The
 * artwork button has always had this property; here it is visible.
 *
 * ── Hydration ─────────────────────────────────────────────────────────────
 * The server renders the unliked state with no count, so the prerendered HTML
 * is identical for every visitor. `localStorage` is read in an effect, never
 * during render — reading it during render is the classic way to produce a
 * mismatch. A count of `null` renders as nothing, which is also what a failed
 * fetch shows: never a fabricated `0`, which would be indistinguishable from
 * real data and would turn an outage into "nobody liked this".
 */

/** Shared with components/LikeButton.tsx — one list of liked things. */
const STORAGE_KEY = "sbh_blog_likes";

function loadLiked(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    // Storage full, disabled, or a private window — the like still reaches
    // the server, it just will not be remembered here.
    return new Set();
  }
}

function saveLiked(slugs: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...slugs]));
  } catch {
    /* same as above — never let storage break the control */
  }
}

export default function PostLikeButton({ slug }: { slug: string }) {
  const isAdmin = useIsAdmin();
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    setLiked(loadLiked().has(slug));
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/blog/engagement?slugs=${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const count = data[slug]?.likes;
        if (typeof count === "number") setLikes(count);
      })
      // A failed count is not an error worth showing: the control still works.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // The owner liking their own post is noise. Hidden here to match InquiryForm
  // and LikeButton; the server also no-ops an admin like, because a client flag
  // resolves asynchronously and can be spoofed.
  if (isAdmin) return null;

  async function toggle() {
    if (busy) return;
    const next = !liked;
    const previousLiked = liked;
    const previousLikes = likes;
    const previousSet = loadLiked();

    setLiked(next);
    // Optimistic, and only when a real count is already known — incrementing
    // from `null` would invent a number.
    if (likes !== null) setLikes(likes + (next ? 1 : -1));
    setBusy(true);

    const nextSet = new Set(previousSet);
    if (next) nextSet.add(slug);
    else nextSet.delete(slug);
    saveLiked(nextSet);

    const seq = ++requestSeq.current;
    let ok = false;
    let serverLikes: number | null = null;
    try {
      const res = await fetch("/api/blog/likes", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        // A SLUG, never a post id — the server resolves it. See the route.
        body: JSON.stringify({ slug }),
        keepalive: true,
      });
      ok = res.ok;
      if (ok) {
        const data = await res.json().catch(() => null);
        if (typeof data?.likes === "number") serverLikes = data.likes;
      }
    } catch {
      ok = false;
    } finally {
      setBusy(false);
    }

    // Reuses the helper the artwork button's regression was extracted into
    // (tech debt 1.7): a stale response is never rolled back, whatever it
    // says, and any non-2xx or network failure rolls back both the visual
    // state and the stored one.
    if (shouldRollbackLike(ok, seq, requestSeq.current)) {
      setLiked(previousLiked);
      setLikes(previousLikes);
      saveLiked(previousSet);
      return;
    }

    // Settle on the server's number rather than the optimistic one. This is
    // also how a deduped like becomes visible honestly: the heart fills and
    // the count does not move.
    if (seq === requestSeq.current && serverLikes !== null) {
      setLikes(serverLikes);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-steel disabled:opacity-60"
      disabled={busy}
    >
      <span aria-hidden="true">{liked ? "♥" : "♡"}</span>
      <span>{liked ? "liked" : "like"}</span>
      {likes !== null && (
        <span className="text-ink-faint" aria-label={`${likes} likes`}>
          {likes}
        </span>
      )}
    </button>
  );
}
