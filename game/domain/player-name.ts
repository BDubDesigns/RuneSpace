/**
 * Player-name domain rules (issue #221) — the single source of truth for the
 * one persistent public account identity shared by all of a player's
 * characters.
 *
 * Pure and framework-free. Better Auth's official Username plugin stores the
 * result (`user.username` = comparison key, `user.display_username` = preserved
 * presentation) and calls these functions as its validator and normalizers;
 * the registration UI calls the same `validatePlayerName` for early feedback.
 *
 * Rules:
 * - 3–20 characters (Unicode code points) after display normalization;
 * - Unicode letters, combining marks, and numbers, plus space, `_`, `-`,
 *   apostrophe, and period;
 * - at least one letter or number;
 * - globally unique case-insensitively, while the chosen capitalization is
 *   preserved for display;
 * - never a name that reasonably impersonates RuneSpace / QC Failed
 *   authority (see `isReservedPlayerName`).
 *
 * Character names keep their own boundary in `character-name.ts`; unifying the
 * two policies is a later slice.
 */

export const PLAYER_NAME_MIN = 3;
export const PLAYER_NAME_MAX = 20;

/**
 * Control characters, zero-width/bidi format marks, the byte-order mark, and
 * the invisible fillers most often used to make two names look identical
 * while comparing differently.
 */
const INVISIBLE_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g;

/**
 * Typographic apostrophes that phone keyboards substitute automatically. They
 * are folded to the ASCII apostrophe so `O\u2019Brien` and `O'Brien` are one name.
 */
const APOSTROPHE_VARIANTS = /[\u2018\u2019\u02BC]/g;

