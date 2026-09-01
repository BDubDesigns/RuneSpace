import { getLocation } from "@/game/content/locations";
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

/** The canonical locations offered as teleport destinations. */
export const ADMIN_DESTINATIONS = [
  { locationId: "crash_site", label: "Crash Site" },
  { locationId: "abandoned_processing_yard", label: "Abandoned Processing Yard" },
  { locationId: "dwhat_emergency_power_annex", label: "DeWhat? Emergency Power Annex" },
  { locationId: "the_long_scramble", label: "The Long Scramble" },
  { locationId: "the_jag", label: "The Jag" },
] as const;
