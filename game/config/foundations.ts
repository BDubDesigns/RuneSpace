import { asContentId, type ContentId } from "@/game/schemas/ids";

/** Foundational mechanical constants and approved stable identities. */
export const GAME_TICK_MS = 600;
export const STANDARD_OFFLINE_RESOLUTION_CAP_MS = 60 * 60 * 1000;
export const EQUIPMENT_ASSIGNMENT_KINDS = ["gear", "container"] as const;

export type EquipmentAssignmentKind = (typeof EQUIPMENT_ASSIGNMENT_KINDS)[number];

const skillIds = {
  mining: asContentId("mining"),
  refining: asContentId("refining"),
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
  refining: asContentId("processing_yard_refining"),
  travel: asContentId("travel"),
} as const satisfies Record<string, ContentId>;

/** Stable identities for the approved local world (issues #40 and #47). */
export const LOCATION_IDS = {
  crashSite: asContentId("crash_site"),
  abandonedProcessingYard: asContentId("abandoned_processing_yard"),
  emergencyPowerAnnex: asContentId("dewhat_emergency_power_annex"),
} as const satisfies Record<string, ContentId>;

/**
 * Stable portrait identities (issue #70). The authoritative catalog with
 * names, categories, and asset paths lives in game/content/portrait-catalog.
 */
const portraitIds = {
  evaSalvageWelder: asContentId("portrait_eva_salvage_welder_01"),
  cargoPilot: asContentId("portrait_cargo_pilot_01"),
  orbitalBotanist: asContentId("portrait_orbital_botanist_01"),
  stationCaptain: asContentId("portrait_station_captain_01"),
  frontierMedic: asContentId("portrait_frontier_medic_01"),
  zeroGRockStar: asContentId("portrait_zero_g_rock_star_01"),
  gramma: asContentId("portrait_gramma_01"),
  grampa: asContentId("portrait_grampa_01"),
  zeroGGymnast: asContentId("portrait_zero_g_gymnast_01"),
  spaceNerd: asContentId("portrait_space_nerd_01"),
  baker: asContentId("portrait_baker_01"),
  milkman: asContentId("portrait_milkman_01"),
  bananaMechanic: asContentId("portrait_banana_mechanic_01"),
  childInventor: asContentId("portrait_child_inventor_01"),
  chocolateSnackThief: asContentId("portrait_chocolate_snack_thief_01"),
  eccentricScientist: asContentId("portrait_eccentric_scientist_01"),
  radioHost: asContentId("portrait_radio_host_01"),
  militaryMedic: asContentId("portrait_military_medic_01"),
  slothMaintenance: asContentId("portrait_sloth_maintenance_01"),
  spaceFootballer: asContentId("portrait_space_footballer_01"),
  spaceportCourier: asContentId("portrait_spaceport_courier_01"),
  teaPsychic: asContentId("portrait_tea_psychic_01"),
  unicornMechanic: asContentId("portrait_unicorn_mechanic_01"),
  vonScavenger: asContentId("portrait_von_scavenger_01"),
  zeroGBallerina: asContentId("portrait_zero_g_ballerina_01"),
} as const satisfies Record<string, ContentId>;

export const SKILL_IDS = skillIds;
/** Legacy reserved identity — renamed to `refining` in issue #81, kept as a migration shim only. */
export const METALLURGY_SKILL_ID_LEGACY = "metallurgy" as const;
export const ITEM_IDS = itemIds;
export const PORTRAIT_IDS = portraitIds;

export type SkillId = (typeof SKILL_IDS)[keyof typeof SKILL_IDS];
export type ItemId = (typeof ITEM_IDS)[keyof typeof ITEM_IDS];
export type LocationId = (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];
export type PortraitId = (typeof PORTRAIT_IDS)[keyof typeof PORTRAIT_IDS];