const ALLOWED = /^[\p{L}\p{M}\p{N} _.'-]+$/u;
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const STARTS_WITH_MARK = /^\p{M}/u;

/**
 * The preserved presentation form: apostrophe variants folded, NFKC,
 * invisible characters stripped, whitespace runs collapsed, trimmed. Case is
 * preserved. Idempotent.
 */
export function normalizePlayerNameDisplay(raw: string): string {
  return (raw ?? "")
    .replace(APOSTROPHE_VARIANTS, "'")
    .normalize("NFKC")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * The canonical, globally unique comparison key: the display form, lowercased.
 * `Brandon` and `brandon` share one key. Idempotent.
 */
export function playerNameKey(raw: string): string {
  return normalizePlayerNameDisplay(raw).toLowerCase();
}

// ---------------------------------------------------------------------------
// Reserved / impersonation names
// ---------------------------------------------------------------------------

/**
 * Protected authority concepts, compared as whole words (or whole runs of
 * adjacent words), never as naive substrings — `ModularMike` must not fail
 * because it contains `mod`.
 */
const AUTHORITY_TERMS = [
  "admin",
  "administrator",
  "mod",
  "moderator",
  "gm",
  "gamemaster",
  "staff",
  "support",
  "operator",
  "owner",
  "runespace",
  "qcfailed",
] as const;

/**
 * Long, distinctive terms that also cannot begin or end a word
 * (`AdminBob`-style fusions typed without a capital letter). Short or common
 * terms (`mod`, `owner`, `operator`, ...) are deliberately excluded so
 * `Modular`, `Downer`, and `Cooperator` stay valid.
 */
const AUTHORITY_AFFIX_TERMS = [
  "admin",
  "administrator",
  "moderator",
  "gamemaster",
  "runespace",
  "qcfailed",
] as const;

/**
 * Obvious Latin look-alikes from Cyrillic and Greek, lowercase. Deliberately a
 * small, targeted table for authority-name evasion — not a general Unicode
 * confusables framework.
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
  а: "a",
  е: "e",
  ё: "e",
  і: "i",
  ї: "i",
  ј: "j",
  к: "k",
  м: "m",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  ѕ: "s",
  ԁ: "d",
  ԛ: "q",
  ԝ: "w",
  ӏ: "i",
  ɡ: "g",
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  ς: "s",
};

/** Digit substitutions, plus `l` folded with `i` because `1`/`l`/`I` are interchangeable. */
const DIGIT_AND_STROKE_LOOKALIKES: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  l: "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

/**
 * Reduce a word to the shape used for authority comparison: lowercase,
 * diacritics removed, look-alikes folded, `rn` read as `m`. Applied to both
 * sides of every comparison, so the protected terms go through it too.
 */
function authoritySkeleton(word: string): string {
  const folded = Array.from(
    word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""),
    (character) => DIGIT_AND_STROKE_LOOKALIKES[character] ?? LOOKALIKES[character] ?? character,
  ).join("");
  return folded.replace(/rn/g, "m");
}

const AUTHORITY_SKELETONS = new Set(AUTHORITY_TERMS.map(authoritySkeleton));
const AUTHORITY_AFFIX_SKELETONS = AUTHORITY_AFFIX_TERMS.map(authoritySkeleton);

/**
 * Split a display name into words: at the allowed separators, at
 * lowercase→uppercase boundaries (`AdminBob` → `Admin`, `Bob`), and at
 * letter↔digit boundaries (`adm1n` → `adm`, `1`, `n`, rejoined below).
 */
function words(display: string): string[] {
  return display
    .split(/[ _.'-]+/u)
    .flatMap((part) => part.split(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u))
    .filter((part) => part.length > 0);
}

/**
 * True when the name reasonably impersonates RuneSpace / QC Failed authority.
 *
 * Every run of adjacent words is rejoined and compared, so separators and
 * spacing cannot hide a protected term (`Q.C. Failed`, `Game Master`,
 * `A d m i n`), while a protected term that is merely a fragment of a larger
 * ordinary word (`ModularMike`, `Staffan`) is not matched.
 */
export function isReservedPlayerName(raw: string): boolean {
  const parts = words(normalizePlayerNameDisplay(raw)).map(authoritySkeleton);
  for (let start = 0; start < parts.length; start += 1) {
    let joined = "";
    for (let end = start; end < parts.length; end += 1) {
      joined += parts[end];
      if (AUTHORITY_SKELETONS.has(joined)) return true;
      if (
        AUTHORITY_AFFIX_SKELETONS.some((term) => joined.startsWith(term) || joined.endsWith(term))
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type PlayerNameValidation =
  | { ok: true; display: string; key: string }
  | { ok: false; error: string };

export const PLAYER_NAME_ERRORS = {
  tooShort: `Player name must be at least ${PLAYER_NAME_MIN} characters.`,
  tooLong: `Player name must be at most ${PLAYER_NAME_MAX} characters.`,
  characters: "Player name can only contain letters, numbers, spaces, and _ - ' .",
  letterOrNumber: "Player name must contain at least one letter or number.",
  reserved: "That Player name is reserved. Please choose another.",
} as const;

/**
 * Validate a raw Player name. Returns the preserved display form and the
 * unique comparison key, or the first player-facing error. The server runs
 * this again on every write; the browser's copy is only early feedback.
 */
export function validatePlayerName(raw: string): PlayerNameValidation {
  const display = normalizePlayerNameDisplay(raw);
  const length = Array.from(display).length;
  if (length < PLAYER_NAME_MIN) return { ok: false, error: PLAYER_NAME_ERRORS.tooShort };
  if (length > PLAYER_NAME_MAX) return { ok: false, error: PLAYER_NAME_ERRORS.tooLong };
  if (!ALLOWED.test(display) || STARTS_WITH_MARK.test(display)) {
    return { ok: false, error: PLAYER_NAME_ERRORS.characters };
  }
  if (!HAS_LETTER_OR_NUMBER.test(display)) {
    return { ok: false, error: PLAYER_NAME_ERRORS.letterOrNumber };
  }
  if (isReservedPlayerName(display)) return { ok: false, error: PLAYER_NAME_ERRORS.reserved };
  return { ok: true, display, key: display.toLowerCase() };
}
