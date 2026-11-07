import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * next.config.ts derives the ONNX shared-library filename from
 * onnxruntime-node's own package.json (tech debt 2.4) instead of hardcoding
 * it, and asserts every traced path exists at config-load time. Importing it
 * here re-runs that assertion on every test run — the same regression this
 * fix was written to catch (the earlier hand-edit of the version template
 * produced "libonnxruntime.so.1.1.21.0" and only `next build` caught it) now
 * fails `npm test` too, well before a build.
 */
const { default: nextConfig } = await import("@/next.config");

describe("next.config.ts ONNX tracing", () => {
  it("includes exactly the four files onnxruntime-node ships for linux/x64, at its real version", () => {
    const { version } = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "node_modules/onnxruntime-node/package.json"),
        "utf8"
      )
    ) as { version: string };

    const includes = nextConfig.outputFileTracingIncludes?.["/api/search"] ?? [];
    const dir =
      "./node_modules/onnxruntime-node/bin/napi-v3/linux/x64";
    expect(includes).toEqual([
      `${dir}/onnxruntime_binding.node`,
      `${dir}/libonnxruntime.so.1`,
      `${dir}/libonnxruntime.so.${version}`,
      `${dir}/libonnxruntime_providers_shared.so`,
    ]);

    // Every included path must actually exist — this is what the config-load
    // assertion checks; re-assert it here so a stale template string fails
    // fast under `npm test` instead of only surfacing during `next build`.
    for (const include of includes) {
      expect(fs.existsSync(path.join(process.cwd(), include))).toBe(true);
    }
  });

  it("excludes every provider .so except the shared one needed at runtime", () => {
    const excludes = nextConfig.outputFileTracingExcludes?.["/api/search"] ?? [];
    expect(excludes).toContain(
      "./node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_!(shared).so"
    );
  });
});
