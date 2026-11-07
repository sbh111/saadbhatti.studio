import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * Next's instrumentation hook: `register()` runs once when a new server
 * instance starts. Used here to fail loudly, at boot, if a required env var
 * (lib/env.ts) is missing or blank — closing tech debt 1.3, where each of
 * these was instead discovered per-request, deep inside whichever code path
 * first needed it (a 500 on the first inquiry, the first login attempt, the
 * first catalog read — independently, at different times).
 */
export async function register() {
  // register() can run under BOTH the Node and Edge runtimes (e.g. if an Edge
  // middleware/route triggers it) — process.env.NEXT_RUNTIME distinguishes
  // them. Only the Node runtime actually serves the routes that read these
  // vars (proxy.ts's Edge middleware never touches Cloudinary/Postgres/the
  // session secret), so skip there rather than double-checking or checking
  // env this runtime can't fully see.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Verified empirically (see the commit this landed in): `next build` does
  // NOT invoke register() in this Next version — but PHASE_PRODUCTION_BUILD
  // is checked anyway as a defense-in-depth guard against that changing in a
  // future Next release, since the CI build (.github/workflows/ci.yml)
  // deliberately has only Cloudinary credentials and a placeholder
  // DATABASE_URL — no IP_HASH_SALT/SESSION_SECRET/ADMIN_* — and must keep
  // working without them.
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;

  const { assertRequiredEnv } = await import("@/lib/env");
  assertRequiredEnv();
}
