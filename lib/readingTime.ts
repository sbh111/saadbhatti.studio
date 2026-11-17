/**
 * "4 min read" for a post body.
 *
 * Pure and dependency-free (no Prisma, no server import), so the admin editor
 * can show a live estimate from the same function the public pages use —
 * the lib/blogLimits.ts split, for the same reason.
 *
 * ── Deliberately an estimate ──────────────────────────────────────────────
 * Words are whitespace-separated tokens of the RAW markdown. That counts a
 * link's URL, a fenced code block's contents and `##` markers as words, which
 * overestimates a link- or code-heavy post by perhaps 10–20%.
 *
 * Stripping that noise correctly needs the markdown parser, which would make
 * this module server-only and pull `marked` into the editor's client bundle to
 * compute a number nobody treats as exact. A reader uses this to decide
 * "now or later", and no reader can tell 4 from 5. An approximation that is
 * honest about being one beats a precise number that costs a bundle.
 */

/**
 * 220 words/minute — adult silent reading of non-technical prose sits around
 * 200–250 (Brysbaert 2019's meta-analysis of 190 studies puts English
 * non-fiction at ~238). The midpoint is chosen rather than the high end
 * because an estimate that runs slightly long is the forgiving direction.
 */
export const WORDS_PER_MINUTE = 220;

/** Whitespace-separated tokens. "" → 0, which is not the same as 1 minute. */
export function countWords(body: string): number {
  const trimmed = body.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Whole minutes, rounded, with a floor of 1 for any non-empty body — "0 min
 * read" is noise, and a one-line post is still a click.
 *
 * Returns 0 for an empty body so callers can hide the label entirely on a
 * blank draft rather than claiming it takes a minute to read nothing.
 */
export function readingMinutes(body: string): number {
  const words = countWords(body);
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** The display string, or "" for an empty body. */
export function readingTimeLabel(body: string): string {
  const minutes = readingMinutes(body);
  return minutes === 0 ? "" : `${minutes} min read`;
}
