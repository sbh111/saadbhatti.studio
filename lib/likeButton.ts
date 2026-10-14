/**
 * Pure logic behind LikeButton's optimistic-update rollback (tech debt 1.7).
 * Extracted so it's unit-testable without a DOM/React test environment —
 * this repo's vitest config runs in "node" (see vitest.config.ts) and has no
 * jsdom / testing-library.
 */

/**
 * Whether a settled like/unlike request should roll back the optimistic UI
 * update (the filled/unfilled heart) and the matching localStorage entry it
 * applied before the request was sent.
 *
 * `ok` mirrors `res.ok`: true for any 2xx, which includes the server's terse
 * 204 for a rate-limited or admin no-op request — both are deliberately
 * idempotent no-ops ("bots learn nothing") and are treated as success here
 * too. `false` covers a 400/503 response or a network failure (the caller
 * passes `false` when `fetch` itself throws).
 *
 * `requestSeq` is a per-button counter's value at the moment THIS request
 * was issued; `latestSeq` is that counter's value when the response arrives.
 * If a later click has bumped the counter since, this response has been
 * superseded — rolling back now would clobber state the later click already
 * set, so a stale response is never rolled back, regardless of `ok`.
 */
export function shouldRollbackLike(
  ok: boolean,
  requestSeq: number,
  latestSeq: number
): boolean {
  return requestSeq === latestSeq && !ok;
}
