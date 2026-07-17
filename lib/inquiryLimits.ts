/**
 * Shared inquiry length/limit constants — deliberately free of any Prisma or
 * server import so the client InquiryForm can pull in the same numbers the
 * server validates against (maxLength attributes, etc.) without dragging the DB
 * layer into the browser bundle. Keep in sync with prisma/schema.prisma.
 */

export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const MESSAGE_MAX = 2000;

/** Pragmatic email shape — deliberately loose; deliverability isn't validated. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** DB-backed rate limit: at most RATE_LIMIT_MAX inquiries per IP per window. */
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
