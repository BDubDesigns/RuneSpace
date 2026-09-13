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
  // Holo Hollow residents (#159). Each lives in one Local Place rather than at
  // the bare Holo Hollow World Location; see game/content/local-places.
  bixWeller: asContentId("bix_weller"),
  maraKells: asContentId("mara_kells"),
  rennCalder: asContentId("renn_calder"),
} as const satisfies Record<string, ContentId>;

const missionIds = {
  walkItOff: asContentId("walk_it_off"),
  cutYourTeeth: asContentId("cut_your_teeth"),
  wasteNot: asContentId("waste_not"),
  holdItTogether: asContentId("hold_it_together"),
  keepTheChange: asContentId("keep_the_change"),
  outOfTheWeather: asContentId("out_of_the_weather"),
} as const satisfies Record<string, ContentId>;

const dialogueIds = {
  wadeOffer: asContentId("wade_rusk_walk_it_off_offer"),
  wadeFollowUp: asContentId("wade_rusk_walk_it_off_follow_up"),
  wadeWalkItOffActiveFollowUp: asContentId("wade_rusk_walk_it_off_active_follow_up"),
  wadePostCutYourTeeth: asContentId("wade_rusk_post_cut_your_teeth"),
  wadeCutYourTeethActive: asContentId("wade_rusk_cut_your_teeth_active"),
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
  // ID registered but no longer has an authored sequence. Issue #164's
  // conversation-model migration removes the old direct-Talk resolver
  // entirely, but this retired identity is preserved rather than deleted.
  tansyAfterCompletion: asContentId("tansy_rusk_walk_it_off_after_completion"),
  tansyCutYourTeethOffer: asContentId("tansy_rusk_cut_your_teeth_offer"),
  tansyCutYourTeethEquipReminder: asContentId("tansy_rusk_cut_your_teeth_equip_reminder"),
  tansyCutYourTeethMiningReminder: asContentId("tansy_rusk_cut_your_teeth_mining_reminder"),
  tansyCutYourTeethStackReminder: asContentId("tansy_rusk_cut_your_teeth_stack_reminder"),
  tansyCutYourTeethTurnIn: asContentId("tansy_rusk_cut_your_teeth_turn_in"),
  tansyCutYourTeethBusy: asContentId("tansy_rusk_cut_your_teeth_busy"),
  tansyCutYourTeethCompletion: asContentId("tansy_rusk_cut_your_teeth_completion"),
  wadeWasteNotTrackedActivityReminder: asContentId("wade_rusk_waste_not_tracked_activity_reminder"),
  tansyWasteNotActive: asContentId("tansy_rusk_waste_not_active"),
  tansyHoldItTogetherActive: asContentId("tansy_rusk_hold_it_together_active"),
  wadeWasteNotBusy: asContentId("wade_rusk_waste_not_busy"),
  wadeWasteNotTurnIn: asContentId("wade_rusk_waste_not_turn_in"),
  wadeWasteNotCompletion: asContentId("wade_rusk_waste_not_completion"),
  wadeHoldItTogetherRepairReminder: asContentId("wade_rusk_hold_it_together_repair_reminder"),
  wadeHoldItTogetherBusy: asContentId("wade_rusk_hold_it_together_busy"),
  wadeHoldItTogetherTurnIn: asContentId("wade_rusk_hold_it_together_turn_in"),
  wadeHoldItTogetherCompletion: asContentId("wade_rusk_hold_it_together_completion"),
  wadePostHoldItTogether: asContentId("wade_rusk_post_hold_it_together"),
  // Keep the Change (#170): Wade's apprenticeship job, the required Bix
  // introduction where Mara meets the player, and Tansy's Power Cell delivery.
  wadeKeepTheChangeOffer: asContentId("wade_rusk_keep_the_change_offer"),
  wadeKeepTheChangeActive: asContentId("wade_rusk_keep_the_change_active"),
  bixKeepTheChangeIntroduction: asContentId("bix_weller_keep_the_change_introduction"),
  tansyKeepTheChangeConversationReminder: asContentId(
    "tansy_rusk_keep_the_change_conversation_reminder",
  ),
  tansyKeepTheChangeCarriedReminder: asContentId("tansy_rusk_keep_the_change_carried_reminder"),
  tansyKeepTheChangeBusy: asContentId("tansy_rusk_keep_the_change_busy"),
  tansyKeepTheChangeTurnIn: asContentId("tansy_rusk_keep_the_change_turn_in"),
  tansyKeepTheChangeCompletion: asContentId("tansy_rusk_keep_the_change_completion"),
  wadePostKeepTheChange: asContentId("wade_rusk_post_keep_the_change"),
  tansyPostKeepTheChange: asContentId("tansy_rusk_post_keep_the_change"),
  // Out of the Weather (#172): Renn's optional Crew Stop side Mission. The
  // player learns Welding from Wade, then chooses to spend their own materials
  // and time on something ordinary that makes Holo Hollow's mornings better.
  rennOutOfTheWeatherOffer: asContentId("renn_calder_out_of_the_weather_offer"),
  rennOutOfTheWeatherRepairReminder: asContentId("renn_calder_out_of_the_weather_repair_reminder"),
  rennOutOfTheWeatherBusy: asContentId("renn_calder_out_of_the_weather_busy"),
  rennOutOfTheWeatherTurnIn: asContentId("renn_calder_out_of_the_weather_turn_in"),
  rennOutOfTheWeatherCompletion: asContentId("renn_calder_out_of_the_weather_completion"),
  rennPostOutOfTheWeather: asContentId("renn_calder_post_out_of_the_weather"),
  // Replayable social/worldbuilding topics (#164). These are ordinary NPC
  // conversations: they never carry a Mission action and never gate progression.
  wadeRecoveryWorkTopic: asContentId("wade_rusk_topic_recovery_work"),
  tansyMiningTopic: asContentId("tansy_rusk_topic_mining"),
  tansyBeyondHoloHollowTopic: asContentId("tansy_rusk_topic_beyond_holo_hollow"),
  // Holo Hollow foundation topics (#159).
  bixTheShopTopic: asContentId("bix_weller_topic_the_shop"),
  bixPowerCellsTopic: asContentId("bix_weller_topic_power_cells"),
  bixHoloHollowTopic: asContentId("bix_weller_topic_holo_hollow"),
  rennAssistanceCenterTopic: asContentId("renn_calder_topic_assistance_center"),
  rennFerriteTopic: asContentId("renn_calder_topic_ferrite"),
  rennLifeHereTopic: asContentId("renn_calder_topic_life_here"),
  // Mara's own replayable topics, reachable once Keep the Change unlocks HH B&B
  // (#170). Her Bix-shop appearance is authored Mission dialogue, not a topic.
  maraTheBnbTopic: asContentId("mara_kells_topic_the_bnb"),
  maraBixTopic: asContentId("mara_kells_topic_bix"),
} as const satisfies Record<string, ContentId>;

