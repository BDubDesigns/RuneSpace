import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Overridable so restricted environments can relocate the results cache
  // (defaults preserve Vitest's standard node_modules/.vite location).
  cacheDir: process.env.VITEST_CACHE_DIR ?? "node_modules/.vite",
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
