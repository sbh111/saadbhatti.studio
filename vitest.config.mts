import { defineConfig } from "vitest/config";

// Minimal config: Node environment (these are server-only route handlers and
// lib helpers, no DOM), the same `@/` alias tsconfig.json defines for imports,
// and test/setup.ts loaded before every file — see that file for why.
export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
  },
});
