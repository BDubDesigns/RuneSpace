/**
 * Character-name domain rules (single source of truth for name handling).
 *
 * These are pure, server-authoritative rules — no UI, no persistence. They are
 * the ONLY place that decides:
 *  - how a submitted name is validated,
 *  - how the canonical "normalized" comparison key is derived, and
 *  - that the player-facing display capitalization is preserved.
 *
 * Why this matters (issue #6): character names must be globally unique, but the
 * same name typed with different capitalization/whitespace (or Unicode
 * equivalences like full-width vs half-width, composed vs decomposed accents)
 * must still be treated as a collision. We derive one canonical key
 * (`normalizeCharacterName`) used for the unique database constraint, while
 * storing the original `displayName` untouched for presentation.
 */

import { z } from "zod";

export const CHARACTER_NAME_MIN = 2;
export const CHARACTER_NAME_MAX = 24;

/** Allowed characters: Unicode letters/digits, spaces, and a small punctuation set. */
const ALLOWED = /^[\p{L}\p{N} _.'-]+$/u;

const displayNameSchema = z
  .string()
  .trim()
  .min(CHARACTER_NAME_MIN, `Name must be at least ${CHARACTER_NAME_MIN} characters`)
  .max(CHARACTER_NAME_MAX, `Name must be at most ${CHARACTER_NAME_MAX} characters`);

/**
 * Derive the canonical comparison key for a character name.
 *
 * Steps (deterministic, locale-independent, reversible-insensitive):
 *  1. Trim surrounding whitespace.
 *  2. Unicode NFKC normalization (compatibility equivalence: full-width →
 *     half-width, composed/decomposed accents unified, etc.).
 *  3. Lowercase (case-insensitive uniqueness).
 *  4. Strip control characters and zero-width spaces.
 *  5. Collapse internal whitespace runs to a single space, then trim again.
 */
export function normalizeCharacterName(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const nfkc = trimmed.normalize("NFKC");
  const lower = nfkc.toLowerCase();
  // Collapse any whitespace runs (incl. tabs/newlines) to a single space.
  const spaced = lower.replace(/\s+/g, " ");
  // Strip control chars and zero-width spaces; drop anything non-allowed.
  const cleaned = spaced
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N} _.'-]/gu, "");
  return cleaned.trim();
}

export type CharacterNameValidation =
  | { ok: true; display: string; normalized: string }
  | { ok: false; error: string };

/**
 * Validate a raw name input and produce both the preserved display form and the
 * normalized comparison key. Returns a discriminated result so the UI and the
 * server share one validation path and one error-message vocabulary. The browser
 * can never bypass this — it runs again server-side on every creation.
 */
export function validateCharacterName(raw: string): CharacterNameValidation {
  const parsed = displayNameSchema.safeParse(raw);
  if (!parsed.success) {
    const error = parsed.error.issues[0]?.message ?? "Invalid character name";
    return { ok: false, error };
  }
  const display = parsed.data; // trimmed, length-bounded

  if (!ALLOWED.test(display)) {
    return {
      ok: false,
      error: "Name can only contain letters, numbers, spaces, and . ' - _",
    };
  }
  if (
    display
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "").length === 0
  ) {
    return { ok: false, error: "Name must contain at least one letter or number" };
  }

  return { ok: true, display, normalized: normalizeCharacterName(display) };
}
