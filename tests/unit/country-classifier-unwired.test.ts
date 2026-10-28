import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYTICS_CONSENT_MODEL } from "@/features/analytics/analytics-policy";

/**
 * Issue #419 adds the offline country classifier as an entirely unwired
 * foundation for #417: no route, page, server action, analytics gate or browser
 * bundle may import it, and consent stays opt-in worldwide. The slice that
 * wires it deletes the importer guard below on purpose.
 */

const ROOT = process.cwd();
const CLASSIFIER_FILES = new Set([
  "server/client-ip.ts",
  "server/client-region.ts",
  "server/geo/country-lookup.ts",
  "features/analytics/analytics-region.ts",
]);
const SKIPPED_DIRECTORIES = new Set([".git", ".next", "node_modules", "tests", "assets"]);
const CLASSIFIER_SPECIFIER =
  /["'](?:@\/|(?:\.\.?\/)+)?(?:[\w./-]*\/)?(?:client-ip|client-region|country-lookup|analytics-region)["']|mmdb-lib/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(full);
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [full] : [];
  });
}

describe("offline country classifier (issue #419)", () => {
  it("is imported by nothing outside its own modules and tests", () => {
    const importers = sourceFiles(ROOT)
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
      .filter((file) => !CLASSIFIER_FILES.has(file))
      .filter((file) => CLASSIFIER_SPECIFIER.test(readFileSync(path.join(ROOT, file), "utf8")));
    expect(importers).toEqual([]);
  });

  it("leaves analytics consent opt-in worldwide", () => {
    expect(ANALYTICS_CONSENT_MODEL).toBe("opt-in");
  });
});
