"use client";

import { useState } from "react";
import { EMAIL_MAX } from "@/lib/inquiryLimits";
import { useIsAdmin } from "./AdminProvider";

/**
 * Email signup, under the blog index.
 *
 * ── One message for every outcome ─────────────────────────────────────────
 * The route answers an identical 200 whether the address is new, already
 * pending, already confirmed, within its cooldown, or resubscribing — because
 * anything else would turn it into an email-existence oracle. This component
 * has to preserve that: there is exactly ONE success state, and it says to
 * check your email.
 *
 * It even treats a failed request as success. That looks wrong and is
 * deliberate: the route already swallows its own database errors into a 200
 * for the same reason, so the only thing a visible error could distinguish is
 * a network failure the visitor can see for themselves — at the cost of a
 * branch that leaks whenever it is reachable for any other reason.
 *
 * `EMAIL_MAX` comes from lib/inquiryLimits.ts rather than a new module: the
 * bound is a generic email length that the server already validates against,
 * and a second copy is a second thing to drift.
 */
export default function SubscribeForm() {
  const isAdmin = useIsAdmin();
  const [email, setEmail] = useState("");
  /** Honeypot — always empty for a human. */
  const [website, setWebsite] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  // No reason to offer the owner their own mailing list, and it matches how
  // InquiryForm and the like buttons hide themselves.
  if (isAdmin) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await fetch("/api/blog/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
    } catch {
      // Swallowed on purpose — see the note above.
    } finally {
      setSending(false);
      setSent(true);
      setEmail("");
    }
  }

  if (sent) {
    return (
      <section className="border-t border-ink-faint/20 px-[30px] py-6">
        <p className="text-[15px] text-ink-muted">
          Check your email to confirm. Nothing is sent until you click the link
          in it.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="subscribe-heading"
      className="border-t border-ink-faint/20 px-[30px] py-6"
    >
      <h2
        id="subscribe-heading"
        className="text-[13px] font-medium text-ink-muted"
      >
        get an email when there&apos;s a new post
      </h2>
      <p className="mt-1 text-[13px] text-ink-faint">
        One email per post, nothing else. Unsubscribe from any of them.
      </p>

      <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="subscribe-email">
          email address
        </label>
        <input
          id="subscribe-email"
          type="email"
          required
          maxLength={EMAIL_MAX}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="grow rounded-[2px] border border-hairline bg-panel px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint"
        />

        {/* Honeypot: off-screen rather than display:none (bots skip those),
            never focusable, never autofilled. The server treats a filled
            value as a bot AFTER its rate limiter has run. */}
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
          <label htmlFor="subscribe-website">website</label>
          <input
            id="subscribe-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={sending}
          className="rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink hover:text-steel disabled:opacity-60"
        >
          {sending ? "…" : "subscribe"}
        </button>
      </form>
    </section>
  );
}
