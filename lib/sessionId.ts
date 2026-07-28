/**
 * Per-tab session id, shared by the event tracker and the like button so a
 * like's Kafka event carries the same partition key as the rest of the visit.
 * Stored in sessionStorage — it dies with the tab and is NOT a tracking cookie.
 * Client-only (touches sessionStorage/crypto); safe no-op fallback if storage
 * is unavailable.
 */

const SESSION_KEY = "sbh_evt_session";

export function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}
