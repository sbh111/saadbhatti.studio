import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Liveness probe for an external uptime checker (see docs/operations.md §4
 * "Monitoring") — the concrete gap this closes: the Next app had no health
 * endpoint at all, unlike the two Python services (embed/, collector/), which
 * both already expose GET /health.
 *
 * Deliberately minimal: one cheap `SELECT 1` through Prisma, bounded by a short
 * timeout, and NOTHING else. In particular this does not call Cloudinary — a
 * Cloudinary outage already takes down every public page (tech-debt 1.4), so an
 * uptime check already hitting `/` on its own schedule learns that anyway;
 * having this endpoint also reach out to Cloudinary would only make the one
 * check meant to be cheap and safe to poll a second, slower way to fail. This
 * answers exactly one question: is the database reachable — the one
 * dependency (rate limiting, inquiries, likes, search) that fails silently
 * everywhere else in the app.
 *
 * Safe to poll anonymously and often: no auth, no heavy work, and the response
 * is terse on purpose — it never echoes the underlying error, a stack trace,
 * or any env value, only a bare status. `proxy.ts`'s matcher is
 * `/admin/:path*` + `/api/admin/:path*`, so this route is never intercepted.
 */
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 2000;

export async function GET() {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("health check timed out")), TIMEOUT_MS)
      ),
    ]);
    return NextResponse.json({ status: "ok" }, noStore);
  } catch (err) {
    // Logged for whoever is watching Vercel logs (see docs/operations.md §4);
    // never surfaced to the caller.
    console.error("health: database check failed:", (err as Error).message);
    return NextResponse.json({ status: "degraded" }, { status: 503, ...noStore });
  }
}