/**
 * Stable identities for authored replayable conversation topics (#164). A
 * topic is a UI subject the player can revisit; it is never player-spoken
 * dialogue and never a Mission.
 */
const conversationTopicIds = {
  wadeRecoveryWork: asContentId("wade_rusk_recovery_work"),
  tansyMining: asContentId("tansy_rusk_mining"),
  tansyBeyondHoloHollow: asContentId("tansy_rusk_beyond_holo_hollow"),
  bixTheShop: asContentId("bix_weller_the_shop"),
  bixPowerCells: asContentId("bix_weller_power_cells"),
  bixHoloHollow: asContentId("bix_weller_holo_hollow"),
  rennAssistanceCenter: asContentId("renn_calder_assistance_center"),
  rennFerrite: asContentId("renn_calder_ferrite"),
  rennLifeHere: asContentId("renn_calder_life_here"),
  maraTheBnb: asContentId("mara_kells_the_bnb"),
  maraBix: asContentId("mara_kells_bix"),
} as const satisfies Record<string, ContentId>;

const expressionIds = {
  neutral: asContentId("neutral"),
  smile: asContentId("smile"),
  concerned: asContentId("concerned"),
  scowl: asContentId("scowl"),
  // Added for the approved Holo Hollow resident expression sets (#159). The
  // shared vocabulary stays generic; each NPC maps it to its own authored art.
  amused: asContentId("amused"),
  sardonic: asContentId("sardonic"),
  guarded: asContentId("guarded"),
  // Added for Mara's approved expression set (#170): composed and matter-of-fact
  // rather than wary (guarded) or displeased (scowl).
  firm: asContentId("firm"),
} as const satisfies Record<string, ContentId>;

const conversationBackgroundIds = {
  crashSiteExterior: asContentId("crash_site_exterior"),
  theJagExterior: asContentId("the_jag_exterior"),
  // Holo Hollow ships dedicated interior conversation art rather than reusing
  // an exterior location scene (#159).
  holoHollowSouvenirsInterior: asContentId("holo_hollow_souvenirs_interior"),
  holoHollowAssistanceCenterInterior: asContentId("holo_hollow_assistance_center_interior"),
  hhBnbInterior: asContentId("hh_bnb_interior"),
} as const satisfies Record<string, ContentId>;

export const ACTION_IDS = {
  ferriteShaleMining: asContentId("ferrite_shale_mining"),
  refining: asContentId("processing_yard_refining"),
  cargoHoldWelding: asContentId("cargo_hold_welding"),
  // Welding is one skill with one set of rules; a repair target is identified
  // by its own action ID because `active_actions` deliberately carries no
  // per-action payload (#172).
  crewStopWelding: asContentId("crew_stop_welding"),
  travel: asContentId("travel"),
} as const satisfies Record<string, ContentId>;

