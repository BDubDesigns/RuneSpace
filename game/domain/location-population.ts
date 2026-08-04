import { levelFromXp, type LevelThreshold } from "./progression";

/**
 * Public location-population projection (issue #62).
 *
 * The server query returns matching characters with their persisted total
 * Mining XP; this pure boundary derives each character's level through the
 * existing authoritative progression rule (`levelFromXp`) and reduces the rows
 * to the narrow approved public shape. It never invents a formula or a level
 * column: a character with no Mining XP row is treated as zero XP (level 1).
 *
 * Identity and ordering use stable character IDs; the public projection itself
 * contains only the approved player-facing fields (character name, derived
 * level, owner/player name) — no emails, account IDs, or character database
 * IDs leave the server.
 */

/** One server-returned row ready for projection (not yet a public entry). */
export type LocationPopulationRow = {
  /** Stable character database ID — used for identity/ordering only. */
  characterId: string;
  /** Globally unique player-facing character name. */
  displayName: string;
  /** Folded comparison key; the repository's global-uniqueness convention. */
  normalizedName: string;
  /** Better Auth user.name of the owning player account. */
  ownerName: string;
  /**
   * Persisted total Mining XP for the character, or null when the character
   * has no XP row (authoritative zero).
   */
  totalXp: number | null;
};

/** One approved public character entry at a location. */
export type LocationPopulationEntry = {
  displayName: string;
  level: number;
  ownerName: string;
};

/**
 * Project matching-character rows into the approved public population list:
 * excludes the active character, derives levels through the existing
 * progression boundary, sorts deterministically by normalized name then stable
 * character ID, and returns only the public fields.
 */
export function projectLocationPopulation(input: {
  activeCharacterId: string;
  rows: readonly LocationPopulationRow[];
  thresholds: readonly LevelThreshold[];
}): readonly LocationPopulationEntry[] {
  // Sort before projection so stable character IDs can break ties; the public
  // entries themselves carry no IDs. The folded comparison key is the
  // repository's global-uniqueness convention (case-insensitive, deterministic).
  const sorted = [...input.rows]
    .filter((row) => row.characterId !== input.activeCharacterId)
    .sort((first, second) => {
      if (first.normalizedName !== second.normalizedName) {
        return first.normalizedName < second.normalizedName ? -1 : 1;
      }
      return first.characterId < second.characterId
        ? -1
        : first.characterId > second.characterId
          ? 1
          : 0;
    });
  return sorted.map((row) => ({
    displayName: row.displayName,
    level: levelFromXp(row.totalXp ?? 0, input.thresholds),
    ownerName: row.ownerName,
  }));
}
