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
