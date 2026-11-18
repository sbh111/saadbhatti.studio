/**
 * Local spam heuristics for comment bodies — the cheap first pass, run before
 * Akismet is asked anything.
 *
 * Pure and dependency-free: no network, no database, no `process.env`. That is
 * what makes it unit-testable without a database AND what lets it run before
 * the expensive check, which is the whole point of having it.
 *
 * ── What "hold" means here ────────────────────────────────────────────────
 * A rule firing does NOT discard the comment. It leaves it `HELD` with a
 * reason the owner can read in the moderation queue, where approving it is one
 * click. So the bar for adding a rule is "would a human want to look at this
 * first", not "is this definitely spam" — a false positive costs the owner a
 * click, while a false negative costs every reader.
 *
 * Reasons are never shown publicly. Telling a spammer which rule they tripped
 * is telling them how to route around it.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 * A keyword blocklist. It would need maintaining forever, it dates badly, and
 * it is exactly the job Akismet does better with a corpus this one does not
 * have. These rules are all structural instead: shape, not vocabulary.
 */

/** A rule that fired, or null for a clean body. */
export interface HeuristicVerdict {
  /** Short, stable, and safe to store in `spamReason` (VarChar(200)). */
  reason: string;
}

/** Links are the single strongest structural signal in comment spam. */
export const MAX_LINKS = 2;

/** Below this, a body is suspicious rather than invalid — held, not rejected. */
export const SHORT_BODY_CHARS = 5;

/** A run this long is keyboard mashing or padding, not emphasis. */
export const MAX_REPEAT_RUN = 10;

/** Shouting, measured only once there are enough letters for a ratio to mean anything. */
export const CAPS_MIN_LETTERS = 12;
export const CAPS_RATIO = 0.7;

/**
 * How fast a human can plausibly land on a post, read it, and write a comment.
 * The form reports ELAPSED MILLISECONDS since it mounted — not a timestamp, so
 * there is no clock-skew problem and nothing to compare against server time.
 *
 * Trivially spoofable in principle; not spoofed in practice, because the bots
 * that bother are not the ones filling this form. Cheap, stateless, and it
 * only holds rather than rejects, so a fast typist loses nothing but a few
 * minutes' wait.
 */
export const MIN_ELAPSED_MS = 3_000;

/**
 * Anything that looks like a link: a scheme, a bare `www.`, or a bracketed
 * BBCode `[url=…]`. Counted rather than matched exactly — the goal is "how
 * many links is this person trying to place", and over-counting a URL written
 * two ways is the harmless direction.
 */
const LINK_RE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)|\[url[=\]]/gi;

/**
 * Zero-width and bidirectional-override characters: U+200B–200F, U+202A–202E,
 * U+2066–2069. No legitimate comment contains a bidi override — they exist in
 * spam to hide text from a human reader while leaving it in the markup, or to
 * reverse how a URL renders.
 */
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u;

/** Letters only, so punctuation and emoji don't dilute the caps ratio. */
const LETTER_RE = /\p{L}/gu;
const UPPER_RE = /\p{Lu}/gu;

function count(value: string, re: RegExp): number {
  return value.match(re)?.length ?? 0;
}

/** The longest run of one repeated character. */
export function longestRun(value: string): number {
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const char of value) {
    run = char === previous ? run + 1 : 1;
    previous = char;
    if (run > longest) longest = run;
  }
  return longest;
}

/**
 * Screen a comment. Returns the first rule that fired, or null if nothing did.
 *
 * First-match-wins rather than collecting every reason: the owner needs one
 * sentence explaining why this is in the queue, not an audit trail. The order
 * below is cheapest-and-most-decisive first.
 */
export function screenComment(
  name: string,
  body: string,
  /**
   * Milliseconds the form was on screen before submission, as the client
   * reported it. Undefined when absent or unparseable — treated as "no
   * signal" rather than as zero, so an old cached form or a visitor with
   * JavaScript partly broken is not punished for it.
   */
  elapsedMs?: number
): HeuristicVerdict | null {
  const trimmedBody = body.trim();
  const trimmedName = name.trim();

  const links = count(trimmedBody, LINK_RE);
  if (links > MAX_LINKS) {
    return { reason: `${links} links in the body` };
  }

  // A name is a name. Nobody signs a comment with a URL except to place it.
  if (count(trimmedName, LINK_RE) > 0) {
    return { reason: "link in the author name" };
  }

  if (INVISIBLE_RE.test(trimmedBody) || INVISIBLE_RE.test(trimmedName)) {
    return { reason: "zero-width or bidi characters" };
  }

  if (typeof elapsedMs === "number" && elapsedMs >= 0 && elapsedMs < MIN_ELAPSED_MS) {
    return { reason: `submitted after ${elapsedMs}ms` };
  }

  if (trimmedBody.length < SHORT_BODY_CHARS) {
    return { reason: "very short body" };
  }

  if (longestRun(trimmedBody) >= MAX_REPEAT_RUN) {
    return { reason: "long run of repeated characters" };
  }

  const letters = count(trimmedBody, LETTER_RE);
  if (letters >= CAPS_MIN_LETTERS) {
    const ratio = count(trimmedBody, UPPER_RE) / letters;
    if (ratio >= CAPS_RATIO) {
      return { reason: "mostly capital letters" };
    }
  }

  return null;
}
