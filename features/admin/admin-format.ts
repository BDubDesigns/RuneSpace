import { getLocation, LOCATIONS } from "@/game/content/locations";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { SKILL_IDS } from "@/game/config/foundations";

/** Human label for a canonical location id, falling back to the raw id. */
export function locationLabel(locationId: string): string {
  return getLocation(locationId)?.displayName ?? locationId;
}

/** Human label for a canonical skill id, falling back to the raw id. */
export function skillLabel(skillId: string): string {
  return getSkillPresentation(skillId)?.displayName ?? skillId;
}

/**
 * The rewritten skills the operator console can SET TOTAL XP on (commands
 * reject anything without an approved progression curve).
 */
export const XP_SHAPED_SKILLS = [SKILL_IDS.mining, SKILL_IDS.refining, SKILL_IDS.welding] as const;

/**
 * Canonical items the ADD ITEM control offers, with human labels for the
 * operator. Stackables and uniques are both offered; ADD ITEM validates against
 * the authoritative item definition at the command boundary.
 */
export const ADMIN_OFFERED_ITEMS = [
  { itemId: "ferrite_shale", label: "Ferrite Shale (stack)" },
  { itemId: "refined_ferrite", label: "Refined Ferrite (stack)" },
  { itemId: "slag", label: "Slag (stack)" },
  { itemId: "power_cell", label: "Power Cell (stack)" },
  { itemId: "salvage_cutter", label: "Salvage Cutter (unique)" },
  { itemId: "mykea_schleppraum_8", label: "Mykea Schleppraum 8 (unique)" },
] as const;

/**
 * The canonical locations offered as teleport destinations. Derived directly
 * from the authoritative location registry (`LOCATIONS`), never hand-maintained
 * in this feature, so an operator can only ever be offered a location that
 * resolves canonically. The server command re-validates each destination via
 * `getLocation` under the transaction lock regardless.
 */
export const ADMIN_DESTINATIONS: readonly { locationId: string; label: string }[] = LOCATIONS.map(
  (location) => ({ locationId: location.id, label: location.displayName }),
);
