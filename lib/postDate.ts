/**
 * Publication-date formatting for the blog, kept as a pure function with no
 * server or Prisma import so it is unit-testable without a database — the
 * same reason lib/slug.ts and lib/likeButton.ts exist.
 *
 * Formatted in UTC, server-side, DELIBERATELY — unlike components/LocalTime.tsx,
 * which defers to the viewer's timezone after mount. Two reasons:
 *
 *   1. The public blog pages must ship no JavaScript for this. LocalTime is a
 *      client component; a post's publication date does not need the viewer's
 *      offset, so paying for hydration would buy nothing.
 *   2. A fixed timezone makes the output deterministic, so the prerendered
 *      HTML is byte-identical no matter which machine or region renders it.
 *      An implicit timezone would silently resolve to the *server's* and
 *      produce different HTML from different Vercel regions.
 *
 * Admin pages keep using LocalTime, where "when did this actually happen,
 * for me" is the question being asked.
 */

const fmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

/**
 * An ISO timestamp as a reader-facing date, e.g. "November 16, 2026".
 * Returns "" for anything unparseable rather than throwing or rendering
 * "Invalid Date" into the page.
 */
export function formatPostDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return fmt.format(date);
}
