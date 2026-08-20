import { assertLocalDatabaseUrl } from "@/scripts/local-db-url.mjs";

const databaseUrl = process.env.DATABASE_URL;
const disposableDatabase = process.env.RUNESPACE_DISPOSABLE_TEST_DB;

if (databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl);
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!disposableDatabase || disposableDatabase !== databaseName) {
    throw new Error(
      "Integration tests require the disposable test runner; use pnpm test:integration instead of the raw Vitest command.",
    );
  }
  if (!databaseName.startsWith("runespace_test_")) {
    throw new Error("Integration tests refused a database outside the disposable test namespace");
  }
}
