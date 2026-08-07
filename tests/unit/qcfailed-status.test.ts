import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Durable `.qcfailed/status.json` contract test (Issue #72).
 *
 * RuneSpace publishes a small curated status manifest that qcfailed.com's
 * "Current Build Floor / QC Operations Console" will consume later (Issue #16
 * in BDubDesigns/qcfailed.com). This repository does NOT implement qcfailed.com's
 * ingestion; it only keeps the committed manifest parseable and internally
 * consistent as a schema-one document. This test deliberately reads the file
 * from disk so the parse boundary and the generic contract are explicit.
 *
 * The validation is generic schema-one validation only: it makes no
 * rollout-history claims (it does not freeze the work state, the latest
 * completed milestone, or the presence or absence of `currentChange`), so
 * future meaningful status-rollover PRs do not need to update this test.
 *
 * It does not connect to PostgreSQL, does not need a browser, and adds no
 * dependency.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = resolve(ROOT, ".qcfailed/status.json");

const ALLOWED_WORK_STATES = ["active", "maintenance", "paused"] as const;
const ALLOWED_CHANGE_STAGES = ["implementation", "review", "preview", "merge-ready"] as const;

/** Top-level fields allowed in schema version one. `currentChange` is optional. */
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "projectSlug",
  "workState",
  "currentFocus",
  "latestCompleted",
  "nextStep",
  "lastMeaningfulUpdate",
  "highlights",
  "currentChange",
]);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real UTC calendar date, not a synthetic one like 2026-02-30. */
function isValidCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  // setUTCFullYear handles years 0-99 exactly (Date.UTC would map them to
  // 1900-1999), so the round-trip check is correct for every real year.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A date that is a real calendar date and not later than today (UTC). */
function isRealNonFutureDate(value: string): boolean {
  if (!isValidCalendarDate(value)) {
    return false;
  }
  const match = DATE_RE.exec(value)!;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date.getTime() <= todayUtc;
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function expectConciseSentence(value: unknown, label: string): void {
  expect(typeof value === "string", `${label} must be a string`).toBe(true);
  if (typeof value !== "string") {
    return;
  }
  expect(value.length > 0, `${label} must not be empty`).toBe(true);
  expect(value.length <= 240, `${label} must be at most 240 characters`).toBe(true);
}

type ManifestRoot = Record<string, unknown>;

function readManifest(): ManifestRoot {
  let text: string;
  try {
    text = readFileSync(MANIFEST_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read status manifest at ${MANIFEST_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Status manifest at ${MANIFEST_PATH} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  expect(parsed !== null && typeof parsed === "object", "manifest root must be a JSON object").toBe(
    true,
  );
  expect(Array.isArray(parsed), "manifest root must not be an array").toBe(false);
  return parsed as ManifestRoot;
}

describe("qcfailed status manifest (schema version one)", () => {
  it("is valid JSON with a JSON-object root", () => {
    const root = readManifest();
    expect(Object.keys(root).length).toBeGreaterThan(0);
  });

  it("exposes only allowed top-level fields for version one", () => {
    const root = readManifest();
    for (const key of Object.keys(root)) {
      expect(ALLOWED_TOP_LEVEL_KEYS.has(key), `unknown top-level field "${key}"`).toBe(true);
    }
  });

  it("declares schemaVersion 1 and the runespace project slug", () => {
    const root = readManifest();
    expect(root.schemaVersion).toBe(1);
    expect(root.projectSlug).toBe("runespace");
  });

  it("declares an allowed work state", () => {
    const root = readManifest();
    expect(ALLOWED_WORK_STATES).toContain(root.workState);
  });

  it("keeps concise public-safe sentence fields at most 240 characters", () => {
    const root = readManifest();
    expectConciseSentence(root.currentFocus, "currentFocus");
    expect(root.latestCompleted).toBeDefined();
    const latest = root.latestCompleted as Record<string, unknown>;
    expectConciseSentence(latest.summary, "latestCompleted.summary");
    expectConciseSentence(root.nextStep, "nextStep");
  });

  it("keeps latestCompleted dated with an optional absolute-https url", () => {
    const root = readManifest();
    const latest = root.latestCompleted as Record<string, unknown>;
    expect(latest !== null && typeof latest === "object", "latestCompleted must be an object").toBe(
      true,
    );
    expect(typeof latest.date === "string" && isRealNonFutureDate(latest.date)).toBe(true);
    if (latest.url !== undefined) {
      expect(typeof latest.url === "string" && isAbsoluteHttpsUrl(latest.url)).toBe(true);
    }
  });

  it("keeps lastMeaningfulUpdate a real, non-future date", () => {
    const root = readManifest();
    expect(typeof root.lastMeaningfulUpdate === "string").toBe(true);
    expect(isRealNonFutureDate(root.lastMeaningfulUpdate as string)).toBe(true);
  });

  it("keeps highlights an array of zero to three dated entries with optional absolute-https urls", () => {
    const root = readManifest();
    expect(Array.isArray(root.highlights)).toBe(true);
    const highlights = root.highlights as unknown[];
    expect(highlights.length).toBeLessThanOrEqual(3);
    for (const entry of highlights) {
      const item = entry as Record<string, unknown>;
      expect(item !== null && typeof item === "object", "each highlight must be an object").toBe(
        true,
      );
      expectConciseSentence(item.summary, "highlight.summary");
      expect(typeof item.date === "string" && isRealNonFutureDate(item.date)).toBe(true);
      if (item.url !== undefined) {
        expect(typeof item.url === "string" && isAbsoluteHttpsUrl(item.url)).toBe(true);
      }
    }
  });

  it("validates an optional currentChange whenever one is present", () => {
    const root = readManifest();
    if (root.currentChange === undefined) {
      return;
    }
    const change = root.currentChange as Record<string, unknown>;
    expect(change !== null && typeof change === "object", "currentChange must be an object").toBe(
      true,
    );
    // Closed schema-one object: only the three documented fields are allowed.
    // Rejecting extra fields (for example a preview URL) keeps the invariant
    // that RuneSpace never stores a preview URL in this public manifest.
    const allowedKeys = new Set(["summary", "stage", "pullRequestNumber"]);
    for (const key of Object.keys(change)) {
      expect(allowedKeys.has(key), `currentChange has unknown field "${key}"`).toBe(true);
    }
    expectConciseSentence(change.summary, "currentChange.summary");
    expect(ALLOWED_CHANGE_STAGES).toContain(change.stage);
    expect(
      typeof change.pullRequestNumber === "number" &&
        Number.isInteger(change.pullRequestNumber) &&
        change.pullRequestNumber > 0,
      "currentChange.pullRequestNumber must be a positive integer",
    ).toBe(true);
  });
});