/** Stable identities for the approved local world (issues #40, #47, #83, #159). */
export const LOCATION_IDS = {
  crashSite: asContentId("crash_site"),
  abandonedProcessingYard: asContentId("abandoned_processing_yard"),
  emergencyPowerAnnex: asContentId("dewhat_emergency_power_annex"),
  theLongScramble: asContentId("the_long_scramble"),
  theJag: asContentId("the_jag"),
  holoHollow: asContentId("holo_hollow"),
} as const satisfies Record<string, ContentId>;

/**
 * Stable identities for Local Places (#159): interior/adjacent town places
 * belonging to exactly one parent World Location. A Local Place never owns a
 * world-map coordinate, adjacency, or Travel semantics of its own, and which
 * one the player is viewing is navigation state, never persisted character
 * state. See game/content/local-places.
 */
export const LOCAL_PLACE_IDS = {
  holoHollowSouvenirs: asContentId("holo_hollow_souvenirs"),
  holoHollowAssistanceCenter: asContentId("holo_hollow_assistance_center"),
  hhBnb: asContentId("hh_bnb"),
  holoHollowCrewStop: asContentId("holo_hollow_crew_stop"),
} as const satisfies Record<string, ContentId>;

/** Stable merchant identities (#159). A Local Place authors which one it owns. */
export const MERCHANT_IDS = {
  bixWeller: asContentId("bix_weller_shop"),
} as const satisfies Record<string, ContentId>;

/**
 * Stable identities for the things Welding can repair (#172).
 *
 * A repair target owns durable per-character repair state (contributed
 * materials, Welding progress, completion) in one generic persistence
 * boundary. Its material recipe and increment count are balance
 * (`game/config/balance`); where it lives and how it presents is content.
 */
export const REPAIR_TARGET_IDS = {
  cargoHold: asContentId("cargo_hold"),
  crewStop: asContentId("crew_stop"),
} as const satisfies Record<string, ContentId>;

/**
 * Stable identities for authored transport routes (#172).
 *
 * A transport route is paid, authored point-to-point travel. It is NOT map
 * adjacency: the Crew Hauler connects Holo Hollow and The Jag without making
 * them walk-adjacent, and walking keeps its existing route through The Long
 * Scramble. See game/content/transport-routes.
 */
export const TRANSPORT_ROUTE_IDS = {
  crewHaulerHoloHollowTheJag: asContentId("crew_hauler_holo_hollow_the_jag"),
} as const satisfies Record<string, ContentId>;

/**
 * How one Journey is being made (#172).
 *
 * `walk` is ordinary free adjacent travel with its Scavenge window. Every other
 * mode is authored paid transport: a real Journey with its own duration and no
 * Scavenge opportunity at all.
 */
export const TRAVEL_MODES = ["walk", "crew_hauler"] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];

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
export const CONVERSATION_TOPIC_IDS = conversationTopicIds;
export const EXPRESSION_IDS = expressionIds;
export const CONVERSATION_BACKGROUND_IDS = conversationBackgroundIds;
export const PORTRAIT_IDS = portraitIds;

export type SkillId = (typeof SKILL_IDS)[keyof typeof SKILL_IDS];
export type ItemId = (typeof ITEM_IDS)[keyof typeof ITEM_IDS];
export type NpcId = (typeof NPC_IDS)[keyof typeof NPC_IDS];
export type MissionId = (typeof MISSION_IDS)[keyof typeof MISSION_IDS];
export type DialogueId = (typeof DIALOGUE_IDS)[keyof typeof DIALOGUE_IDS];
export type ConversationTopicId =
  (typeof CONVERSATION_TOPIC_IDS)[keyof typeof CONVERSATION_TOPIC_IDS];
export type ExpressionId = (typeof EXPRESSION_IDS)[keyof typeof EXPRESSION_IDS];
export type ConversationBackgroundId =
  (typeof CONVERSATION_BACKGROUND_IDS)[keyof typeof CONVERSATION_BACKGROUND_IDS];
export type LocationId = (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
export type LocalPlaceId = (typeof LOCAL_PLACE_IDS)[keyof typeof LOCAL_PLACE_IDS];
export type MerchantId = (typeof MERCHANT_IDS)[keyof typeof MERCHANT_IDS];
export type RepairTargetId = (typeof REPAIR_TARGET_IDS)[keyof typeof REPAIR_TARGET_IDS];
export type TransportRouteId = (typeof TRANSPORT_ROUTE_IDS)[keyof typeof TRANSPORT_ROUTE_IDS];
export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];
export type PortraitId = (typeof PORTRAIT_IDS)[keyof typeof PORTRAIT_IDS];
