import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import {
  NPC_ONLY_PORTRAIT_IDS,
  PLAYER_STARTER_PORTRAITS,
  PLAYER_STARTER_SET_SIZE,
  PORTRAITS,
  getPortrait,
  isPlayerStarterPortrait,
} from "@/game/content/portrait-catalog";
import { PORTRAIT_LAUNCH_CATEGORIES } from "@/game/schemas/portraits";

/** The approved launch set in the issue's own order (deterministic ordering). */
const EXPECTED_STARTER_IDS = [
  PORTRAIT_IDS.evaSalvageWelder,
  PORTRAIT_IDS.cargoPilot,
  PORTRAIT_IDS.orbitalBotanist,
  PORTRAIT_IDS.stationCaptain,
  PORTRAIT_IDS.frontierMedic,
  PORTRAIT_IDS.zeroGRockStar,
  PORTRAIT_IDS.gramma,
  PORTRAIT_IDS.grampa,
  PORTRAIT_IDS.zeroGGymnast,
  PORTRAIT_IDS.spaceNerd,
] as const;

const repoRoot = process.cwd();

describe("issue #70 portrait catalog content", () => {
  it("contains exactly the approved 25 accepted portraits with unique stable IDs", () => {
    expect(PORTRAITS).toHaveLength(25);
    const ids = PORTRAITS.map((portrait) => portrait.id);
    expect(new Set(ids).size).toBe(25);
  });

  it("catalog IDs match the foundations PORTRAIT_IDS registry exactly (SSOT parity)", () => {
    expect(new Set(PORTRAITS.map((portrait) => portrait.id))).toEqual(
      new Set(Object.values(PORTRAIT_IDS)),
    );
  });

  it("classifies every portrait into exactly one launch category", () => {
    for (const portrait of PORTRAITS) {
      expect(PORTRAIT_LAUNCH_CATEGORIES).toContain(portrait.category);
    }
  });

  it("defines exactly ten player-starter portraits", () => {
    const starters = PORTRAITS.filter((portrait) => portrait.category === "player-starter");
    expect(starters).toHaveLength(PLAYER_STARTER_SET_SIZE);
    expect(starters.map((portrait) => portrait.id).sort()).toEqual(
      [...EXPECTED_STARTER_IDS].sort(),
    );
  });

  it("preserves baker and milkman as the only npc-only portraits", () => {
    const npcOnly = PORTRAITS.filter((portrait) => portrait.category === "npc-only");
    expect(npcOnly.map((portrait) => portrait.id).sort()).toEqual(
      [...NPC_ONLY_PORTRAIT_IDS].sort(),
    );
    expect(getPortrait(PORTRAIT_IDS.baker)?.category).toBe("npc-only");
    expect(getPortrait(PORTRAIT_IDS.milkman)?.category).toBe("npc-only");
  });

  it("keeps the remaining accepted portraits reserved", () => {
    const reserved = PORTRAITS.filter((portrait) => portrait.category === "reserved");
    expect(reserved).toHaveLength(13);
  });

  it("exposes only the ten starters as the selectable subset", () => {
    expect(PLAYER_STARTER_PORTRAITS.map((portrait) => portrait.id)).toEqual([
      ...EXPECTED_STARTER_IDS,
    ]);
    expect(isPlayerStarterPortrait(PORTRAIT_IDS.baker)).toBe(false);
    expect(isPlayerStarterPortrait(PORTRAIT_IDS.milkman)).toBe(false);
    expect(isPlayerStarterPortrait(PORTRAIT_IDS.vonScavenger)).toBe(false);
    expect(isPlayerStarterPortrait(PORTRAIT_IDS.zeroGBallerina)).toBe(false);
    expect(isPlayerStarterPortrait("unknown_portrait")).toBe(false);
  });

  it("keeps deterministic explicit ordering", () => {
    // Catalog order: the ten starters in the issue's approved order, then the
    // two NPC-only portraits, then reserved entries alphabetically by id.
    const ids = PORTRAITS.map((portrait) => portrait.id);
    expect(ids.slice(0, 10)).toEqual([...EXPECTED_STARTER_IDS]);
    expect(ids.slice(10, 12)).toEqual([...NPC_ONLY_PORTRAIT_IDS]);
    const reserved = ids.slice(12);
    expect(reserved).toEqual([...reserved].sort());
  });

  it("uses concept-based names and never ethnicity-based IDs or names", () => {
    const ethnicityTerms =
      /african|latina|latino|hispanic|asian|muslim|caucasian|ethnic|black-|white-|indian|arab|european/i;
    for (const portrait of PORTRAITS) {
      expect(portrait.id).not.toMatch(ethnicityTerms);
      expect(portrait.displayName).not.toMatch(ethnicityTerms);
      expect(portrait.concept).not.toMatch(ethnicityTerms);
    }
  });

  it("never encodes launch categories in filenames or paths", () => {
    for (const portrait of PORTRAITS) {
      expect(portrait.masterPath).not.toMatch(/player-starter|npc-only|reserved/);
      expect(portrait.derivativePath).not.toMatch(/player-starter|npc-only|reserved/);
    }
  });

  it("keeps masters outside public/ and derivatives under the canonical public path", () => {
    for (const portrait of PORTRAITS) {
      expect(portrait.masterPath.startsWith("public/")).toBe(false);
      expect(portrait.derivativePath.startsWith("/character-portraits/")).toBe(true);
    }
  });

  it("declares consistent square derivative dimensions", () => {
    for (const portrait of PORTRAITS) {
      expect(portrait.derivativeWidth).toBe(512);
      expect(portrait.derivativeHeight).toBe(512);
      expect(portrait.accessibleDescription.length).toBeGreaterThan(0);
    }
  });
});

describe("issue #70 portrait asset tree", () => {
  it("has every catalog master and derivative present on disk", () => {
    for (const portrait of PORTRAITS) {
      expect(existsSync(join(repoRoot, portrait.masterPath))).toBe(true);
      expect(existsSync(join(repoRoot, "public", portrait.derivativePath))).toBe(true);
    }
  });

  it("contains exactly the cataloged PNG masters and no unreferenced masters", () => {
    const masters = readdirSync(join(repoRoot, "assets/character-portraits")).filter((file) =>
      file.endsWith(".png"),
    );
    expect(masters).toHaveLength(25);
    const cataloged = new Set(PORTRAITS.map((portrait) => portrait.masterPath.split("/").at(-1)));
    expect(new Set(masters)).toEqual(cataloged);
  });

  it("contains exactly the cataloged WebP derivatives and no unreferenced derivatives", () => {
    const derivatives = readdirSync(join(repoRoot, "public/character-portraits")).filter(
      (file) => file !== "README.md" && file.endsWith(".webp"),
    );
    expect(derivatives).toHaveLength(25);
    const cataloged = new Set(
      PORTRAITS.map((portrait) => portrait.derivativePath.split("/").at(-1)),
    );
    expect(new Set(derivatives)).toEqual(cataloged);
  });

  it("ships no root-level staging files and no staging folder", () => {
    const rootStaging = readdirSync(repoRoot).filter((file) => /^file_.*\.png$/.test(file));
    expect(rootStaging).toEqual([]);
    expect(existsSync(join(repoRoot, "portrait-staging"))).toBe(false);
  });

  it("keeps the labeled contact sheet as committed review evidence", () => {
    const contactSheet = join(repoRoot, "docs/assets/portrait-contact-sheet.png");
    expect(existsSync(contactSheet)).toBe(true);
    expect(statSync(contactSheet).size).toBeGreaterThan(100_000);
  });
});
