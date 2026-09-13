/**
 * Pure helpers for AdminProvider's two localStorage-backed staging maps
 * (staged edits, keyed by artwork public id; staged reorders, keyed by
 * collection path). Split out of the component so the read-merge-write logic
 * that keeps two open admin tabs from clobbering each other's staged changes
 * (tech debt 1.6) can be unit-tested directly — AdminProvider itself is a
 * client component that touches `window`/`localStorage`, which the vitest
 * env (node, no jsdom) can't exercise.
 */

/**
 * Parse a localStorage value into a string-keyed map, defaulting to `{}` for
 * anything missing, malformed, or not a plain object (corrupt storage, a
 * stale shape from an older version, manual tampering, another tab clearing
 * the key). Shared by the initial load AND the cross-tab `storage` listener,
 * so both parse identically.
 */
export function parseStagingMap<T>(raw: string | null | undefined): Record<string, T> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, T>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Apply ONE key's change to a map: set it (a non-null value) or delete it
 * (null). This is the "merge" half of read-merge-write — call it against a
 * map just read fresh from localStorage, never against a possibly-stale
 * in-memory copy, so a change another tab staged since our last read survives
 * instead of being overwritten wholesale when we persist (tech debt 1.6: two
 * tabs each writing the ENTIRE map from their own snapshot is exactly what
 * let tab B's write erase tab A's change).
 */
export function applyStagingChange<T>(
  current: Record<string, T>,
  key: string,
  value: T | null
): Record<string, T> {
  const next = { ...current };
  if (value !== null) next[key] = value;
  else delete next[key];
  return next;
}
