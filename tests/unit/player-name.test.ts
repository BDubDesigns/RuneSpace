import { describe, expect, it } from "vitest";
import {
  PLAYER_NAME_ERRORS,
  isReservedPlayerName,
  normalizePlayerNameDisplay,
  playerNameKey,
  validatePlayerName,
} from "@/game/domain/player-name";

/**
 * Pure Player-name rules (issue #221). The database unique index on the key
 * and the Better Auth Username plugin both depend on these functions, so the
 * collision, normalization, and impersonation behavior is proved here.
 */

describe("normalizePlayerNameDisplay / playerNameKey", () => {
  it("preserves chosen capitalization for display but folds it for the key", () => {
    expect(normalizePlayerNameDisplay("BDubDesigns")).toBe("BDubDesigns");
    expect(playerNameKey("Brandon")).toBe(playerNameKey("brandon"));
    expect(playerNameKey("BRANDON")).toBe("brandon");
  });

  it("applies NFKC so full-width and decomposed forms collide", () => {
    expect(playerNameKey("Ｂｒａｎｄｏｎ")).toBe("brandon");
    expect(playerNameKey("Jose\u0301")).toBe(playerNameKey("José"));
  });

  it("collapses whitespace runs and strips control / zero-width characters", () => {
    expect(normalizePlayerNameDisplay("  Brandon \t\n Werner  ")).toBe("Brandon Werner");
    expect(playerNameKey("Bran\u200Bdon")).toBe("brandon");
    expect(playerNameKey("Bran\u2060don\uFEFF")).toBe("brandon");
    expect(playerNameKey("Bran\u0007don")).toBe("brandon");
  });

  it("folds typographic apostrophes so phone-typed names collide", () => {
    expect(normalizePlayerNameDisplay("O\u2019Brien")).toBe("O'Brien");
    expect(playerNameKey("O\u2019Brien")).toBe(playerNameKey("o'brien"));
  });

  it("is idempotent", () => {
    const once = normalizePlayerNameDisplay(" Ｊosé  O\u2019Neil ");
    expect(normalizePlayerNameDisplay(once)).toBe(once);
    expect(playerNameKey(playerNameKey("Ｊosé"))).toBe(playerNameKey("Ｊosé"));
  });
});

describe("validatePlayerName", () => {
  it.each([
    "Brandon Werner",
    "BDubDesigns",
    "José",
    "Łucja",
    "राह\u0941ल",
    "さくら",
    "Ана Мария",
    "Rae_42",
  ])("accepts %s", (name) => {
    const result = validatePlayerName(name);
    expect(result).toEqual({
      ok: true,
      display: normalizePlayerNameDisplay(name),
      key: playerNameKey(name),
    });
  });

  it("returns the preserved display form and the folded key", () => {
    expect(validatePlayerName("  Brandon   Werner ")).toEqual({
      ok: true,
      display: "Brandon Werner",
      key: "brandon werner",
    });
  });

  it("enforces 3–20 characters counted as code points, after normalization", () => {
    expect(validatePlayerName("Al")).toEqual({ ok: false, error: PLAYER_NAME_ERRORS.tooShort });
    expect(validatePlayerName(" A\u200Bl ")).toEqual({
      ok: false,
      error: PLAYER_NAME_ERRORS.tooShort,
    });
    expect(validatePlayerName("Abc").ok).toBe(true);
    expect(validatePlayerName("a".repeat(20)).ok).toBe(true);
    expect(validatePlayerName("a".repeat(21))).toEqual({
      ok: false,
      error: PLAYER_NAME_ERRORS.tooLong,
    });
    // Astral-plane letters are one character each, not two UTF-16 units.
    expect(validatePlayerName("𝒜".repeat(3)).ok).toBe(true);
  });

  it("allows only letters, numbers, space, _, -, apostrophe, and period", () => {
    expect(validatePlayerName("Rae-Lynn O'Neil").ok).toBe(true);
    expect(validatePlayerName("J. R. Smith").ok).toBe(true);
    for (const invalid of ["Bran!don", "Bran@don", "Bran/don", "Bran🙂don", "<script>"]) {
      expect(validatePlayerName(invalid)).toEqual({
        ok: false,
        error: PLAYER_NAME_ERRORS.characters,
      });
    }
  });

  it("rejects punctuation-only names", () => {
    for (const name of ["....", "---", "_ _", "' . -"]) {
      expect(validatePlayerName(name)).toEqual({
        ok: false,
        error: PLAYER_NAME_ERRORS.letterOrNumber,
      });
    }
  });

  it("rejects a name that begins with a detached combining mark", () => {
    expect(validatePlayerName("\u0301abc")).toEqual({
      ok: false,
      error: PLAYER_NAME_ERRORS.characters,
    });
  });

  it("rejects reserved authority names", () => {
    expect(validatePlayerName("Admin")).toEqual({ ok: false, error: PLAYER_NAME_ERRORS.reserved });
  });
});

describe("isReservedPlayerName", () => {
  it.each([
    "Admin",
    "Administrator",
    "Moderator",
    "Mod",
    "GM",
    "Game Master",
    "GameMaster",
    "Staff",
    "Support",
    "Operator",
    "Owner",
    "RuneSpace",
    "Rune Space",
    "RUNESPACE",
    "QC Failed",
    "QCFailed",
    "Q.C. Failed",
    "qc_failed",
  ])("protects the authority name %s", (name) => {
    expect(isReservedPlayerName(name)).toBe(true);
  });

  it.each([
    "Mod Mike",
    "Admin_Bob",
    "AdminBob",
    "adminbob",
    "Bob the Admin",
    "RuneSpace Fan",
    "Official Staff",
    "Support Team",
    "Gm Bob",
    "Sysadmin",
  ])("protects the authority phrase %s", (name) => {
    expect(isReservedPlayerName(name)).toBe(true);
  });

  it.each([
    "Adm1n",
    "4dmin",
    "Аdmin", // Cyrillic А
    "Ådmin",
    "Moderatоr", // Cyrillic о
    "0wner",
    "5taff",
    "A d m i n",
    "Runespаce", // Cyrillic а
    "QC Fai1ed",
    "Gamernaster", // rn read as m
  ])("blocks the evasion variant %s", (name) => {
    expect(isReservedPlayerName(name)).toBe(true);
  });

  it.each([
    "ModularMike",
    "Modest",
    "Staffan",
    "Downer",
    "Cooperator",
    "Supporter Sam",
    "Brandon Werner",
    "BDubDesigns",
    "Admiral Rae",
    "Badminton Pro",
    "Rune",
    "Spacer",
    "Ogmund",
    "Failed Hero",
    "Qwen",
  ])("does not falsely reject %s", (name) => {
    expect(isReservedPlayerName(name)).toBe(false);
  });
});
