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
