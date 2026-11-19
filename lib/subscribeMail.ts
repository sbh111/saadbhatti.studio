import { Resend } from "resend";
import { SITE_ORIGIN } from "./constants";
import { escapeHtml } from "./markdown";
import type { BroadcastContent } from "./resendSegment";

/**
 * Visitor-facing email: the double opt-in confirmation, and the body of the
 * new-post broadcast.
 *
 * Separate from lib/mail.ts on purpose. That module sends ONE thing to ONE
 * address — the owner's own inquiry notification — and its whole contract is
 * "best effort, never cost a lead". This module mails strangers, which is a
 * different kind of responsibility: it needs opt-in semantics, unsubscribe
 * links and a daily budget. Mixing them would have meant one module with two
 * contracts.
 *
 * ── Two different unsubscribe mechanisms, and why ─────────────────────────
 * This is the subtlety worth reading before changing anything here.
 *
 * A BROADCAST is one message rendered for many recipients, so it physically
 * cannot carry a per-subscriber link. Resend's `{{{RESEND_UNSUBSCRIBE_URL}}}`
 * placeholder is the mechanism — Resend substitutes the right link per contact
 * and handles the unsubscribe itself. That means a broadcast unsubscribe
 * updates **Resend** and not Postgres, which is drift by design rather than by
 * accident: a broadcast can only reach Resend contacts, so someone who leaves
 * that way stops receiving mail regardless of what Postgres believes. The
 * admin drift panel is what keeps the consent record honest afterwards.
 *
 * A CONFIRMATION is a transactional `/emails` send to one known address, so it
 * carries our own HMAC link (lib/subscribers.ts) plus the RFC 8058 headers.
 * That link is Postgres-authoritative: it is the "this wasn't me" escape for
 * someone whose address was entered by a stranger, and it must work before
 * any Resend contact exists.
 */

/** Resend substitutes this per contact when sending a broadcast. */
const RESEND_UNSUBSCRIBE_PLACEHOLDER = "{{{RESEND_UNSUBSCRIBE_URL}}}";

function sender(): string | null {
  // Deliberately its own address rather than INQUIRY_NOTIFY_FROM: that one is
  // the owner's notification identity, and subscriber mail should have
  // separable sending reputation — a spam complaint on a newsletter must not
  // put inquiry notifications at risk.
  return process.env.BLOG_NOTIFY_FROM ?? null;
}

/**
 * Send the double opt-in confirmation.
 *
 * @returns true if dispatched, false if mail is unconfigured. Throws only if
 *   Resend rejects the send — matching lib/mail.ts's contract, so the caller
 *   records the outcome rather than failing the request.
 */
export async function sendSubscribeConfirmation(params: {
  email: string;
  confirmUrl: string;
  unsubscribeUrl: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = sender();
  if (!apiKey || !from) {
    console.warn(
      "sendSubscribeConfirmation: skipped — set RESEND_API_KEY and BLOG_NOTIFY_FROM to enable subscriber mail."
    );
    return false;
  }

  const subject = "Confirm your subscription";
  // Copy written for the person who did NOT sign up: they must be able to
  // understand and ignore it without acting. "Nothing happens until you
  // click" is the whole message.
  const text = [
    "Someone — hopefully you — asked for an email when a new post goes up on",
    `${SITE_ORIGIN}.`,
    "",
    "Confirm by opening this link:",
    params.confirmUrl,
    "",
    "If this wasn't you, ignore this email and nothing happens. You will not",
    "be added, and you will not hear from us again. To remove the pending",
    "request entirely:",
    params.unsubscribeUrl,
  ].join("\n");

  const html = `<p>Someone — hopefully you — asked for an email when a new post goes up on <a href="${escapeHtml(SITE_ORIGIN)}">${escapeHtml(SITE_ORIGIN)}</a>.</p>
<p><a href="${escapeHtml(params.confirmUrl)}">Confirm your subscription</a></p>
<p>If this wasn't you, ignore this email and nothing happens — you will not be added, and you will not hear from us again. To remove the pending request entirely, <a href="${escapeHtml(params.unsubscribeUrl)}">use this link</a>.</p>`;

  const { error } = await new Resend(apiKey).emails.send({
    from,
    to: params.email,
    subject,
    text,
    html,
    // RFC 8058. Required practice for a transactional /emails send, which
    // unlike a broadcast gets no unsubscribe handling from Resend.
    headers: {
      "List-Unsubscribe": `<${params.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) {
    // Resend reports failures in the response rather than throwing. Surface it
    // so the caller's catch can record it — the lib/mail.ts convention.
    throw new Error(`Resend rejected the confirmation: ${error.message}`);
  }
  return true;
}

/**
 * Build the new-post broadcast.
 *
 * Pure, so it is unit-testable without a network, and the escaping is
 * assertable.
 *
 * ── A pointer, not a copy ─────────────────────────────────────────────────
 * Title, date, cover, the post's own excerpt, and a link. Deliberately NOT the
 * body: rendering Markdown into email HTML is a whole second rendering
 * pipeline with its own escaping questions, its own CSS limitations, and its
 * own failure modes — for no gain, since the reader is one click from the real
 * thing. lib/markdown.ts's hardening exists for the web page; duplicating that
 * reasoning for email is how you end up with two subtly different sanitisers.
 */
export function buildPostBroadcast(params: {
  title: string;
  excerpt: string;
  url: string;
  coverUrl: string | null;
}): BroadcastContent {
  const subject = params.title;

  const text = [
    params.title,
    "",
    params.excerpt,
    "",
    `Read it: ${params.url}`,
    "",
    `Unsubscribe: ${RESEND_UNSUBSCRIBE_PLACEHOLDER}`,
  ].join("\n");

  const cover = params.coverUrl
    ? `<p><a href="${escapeHtml(params.url)}"><img src="${escapeHtml(params.coverUrl)}" alt="" width="600" style="max-width:100%;height:auto;border-radius:2px" /></a></p>`
    : "";

  // Inline styles only, and no stylesheet: email clients strip <style> blocks
  // unpredictably, and this is a plain layout rather than a design.
  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:600px;color:#262a2e">
<h1 style="font-size:20px;line-height:1.4;margin:0 0 8px"><a href="${escapeHtml(params.url)}" style="color:#262a2e;text-decoration:none">${escapeHtml(params.title)}</a></h1>
${cover}
<p style="font-size:15px;line-height:1.6;color:#6c727a">${escapeHtml(params.excerpt)}</p>
<p><a href="${escapeHtml(params.url)}" style="font-size:15px;color:#445059">Read the post →</a></p>
<hr style="border:0;border-top:1px solid #cfd3d8;margin:24px 0" />
<p style="font-size:12px;color:#9aa0a7">You are getting this because you confirmed a subscription at ${escapeHtml(SITE_ORIGIN)}. <a href="${RESEND_UNSUBSCRIBE_PLACEHOLDER}" style="color:#9aa0a7">Unsubscribe</a>.</p>
</div>`;

  return { subject, html, text };
}

/** Exposed for the test that asserts the placeholder survives escaping. */
export const UNSUBSCRIBE_PLACEHOLDER = RESEND_UNSUBSCRIBE_PLACEHOLDER;
