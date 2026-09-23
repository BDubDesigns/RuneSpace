import { projectCharacterProgression } from "./character-progression";
import type { LevelThreshold } from "./progression";

/**
 * Public location-population projection (issue #62).
 *
 * The server query returns matching characters with their persisted per-skill
 * XP rows; this pure boundary reduces them to the narrow approved public
 * shape. It never invents a formula or a level column.
 *
 * The listed level is the canonical Character Level (#213), derived through
 * `projectCharacterProgression` — the same rule the profile a player opens
 * from this list shows, and the same rule the player's own Character surface
 * shows. Before #213 this list published the Mining level under the bare label
 * "Level", which meant the row and the profile it opened could disagree about
 * what a character's level was. A character with no XP rows at all is
 * authoritative zero XP in every skill, which is Character Level 1.
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
  /**
   * The owning account's canonical Player name (Better Auth Username-plugin
   * `displayUsername`, issue #221). Null only for an account created before
   * Player names existed and not yet migrated by the one-time cutover.
   */
  ownerName: string | null;
  /**
   * One persisted skill-XP row for the character. A character with no rows at
   * all appears once with nulls (authoritative zero in every skill); a
   * character with rows appears once per row.
   */
  skillId: string | null;
  totalXp: number | null;
};

/** One approved public character entry at a location. */
export type LocationPopulationEntry = {
  displayName: string;
  level: number;
  ownerName: string | null;
};

/**
 * Project matching-character rows into the approved public population list:
 * excludes the active character, derives levels through the existing
 * progression boundary, sorts deterministically by normalized name then stable
 * character ID, and returns only the public fields.
 */
export function projectLocationPopulation(input: {
  activeCharacterId: string;
  /** One row per persisted skill-XP row; see `LocationPopulationRow`. */
  rows: readonly LocationPopulationRow[];
  levelThresholds: (skillId: string) => readonly LevelThreshold[] | undefined;
  skillDisplayName: (skillId: string) => string | undefined;
}): readonly LocationPopulationEntry[] {
  // The left join repeats a character's identity once per skill-XP row, so
  // fold the rows back into one character with one XP set before projecting.
  const byCharacterId = new Map<
    string,
    { row: LocationPopulationRow; skillXp: { skillId: string; totalXp: number }[] }
  >();
  for (const row of input.rows) {
    const character = byCharacterId.get(row.characterId) ?? { row, skillXp: [] };
    if (row.skillId !== null && row.totalXp !== null) {
      character.skillXp.push({ skillId: row.skillId, totalXp: row.totalXp });
    }
    byCharacterId.set(row.characterId, character);
  }

  // Sort before projection so stable character IDs can break ties; the public
  // entries themselves carry no IDs. The folded comparison key is the
  // repository's global-uniqueness convention (case-insensitive, deterministic).
  const sorted = [...byCharacterId.values()]
    .map((character) => character.row)
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
    level: projectCharacterProgression({
      skillXp: byCharacterId.get(row.characterId)?.skillXp ?? [],
      levelThresholds: input.levelThresholds,
      skillDisplayName: input.skillDisplayName,
    }).characterLevel,
    ownerName: row.ownerName,
  }));
}
