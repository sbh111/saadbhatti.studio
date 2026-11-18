import { prisma } from "./db";

/**
 * Server-only key/value settings, backed by the `settings` table. Home of the
 * single event-streaming toggle for now, but generic so future flags reuse it.
 *
 * isEventStreamingEnabled() sits on the hot ingest path, so it caches the flag
 * in-process for ~60s. Serverless runs many instances, so a toggle flip
 * propagates within the TTL rather than instantly — fine for analytics, and the
 * client-side /api/events/config check makes the common (page-load) case
 * immediate. Imports prisma — keep this out of the client bundle.
 */

export const EVENT_STREAMING_KEY = "event_streaming_enabled";

/**
 * Master switch for accepting visitor comments. Off → the comment route
 * rejects and the form is not rendered. Exists because "turn comments off"
 * should not need a deploy, and because the generic `settings` table was built
 * for exactly this ("future flags reuse it").
 */
export const COMMENTS_ENABLED_KEY = "blog_comments_enabled";

/**
 * Whether a clean Akismet verdict is allowed to publish a comment on its own.
 *
 * Starts OFF deliberately. Comments are name-only, which removes the most
 * portable signal Akismet has (see lib/akismet.ts), so its confidence is
 * reduced exactly where auto-publishing needs confidence. With this off every
 * comment is HELD and the verdict is merely *recorded* in `spamReason` — so
 * the owner can read a few weeks of real verdicts and decide whether they
 * match their own judgement before trusting them. Cheaper and far more
 * informative than trusting the filter on day one.
 */
export const COMMENT_AUTO_PUBLISH_KEY = "blog_comment_auto_publish";

/** A boolean setting, defaulting to `fallback` when unset or unreadable. */
export async function getBooleanSetting(
  key: string,
  fallback: boolean
): Promise<boolean> {
  try {
    const value = await getSetting(key);
    if (value === null) return fallback;
    return value === "true";
  } catch (err) {
    // Fail to the caller's stated default rather than throwing into a public
    // write path — the same reasoning as isEventStreamingEnabled below, which
    // fails closed on a DB hiccup.
    console.warn(
      `settings: read of "${key}" failed, defaulting to ${fallback}:`,
      (err as Error).message
    );
    return fallback;
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

const TTL_MS = 60_000;
let cached: { value: boolean; at: number } | null = null;

/** The streaming toggle, cached ~60s. Defaults OFF on any read failure. */
export async function isEventStreamingEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  let value = false;
  try {
    value = (await getSetting(EVENT_STREAMING_KEY)) === "true";
  } catch (err) {
    // A DB hiccup must never break the ingest path — fail closed (off).
    console.warn(
      "isEventStreamingEnabled: settings read failed, defaulting off:",
      (err as Error).message
    );
    value = false;
  }
  cached = { value, at: now };
  return value;
}

/**
 * Drop the in-process cache so the next read hits the DB. Called right after the
 * admin flips the toggle — makes THIS instance immediate (other serverless
 * instances still refresh within the TTL; that tradeoff is documented above).
 */
export function invalidateStreamingCache(): void {
  cached = null;
}
