"use client";

import { useState, type FormEvent } from "react";
import { EMAIL_MAX, MESSAGE_MAX, NAME_MAX } from "@/lib/inquiryLimits";
import { useIsAdmin } from "./AdminProvider";

/**
 * The inline "inquire about this piece" form under an artwork's caption. A
 * collapsed trigger expands into name/email/message; submitting POSTs a private
 * inquiry to /api/inquiries (it never renders publicly — it lands in the admin
 * comment log). Dependency-free and fetch-in-handler only, so the collection
 * pages stay static.
 *
 * Hidden entirely for admins (captions are already input-heavy in edit mode).
 */
export default function InquiryForm({
  artworkPublicId,
  artworkName,
}: {
  artworkPublicId: string;
  artworkName: string;
}) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — always empty for humans

  if (isAdmin) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artworkPublicId,
          name,
          email,
          message,
          website,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("sent");
    } catch {
      setStatus("error"); // values are kept in state — the form stays fillable
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-[13px] text-ink-faint hover:text-steel"
      >
        inquire about this piece
      </button>
    );
  }

  if (status === "sent") {
    return (
      <p className="mt-2 text-[13px] text-ink-muted">
        Thanks — I&apos;ll get back to you.
      </p>
    );
  }

  const sending = status === "sending";
  const inputClasses =
    "w-full rounded-[2px] border border-hairline bg-page px-3 py-2 text-[15px] text-ink outline-none focus:border-steel";

  return (
    <form onSubmit={handleSubmit} className="mt-2">
      <p className="text-[13px] text-ink-faint">
        Inquire about <span className="text-ink-muted">{artworkName}</span>
      </p>

      {/* Honeypot: off-screen (not display:none — bots skip those), never
          focusable, never autofilled. A non-empty value is treated as a bot. */}
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
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <label className="mt-2 block text-[13px] text-ink-muted">
        Name
        <input
          name="name"
          required
          maxLength={NAME_MAX}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`mt-1 ${inputClasses}`}
        />
      </label>
      <label className="mt-2 block text-[13px] text-ink-muted">
        Email
        <input
          name="email"
          type="email"
          required
          maxLength={EMAIL_MAX}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`mt-1 ${inputClasses}`}
        />
      </label>
      <label className="mt-2 block text-[13px] text-ink-muted">
        Message
        <textarea
          name="message"
          required
          rows={4}
          maxLength={MESSAGE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`mt-1 resize-y ${inputClasses}`}
        />
      </label>

      {status === "error" && (
        <p className="mt-2 text-[13px] text-steel">
          Something went wrong. Please try again.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          className="rounded-[2px] bg-steel px-3 py-1.5 text-[13px] font-medium text-page hover:opacity-90 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[13px] text-ink-faint hover:text-steel"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
