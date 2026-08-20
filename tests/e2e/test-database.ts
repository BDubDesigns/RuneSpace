import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Browser fixtures must never run against the persistent development database.
 * The disposable-test runner sets the marker to the exact selected database
 * name; a raw Playwright invocation therefore fails before creating a user.
 */
export function assertDisposableE2EDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const disposableDatabase = process.env.RUNESPACE_DISPOSABLE_TEST_DB;
  if (!databaseUrl) throw new Error("E2E fixtures require the disposable test runner");
  // Playwright's TypeScript loader can transform a static `.mjs` import into
  // CommonJS. Invoke the dependency-free authoritative guard as a child Node
  // process so the browser fixture never bypasses the local-host boundary.
  try {
    execFileSync(process.execPath, [resolve(process.cwd(), "scripts/local-db-url.mjs")], {
      env: process.env,
      stdio: "ignore",
    });
  } catch {
    throw new Error("E2E fixtures require a disposable localhost PostgreSQL database");
  }
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (
    !disposableDatabase ||
    disposableDatabase !== databaseName ||
    !databaseName.startsWith("runespace_test_")
  ) {
    throw new Error(
      "E2E fixtures require a disposable test database; use pnpm test:e2e or pnpm test:e2e:canonical.",
    );
  }
}
