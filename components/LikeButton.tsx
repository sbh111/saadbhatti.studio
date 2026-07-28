"use client";

import { useEffect, useState } from "react";
import { getSessionId } from "@/lib/sessionId";
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

  // Seed from localStorage after mount (SSR renders the unliked state, so the
  // static markup is identical for everyone — no hydration mismatch).
  useEffect(() => {
    setLiked(loadLiked().has(publicId));
  }, [publicId]);

  if (isAdmin) return null;

  async function toggle() {
    if (busy) return;
    const next = !liked;
    setLiked(next); // optimistic
    setBusy(true);

    // Persist intent locally first so a reload reflects it even if the POST fails.
    const set = loadLiked();
    if (next) set.add(publicId);
    else set.delete(publicId);
    saveLiked(set);

    try {
      await fetch("/api/likes", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artworkPublicId: publicId,
          sessionId: getSessionId(),
        }),
        keepalive: true,
      });
    } catch {
      /* network failed — keep the optimistic state; localStorage already set */
    } finally {
      setBusy(false);
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
