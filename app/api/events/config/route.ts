import { NextResponse } from "next/server";
import { isEventStreamingEnabled } from "@/lib/settings";

/**
 * Public read of the event-streaming toggle for the client EventTracker. Kept
 * OUT of page render so the public pages stay statically prerendered — the
 * tracker fetches this once per session (mirrors AdminProvider → /api/admin/
 * session). Short cache: the flag changes rarely and a few seconds of staleness
 * is harmless (the server-side check in /api/events is the real gate).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = await isEventStreamingEnabled();
  return NextResponse.json(
    { enabled },
    { headers: { "Cache-Control": "public, max-age=30" } }
  );
}
