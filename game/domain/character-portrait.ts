import {
  PLAYER_STARTER_PORTRAITS,
  PLAYER_UNLOCKABLE_PORTRAITS,
  getPortrait,
} from "@/game/content/portrait-catalog";

/**
 * Character portrait resolution and projection (issue #65).
 *
 * One narrow server-side boundary that separates a player's deliberate
 * portrait choice from the neutral system placeholder:
 *
 * - A stored value is honored ONLY when it is a currently selectable
 *   `player-starter` catalog ID or an owned `player-unlockable` catalog ID.
 *   `npc-only`, `reserved`, unknown, malformed, retired, unowned unlockable,
 *   and null values all resolve to the neutral placeholder.
 * - Resolution NEVER rewrites the database row: a stale or retired stored ID
 *   renders safely as the placeholder until its owner deliberately changes it.
 * - The neutral placeholder is deliberately NOT a catalog portrait: it is
 *   never selectable and is never persisted as though the player chose it.
 * - Only approved safe presentation fields leave this boundary. Raw internal
 *   values (categories, master paths, concept strings) are never exposed to
 *   the browser.
 *
 * The picker option set is also derived here from the authoritative catalog so
 * the creation and management surfaces share one server-projected list that
 * contains the ten player-starter entries plus the owning player's unlocks.
 */

/**
 * One option in the shared portrait picker (catalog-derived, player-owned).
 * The stable portrait ID is required for selection identity; this list is
 * projected server-side and contains only the account's selectable entries.
 */
export type SelectablePortraitOption = {
  portraitId: string;
  displayName: string;
  derivativePath: string;
  derivativeWidth: number;
  derivativeHeight: number;
  accessibleDescription: string;
};

/** Safe player-facing presentation of a selected catalog portrait. */
export type SelectedPortraitPresentation = Omit<SelectablePortraitOption, "portraitId">;

/**
 * The neutral system placeholder presentation. Not a catalog portrait, not
 * selectable, and never persisted as a player choice.
 */
export type NeutralPortraitPresentation = {
  kind: "placeholder";
};

/** Resolved safe presentation for a stored portrait value (public shape). */
export type CharacterPortraitPresentation =
  | ({ kind: "selected" } & SelectedPortraitPresentation)
  | NeutralPortraitPresentation;

function toSelectableOption(
  portrait: (typeof PLAYER_STARTER_PORTRAITS)[number],
): SelectablePortraitOption {
  return {
    portraitId: portrait.id,
    displayName: portrait.displayName,
    derivativePath: portrait.derivativePath,
    derivativeWidth: portrait.derivativeWidth,
    derivativeHeight: portrait.derivativeHeight,
    accessibleDescription: portrait.accessibleDescription,
  };
}

/**
 * Whether a stable portrait ID is selectable for a player with these owned
 * unlock IDs. This is the shared pure rule used by creation and edit writes.
 */
export function isSelectablePortrait(
  portraitId: string,
  ownedPortraitIds: Iterable<string> = [],
): boolean {
  const portrait = getPortrait(portraitId);
  if (!portrait) return false;
  if (portrait.category === "player-starter") return true;
  return portrait.category === "player-unlockable" && new Set(ownedPortraitIds).has(portrait.id);
}

/** The ordered selectable picker options for one player's owned unlocks. */
export function getSelectablePortraitOptions(
  ownedPortraitIds: Iterable<string> = [],
): readonly SelectablePortraitOption[] {
  const owned = new Set(ownedPortraitIds);
  return [
    ...PLAYER_STARTER_PORTRAITS,
    ...PLAYER_UNLOCKABLE_PORTRAITS.filter((portrait) => owned.has(portrait.id)),
  ].map(toSelectableOption);
}

/**
 * Resolve a stored portrait ID to its safe public presentation.
 *
 * Only currently selectable `player-starter` IDs and owned
 * `player-unlockable` IDs present the catalog portrait; every other value
 * resolves to the neutral placeholder without touching the database.
 */
export function resolveCharacterPortrait(
  portraitId: string | null | undefined,
  ownedPortraitIds: Iterable<string> = [],
): CharacterPortraitPresentation {
  if (typeof portraitId !== "string" || !isSelectablePortrait(portraitId, ownedPortraitIds)) {
    return { kind: "placeholder" };
  }
  const portrait = getPortrait(portraitId);
  if (!portrait) return { kind: "placeholder" };
  return {
    kind: "selected",
    displayName: portrait.displayName,
    derivativePath: portrait.derivativePath,
    derivativeWidth: portrait.derivativeWidth,
    derivativeHeight: portrait.derivativeHeight,
    accessibleDescription: portrait.accessibleDescription,
  };
}
