import { createHash } from "node:crypto";

/**
 * Server-only inquiry helpers: IP hashing (we never store a raw IP) and the
 * client-IP resolver every rate-limited route builds its bucket key from.
 * Kept out of the client bundle — hashIp/clientIpOf are the shared per-IP
 * building blocks for every public write path (likes, events, search,
 * inquiries) — `clientIpOf` in particular is the spoofing guard behind all of
 * them, so treat it as broad-blast-radius, not local. Routes call the shared
 * `isRateLimited` in lib/rateLimit.ts directly with their own bucket name and
 * bounds; there used to be a thin inquiry-specific wrapper here, but it was
 * the only such wrapper in the codebase and its different arity from the
 * function it wrapped invited exactly the alias-juggling tech debt 3.5 found.
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
