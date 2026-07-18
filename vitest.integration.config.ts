import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration test config — runs the real-PostgreSQL ownership/character tests
 * in `tests/integration`. These are intentionally excluded from the fast unit
 * suite so CI stays lightweight; run them locally against a live database:
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
