import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration test config — runs real-PostgreSQL ownership and gameplay tests
 * in `tests/integration`. They run in the dedicated CI database job and can run
 * locally through the disposable database wrapper:
 *
 *   pnpm test:integration
 */

export default defineConfig({
  // Overridable so restricted environments can relocate the results cache
  // (defaults preserve Vitest's standard node_modules/.vite location).
  cacheDir: process.env.VITEST_CACHE_DIR ?? "node_modules/.vite",
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    setupFiles: ["tests/integration/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
