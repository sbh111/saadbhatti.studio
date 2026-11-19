"use client";

import { useEffect, useRef, useState } from "react";
import {
  COMMENT_BODY_MAX,
  COMMENT_NAME_MAX,
} from "@/lib/commentLimits";
import type { PublicComment } from "@/lib/comments";
import LocalTime from "./LocalTime";

/**
 * The conversation under a post: the published comments, and the form.
 *
 * List and form live in one component because posting has to refresh the
 * list, and splitting them would mean lifting that state into a parent that
 * exists for no other reason.
 *
 * ── Why this is client-fetched rather than server-rendered ────────────────
 * Comments are public content, so rendering them on the server inside the
 * cached post page would have been legal. It was rejected for three reasons:
 * a commenter could not see their own comment until the next revalidation and
 * would post it again; removing an abusive comment would wait on an
 * invalidation; and invalidating on every comment means a public,
 * unauthenticated write restaging the HTML of a CDN-cached page, behind a rate
 * limiter that fails open.
 *
 * The payoff is that **no comment path touches the Next cache at all** — no
 * `updateTag`, no `revalidateTag`, and therefore none of the
 * route-handler-versus-Server-Action trap those two invite.
 *
 * The cost, accepted: comments need JavaScript and are not in the indexed
 * HTML. For a photography blog, comment SEO is worth approximately nothing.
 *
 * ── Rendering a comment body ──────────────────────────────────────────────
 * `{comment.body}` is a React text node, so it is escaped by React itself.
 * It never goes through `renderMarkdown` and is never linkified —
 * `docs/architecture.md` invariant 13 says so in bold, and auto-linkifying
 * would both widen the surface that invariant protects and actively reward
 * link spam.
 */

type FormState = "idle" | "sending" | "published" | "held" | "error";

export default function CommentThread({ slug }: { slug: string }) {
  const [comments, setComments] = useState<PublicComment[] | null>(null);
  const [state, setState] = useState<FormState>("idle");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  /** Honeypot — always empty for a human. */
  const [website, setWebsite] = useState("");

  /**
   * When the form mounted, so submission can report ELAPSED milliseconds
   * rather than a timestamp — no clock skew to reason about, and nothing for
   * the server to compare against its own clock.
   *
   * Set in the effect below rather than as the initial value: `Date.now()` is
   * impure, and calling it during render is both flagged by the React
   * compiler and wrong under Strict Mode's double render. 0 until mounted,
   * which the submit handler treats as "no signal".
   */
  const mountedAt = useRef(0);

  async function load() {
    try {
      const res = await fetch(
        `/api/blog/comments?slug=${encodeURIComponent(slug)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.comments)) setComments(data.comments);
    } catch {
      // Leave `comments` as null — the section renders nothing rather than
      // claiming there are no comments.
    }
  }

  useEffect(() => {
    mountedAt.current = Date.now();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/blog/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          body,
          website,
          // 0 means the mount effect has not run, so send nothing rather
          // than an elapsed time measured from the epoch.
          elapsedMs: mountedAt.current
            ? Date.now() - mountedAt.current
            : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.status === "published") {
        setState("published");
        setName("");
        setBody("");
        await load();
      } else {
        // Held for review. The reason is deliberately not returned by the
        // API — telling someone which rule they tripped tells a spammer how
        // to route around it.
        setState("held");
        setName("");
        setBody("");
      }
    } catch {
      // One generic message: the route returns terse errors on purpose, so
      // there is nothing more specific to say, and values stay in state so
      // the form is still submittable.
      setState("error");
    }
  }

  const field =
    "w-full rounded-[2px] border border-hairline bg-panel px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint";

  return (
    <section
      aria-labelledby="comments-heading"
      className="mx-auto max-w-[680px] px-[30px] pb-16"
    >
      <h2
        id="comments-heading"
        className="font-pixel text-[13px] leading-relaxed text-ink"
      >
        comments
        {comments && comments.length > 0 && (
          <span className="ml-2 font-sans text-[13px] text-ink-faint">
            {comments.length}
          </span>
        )}
      </h2>

      <noscript>
        <p className="mt-2 text-[13px] text-ink-faint">
          Comments need JavaScript to load.
        </p>
      </noscript>

      {comments?.length === 0 && (
        <p className="mt-2 text-[13px] text-ink-faint">
          No comments yet.
        </p>
      )}

      {comments && comments.length > 0 && (
        <ul className="mt-3 flex flex-col gap-4">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="border-t border-ink-faint/20 pt-3"
            >
              <div className="flex items-baseline gap-2 text-[13px]">
                <span className="font-medium text-ink">
                  {comment.authorName}
                </span>
                {comment.isOwner && (
                  <span className="font-pixel text-[9px] text-steel">
                    AUTHOR
                  </span>
                )}
                <span className="text-ink-faint">
                  <LocalTime date={comment.createdAt} />
                </span>
              </div>
              {/* Escaped by React, whitespace preserved, never linkified. */}
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                {comment.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {state === "held" ? (
        <p className="mt-6 text-[13px] text-ink-muted">
          Thanks — your comment will appear once it has been reviewed.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          {state === "published" && (
            <p className="text-[13px] text-ink-muted">Thanks — posted.</p>
          )}

          <div>
            <label className="block text-[13px] text-ink-muted" htmlFor="comment-name">
              name
            </label>
            <input
              id="comment-name"
              type="text"
              required
              maxLength={COMMENT_NAME_MAX}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`mt-1 ${field}`}
            />
          </div>

          {/* Honeypot: off-screen rather than display:none, which bots skip;
              never focusable, never autofilled. A non-empty value is a bot,
              and the server treats it as one AFTER the rate limiter has run
              (tech debt 3.8). */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-9999px",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          >
            <label htmlFor="comment-website">website</label>
            <input
              id="comment-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[13px] text-ink-muted" htmlFor="comment-body">
              comment{" "}
              <span className="text-ink-faint">
                {body.length}/{COMMENT_BODY_MAX} · no email needed
              </span>
            </label>
            <textarea
              id="comment-body"
              required
              rows={4}
              maxLength={COMMENT_BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={`mt-1 ${field}`}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink hover:text-steel disabled:opacity-60"
            >
              {state === "sending" ? "posting…" : "post comment"}
            </button>
            {state === "error" && (
              <span role="alert" className="text-[13px] text-steel">
                That didn&apos;t go through — try again.
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
