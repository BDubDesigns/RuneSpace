import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Durable Drizzle migration-journal invariant test (Issue #74).
 *
 * Drizzle applies only journal entries whose `folderMillis` is newer than the
 * last recorded applied-migration timestamp. A non-monotonic or equal `when`
 * value can therefore be silently skipped even though `drizzle-kit migrate`
 * exits successfully. This test protects that continuing invariant generically:
 * it does not special-case any single migration, does not connect to
 * PostgreSQL, and does not check whether old migrations have already run. It
 * deliberately reads the journal/file from disk so the parse boundary and the
 * SQL-file parity check are explicit.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const JOURNAL_PATH = resolve(ROOT, "drizzle/meta/_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function readJournalEntries(): JournalEntry[] {
  let text: string;
  try {
    text = readFileSync(JOURNAL_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read Drizzle migration journal at ${JOURNAL_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Drizzle migration journal at ${JOURNAL_PATH} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  expect(parsed !== null && typeof parsed === "object", "journal root must be a JSON object").toBe(
    true,
  );

  const entries = (parsed as { entries?: unknown }).entries;
  expect(entries, "journal.entries must be present").toBeDefined();
  expect(Array.isArray(entries), "journal.entries must be an array").toBe(true);
  expect((entries as unknown[]).length, "journal.entries must not be empty").toBeGreaterThan(0);

  const typed = entries as JournalEntry[];

  // Validate the minimal shape of each entry before relying on it.
  typed.forEach((entry, position) => {
    expect(
      entry !== null && typeof entry === "object",
      `entry at journal position ${position} must be a JSON object`,
    ).toBe(true);
    expect(
      typeof entry.tag === "string" && entry.tag.length > 0,
      `entry at journal position ${position} must have a non-empty string tag`,
    ).toBe(true);
  });

  return typed;
}

describe("Drizzle migration journal invariant", () => {
  it("keeps idx contiguous from 0", () => {
    const entries = readJournalEntries();
    entries.forEach((entry, position) => {
      expect(
        entry.idx,
        `entry at position ${position} (tag "${entry.tag}") must have idx ${position}`,
      ).toBe(position);
    });
  });

  it("keeps every when value a finite integer", () => {
    const entries = readJournalEntries();
    entries.forEach((entry) => {
      expect(
        Number.isFinite(entry.when) && Number.isInteger(entry.when),
        `entry idx ${entry.idx} (tag "${entry.tag}") must have a finite integer 'when', got ${String(
          entry.when,
        )}`,
      ).toBe(true);
    });
  });

  it("keeps when values strictly increasing in journal order", () => {
    const entries = readJournalEntries();
    for (let position = 1; position < entries.length; position += 1) {
      const previous = entries[position - 1]!;
      const current = entries[position]!;
      expect(
        current.when > previous.when,
        `entry idx ${current.idx} (tag "${current.tag}") 'when' ${current.when} must be strictly ` +
          `greater than the previous entry idx ${previous.idx} (tag "${previous.tag}") 'when' ${previous.when}`,
      ).toBe(true);
    }
  });

  it("keeps migration tags unique", () => {
    const entries = readJournalEntries();
    const seen = new Map<string, number>();
    for (const entry of entries) {
      const prior = seen.get(entry.tag);
      if (prior !== undefined) {
        expect.fail(`duplicate migration tag "${entry.tag}" at idx ${prior} and idx ${entry.idx}`);
      }
      seen.set(entry.tag, entry.idx);
    }
  });

  it("has a committed SQL file for every journal tag", () => {
    const entries = readJournalEntries();
    for (const entry of entries) {
      expect(
        existsSync(resolve(ROOT, "drizzle", `${entry.tag}.sql`)),
        `migration tag "${entry.tag}" (idx ${entry.idx}) has no committed drizzle/${entry.tag}.sql file`,
      ).toBe(true);
    }
  });
});
