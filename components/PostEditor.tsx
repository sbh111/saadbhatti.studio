"use client";

import { useEffect, useRef, useState } from "react";
import {
  BODY_MAX,
  EXCERPT_MAX,
  SLUG_MAX,
  TITLE_MAX,
} from "@/lib/blogLimits";

/**
 * The post editor's form fields.
 *
 * A client component for one reason: an unsaved-changes guard. Everything here
 * is a plain `<form action={serverAction}>` submission — no useActionState, no
 * form library — but a `<textarea>` holding a half-written post plus an
 * explicit Save button loses work to a mis-click or a stray back-gesture, and
 * a `beforeunload` listener is a few lines.
 *
 * Deliberately NOT the localStorage staging system in components/AdminProvider.tsx.
 * That exists because artwork edits are bulk-published to Cloudinary across
 * several collections; a post is one row with one Save button, so staging
 * would be machinery without a matching problem.
 *
 * Bounds come from lib/blogLimits.ts — the same numbers savePostAction
 * validates against, which is what that module is for.
 */

export default function PostEditor({
  id,
  initialTitle,
  initialSlug,
  initialExcerpt,
  initialBody,
  slugEditable,
  saveAction,
}: {
  id: string;
  initialTitle: string;
  initialSlug: string;
  initialExcerpt: string;
  initialBody: string;
  /** False once published — the slug is a permanent public contract by then. */
  slugEditable: boolean;
  saveAction: (formData: FormData) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [excerpt, setExcerpt] = useState(initialExcerpt);
  const [body, setBody] = useState(initialBody);

  const dirty =
    title !== initialTitle ||
    slug !== initialSlug ||
    excerpt !== initialExcerpt ||
    body !== initialBody;

  // Set on submit so the guard doesn't fire on the navigation the save itself
  // causes (savePostAction redirects).
  const submitting = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (submitting.current) return;
      // Both forms: preventDefault is the current standard, returnValue is
      // what older browsers still check.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const field =
    "w-full rounded-[2px] border border-hairline bg-panel px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint";
  const label = "block text-[13px] text-ink-muted";

  return (
    <form
      action={saveAction}
      onSubmit={() => {
        submitting.current = true;
      }}
      className="mt-4 flex flex-col gap-4"
    >
      <input type="hidden" name="id" value={id} />

      <div>
        <label className={label} htmlFor="post-title">
          title{" "}
          <span className="text-ink-faint">
            {title.length}/{TITLE_MAX}
          </span>
        </label>
        <input
          id="post-title"
          name="title"
          type="text"
          required
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`mt-1 ${field}`}
        />
      </div>

      <div>
        <label className={label} htmlFor="post-slug">
          slug{" "}
          {slugEditable ? (
            <span className="text-ink-faint">
              editable while this is a draft
            </span>
          ) : (
            <span className="text-steel">
              locked — published URLs must not change
            </span>
          )}
        </label>
        {slugEditable ? (
          <input
            id="post-slug"
            name="slug"
            type="text"
            maxLength={SLUG_MAX}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className={`mt-1 ${field}`}
          />
        ) : (
          // Rendered as text, and no input is submitted — savePostAction
          // ignores a slug on a published post regardless.
          <p className="mt-1 text-[15px] text-ink">/blog/{slug}</p>
        )}
      </div>

      <div>
        <label className={label} htmlFor="post-excerpt">
          excerpt{" "}
          <span className="text-ink-faint">
            {excerpt.length}/{EXCERPT_MAX} · shown on the index, required to
            publish
          </span>
        </label>
        <textarea
          id="post-excerpt"
          name="excerpt"
          rows={2}
          maxLength={EXCERPT_MAX}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className={`mt-1 ${field}`}
        />
      </div>

      <div>
        <label className={label} htmlFor="post-body">
          body{" "}
          <span className="text-ink-faint">
            {body.length}/{BODY_MAX} · plain text — blank lines are kept, no
            markup is interpreted
          </span>
        </label>
        <textarea
          id="post-body"
          name="body"
          rows={22}
          maxLength={BODY_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={`mt-1 font-sans leading-relaxed ${field}`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink hover:text-steel"
        >
          save
        </button>
        <span className="text-[13px] text-ink-faint">
          {dirty ? "unsaved changes" : "saved"}
        </span>
      </div>
    </form>
  );
}
