import nextConfig from "eslint-config-next/core-web-vitals";

/**
 * Flat config (Next 16 dropped `next lint`, so this runs via a plain `eslint`
 * script — see package.json). `eslint-config-next/core-web-vitals` bundles the
 * TypeScript + react-hooks + Next-specific rule sets; nothing extra installed.
 *
 * `reportUnusedDisableDirectives: "error"` is what let us audit the six
 * pre-existing `eslint-disable` comments below for tech debt 4.1 — a stale
 * directive now fails the same as a real lint error rather than sitting
 * invisibly forever.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      // Native Python services, linted (if at all) by their own toolchains.
      "embed/**",
      "collector/**",
    ],
  },
  ...nextConfig,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // React-Compiler-era rule new to eslint-plugin-react-hooks v7: it flags
      // setState called synchronously in an effect body, which is an existing,
      // working pattern all over this codebase (re-seeding state from
      // localStorage/context after mount, resetting derived state on prop
      // change) rather than a bug. Downgraded to warn rather than rewriting
      // five components as part of a lint-only tech-debt item (4.1) — see the
      // report for the exact count. `refs` and `purity` (also new in v7) stay
      // at their default "error" — they raise nothing in this codebase today.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
