import { SITE_ORIGIN } from "./constants";

/**
 * Akismet comment-check — the second pass, after lib/commentHeuristics.ts has
 * already handled the structural signals for free.
 *
 * ── This module FAILS CLOSED, inverting the house convention ──────────────
 * lib/mail.ts and lib/collector.ts are best-effort by contract: a missing key
 * warns and no-ops, because the row is already saved and the visitor's request
 * has already succeeded. **This module must not behave that way.** Its verdict
 * decides whether a comment is publicly visible, so "unconfigured" or
 * "unreachable" has to mean HELD. An unconfigured deploy that auto-published
 * would be a spam target rather than a degraded feature.
 *
 * The consequence for lib/env.ts: `AKISMET_API_KEY` must stay OUT of
 * `REQUIRED_ENV_VARS`. Running without it is a supported mode — every comment
 * waits for the owner — not a boot failure.
 *
 * ── It needs the visitor's raw IP, and that is a decision ─────────────────
 * Akismet cannot score without `user_ip`. This codebase never *stores* a raw
 * address (architecture.md invariant 6), and sending is not storing, but this
 * is a new outbound flow of visitor PII to a third party (Automattic) and
 * belongs in a privacy note on the site rather than only in a commit message.
 *
 * It also means Akismet cannot be exercised locally: `clientIpOf` returns
 * "unknown" off Vercel, which Akismet rejects. The fail-closed paths are
 * testable; a true positive needs a deployed preview.
 *
 * ── Name-only costs accuracy ──────────────────────────────────────────────
 * Akismet is substantially a reputation service, and `comment_author_email` is
 * the most portable identifier it has — the one that follows a spammer across
 * IP rotations and across sites. There is deliberately no email column here
 * (decided 2026-11-18), so what is left is IP reputation (still strong) and
 * content analysis (unaffected). Expect more held comments than Akismet's
 * marketing numbers suggest. That is the safe direction, and it is why the
 * `blog_comment_auto_publish` setting starts OFF: record verdicts, read them
 * for a few weeks, and switch auto-publishing on once they match your own
 * judgement.
 */

/** Hard ceiling on how long a comment POST may wait for a verdict. */
export const AKISMET_TIMEOUT_MS = 2_500;

export type AkismetVerdict =
  /** Akismet says this is fine. */
  | "ham"
  /** Spam, but worth the owner's eyes — held, not binned. */
  | "spam"
  /** `X-akismet-pro-tip: discard` — blatant enough to bin unseen. */
  | "blatant"
  /** No key, no answer, or an answer we could not read. Fails to held. */
  | "unavailable";

export interface AkismetResult {
  verdict: AkismetVerdict;
  /** Short, safe to store in `spamReason` (VarChar(200)). Null for ham. */
  reason: string | null;
}

export interface AkismetInput {
  authorName: string;
  body: string;
  /** Raw client IP. Akismet will not score without it. */
  userIp: string;
  userAgent: string | null;
  referrer: string | null;
  /** Canonical post URL — `postUrl(slug)` from lib/urls.ts. */
  permalink: string;
}

/**
 * Ask Akismet about one comment.
 *
 * Never throws: every failure path resolves to `unavailable`, because a
 * rejected promise here would become a 500 on a public write that had already
 * succeeded in every other respect.
 */
export async function checkComment(
  input: AkismetInput
): Promise<AkismetResult> {
  const key = process.env.AKISMET_API_KEY;
  if (!key) {
    // Not an error, and not warned on every comment — this is a supported
    // mode. The reason string is what tells the owner why it is in the queue.
    return { verdict: "unavailable", reason: "akismet not configured" };
  }

  const params = new URLSearchParams({
    blog: SITE_ORIGIN,
    user_ip: input.userIp,
    comment_type: "comment",
    comment_author: input.authorName,
    comment_content: input.body,
    comment_date_gmt: new Date().toISOString(),
    permalink: input.permalink,
    blog_charset: "UTF-8",
  });
  if (input.userAgent) params.set("user_agent", input.userAgent);
  if (input.referrer) params.set("referrer", input.referrer);
  // Keeps development and preview traffic out of Akismet's training data. Their
  // docs ask for this explicitly, and without it a test comment teaches the
  // model about a post nobody has read.
  if (process.env.NODE_ENV !== "production") params.set("is_test", "1");

  let response: Response;
  try {
    response = await fetch(`https://${key}.rest.akismet.com/1.1/comment-check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      cache: "no-store",
      // Bounds the worst case for a comment POST. A timeout yields a HELD
      // comment, never a hung request.
      signal: AbortSignal.timeout(AKISMET_TIMEOUT_MS),
    });
  } catch {
    // Timeout, DNS, TLS, offline — all the same answer.
    return { verdict: "unavailable", reason: "akismet unreachable" };
  }

  if (!response.ok) {
    return {
      verdict: "unavailable",
      reason: `akismet HTTP ${response.status}`,
    };
  }

  // Akismet answers with the literal body "true" or "false". A malformed key
  // or a missing required field produces something else entirely, with the
  // explanation in X-akismet-debug-help — worth surfacing, since it is the
  // difference between "this is spam" and "we are calling the API wrong".
  const text = (await response.text()).trim();
  if (text === "false") {
    return { verdict: "ham", reason: null };
  }
  if (text === "true") {
    const blatant = response.headers.get("x-akismet-pro-tip") === "discard";
    return blatant
      ? { verdict: "blatant", reason: "akismet: discard" }
      : { verdict: "spam", reason: "akismet: spam" };
  }

  const help = response.headers.get("x-akismet-debug-help");
  console.warn(
    "[akismet] unexpected response:",
    JSON.stringify(text).slice(0, 120),
    help ? `(${help})` : ""
  );
  return { verdict: "unavailable", reason: "akismet bad response" };
}
