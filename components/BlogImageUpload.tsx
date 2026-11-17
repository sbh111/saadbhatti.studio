"use client";

import { useRef, useState } from "react";
import { BLOG_UPLOAD_MAX_BYTES } from "@/lib/cloudinaryUpload";

/**
 * Browser-direct image upload for the post editor: ask the server for a signed
 * ticket, POST the file to Cloudinary with it, hand back the public_id.
 *
 * Used twice on the editor — once for the cover image, once for inserting an
 * image into the Markdown body — so the mechanics live here and the two call
 * sites only decide what to do with the result.
 *
 * lib/cloudinaryUpload.ts is imported for one constant. That module reads
 * `node:crypto` and `process.env` at call time, not at import time, and only
 * inside `mintBlogUploadTicket`, so pulling the constant in does not drag a
 * server dependency into this bundle — the size cap genuinely is the same
 * number the signed ticket carries, which is the point of sharing it.
 */

export interface UploadedImage {
  publicId: string;
  width: number;
  height: number;
}

interface UploadTicket {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
}

/**
 * Human-readable size, for an error the owner can act on ("that file is 14 MB")
 * rather than one they have to decode.
 */
function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BlogImageUpload({
  label,
  onUploaded,
  id,
  postId,
}: {
  label: string;
  onUploaded: (image: UploadedImage) => void;
  /** Distinct per instance — two file inputs on one page need separate ids. */
  id: string;
  /** Scopes the signed ticket to this post's Cloudinary folder. */
  postId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);

    // Checked before the ticket is minted, so an oversized file costs neither
    // a round trip nor a signature. Not a security boundary — Cloudinary's own
    // limit is — but it turns a slow failure into an immediate, clear one.
    if (file.size > BLOG_UPLOAD_MAX_BYTES) {
      setError(
        `That file is ${megabytes(file.size)}. The limit is ${megabytes(BLOG_UPLOAD_MAX_BYTES)}.`
      );
      return;
    }

    setBusy(true);
    try {
      const ticketResponse = await fetch("/api/admin/blog/upload-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server signs `blog/<postId>` after validating the id and
        // confirming the post exists — it is not taken on trust from here.
        body: JSON.stringify({ postId }),
      });
      if (!ticketResponse.ok) {
        throw new Error(
          ticketResponse.status === 401
            ? "Your session expired — reload and sign in again."
            : "Could not get an upload signature."
        );
      }
      const ticket: UploadTicket = await ticketResponse.json();

      // Every field below except `file` and `api_key` is covered by the
      // signature, so none of them can be altered here without Cloudinary
      // rejecting the upload outright.
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", ticket.apiKey);
      form.append("timestamp", String(ticket.timestamp));
      form.append("folder", ticket.folder);
      form.append("allowed_formats", ticket.allowedFormats);
      form.append("signature", ticket.signature);

      const upload = await fetch(ticket.uploadUrl, {
        method: "POST",
        body: form,
      });
      const result = await upload.json();
      if (!upload.ok) {
        // Cloudinary's own message is the useful one here ("Invalid image
        // file", a format outside allowed_formats, a plan limit).
        throw new Error(result?.error?.message ?? "Cloudinary rejected the upload.");
      }

      onUploaded({
        publicId: result.public_id,
        width: result.width,
        height: result.height,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      // Clear the input so choosing the SAME file again still fires a change
      // event — otherwise a retry after a failure silently does nothing.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        htmlFor={id}
        className={`cursor-pointer rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] ${
          busy ? "text-ink-faint" : "text-ink-muted hover:text-steel"
        }`}
      >
        {busy ? "uploading…" : label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        disabled={busy}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && (
        <span role="alert" className="text-[13px] text-steel">
          {error}
        </span>
      )}
    </div>
  );
}
