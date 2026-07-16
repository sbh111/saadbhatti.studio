import { createHash } from "node:crypto";
import { prisma } from "./db";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./inquiryLimits";

/**
 * Server-only inquiry helpers: IP hashing (we never store a raw IP) and the
 * DB-backed rate limit. Kept out of the client bundle — imports prisma. The
 * public POST handler (app/api/inquiries/route.ts) is the sole caller.
 */

/** Salted sha256 of an IP — never the raw address. */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) {
    throw new Error(
      "Missing IP_HASH_SALT. Locally: put it in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }
  return createHash("sha256").update(ip + salt).digest("hex");
}

/**
 * The client IP as Vercel presents it: the leftmost x-forwarded-for entry
 * (guaranteed to be the real client). Falls back to "unknown" so a missing
 * header still hashes to a stable bucket rather than throwing.
 */
export function clientIpOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return forwarded.split(",")[0].trim() || "unknown";
}

/**
 * True when this ipHash has already submitted RATE_LIMIT_MAX or more inquiries
 * within the window. Index-only-friendly via @@index([ipHash, createdAt]).
 */
export async function isRateLimited(ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await prisma.inquiry.count({
    where: { ipHash, createdAt: { gte: since } },
  });
  return recent >= RATE_LIMIT_MAX;
}
