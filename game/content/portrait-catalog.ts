import { PORTRAIT_IDS, type PortraitId } from "@/game/config/foundations";
import { PortraitDefinitionSchema, type PortraitDefinition } from "@/game/schemas/portraits";
import portraitCatalogData from "./portrait-catalog.json";

/**
 * The authoritative character portrait catalog (issue #70). Server validation,
 * UI projection, and issue #65's picker all read from this registry. Launch
 * availability comes from the category metadata, never from folder separation
 * or filenames.
 *
 * Stable portrait IDs are code-owned in game/config/foundations.ts
 * (PORTRAIT_IDS), following the repository's identity convention; this catalog
 * references those IDs and asserts at import time that every catalog entry is
 * a registered identity. The JSON file is the machine-readable content source
 * consumed by both this module and the repository-side optimization tooling.
 *
 * All 25 staged portraits were visually inspected and accepted; none were
 * rejected or superseded. The catalog carries exactly the approved launch
 * set: ten player-starter entries, baker and milkman as npc-only, and the
 * remaining thirteen accepted portraits as reserved.
 */
export const PLAYER_STARTER_SET_SIZE = 10;

/** NPC-only identities approved by the product owner for the recipe-quest parody. */
export const NPC_ONLY_PORTRAIT_IDS = [PORTRAIT_IDS.baker, PORTRAIT_IDS.milkman] as const;

const portraitDefinitions: readonly PortraitDefinition[] = portraitCatalogData.map((entry) =>
  PortraitDefinitionSchema.parse(entry),
);

/**
 * Structural invariants of the approved catalog. These are pure data
 * assertions (no filesystem access) so the catalog stays safe to import
 * anywhere; path/existence checks live in tests and tooling.
 */
export function assertPortraitCatalogIntegrity(portraits: readonly PortraitDefinition[]): void {
  const registeredIds = new Set(Object.values(PORTRAIT_IDS));
  const ids = new Set<string>();
  const masterPaths = new Set<string>();
  const derivativePaths = new Set<string>();
  for (const portrait of portraits) {
    if (!registeredIds.has(portrait.id)) {
      throw new Error(`Catalog entry ${portrait.id} is not a registered PORTRAIT_IDS identity`);
    }
    if (ids.has(portrait.id)) {
      throw new Error(`Duplicate portrait id ${portrait.id}`);
    }
    ids.add(portrait.id);
    if (masterPaths.has(portrait.masterPath)) {
      throw new Error(`Duplicate portrait master path ${portrait.masterPath}`);
    }
    masterPaths.add(portrait.masterPath);
    if (derivativePaths.has(portrait.derivativePath)) {
      throw new Error(`Duplicate portrait derivative path ${portrait.derivativePath}`);
    }
    derivativePaths.add(portrait.derivativePath);
  }

  const starterCount = portraits.filter(
    (portrait) => portrait.category === "player-starter",
  ).length;
  if (starterCount !== PLAYER_STARTER_SET_SIZE) {
    throw new Error(
      `Approved player-starter set must contain exactly ${PLAYER_STARTER_SET_SIZE} portraits, found ${starterCount}`,
    );
  }
}

assertPortraitCatalogIntegrity(portraitDefinitions);

/** The full ordered portrait catalog (explicit deterministic ordering). */
export const PORTRAITS: readonly PortraitDefinition[] = portraitDefinitions;

/** The ordered selectable subset: player-starter entries only (issue #65). */
export const PLAYER_STARTER_PORTRAITS: readonly PortraitDefinition[] = portraitDefinitions.filter(
  (portrait) => portrait.category === "player-starter",
);

const portraitById = new Map<string, PortraitDefinition>(
  portraitDefinitions.map((portrait) => [portrait.id, portrait]),
);

/** Resolve a portrait from the authoritative catalog by stable ID. */
export function getPortrait(portraitId: string): PortraitDefinition | undefined {
  return portraitById.get(portraitId);
}

/** Whether the supplied ID is selectable in the initial player portrait picker. */
export function isPlayerStarterPortrait(portraitId: string): boolean {
  return getPortrait(portraitId)?.category === "player-starter";
}

export type { PortraitDefinition, PortraitLaunchCategory } from "@/game/schemas/portraits";
export type { PortraitId };
