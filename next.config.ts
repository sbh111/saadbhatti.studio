import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";
import { missingEnvVars } from "./lib/env";

// Native ONNX runtime files the CLIP text encoder needs at runtime. Tracing picks
// up the .node addon but not the shared libraries it dlopen()s, which is why the
// function died with "libonnxruntime.so.1: cannot open shared object file".
const ORT_LINUX_X64 = "./node_modules/onnxruntime-node/bin/napi-v3/linux/x64";

// The versioned .so (libonnxruntime.so.1.21.0) used to be a literal here, while
// package.json floats "@huggingface/transformers": "^3.5.0" — any minor bump
// that repins the transitive onnxruntime-node version would go stale silently
// (tech debt 2.4: outputFileTracingIncludes with a non-matching path is NOT a
// build warning, only a production 500 the first time search runs). Read the
// version onnxruntime-node actually shipped with instead of hardcoding it.
const ORT_PACKAGE_JSON = path.join(
  process.cwd(),
  "node_modules/onnxruntime-node/package.json"
);
const { version: ORT_VERSION } = JSON.parse(
  fs.readFileSync(ORT_PACKAGE_JSON, "utf8")
) as { version: string };

const ORT_INCLUDES = [
  `${ORT_LINUX_X64}/onnxruntime_binding.node`,
  `${ORT_LINUX_X64}/libonnxruntime.so.1`,
  `${ORT_LINUX_X64}/libonnxruntime.so.${ORT_VERSION}`,
  `${ORT_LINUX_X64}/libonnxruntime_providers_shared.so`,
];

// Fail LOUD at config load (dev server start or build) rather than silently at
// request time in production. Safe to assert unconditionally on any host OS,
// not just Linux: onnxruntime-node ships every platform's prebuilt binaries
// (linux, darwin x64+arm64, win32) inside the one npm package — confirmed by
// inspecting node_modules/onnxruntime-node/bin/napi-v3/* — so the linux/x64
// files this function needs at runtime are present in node_modules on a
// macOS or Windows dev machine too, not only on the Linux CI/Vercel host.
for (const include of ORT_INCLUDES) {
  const abs = path.join(process.cwd(), include);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `next.config.ts: outputFileTracingIncludes references a file that doesn't ` +
        `exist: ${include}\nonnxruntime-node is at version ${ORT_VERSION} — its ` +
        `bundled file layout under bin/napi-v3/linux/x64 has apparently changed; ` +
        `update ORT_INCLUDES above to match.`
    );
  }
}

// Fail a PRODUCTION deploy before it goes live, rather than building fine and
// failing at the first request (tech debt 1.3 — instrumentation.ts's
// register() is the runtime line of defense; this is the build-time one, and
// catches it even earlier). Gated on VERCEL_ENV — set by Vercel itself,
// distinct from NODE_ENV — so a Preview deploy or a local `next build`
// (VERCEL_ENV unset) is never blocked, only an actual Production-environment
// build. This is nothing more than an env-var presence check (missingEnvVars,
// shared with instrumentation.ts) — no Vercel API call — so it costs nothing
// and does nothing on any other host if this ever runs somewhere else.
if (process.env.VERCEL_ENV === "production") {
  const missing = missingEnvVars(process.env);
  if (missing.length > 0) {
    throw new Error(
      `next.config.ts: refusing to build for production — missing required ` +
        `env var(s): ${missing.join(", ")}. See docs/operations.md's environment table.`
    );
  }
}

const nextConfig: NextConfig = {
  /**
   * Legacy URL compatibility, and the ONE place in this repo that names a
   * medium.
   *
   * Until the Cloudinary restructure the mediums WERE the account's root
   * folders, so they were served at `/<medium>/<collection>`. They now live
   * under `art/` and are served at `/art/<medium>/<collection>`
   * (lib/urls.ts). Links sent before the move — inquiry-notification emails,
   * admin comment-log rows, like-event snapshots, anything shared or
   * bookmarked — must keep working, hence `permanent` (308).
   *
   * This is a FROZEN historical list, deliberately hardcoded rather than
   * derived from the catalog: it maps slugs that were once published to where
   * they live now, so it must stay correct even after a folder is renamed in
   * Cloudinary. `lib/` and `app/` still name no medium anywhere
   * (docs/architecture.md §1).
   *
   * Redirects are applied before filesystem routing, so this list must stay
   * ENUMERATED — a generic `/:medium/:collection` rule would hijack
   * `/admin/comments` into `/art/admin/comments`. Each bare path is listed
   * separately from its `:path*` form rather than relying on `:path*`
   * matching zero segments.
   *
   * The `#fragment` survives: it is never sent to the server, so the browser
   * re-applies it to the redirect target — which is what keeps
   * `…/southwest#colorado-iejdgb` deep links landing on the right artwork,
   * where components/LegacyHashResolver.tsx takes over as before.
   */
  async redirects() {
    return [
      {
        source: "/photography",
        destination: "/art/photography",
        permanent: true,
      },
      {
        source: "/photography/:path*",
        destination: "/art/photography/:path*",
        permanent: true,
      },
      // The painting medium never held an asset (it was a WIPView), so these
      // are belt-and-braces for a bookmarked tab. Both spellings are covered
      // because the Cloudinary folder is now plural.
      { source: "/paintings", destination: "/art/paintings", permanent: true },
      {
        source: "/paintings/:path*",
        destination: "/art/paintings/:path*",
        permanent: true,
      },
      { source: "/painting", destination: "/art/paintings", permanent: true },
      {
        source: "/painting/:path*",
        destination: "/art/paintings/:path*",
        permanent: true,
      },
    ];
  },

  // transformers.js pulls in onnxruntime-node (a native addon); keep it external so
  // Next bundles a require() rather than trying to trace/bundle the binary. Used by
  // the CLIP text encoder in lib/clip.ts (app/api/search).
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],

  // Ship the CPU runtime with the search function (~43 MB).
  outputFileTracingIncludes: {
    "/api/search": ORT_INCLUDES,
  },

  // Keep everything else OUT. The GPU providers and the other platforms' binaries
  // are useless on Vercel and enormous — the CUDA provider alone is 327 MB, which
  // would blow the 250 MB unzipped function limit on its own.
  //
  // The provider exclude is deliberately a "not shared" extglob rather than an
  // enumerated cuda/tensorrt list: excludes win over includes (Next unions the
  // traced files with outputFileTracingIncludes FIRST, then deletes anything any
  // exclude glob matches — see collect-build-traces.js), so a literal list would
  // need updating every time onnxruntime-node adds a new provider .so, and a
  // missed one is the same silent-until-production failure as 2.4 itself, just
  // in the other direction (blowing the 250 MB limit instead of a missing file).
  outputFileTracingExcludes: {
    "/api/search": [
      `${ORT_LINUX_X64}/libonnxruntime_providers_!(shared).so`,
      "./node_modules/onnxruntime-node/bin/napi-v3/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v3/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/**",
    ],
  },
};

export default nextConfig;
