import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Subscriber tokens and email normalisation.
 *
 * ── Two credentials, two completely different designs ─────────────────────
 * This is the part worth reading before changing anything here.
 *
 * The CONFIRMATION token is one-shot. It is minted once, mailed, and consumed:
 * so only its **sha256 is stored**, and confirming NULLs the column. A database
 * leak therefore does not let the reader confirm anybody, and the token exists
 * only in the email — the same reasoning as `ADMIN_PASSWORD_HASH` and `ipHash`.
 *
 * The UNSUBSCRIBE link is a permanent capability. It has to stay valid forever
 * and be mintable fresh at every broadcast, which a stored single-use hash
 * cannot do. So it is **derived**, as an HMAC of the subscriber id under a
 * server secret, and **nothing is stored at all**. It is verified by
 * recomputation, revocable en masse by rotating the secret, and there is no
 * column to leak.
 *
 * The rule, stated once so the next person does not have to re-derive it:
 * a one-shot credential gets a stored hash plus a timestamp; a permanent
 * capability gets a derived HMAC and nothing at rest.
 *
 * ── Why SUBSCRIBE_TOKEN_SECRET is a REQUIRED env var ──────────────────────
 * Every other optional integration here degrades safely — no Resend key means
 * mail is skipped, no Akismet key means comments wait. This one does not. An
 * unsubscribe link that cannot be minted or verified is not a degraded
 * feature, it is a compliance failure: mail goes out carrying a link that does
 * not work. So it is asserted at boot (lib/env.ts) rather than discovered by
 * the first person trying to leave.
 */

/** Bytes of entropy in a confirmation token. 32 → 43 base64url characters. */
const TOKEN_BYTES = 32;

function secret(): string {
  const value = process.env.SUBSCRIBE_TOKEN_SECRET;
  if (!value) {
    // instrumentation.ts asserts this at startup, so reaching here means
    // something bypassed that — worth failing loudly rather than minting a
    // signature under an empty key.
    throw new Error(
      "Missing SUBSCRIBE_TOKEN_SECRET. Locally: put it in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }
  return value;
}

/**
 * Normalise an address before it touches the database.
 *
 * Load-bearing, not cosmetic: a Postgres unique index on text is
 * case-sensitive, so without this "A@x.com" and "a@x.com" would both be
 * storable, both be confirmable, and both be mailed.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** sha256 hex — what gets stored for a confirmation token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A fresh confirmation token and the hash to store for it.
 *
 * Returns both so a caller cannot accidentally store the token: there is no
 * code path that has the plaintext and the row at the same time without
 * having asked for both explicitly.
 */
export function mintConfirmToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/**
 * The unsubscribe MAC for a subscriber id.
 *
 * Truncated to 32 hex characters (128 bits). Full sha256 would make an
 * unsubscribe URL unpleasantly long in an email client that renders it
 * verbatim, and 128 bits is far beyond forgeable for a value that only ever
 * unsubscribes one already-known address.
 */
export function unsubscribeMac(subscriberId: string): string {
  return createHmac("sha256", secret())
    .update(subscriberId)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Verify an unsubscribe MAC in constant time.
 *
 * `timingSafeEqual` throws on length mismatch, so the lengths are compared
 * first — and that comparison is deliberately NOT constant time, because the
 * length of the expected MAC is a public constant and leaks nothing.
 */
export function verifyUnsubscribeMac(
  subscriberId: string,
  candidate: string
): boolean {
  if (!subscriberId || !candidate) return false;
  const expected = Buffer.from(unsubscribeMac(subscriberId), "utf8");
  const given = Buffer.from(candidate, "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * The unsubscribe path for a subscriber, relative to the site origin.
 *
 * Built here rather than at the call site for the same reason lib/urls.ts
 * exists: it ends up in every email this app ever sends, and a link assembled
 * by hand in two places is a link that disagrees with itself in one of them.
 */
export function unsubscribePath(subscriberId: string): string {
  return `/api/blog/unsubscribe?s=${encodeURIComponent(subscriberId)}&t=${unsubscribeMac(subscriberId)}`;
}

/** The confirmation path for a freshly minted token. */
export function confirmPath(token: string): string {
  return `/api/blog/subscribe/confirm?t=${encodeURIComponent(token)}`;
}
