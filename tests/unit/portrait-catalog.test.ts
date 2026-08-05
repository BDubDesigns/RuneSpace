import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
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

/**
 * The approved launch set in the issue's own order. This order is the
 * deterministic picker order for issue #65 and the only ordering the runtime
 * depends on; reserved entries keep no required internal ordering.
 */
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

/**
 * Neutral canonical identity format: portrait_<concept>_<nn> in lowercase
 * snake_case. The concept-first naming policy itself is a documentation and
 * human-review matter (see docs/portrait-asset-inventory.md), not a regex.
 */
const PORTRAIT_ID_FORMAT = /^portrait_[a-z0-9]+(?:_[a-z0-9]+)*_\d{2}$/;

const repoRoot = process.cwd();

describe("issue #70 portrait catalog content", () => {
  it("catalog IDs match the code-owned PORTRAIT_IDS registry exactly, with unique identities and paths", () => {
    expect(new Set(PORTRAITS.map((portrait) => portrait.id))).toEqual(
      new Set(Object.values(PORTRAIT_IDS)),
    );
    const ids = PORTRAITS.map((portrait) => portrait.id);
    expect(new Set(ids).size).toBe(ids.length);
    const masterPaths = PORTRAITS.map((portrait) => portrait.masterPath);
    expect(new Set(masterPaths).size).toBe(masterPaths.length);
    const derivativePaths = PORTRAITS.map((portrait) => portrait.derivativePath);
    expect(new Set(derivativePaths).size).toBe(derivativePaths.length);
  });

  it("defines exactly the ten approved player-starter identities in approved picker order", () => {
    expect(PLAYER_STARTER_PORTRAITS).toHaveLength(PLAYER_STARTER_SET_SIZE);
    expect(PLAYER_STARTER_PORTRAITS.map((portrait) => portrait.id)).toEqual([
      ...EXPECTED_STARTER_IDS,
    ]);
  });

  it("preserves baker and milkman as the only npc-only portraits", () => {
    const npcOnly = PORTRAITS.filter((portrait) => portrait.category === "npc-only").map(
      (portrait) => portrait.id,
    );
    expect(new Set(npcOnly)).toEqual(new Set(NPC_ONLY_PORTRAIT_IDS));
    expect(getPortrait(PORTRAIT_IDS.baker)?.category).toBe("npc-only");
    expect(getPortrait(PORTRAIT_IDS.milkman)?.category).toBe("npc-only");
  });

  it("selection helpers expose starter-only selection", () => {
    for (const id of EXPECTED_STARTER_IDS) {
      expect(isPlayerStarterPortrait(id)).toBe(true);
    }
    expect(
      PLAYER_STARTER_PORTRAITS.every((portrait) => portrait.category === "player-starter"),
    ).toBe(true);
    expect(isPlayerStarterPortrait(PORTRAIT_IDS.baker)).toBe(false);
    expect(isPlayerStarterPortrait(PORTRAIT_IDS.milkman)).toBe(false);
    expect(isPlayerStarterPortrait(PORTRAIT_IDS.vonScavenger)).toBe(false);
    expect(isPlayerStarterPortrait("unknown_portrait")).toBe(false);
  });

  it("canonical IDs and filenames follow the neutral concept format", () => {
    for (const portrait of PORTRAITS) {
      expect(portrait.id).toMatch(PORTRAIT_ID_FORMAT);
      const canonicalKebab = portrait.id.replaceAll("_", "-");
      expect(portrait.masterPath.split("/").at(-1)).toBe(`${canonicalKebab}.png`);
      expect(portrait.derivativePath.split("/").at(-1)).toBe(`${canonicalKebab}.webp`);
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

  it("declares expected derivative metadata and accessible descriptions", () => {
    for (const portrait of PORTRAITS) {
      expect(portrait.derivativeWidth).toBe(512);
      expect(portrait.derivativeHeight).toBe(512);
      expect(portrait.accessibleDescription.length).toBeGreaterThan(0);
    }
  });
});

describe("issue #70 portrait asset inventory", () => {
  it("every cataloged master and derivative exists, with no missing or orphan assets", () => {
    for (const portrait of PORTRAITS) {
      expect(existsSync(join(repoRoot, portrait.masterPath))).toBe(true);
      expect(existsSync(join(repoRoot, "public", portrait.derivativePath))).toBe(true);
    }
    const masterFiles = readdirSync(join(repoRoot, "assets/character-portraits")).filter((file) =>
      file.endsWith(".png"),
    );
    const derivativeFiles = readdirSync(join(repoRoot, "public/character-portraits")).filter(
      (file) => file.endsWith(".webp"),
    );
    expect(new Set(masterFiles)).toEqual(
      new Set(PORTRAITS.map((portrait) => portrait.masterPath.split("/").at(-1))),
    );
    expect(new Set(derivativeFiles)).toEqual(
      new Set(PORTRAITS.map((portrait) => portrait.derivativePath.split("/").at(-1))),
    );
  });
});
