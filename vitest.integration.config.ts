import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration test config — runs real-PostgreSQL ownership and gameplay tests
 * in `tests/integration`. They run in the dedicated CI database job and can run
 * locally against a live database:
 *
 *   DATABASE_URL=postgres://runespace:runespace@127.0.0.1:5432/runespace \
 *     pnpm test:integration
 */

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
