"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { imageUrl } from "@/lib/cloudinary";
import { useIsAdmin } from "./AdminProvider";

/**
 * Visitor-facing visual search: a right-hand sidebar (desktop only) that reuses
 * ReorderPanel's chrome. Types a description → POSTs to /api/search → shows up to 5
 * thumbnail results linking to the artwork. Renders null for admins, so it shares
 * the collection page's right slot with the admin-only ReorderPanel.
 *
 * The debounce + min-length + abort here only reduce accidental load — the real
 * abuse defenses live server-side in /api/search.
 */

interface SearchResult {
  image: string;
  name: string;
  href: string;
}

type Status = "idle" | "loading" | "done" | "error" | "limited";

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;

/** Same-page jump: if the target artwork is on THIS page, smooth-scroll to it
 *  (a hash change alone won't re-scroll); otherwise let the Link navigate. */
function jumpIfOnPage(e: React.MouseEvent, href: string) {
  const hash = href.indexOf("#");
  if (hash === -1) return;
  const el = document.getElementById(href.slice(hash + 1));
  if (el) {
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", href);
  }
}

export default function SearchPanel() {
  const isAdmin = useIsAdmin();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      abortRef.current?.abort();
      setResults([]);
      setStatus("idle");
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus("loading");
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: ctrl.signal,
        });
        if (res.status === 429 || res.status === 503) {
          setResults([]);
          setStatus("limited");
          return;
        }
        if (!res.ok) {
          setResults([]);
          setStatus("error");
          return;
        }
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setStatus("done");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setResults([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  if (isAdmin) return null;

  return (
    <aside className="sticky top-0 hidden max-h-[calc(100vh-6rem)] w-[220px] shrink-0 self-start overflow-y-auto border-l border-hairline bg-panel px-3 pt-[34px] desk:block">
      <h2 className="mb-2 font-pixel text-[11px] text-ink-muted">search</h2>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="describe a piece…"
        aria-label="Search artworks by description"
        maxLength={200}
        className="mb-2 w-full rounded-[2px] border border-hairline bg-page px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-steel focus:outline-none"
      />

      {status === "loading" && (
        <p className="text-[12px] text-ink-faint">searching…</p>
      )}
      {status === "limited" && (
        <p className="text-[12px] text-ink-faint">
          too many searches — try again shortly.
        </p>
      )}
      {status === "error" && (
        <p className="text-[12px] text-ink-faint">search unavailable.</p>
      )}
      {status === "done" && results.length === 0 && (
        <p className="text-[12px] text-ink-faint">no matches.</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {results.map((r) => (
          <li key={r.image} className="list-none">
            <Link
              href={r.href}
              onClick={(e) => jumpIfOnPage(e, r.href)}
              className="flex items-center gap-2 rounded-[2px] border border-hairline bg-page px-2 py-1.5 hover:border-steel"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(r.image, 200)}
                alt=""
                className="h-10 w-14 shrink-0 rounded-[1px] bg-placeholder object-cover"
              />
              <span className="min-w-0 grow truncate text-[13px] text-ink">
                {r.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
