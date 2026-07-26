import { asContentId, type ContentId } from "@/game/schemas/ids";

/** Foundational mechanical constants and approved stable identities. */
export const GAME_TICK_MS = 600;
export const STANDARD_OFFLINE_RESOLUTION_CAP_MS = 60 * 60 * 1000;
export const EQUIPMENT_ASSIGNMENT_KINDS = ["gear", "container"] as const;

export type EquipmentAssignmentKind = (typeof EQUIPMENT_ASSIGNMENT_KINDS)[number];

const skillIds = {
  mining: asContentId("mining"),
  metallurgy: asContentId("metallurgy"),
  welding: asContentId("welding"),
  strength: asContentId("strength"),
} as const satisfies Record<string, ContentId>;

const itemIds = {
  ferriteShale: asContentId("ferrite_shale"),
  refinedFerrite: asContentId("refined_ferrite"),
  slag: asContentId("slag"),
  crashGradeStructuralAlloy: asContentId("crash_grade_structural_alloy"),
  salvageCutter: asContentId("salvage_cutter"),
  powerCell: asContentId("power_cell"),
  mykeaSchleppraum8: asContentId("mykea_schleppraum_8"),
} as const satisfies Record<string, ContentId>;

export const ACTION_IDS = {
  crashSiteMining: asContentId("crash_site_ferrite_shale_mining"),
  travel: asContentId("travel"),
} as const satisfies Record<string, ContentId>;

/** Stable identities for the approved initial two-location world (issue #40). */
export const LOCATION_IDS = {
  crashSite: asContentId("crash_site"),
  abandonedProcessingYard: asContentId("abandoned_processing_yard"),
} as const satisfies Record<string, ContentId>;

export const SKILL_IDS = skillIds;
export const ITEM_IDS = itemIds;

export type SkillId = (typeof SKILL_IDS)[keyof typeof SKILL_IDS];
export type ItemId = (typeof ITEM_IDS)[keyof typeof ITEM_IDS];
export type LocationId = (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];
