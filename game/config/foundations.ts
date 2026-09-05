import { asContentId, type ContentId } from "../schemas/ids.ts";

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

const npcIds = {
  wadeRusk: asContentId("wade_rusk"),
  tansyRusk: asContentId("tansy_rusk"),
} as const satisfies Record<string, ContentId>;

const missionIds = {
  walkItOff: asContentId("walk_it_off"),
  cutYourTeeth: asContentId("cut_your_teeth"),
  wasteNot: asContentId("waste_not"),
} as const satisfies Record<string, ContentId>;

const dialogueIds = {
  wadeOffer: asContentId("wade_rusk_walk_it_off_offer"),
  wadeFollowUp: asContentId("wade_rusk_walk_it_off_follow_up"),
  wadeWalkItOffActiveFollowUp: asContentId("wade_rusk_walk_it_off_active_follow_up"),
  wadePostCutYourTeeth: asContentId("wade_rusk_post_cut_your_teeth"),
  tansyPostCutYourTeeth: asContentId("tansy_rusk_post_cut_your_teeth"),
  wadePostWasteNot: asContentId("wade_rusk_post_waste_not"),
  tansyPostWasteNot: asContentId("tansy_rusk_post_waste_not"),
  tansyBeforeMission: asContentId("tansy_rusk_walk_it_off_before_mission"),
  tansyAfterRemoteAcceptance: asContentId("tansy_rusk_walk_it_off_after_remote_acceptance"),
  tansyCompletion: asContentId("tansy_rusk_walk_it_off_completion"),
  tansyAfterClaim: asContentId("tansy_rusk_walk_it_off_after_claim"),
  tansyCapacitySlots: asContentId("tansy_rusk_walk_it_off_capacity_slots"),
  tansyCapacityMass: asContentId("tansy_rusk_walk_it_off_capacity_mass"),
  // Issue #110 folds Tansy's old standalone post-mission idle chain into the
  // Cut Your Teeth offer, so the retired v1 idle sequence keeps its stable
  // ID registered but no longer has an authored sequence.
  tansyAfterCompletion: asContentId("tansy_rusk_walk_it_off_after_completion"),
  tansyCutYourTeethOffer: asContentId("tansy_rusk_cut_your_teeth_offer"),
  tansyCutYourTeethEquipReminder: asContentId("tansy_rusk_cut_your_teeth_equip_reminder"),
  tansyCutYourTeethMiningReminder: asContentId("tansy_rusk_cut_your_teeth_mining_reminder"),
  tansyCutYourTeethStackReminder: asContentId("tansy_rusk_cut_your_teeth_stack_reminder"),
  tansyCutYourTeethTurnIn: asContentId("tansy_rusk_cut_your_teeth_turn_in"),
  tansyCutYourTeethBusy: asContentId("tansy_rusk_cut_your_teeth_busy"),
  tansyCutYourTeethCompletion: asContentId("tansy_rusk_cut_your_teeth_completion"),
  wadeWasteNotTrackedActivityReminder: asContentId("wade_rusk_waste_not_tracked_activity_reminder"),
  wadeWasteNotBusy: asContentId("wade_rusk_waste_not_busy"),
  wadeWasteNotTurnIn: asContentId("wade_rusk_waste_not_turn_in"),
  wadeWasteNotCompletion: asContentId("wade_rusk_waste_not_completion"),
} as const satisfies Record<string, ContentId>;

const expressionIds = {
  neutral: asContentId("neutral"),
  smile: asContentId("smile"),
  concerned: asContentId("concerned"),
  scowl: asContentId("scowl"),
} as const satisfies Record<string, ContentId>;

const conversationBackgroundIds = {
  crashSiteExterior: asContentId("crash_site_exterior"),
  theJagExterior: asContentId("the_jag_exterior"),
} as const satisfies Record<string, ContentId>;

export const ACTION_IDS = {
  ferriteShaleMining: asContentId("ferrite_shale_mining"),
  refining: asContentId("processing_yard_refining"),
  cargoHoldWelding: asContentId("cargo_hold_welding"),
  travel: asContentId("travel"),
} as const satisfies Record<string, ContentId>;

/** Stable identities for the approved local world (issues #40, #47, and #83). */
export const LOCATION_IDS = {
  crashSite: asContentId("crash_site"),
  abandonedProcessingYard: asContentId("abandoned_processing_yard"),
  emergencyPowerAnnex: asContentId("dewhat_emergency_power_annex"),
  theLongScramble: asContentId("the_long_scramble"),
  theJag: asContentId("the_jag"),
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
export const ITEM_IDS = itemIds;
export const NPC_IDS = npcIds;
export const MISSION_IDS = missionIds;
export const DIALOGUE_IDS = dialogueIds;
export const EXPRESSION_IDS = expressionIds;
export const CONVERSATION_BACKGROUND_IDS = conversationBackgroundIds;
export const PORTRAIT_IDS = portraitIds;

export type SkillId = (typeof SKILL_IDS)[keyof typeof SKILL_IDS];
export type ItemId = (typeof ITEM_IDS)[keyof typeof ITEM_IDS];
export type NpcId = (typeof NPC_IDS)[keyof typeof NPC_IDS];
export type MissionId = (typeof MISSION_IDS)[keyof typeof MISSION_IDS];
export type DialogueId = (typeof DIALOGUE_IDS)[keyof typeof DIALOGUE_IDS];
export type ExpressionId = (typeof EXPRESSION_IDS)[keyof typeof EXPRESSION_IDS];
export type ConversationBackgroundId =
  (typeof CONVERSATION_BACKGROUND_IDS)[keyof typeof CONVERSATION_BACKGROUND_IDS];
export type LocationId = (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];
export type PortraitId = (typeof PORTRAIT_IDS)[keyof typeof PORTRAIT_IDS];
