import { readFileSync } from "node:fs";

/**
 * Production uses the supplied server instant. Canonical E2E may point this
 * narrow Power Annex clock at a disposable file so browser tests can cross a
 * Pacific calendar boundary without trusting the host wall clock.
 */
export function powerAnnexNow(fallback = new Date()): Date {
  const clockPath = process.env.RUNESPACE_POWER_ANNEX_CLOCK_FILE;
  const databaseHost = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : undefined;
  const canonicalLocalE2E =
    process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_CANONICAL_HTTP === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1");
  if (!clockPath || !canonicalLocalE2E) return fallback;
  try {
    const value = new Date(readFileSync(clockPath, "utf8").trim());
    if (Number.isFinite(value.getTime())) return value;
  } catch {
    // The test clock is optional; an absent/unreadable file uses the server instant.
  }
  return fallback;
}
