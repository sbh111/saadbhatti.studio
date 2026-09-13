import { createHash } from "node:crypto";
import { isRateLimited as limit } from "./rateLimit";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./inquiryLimits";

/**
 * Server-only inquiry helpers: IP hashing (we never store a raw IP) and the
 * DB-backed rate limit. Kept out of the client bundle — pulls in the DB layer
 * transitively via lib/rateLimit. `isRateLimited` here is inquiry-specific and
 * used only by app/api/inquiries/route.ts, but `hashIp` and `clientIpOf` are
 * the shared per-IP building blocks for every public write path (likes,
 * events, search, inquiries) — `clientIpOf` in particular is the spoofing
 * guard behind all of them, so treat it as broad-blast-radius, not local.
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
 * The trustworthy client IP, used as the key for every per-IP rate limit.
 *
 * We must NOT read the leftmost `x-forwarded-for` entry: that end of the chain
 * is appended by the client and is trivially spoofable, so a rotating header
 * would mint a fresh rate-limit bucket per request and defeat every limiter.
 * Instead we trust only sources the platform controls:
 *   1. `x-vercel-forwarded-for` — Vercel injects/overwrites this (not forgeable).
 *   2. `x-real-ip` — likewise set by the platform.
 *   3. `x-forwarded-for` fallback: the RIGHTMOST hop, i.e. the one the trusted
 *      proxy appended — never `[0]`.
 * Falls back to "unknown" (a single stable bucket) so a missing header hashes
 * consistently rather than throwing. Locally, where no platform sets these,
 * traffic collapses to "unknown"; setting `x-real-ip` in curl is a safe way to
 * simulate distinct client IPs in dev.
 */
export function clientIpOf(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim() || "unknown";

  const real = request.headers.get("x-real-ip");
  if (real) return real.trim() || "unknown";

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

/**
 * True once this ipHash has used up its inquiry budget for the window. A thin
 * wrapper over the shared rate limiter (lib/rateLimit.ts) on the "inquiry"
 * bucket, reusing the shared bounds from lib/inquiryLimits.ts.
 */
export function isRateLimited(ipHash: string): Promise<boolean> {
  return limit("inquiry", ipHash, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
}
