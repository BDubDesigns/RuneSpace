import { PLAYER_STARTER_PORTRAITS, getPortrait } from "@/game/content/portrait-catalog";

/**
 * Character portrait resolution and projection (issue #65).
 *
 * One narrow server-side boundary that separates a player's deliberate
 * portrait choice from the neutral system placeholder:
 *
 * - A stored value is honored ONLY when it is a currently selectable
 *   `player-starter` catalog ID. `npc-only`, `reserved`, unknown, malformed,
 *   retired, and null values all resolve to the neutral placeholder.
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
 * contains ONLY the ten player-starter entries.
 */

/**
 * One option in the shared portrait picker (catalog-derived, starter-only).
 * The stable portrait ID is required for selection identity; this list is
 * projected server-side and contains exactly the ten selectable entries.
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

/** The ordered selectable picker options: exactly the ten player-starter entries. */
export function getSelectablePortraitOptions(): readonly SelectablePortraitOption[] {
  return PLAYER_STARTER_PORTRAITS.map((portrait) => ({
    portraitId: portrait.id,
    displayName: portrait.displayName,
    derivativePath: portrait.derivativePath,
    derivativeWidth: portrait.derivativeWidth,
    derivativeHeight: portrait.derivativeHeight,
    accessibleDescription: portrait.accessibleDescription,
  }));
}

/**
 * Resolve a stored portrait ID to its safe public presentation.
 *
 * Only currently selectable `player-starter` IDs present the catalog portrait;
 * every other value (null, unknown, malformed, `npc-only`, `reserved`,
 * retired) resolves to the neutral placeholder without touching the database.
 */
export function resolveCharacterPortrait(
  portraitId: string | null | undefined,
): CharacterPortraitPresentation {
  const portrait = typeof portraitId === "string" ? getPortrait(portraitId) : undefined;
  if (portrait?.category !== "player-starter") {
    return { kind: "placeholder" };
  }
  return {
    kind: "selected",
    displayName: portrait.displayName,
    derivativePath: portrait.derivativePath,
    derivativeWidth: portrait.derivativeWidth,
    derivativeHeight: portrait.derivativeHeight,
    accessibleDescription: portrait.accessibleDescription,
  };
}
