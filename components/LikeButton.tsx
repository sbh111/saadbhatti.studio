"use client";

import { useEffect, useRef, useState } from "react";
import { getSessionId } from "@/lib/sessionId";
import { shouldRollbackLike } from "@/lib/likeButton";
import { useIsAdmin } from "./AdminProvider";

/**
 * The "like" control under an artwork's caption — the one explicit interest
 * signal. Whether THIS browser has liked a piece lives in localStorage, so the
 * heart fills on mount with zero network on load (keeps the collection pages
 * statically prerendered). The click persists a durable, deduped row via
 * /api/likes and — when streaming is on — emits an artwork_like event.
 *
 * No count is shown publicly (private by design; see /admin/likes). Hidden for
 * admins, matching InquiryForm — the server also no-ops admin likes.
 */

const LS_KEY = "sbh_likes";

function loadLiked(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveLiked(set: Set<string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...set]));
  } catch {
    /* storage full / unavailable — the like still reaches the server */
  }
}

export default function LikeButton({ publicId }: { publicId: string }) {
  const isAdmin = useIsAdmin();
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bumped on every click; lets a response tell whether it's still the most
  // recent request for this button or has been superseded by a later click,
  // so it knows whether rolling back would clobber newer state (tech debt
  // 1.7 — see shouldRollbackLike).
  const requestSeqRef = useRef(0);

  // Seed from localStorage after mount (SSR renders the unliked state, so the
  // static markup is identical for everyone — no hydration mismatch).
  useEffect(() => {
    setLiked(loadLiked().has(publicId));
  }, [publicId]);

  if (isAdmin) return null;

  async function toggle() {
    if (busy) return;
    const next = !liked;
    const previousLiked = liked;
    const previousSet = loadLiked();
    setLiked(next); // optimistic
    setBusy(true);

    // Persist intent locally first so a reload reflects it even if the request fails.
    const nextSet = new Set(previousSet);
    if (next) nextSet.add(publicId);
    else nextSet.delete(publicId);
    saveLiked(nextSet);

    const seq = ++requestSeqRef.current;
    let ok = false;
    try {
      const res = await fetch("/api/likes", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artworkPublicId: publicId,
          sessionId: getSessionId(),
        }),
        keepalive: true,
      });
      ok = res.ok;
    } catch {
      ok = false; // network failure — same as a non-2xx response, below
    } finally {
      setBusy(false);
    }

    // Roll back BOTH the visual state and the localStorage entry to what
    // they were before this click — but only if no later click has already
    // moved the state on (a stale rollback would clobber it).
    if (shouldRollbackLike(ok, seq, requestSeqRef.current)) {
      setLiked(previousLiked);
      saveLiked(previousSet);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? "Unlike this piece" : "Like this piece"}
      className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-steel"
    >
      <span aria-hidden="true" className={liked ? "text-steel" : ""}>
        {liked ? "♥" : "♡"}
      </span>
      <span>{liked ? "liked" : "like"}</span>
    </button>
  );
}
