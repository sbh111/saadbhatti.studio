#!/usr/bin/env node
/**
 * Turns docs/architecture.md invariant 2 from a manual eyeball of the
 * `next build` route table into an assertion.
 *
 * Run AFTER `next build`, against .next/prerender-manifest.json. It checks
 * three things, each of which has a specific way of silently regressing:
 *
 *  1. Every public route is prerendered — either as static HTML (`routes`) or
 *     as an ISR-cached dynamic route (`dynamicRoutes`). A public route that
 *     drops out of both has become server-rendered per request, which is how
 *     the site quietly stops being CDN-cacheable.
 *
 *  2. No /admin route is prerendered. Admin pages read the session and must
 *     stay dynamic; one appearing here would mean admin HTML was baked at
 *     build time.
 *
 *  3. NOTHING under /blog/<slug> is prerendered. app/blog/[slug]/page.tsx
 *     exports a `generateStaticParams` that returns an empty list on purpose:
 *     exporting it keeps the route ISR-cached, and returning nothing keeps the
 *     database out of `next build` (ci.yml points DATABASE_URL at an
 *     unreachable placeholder). Someone "optimizing" that into a real query
 *     would couple every deploy to Neon being reachable and to the manually
 *     applied migration having landed first. Deleting the export entirely
 *     makes the route per-request dynamic, which check 1 catches.
 *
 * Exits non-zero with a specific message on failure, so CI names the broken
 * invariant rather than just failing.
 */

import { readFileSync } from "node:fs";

const MANIFEST = ".next/prerender-manifest.json";

/** Routes that must be prerendered, as static HTML or an ISR dynamic route. */
const MUST_BE_PRERENDERED = [
  "/",
  "/about",
  "/art",
  "/art/[medium]",
  "/art/[medium]/[collection]",
  "/blog",
  "/blog/[slug]",
];

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (err) {
  console.error(
    `assert-static-routes: could not read ${MANIFEST} — run \`next build\` first.\n${err.message}`
  );
  process.exit(1);
}

const staticRoutes = Object.keys(manifest.routes ?? {});
const dynamicRoutes = Object.keys(manifest.dynamicRoutes ?? {});
const prerendered = new Set([...staticRoutes, ...dynamicRoutes]);

const failures = [];

for (const route of MUST_BE_PRERENDERED) {
  if (!prerendered.has(route)) {
    failures.push(
      `${route} is no longer prerendered — it is now server-rendered on demand (ƒ). ` +
        `Public routes must stay CDN-cacheable; see docs/architecture.md §13.2.`
    );
  }
}

const leakedAdmin = [...prerendered].filter((route) =>
  route.startsWith("/admin")
);
if (leakedAdmin.length > 0) {
  failures.push(
    `admin route(s) were prerendered: ${leakedAdmin.join(", ")}. ` +
      `Admin pages read the session and must be dynamic (force-dynamic).`
  );
}

// `/blog` itself is the index and SHOULD be static; anything deeper means a
// post was prerendered at build time, i.e. the database was queried.
const prerenderedPosts = staticRoutes.filter((route) =>
  route.startsWith("/blog/")
);
if (prerenderedPosts.length > 0) {
  failures.push(
    `post page(s) were prerendered at build time: ${prerenderedPosts.join(", ")}. ` +
      `app/blog/[slug]/page.tsx's generateStaticParams must return [] so the ` +
      `build never queries Postgres.`
  );
}

if (failures.length > 0) {
  console.error("assert-static-routes: FAILED\n");
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  `assert-static-routes: ok — ${staticRoutes.length} static, ` +
    `${dynamicRoutes.length} ISR dynamic, no admin leakage, no prerendered posts.`
);
