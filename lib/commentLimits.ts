/**
 * Shared comment bounds — deliberately free of any Prisma or server import, so
 * the client comment form can use the same numbers the server validates
 * against (`maxLength` attributes, character counters) without dragging the
 * database layer into the browser bundle.
 *
 * The same split as lib/inquiryLimits.ts and lib/blogLimits.ts, and for the
 * same reason. Keep in sync with prisma/schema.prisma: every bound here has a
 * matching `@db.VarChar(n)`, so the database is a second line of defence
 * rather than the only one.
 *
 * ── No email ──────────────────────────────────────────────────────────────
 * There is deliberately no email bound here, because there is no email
 * column. A comment is name-only (decided 2026-11-18): nothing sensitive to
 * store, nothing to leak, nothing to honour a deletion request over. The cost
 * is spam-filter accuracy, which lib/akismet.ts documents.
 */

export const COMMENT_NAME_MAX = 80;
export const COMMENT_BODY_MAX = 2000;

/**
 * Hard validity floors, rejected with a 400. Deliberately tiny — "ok" and
 * "👍" are real comments. Anything short enough to be *suspicious* rather
 * than invalid is held by a heuristic instead (lib/commentHeuristics.ts), so
 * the owner sees it and can approve it.
 */
export const COMMENT_NAME_MIN = 1;
export const COMMENT_BODY_MIN = 2;

/**
 * Byte cap for the raw request body, enforced by `readCappedText` BEFORE any
 * parsing or normalising.
 *
 * Tech debt 3.3 recorded that the existing routes disagree about this
 * ordering: bounding a string after normalising it means an unauthenticated
 * caller's megabyte of text is fully read and scanned first. 16 KiB is
 * comfortably above the worst legitimate case — 2,000 characters of body plus
 * 80 of name, at up to 4 UTF-8 bytes each, plus JSON overhead — and far below
 * anything worth buffering.
 */
export const COMMENT_BODY_BYTES_MAX = 16 * 1024;

/**
 * Per-IP submission budget. Tighter than likes (30/min) because a comment
 * costs a moderation decision rather than a row, and looser than it looks: a
 * real person writing five comments in ten minutes is already unusual.
 * Mirrors the inquiry bucket's shape.
 */
export const COMMENT_RATE_MAX = 5;
export const COMMENT_RATE_WINDOW_MS = 10 * 60 * 1000;

/** True when both fields are within their hard bounds. */
export function isValidCommentInput(name: string, body: string): boolean {
  return (
    name.length >= COMMENT_NAME_MIN &&
    name.length <= COMMENT_NAME_MAX &&
    body.length >= COMMENT_BODY_MIN &&
    body.length <= COMMENT_BODY_MAX
  );
}

/**
 * Hidden field the comment form submits: how long it was on screen, in
 * milliseconds. Screened by `screenComment` — see MIN_ELAPSED_MS there for why
 * elapsed time rather than a timestamp.
 */
export const COMMENT_ELAPSED_FIELD = "elapsedMs";
