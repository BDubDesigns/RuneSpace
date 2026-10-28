import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Next compiles JSX with the automatic runtime; match it so a unit test can
  // render a real feature component without that file importing React.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
    // Inlined so `vi.resetModules()` gives a test a fresh real posthog-js
    // singleton (tests/unit/analytics-attribution-sdk.test.ts).
    server: { deps: { inline: [/posthog/] } },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
