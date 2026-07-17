/**
 * Server-only inquiry notification. When a visitor submits an inquiry, the
 * public POST handler (app/api/inquiries/route.ts) fires this in the background
 * via next/server `after()`, so it runs after the 201 is flushed and never adds
 * latency to — or can fail — the submission.
 *
 * BEST-EFFORT by design: the inquiry row is already persisted and shown in the
 * admin comment log before this runs. So unlike lib/auth.ts / lib/inquiries.ts
 * (which throw on missing env), a missing mail config here just warns and no-ops
 * — an unconfigured deploy still accepts inquiries. Send failures are caught by
 * the caller and logged; they must never cost a lead.
 *
 * SCAFFOLD: the Resend send itself is left as a TODO for the real implementation
 * (see below). Until it's filled in, this builds the payload and logs that it
 * *would* have sent — no `resend` dependency is imported yet, so the build stays
 * green.
 */

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

export async function sendInquiryNotification(
  data: InquiryNotification
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.INQUIRY_NOTIFY_TO;
  const from = process.env.INQUIRY_NOTIFY_FROM;

  // Best-effort: warn and no-op rather than throw (see file docblock).
  if (!apiKey || !to || !from) {
    console.warn(
      "[mail] inquiry notification skipped — set RESEND_API_KEY, INQUIRY_NOTIFY_TO, and INQUIRY_NOTIFY_FROM (.env.local locally, Vercel env in prod; see .env.local.example)."
    );
    return;
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

  // The message Resend will send. `replyTo` is the inquirer so a reply reaches
  // them directly; `from` is an address on the verified saadbhatti.studio domain.
  const payload = { from, to, replyTo: data.email, subject, text, html };

  // TODO(saad): send it via Resend.
  //   1. npm i resend
  //   2. import { Resend } from "resend";  (at the top of this file)
  //   3. const resend = new Resend(apiKey);
  //   4. const { error } = await resend.emails.send(payload);
  //      if (error) throw new Error(error.message);  // caller logs it
  // Until then, log that it was prepared and return (no send).
  console.log(`[mail] prepared (send not implemented): ${payload.subject}`);
}

/** Minimal HTML-escaping for interpolating user text into the email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
