import { describe, it, expect } from "vitest";
import {
  normalizeCharacterName,
  validateCharacterName,
  CHARACTER_NAME_MIN,
  CHARACTER_NAME_MAX,
} from "@/game/domain/character-name";

/**
 * Unit coverage for the single source of truth for character-name handling.
 * Pure functions, no database — these prove the uniqueness/normalization rules
 * and display-capitalization preservation that the DB unique index relies on.
 */

describe("normalizeCharacterName", () => {
  it("folds case so equivalent names collide", () => {
    expect(normalizeCharacterName("Aether")).toBe(normalizeCharacterName("aether"));
    expect(normalizeCharacterName("Star Drifter")).toBe(normalizeCharacterName("STAR DRIFTER"));
  });

  it("trims and collapses internal whitespace", () => {
    expect(normalizeCharacterName("  Star   Drifter  ")).toBe("star drifter");
    expect(normalizeCharacterName("Star\t\nDrifter")).toBe("star drifter");
  });

  it("unifies Unicode equivalence (NFKC)", () => {
    // Full-width and composed/decomposed accents normalize to the same key.
    expect(normalizeCharacterName("Ｓｔａｒ")).toBe("star");
    expect(normalizeCharacterName("é".normalize("NFC"))).toBe(
      normalizeCharacterName("é".normalize("NFD")),
    );
    expect(normalizeCharacterName("Stär")).toBe("stär");
  });

  it("strips control and zero-width characters", () => {
    expect(normalizeCharacterName("Sta\u200Br")).toBe("star");
    expect(normalizeCharacterName("Sta\u0000r")).toBe("star");
  });
});

describe("validateCharacterName", () => {
  it("preserves the original display capitalization", () => {
    const result = validateCharacterName("Stär Drifter");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.display).toBe("Stär Drifter");
      expect(result.normalized).toBe("stär drifter");
    }
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateCharacterName("").ok).toBe(false);
    expect(validateCharacterName("   ").ok).toBe(false);
  });

  it("enforces length bounds", () => {
    expect(validateCharacterName("a").ok).toBe(false);
    const tooLong = "x".repeat(CHARACTER_NAME_MAX + 1);
    expect(validateCharacterName(tooLong).ok).toBe(false);
    expect(validateCharacterName("ab").ok).toBe(true);
    const exact = "x".repeat(CHARACTER_NAME_MAX);
    expect(validateCharacterName(exact).ok).toBe(true);
  });

  it("rejects disallowed characters but allows the small punctuation set", () => {
    expect(validateCharacterName("Rogue@Name").ok).toBe(false);
    expect(validateCharacterName("Name#1").ok).toBe(false);
    expect(validateCharacterName("O'Brien").ok).toBe(true);
    expect(validateCharacterName("Star-Lord").ok).toBe(true);
    expect(validateCharacterName("Doc.Who").ok).toBe(true);
    expect(validateCharacterName("snake_case").ok).toBe(true);
  });

  it("requires at least one letter or number", () => {
    expect(validateCharacterName("....").ok).toBe(false);
    expect(validateCharacterName("..a..").ok).toBe(true);
  });

  it("treats differently-cased names as the same collision key", () => {
    const a = validateCharacterName("VoidWalker");
    const b = validateCharacterName("voidwalker");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.normalized).toBe(b.normalized);
      // but display capitalization is preserved independently
      expect(a.display).toBe("VoidWalker");
      expect(b.display).toBe("voidwalker");
    }
  });

  it("treats whitespace variants as the same collision key", () => {
    const a = validateCharacterName("Star Drifter");
    const b = validateCharacterName("  star   drifter  ");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.normalized).toBe(b.normalized);
      expect(b.display).toBe("star   drifter");
    }
  });

  it("is bounded by the exported min/max constants", () => {
    expect(CHARACTER_NAME_MIN).toBe(2);
    expect(CHARACTER_NAME_MAX).toBe(24);
  });
});
