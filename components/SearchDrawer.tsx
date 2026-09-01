"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { imageUrl } from "@/lib/cloudinary";

/**
 * Global visual-search drawer. Available on every page (mounted in AppShell), not
 * tied to a single collection: the corpus is the whole catalog and results deep-
 * link anywhere. Hidden by default; a handle on the right edge slides it in. It
 * spans the full height of the framed content area (AppShell's content row is
 * `relative`, and this positions against it).
 *
 * Debounce + min-length + abort here only trim accidental load — the real abuse
 * defenses live server-side in /api/search.
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

export default function SearchDrawer() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search on query change.
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

  // Focus the input when the drawer opens; close on Escape.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Right-edge handle — pull-out tab, hidden while the drawer is open. */}
      {!open && (
        <button
          type="button"
          aria-label="Open search"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="absolute right-0 top-1/2 z-30 flex -translate-y-1/2 items-center rounded-l-[3px] border border-r-0 border-hairline bg-panel px-1.5 py-3 text-ink-muted shadow-sm hover:text-steel"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="4.5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </g>
          </svg>
        </button>
      )}

      {/* Drawer + backdrop. */}
      {open && (
        <div
          className="absolute inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label="Search artworks"
        >
          <button
            type="button"
            aria-label="Close search"
            className="absolute inset-0 animate-fadein bg-black/35 motion-reduce:animate-none"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 flex w-[320px] max-w-[85vw] animate-drawer-right flex-col border-l border-hairline bg-panel shadow-xl motion-reduce:animate-none">
            <div className="flex items-center justify-between px-3.5 pb-3 pt-6">
              <h2 className="font-pixel text-[11px] text-ink-muted">search</h2>
              <button
                type="button"
                aria-label="Close search"
                onClick={() => setOpen(false)}
                className="-m-2 p-2 text-ink-faint hover:text-steel"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <g
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  >
                    <line x1="2" y1="2" x2="12" y2="12" />
                    <line x1="12" y1="2" x2="2" y2="12" />
                  </g>
                </svg>
              </button>
            </div>

            <div className="px-3.5">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="describe a piece…"
                aria-label="Search artworks by description"
                maxLength={200}
                className="w-full rounded-[2px] border border-hairline bg-page px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-steel focus:outline-none"
              />
            </div>

            <div className="no-scrollbar mt-2 grow overflow-y-auto px-3.5 pb-5">
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
                      onClick={(e) => {
                        jumpIfOnPage(e, r.href);
                        setOpen(false);
                      }}
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
