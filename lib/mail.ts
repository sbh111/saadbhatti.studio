/**
 * Server-only inquiry notification. When a visitor submits an inquiry, the
 * public POST handler (app/api/inquiries/route.ts) fires this in the background
 * via next/server `after()`, so it runs after the 201 is flushed and never adds
 * latency to — or can fail — the submission.
 *
 * BEST-EFFORT by design: the inquiry row is already persisted and shown in the
 * admin comment log before this runs. So unlike lib/auth.ts / lib/inquiries.ts
 * (which throw on missing env), a missing mail config here just warns and no-ops
 * — an unconfigured deploy still accepts inquiries. A send failure throws, which
 * the caller catches and logs; it must never cost a lead.
 *
 * Delivery is Resend. `INQUIRY_NOTIFY_FROM` must be an address on a domain
 * verified in Resend (before verification, Resend only accepts
 * onboarding@resend.dev and only delivers to your own account address).
 */

import { Resend } from "resend";

const SITE_URL = "https://saadbhatti.studio";

export interface InquiryNotification {
  name: string;
  email: string;
  message: string;
  artworkTitle: string;
  artworkPublicId: string;
  /** Slug for the on-page anchor: /{medium}/{collection}#{artworkSlug} */
  artworkSlug: string;
  mediumSlug: string;
  collectionSlug: string;
}

/**
 * @returns true if the email was dispatched to Resend, false if it was skipped
 * because mail is unconfigured. Throws if Resend rejects the send.
 */
export async function sendInquiryNotification(
  data: InquiryNotification
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.INQUIRY_NOTIFY_TO;
  const from = process.env.INQUIRY_NOTIFY_FROM;

  // Best-effort: warn and no-op rather than throw (see file docblock).
  if (!apiKey || !to || !from) {
    console.warn(
      "[mail] inquiry notification skipped — set RESEND_API_KEY, INQUIRY_NOTIFY_TO, and INQUIRY_NOTIFY_FROM (.env.local locally, Vercel env in prod; see .env.local.example)."
    );
    return false;
  }

  const artworkUrl = `${SITE_URL}/${data.mediumSlug}/${data.collectionSlug}#${data.artworkSlug}`;
  const logUrl = `${SITE_URL}/admin/comments`;

  const subject = `New inquiry: ${data.artworkTitle} — ${data.name}`;

  const text = [
    `New inquiry about "${data.artworkTitle}".`,
    ``,
    `From:    ${data.name} <${data.email}>`,
    `Artwork: ${data.artworkTitle} (${data.artworkPublicId})`,
    `         ${artworkUrl}`,
    ``,
    `Message:`,
    data.message,
    ``,
    `— Reply straight to this email to reach ${data.name}.`,
    `Comment log: ${logUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px">New inquiry</h2>
      <p style="margin:0 0 16px;color:#555">
        about <a href="${artworkUrl}">${escapeHtml(data.artworkTitle)}</a>
      </p>
      <p style="margin:0 0 4px">
        <strong>${escapeHtml(data.name)}</strong>
        &lt;<a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a>&gt;
      </p>
      <p style="white-space:pre-wrap;margin:12px 0;padding:12px;background:#f4f4f5;border-radius:4px">${escapeHtml(
        data.message
      )}</p>
      <p style="color:#888;font-size:13px">
        Reply to this email to reach ${escapeHtml(data.name)} directly ·
        <a href="${logUrl}">comment log</a>
      </p>
    </div>`;

  // `replyTo` is the inquirer so a reply reaches them directly; `from` is an
  // address on the verified saadbhatti.studio domain.
  // Constructed per call (not at module scope) so a missing key can't throw at
  // import time — the guard above is the only place config is enforced.
  const { error } = await new Resend(apiKey).emails.send({
    from,
    to,
    replyTo: data.email,
    subject,
    text,
    html,
  });

  // Resend reports failures in the response rather than throwing. Surface it so
  // the caller's .catch logs it (the inquiry itself is already safe).
  if (error) {
    throw new Error(`Resend rejected the send: ${error.message}`);
  }
  return true;
}

/** Minimal HTML-escaping for interpolating user text into the email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
