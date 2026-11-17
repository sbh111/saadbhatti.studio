"use client";

import { useEffect, useRef, useState } from "react";
import {
  BODY_MAX,
  COVER_ALT_MAX,
  EXCERPT_MAX,
  SLUG_MAX,
  TITLE_MAX,
} from "@/lib/blogLimits";
import { bodyImageUrl, imageUrl } from "@/lib/cloudinary";
import { readingTimeLabel } from "@/lib/readingTime";
import BlogImageUpload, { type UploadedImage } from "./BlogImageUpload";

/**
 * The post editor's form fields.
 *
 * A client component for three reasons now: an unsaved-changes guard, live
 * counters, and browser-direct image uploads (which must read a File object,
 * so they cannot be a Server Action). Everything that PERSISTS is still a
 * plain `<form action={serverAction}>` submission — no useActionState, no form
 * library. The uploads write their results into hidden inputs that the same
 * single Save button submits, so there is still exactly one way for a post to
 * change.
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
  initialCoverPublicId,
  initialCoverAlt,
  initialCoverWidth,
  initialCoverHeight,
  slugEditable,
  saveAction,
}: {
  id: string;
  initialTitle: string;
  initialSlug: string;
  initialExcerpt: string;
  initialBody: string;
  initialCoverPublicId: string;
  initialCoverAlt: string;
  initialCoverWidth: number | null;
  initialCoverHeight: number | null;
  /** False once published — the slug is a permanent public contract by then. */
  slugEditable: boolean;
  saveAction: (formData: FormData) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [excerpt, setExcerpt] = useState(initialExcerpt);
  const [body, setBody] = useState(initialBody);
  const [coverPublicId, setCoverPublicId] = useState(initialCoverPublicId);
  const [coverAlt, setCoverAlt] = useState(initialCoverAlt);
  const [coverSize, setCoverSize] = useState<{
    width: number | null;
    height: number | null;
  }>({ width: initialCoverWidth, height: initialCoverHeight });

  const dirty =
    title !== initialTitle ||
    slug !== initialSlug ||
    excerpt !== initialExcerpt ||
    body !== initialBody ||
    coverPublicId !== initialCoverPublicId ||
    coverAlt !== initialCoverAlt;

  // Set on submit so the guard doesn't fire on the navigation the save itself
  // causes (savePostAction redirects).
  const submitting = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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

  /**
   * Splice text in at the caret rather than appending.
   *
   * An uploaded image belongs where the writer was typing, and an editor that
   * always appends makes them cut and paste it into place — which is worse
   * than no button. The caret is restored after the controlled re-render,
   * because setting `value` otherwise collapses the selection to the end.
   */
  function insertIntoBody(snippet: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((current) => current + snippet);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    setBody(body.slice(0, start) + snippet + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function onCoverUploaded(image: UploadedImage) {
    setCoverPublicId(image.publicId);
    setCoverSize({ width: image.width, height: image.height });
  }

  function onBodyImageUploaded(image: UploadedImage) {
    // Alt text left empty on purpose: the writer fills it in, and a guessed
    // alt ("image") is worse for a screen reader than an honestly empty one.
    insertIntoBody(`\n\n![](${bodyImageUrl(image.publicId)})\n\n`);
  }

  const field =
    "w-full rounded-[2px] border border-hairline bg-panel px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint";
  const label = "block text-[13px] text-ink-muted";
  const button =
    "rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink-muted hover:text-steel";

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

      {/* ── Cover image ──────────────────────────────────────────────────
          The public_id and dimensions ride along as hidden inputs so the one
          Save button persists them; the file itself went straight from the
          browser to Cloudinary and never touched this app's server. */}
      <div className="rounded-[2px] border border-hairline p-3">
        <span className={label}>
          cover image{" "}
          <span className="text-ink-faint">
            optional · shown on the index and above the post
          </span>
        </span>

        <input type="hidden" name="coverPublicId" value={coverPublicId} />
        <input
          type="hidden"
          name="coverWidth"
          value={coverSize.width ?? ""}
        />
        <input
          type="hidden"
          name="coverHeight"
          value={coverSize.height ?? ""}
        />

        {coverPublicId ? (
          <div className="mt-2 flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(coverPublicId, 640)}
              alt=""
              className="max-h-40 w-auto self-start rounded-[2px] border border-hairline"
            />
            <p className="font-mono text-[11px] break-all text-ink-faint">
              {coverPublicId}
              {coverSize.width && coverSize.height
                ? ` · ${coverSize.width}×${coverSize.height}`
                : ""}
            </p>
            <div>
              <label className={label} htmlFor="post-cover-alt">
                alt text{" "}
                <span className="text-ink-faint">
                  {coverAlt.length}/{COVER_ALT_MAX} · leave empty if the image
                  is purely decorative
                </span>
              </label>
              <input
                id="post-cover-alt"
                name="coverAlt"
                type="text"
                maxLength={COVER_ALT_MAX}
                value={coverAlt}
                onChange={(e) => setCoverAlt(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BlogImageUpload
                id="cover-replace"
                label="replace"
                postId={id}
                onUploaded={onCoverUploaded}
              />
              <button
                type="button"
                className={button}
                onClick={() => {
                  setCoverPublicId("");
                  setCoverAlt("");
                  setCoverSize({ width: null, height: null });
                }}
              >
                remove
              </button>
            </div>
            {/* Cloudinary assets are never deleted by this app (see
                docs/architecture.md) — "remove" detaches the image from the
                post and leaves the asset in place. */}
            <p className="text-[11px] text-ink-faint">
              Removing detaches the image from this post; the file stays in
              Cloudinary.
            </p>
          </div>
        ) : (
          <div className="mt-2">
            <BlogImageUpload
              id="cover-add"
              label="upload a cover"
              postId={id}
              onUploaded={onCoverUploaded}
            />
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label className={label} htmlFor="post-body">
            body{" "}
            <span className="text-ink-faint">
              {body.length}/{BODY_MAX} · Markdown
              {readingTimeLabel(body) ? ` · ${readingTimeLabel(body)}` : ""}
            </span>
          </label>
          <BlogImageUpload
            id="body-image"
            label="insert an image"
            postId={id}
            onUploaded={onBodyImageUploaded}
          />
        </div>
        <textarea
          ref={bodyRef}
          id="post-body"
          name="body"
          rows={22}
          maxLength={BODY_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={`mt-1 font-mono text-[13px] leading-relaxed ${field}`}
        />
        <p className="mt-1 text-[11px] text-ink-faint">
          Raw HTML is shown as text, not rendered, and only http/https/mailto
          links survive — see <code>lib/markdown.ts</code>. Use{" "}
          <em>preview</em> to see exactly what a visitor gets: the same
          component renders both.
        </p>
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
