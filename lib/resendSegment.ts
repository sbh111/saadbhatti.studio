import { Resend } from "resend";

/**
 * The Resend side of subscriptions: contacts in a segment, and broadcasts to
 * it.
 *
 * ── SEGMENTS, not audiences ───────────────────────────────────────────────
 * The plan for this phase said "Resend Audiences", written from Resend's
 * marketing pages. The installed SDK (6.18.0) disagrees: `audienceId` carries
 * an `@deprecated` notice in five separate places, `CreateContactOptions` takes
 * `segments: [{ id }]` with the `audienceId` form split out as
 * `LegacyCreateContactOptions`, and `CreateBroadcastOptions` requires
 * `SegmentOptions` whose own `audienceId` field is deprecated in favour of
 * `segmentId`. Resend has migrated the concept. Building against the
 * deprecated path would have meant shipping something already on a migration
 * notice, so this uses segments and the env var is `RESEND_SEGMENT_ID`.
 *
 * The division of authority is unchanged by that rename: Postgres owns
 * CONSENT, Resend owns DELIVERABILITY. See prisma/schema.prisma's `Subscriber`.
 *
 * ── Degrades, unlike lib/akismet.ts ───────────────────────────────────────
 * Every function here returns an outcome rather than throwing, and a missing
 * key or segment id is a clean "not configured". That is the right call here
 * and the opposite of the call lib/akismet.ts makes, for a reason worth
 * stating: Akismet's verdict decides whether content is publicly visible, so
 * unconfigured must fail closed. Nothing here decides visibility — an
 * unconfigured deploy simply records SKIPPED on the post and mails nobody,
 * which the owner can see in the admin list.
 */

/** What a caller needs to distinguish; never an exception. */
export type SegmentOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function client(): { resend: Resend; segmentId: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const segmentId = process.env.RESEND_SEGMENT_ID;
  if (!apiKey || !segmentId) return null;
  // Constructed per call rather than at module scope, so a missing key cannot
  // throw at import time — the same reasoning lib/mail.ts records.
  return { resend: new Resend(apiKey), segmentId };
}

/** True when subscriber mail is configured at all. */
export function isSegmentConfigured(): boolean {
  return client() !== null;
}

/**
 * Add a confirmed subscriber to the segment, returning Resend's contact id.
 *
 * Called only AFTER double opt-in completes, which is the whole point of the
 * pending state: an unconfirmed address never reaches Resend, so it can never
 * receive a broadcast even if something else goes wrong.
 */
export async function addContact(
  email: string
): Promise<SegmentOutcome<string>> {
  const c = client();
  if (!c) return { ok: false, reason: "resend not configured" };

  try {
    const { data, error } = await c.resend.contacts.create({
      email,
      unsubscribed: false,
      segments: [{ id: c.segmentId }],
    });
    if (error) return { ok: false, reason: error.message };
    if (!data?.id) return { ok: false, reason: "no contact id returned" };
    return { ok: true, value: data.id };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "contact create failed",
    };
  }
}

/**
 * Mark a contact unsubscribed in Resend.
 *
 * `update(unsubscribed: true)` rather than `remove`, deliberately: an
 * unsubscribed contact stays in Resend's suppression state, so a later
 * re-import or a hand-added duplicate cannot quietly start mailing them again.
 * Deleting the contact would throw that protection away.
 */
export async function unsubscribeContact(
  contactId: string
): Promise<SegmentOutcome<null>> {
  const c = client();
  if (!c) return { ok: false, reason: "resend not configured" };

  try {
    const { error } = await c.resend.contacts.update({
      id: contactId,
      unsubscribed: true,
    });
    if (error) return { ok: false, reason: error.message };
    return { ok: true, value: null };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "contact update failed",
    };
  }
}

export interface BroadcastContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Create a broadcast WITHOUT sending it, returning its id.
 *
 * Split from sending on purpose, and it is the whole reason
 * `posts.notifyBroadcastId` exists: Resend's API is create-then-send, two
 * calls, so a retry that creates again would produce a SECOND broadcast and
 * mail everyone twice. Storing the id between the two calls is what makes a
 * hand retry send the existing draft instead.
 */
export async function createBroadcast(
  content: BroadcastContent,
  from: string
): Promise<SegmentOutcome<string>> {
  const c = client();
  if (!c) return { ok: false, reason: "resend not configured" };

  try {
    const { data, error } = await c.resend.broadcasts.create({
      segmentId: c.segmentId,
      from,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    if (error) return { ok: false, reason: error.message };
    if (!data?.id) return { ok: false, reason: "no broadcast id returned" };
    return { ok: true, value: data.id };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "broadcast create failed",
    };
  }
}

/** Send a previously created broadcast. Idempotent-ish: Resend rejects a re-send. */
export async function sendBroadcast(
  broadcastId: string
): Promise<SegmentOutcome<null>> {
  const c = client();
  if (!c) return { ok: false, reason: "resend not configured" };

  try {
    const { error } = await c.resend.broadcasts.send(broadcastId);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, value: null };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "broadcast send failed",
    };
  }
}
