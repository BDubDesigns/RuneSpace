import {
  ACTION_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  type ActionId,
  type DialogueId,
  type ItemId,
  type LocationId,
  type MissionId,
  type NpcId,
  type RepairTargetId,
  type SkillId,
} from "@/game/config/foundations";

/**
 * The two real completion reward shapes proven by production content. A
 * mission grants at most one reward: an inventory item (Walk It Off) or skill
 * XP through the authoritative progression boundary (Cut Your Teeth).
 * Deliberately narrow — no credits, reputation, bundles, or effect lists.
 *
 * Item rewards are granted as ONE new unique item instance (the generic
 * completion boundary's sole item execution path); registry validation
 * rejects stackable item rewards until a real mission earns that path.
 */
export type MissionReward =
  | { kind: "item"; itemId: ItemId }
  | { kind: "skill_xp"; skillId: SkillId; amount: number };

/**
 * An authored effect applied when one offer route's acceptance commits.
 *
 * This is an up-front job budget, not a reward: Keep the Change hands the
 * player Wade's Credits at acceptance so they can go buy what the job needs.
 * It is applied inside the generic acceptance transaction, in the branch that
 * has already proven this is a genuinely fresh acceptance, so the existing
 * acceptance guard makes it exactly-once without a second mechanism.
 *
 * Deliberately narrow: one closed shape, authored per offer route, never a
 * generic effect list.
 */
export type MissionAcceptEffect = { kind: "credits"; amount: number };

/**
 * Explicit turn-in disposition for a carried-stack requirement. Requirement
 * satisfaction (does the character carry the quantity?) is deliberately kept
 * separate from consumption (does the turn-in take the items?).
 *
 * - `"show"` — the stack is a condition only; the turn-in consumes zero
 *   (Cut Your Teeth's "show the shale").
 * - `"consume_required_quantity"` — the turn-in hands in exactly the required
 *   quantity through the authoritative carried-stack boundary.
 */
export type CarriedStackTurnIn = "show" | "consume_required_quantity";

/**
 * One reusable requirement evaluated against current authoritative character
 * state or the narrow durable tracked-activity projection. Live-state
 * requirements remain recomputed from location/equipment/inventory.
 *
 * The closed union is justified by the two production missions and the known
 * needs of the next ordinary missions. A future real mission earns any new
 * kind deliberately rather than broadening this speculatively.
 */
export type MissionRequirement =
  | {
      kind: "at_location";
      /** Canonical authored location. Current location alone satisfies this. */
      locationId: LocationId;
      /** Player-facing copy, e.g. "Travel to The Jag" / "Return to The Jag". */
      objective: string;
    }
  | {
      kind: "equipped_item";
      /** The item that must genuinely occupy its authoritative compatible slot. */
      itemId: ItemId;
      /** Player-facing copy; `{item}` receives the authoritative display name. */
      objective: string;
    }
  | {
      kind: "carried_stack";
      /** The item whose current carried quantity is observed. */
      itemId: ItemId;
      /**
       * Omitted quantity means "one authoritative full stack": the projection
       * resolves the number from the item definition's stack limit rather than
       * duplicating balance values in mission content.
       */
      quantity?: number;
      /** Explicit turn-in disposition: shown (consume zero) or handed in. */
      turnIn: CarriedStackTurnIn;
      /** Player-facing copy; `{item}`, `{carried}`, `{required}` are substituted. */
      objective: string;
      /**
       * Optional authored recommendation of which gameplay interaction this
       * mission is intentionally teaching/recommending for acquisition. Kept
       * separate from requirement truth and validated against the action's
       * authoritative outputs — never a duplicated drop table.
       */
      recommendedActionId?: ActionId;
    }
  | {
      kind: "tracked_activity";
      /** Stable identity for this requirement's durable progress row. */
      progressKey: string;
      /** Closed production activity vocabulary owned by the gameplay boundary. */
      activity: "mining" | "refining";
      /** Closed production metric vocabulary; both activities count attempts. */
      metric: "attempts";
      /** Positive authored target; current progress is persisted separately. */
      target: number;
      /** Player-facing copy; `{current}` and `{target}` are substituted. */
      objective: string;
      /** Optional authored action guidance for the activity being taught. */
      recommendedActionId?: ActionId;
    }
  | {
      /**
       * One authoritative repair target is finished (#172).
       *
       * Generic over every Welding job: Hold It Together observes the Crash
       * Site Cargo Hold, Out of the Weather observes Holo Hollow's Crew Stop.
       * The mission observes completion; it never owns material consumption or
       * Welding progress, which belong to the repair target itself.
       */
      kind: "repair_target_complete";
      targetId: RepairTargetId;
      /** Player-facing copy for the job as a whole, and the fallback for any phase. */
      objective: string;
      /**
       * Optional phase copy (#172). A repair has real stages — install the
       * recipe's materials, then weld — and a Mission may author what each one
       * reads as. The framework picks the live phase from the authoritative
       * repair record, never from the Mission's identity.
       *
       * `{item}`, `{contributed}`, and `{required}` are substituted from the
       * first authored material still short of its requirement. Contributed
       * means durably installed: carried and stored material never appear here.
       */
      materialObjective?: string;
      /** Optional Welding-phase copy; `{current}` and `{target}` are substituted. */
      weldingObjective?: string;
      /**
       * When this repair's material phase should guide the player to the
       * target at all (#172).
       *
       * `"always"` (the default) keeps the ordinary behavior: the target is the
       * guidance destination for the whole job. `"when_carrying"` withholds
       * guidance while the player carries none of an outstanding material —
       * the same principle a carried requirement with several legitimate
       * sources already follows, since walking to the shelter with empty hands
       * accomplishes nothing and the framework must not invent which of
       * refining, buying, or scavenging the player should do. The Mission Log's
       * "{contributed} / {required}" carries the objective on its own until
       * they pick something up.
       */
      materialGuidance?: "always" | "when_carrying";
    }
  | {
      /**
       * A mandatory authored conversation: the mission requires the player to
       * actually meet this NPC and see this scene (Keep the Change requires
       * Wade's new apprentice to meet Bix). It is satisfied only by the generic
       * `acknowledgeMissionConversation` command, never by opening a merchant,
       * arriving at a location, or reading dialogue prose.
       *
       * Durable satisfaction reuses the existing mission-progress row keyed by
       * `progressKey`; no conversation history, viewed-topic flag, or new
       * persistence shape is introduced.
       */
      kind: "npc_conversation";
      npcId: NpcId;
      /**
       * The authored location this conversation happens at. Mission location
       * semantics are never derived from the NPC's home location.
       */
      locationId: LocationId;
      /** The authored sequence whose terminal control satisfies this requirement. */
      dialogueId: DialogueId;
      /** Stable identity for this requirement's durable progress row. */
      progressKey: string;
      /** Player-facing copy; no substitutions. */
      objective: string;
      /**
       * Authored copy for the terminal control on that conversation. Falls back
       * to a generic label when omitted.
       */
      actionLabel?: string;
    };

/** The kinds a requirement may take, used for semantic stage routing. */
export type MissionRequirementKind = MissionRequirement["kind"];

/**
 * One authored offer interaction. A mission may have several real offer routes
 * (Walk It Off through Wade at the Crash Site, or Tansy at The Jag for the
 * explorer-first remote acceptance). Offer location/dialogue semantics are
 * authored explicitly so the UI never infers mission rules from NPC names.
 */
export type MissionOffer = {
  npcId: NpcId;
  locationId: LocationId;
  /** The offer/acceptance dialogue sequence. */
  dialogueId: DialogueId;
  /**
   * Authored copy for the acceptance control on this offer's conversation.
   * Falls back to the generic acceptance label when omitted.
   */
  actionLabel?: string;
  /**
   * Optional authored continuation presented immediately after a successful
   * acceptance at this offer (e.g. Tansy's remote-acceptance follow-up that
   * leads straight to the Cutter claim).
   */
  acceptedContinuation?: MissionOfferContinuation;
  /**
   * Authored dialogue while this mission is active (e.g. Wade reminding the
   * player to reach Tansy at The Jag). Distinct from ordinary completed-story
   * dialogue authored via completedNpcDialogue.
   */
  activeDialogueId?: DialogueId;
  /**
   * Applied exactly once when acceptance at THIS offer route commits (Wade's
   * 24-Credit job budget). Absent for an ordinary offer.
   */
  acceptEffect?: MissionAcceptEffect;
};

/**
 * An authored post-acceptance continuation for one offer route. `completesMission`
 * is the one narrow case proven by production content: Tansy's explorer-first
 * acceptance walks straight into this mission's own authoritative turn-in, so the
 * continuation presents the mission's turn-in action instead of ending the
 * conversation. The action itself stays server-authoritative — this only says
 * which authored control the continuation shows.
 */
export type MissionOfferContinuation = {
  dialogueId: DialogueId;
  completesMission?: true;
};

/**
 * Ordinary post-completion story dialogue authored for an NPC after a
 * particular mission completes, including NPCs who were not that mission's
 * offer or turn-in participant. This is how a later mission can advance
 * Wade's understanding even when Wade did not offer/turn in that mission.
 */
export type MissionNpcDialogue = {
  npcId: NpcId;
  dialogueId: DialogueId;
};

/**
 * The authoritative turn-in interaction. The turn-in location is authored
 * here — mission location semantics never derive from an NPC's home location,
 * so a future NPC-movement/phase feature cannot accidentally depend on an
 * "NPC home equals mission location" invariant.
 */
export type MissionTurnIn = {
  npcId: NpcId;
  locationId: LocationId;
  requiresStationary: true;
  /** Objective copy once every requirement holds. */
  objective: string;
  /** The turn-in dialogue sequence. The conversation attaches the completion action. */
  dialogueId: DialogueId;
  /**
   * Authored copy for the completion control (e.g. "Claim Cutter",
   * "SHOW SHALE"). Falls back to a generic label when omitted.
   */
  actionLabel?: string;
};

/**
 * Authored semantic dialogue mappings. Stable semantic mission state selects
 * the sequence; no boolean-expression language and no prose in server logic.
 * All fields optional — a mission authors only the branches it needs.
 */
export type MissionDialogue = {
  /** First unmet requirement is an equipped_item. */
  equipmentReminderDialogueId?: DialogueId;
  /** First unmet requirement is a carried_stack. */
  carriedReminderDialogueId?: DialogueId;
  /** First unmet requirement is a tracked activity. */
  trackedActivityReminderDialogueId?: DialogueId;
  /** First unmet requirement is an unfinished repair target. */
  repairReminderDialogueId?: DialogueId;
  /** First unmet requirement is a mandatory authored NPC conversation. */
  conversationReminderDialogueId?: DialogueId;
  /** Requirements satisfied but the turn-in is not performable (busy). */
  busyDialogueId?: DialogueId;
  /**
   * Presentation-only completion beats revealed after the authoritative
   * success (item / skill-XP beats). Never mutates state.
   */
  completionPresentationDialogueId?: DialogueId;
  /** Item-reward capacity refusal branches. */
  capacitySlotsDialogueId?: DialogueId;
  capacityMassDialogueId?: DialogueId;
};

export type MissionDefinition = {
  id: MissionId;
  title: string;
  summary: string;
  /**
   * Stable mission ID that must be completed before this one can be offered
   * or accepted. Absent for the first mission in the chain.
   */
  prerequisiteMissionId?: MissionId;
  /**
   * Explicitly authored automatic continuation: when this mission
   * successfully completes, the generic completion boundary atomically
   * accepts this mission. Zero or one per mission — no fan-out or
   * branching. Never inferred from prerequisites: a prerequisite only says
   * the later mission cannot begin first, not that it directly continues
   * the story.
   */
  continuationMissionId?: MissionId;
  /** Authored offer interactions; continuation-only missions may have none. */
  offers: readonly MissionOffer[];
  /** Ordered reusable live-state requirements. */
  requirements: readonly MissionRequirement[];
  turnIn: MissionTurnIn;
  /**
   * At most one authored completion reward. Absent when the mission's real
   * outcome is world/social state rather than a grant: Keep the Change pays its
   * budget up front at acceptance and deliberately adds no completion payout.
   */
  reward?: MissionReward;
  dialogue: MissionDialogue;
  /**
   * Ordinary post-completion story dialogue for one or more relevant NPCs
   * after this mission completes, including NPCs who were not this mission's
   * offer or turn-in participant. Selected by latest/furthest completed state
   * in the router; never replays the one-shot completion presentation.
   */
  completedNpcDialogue?: readonly MissionNpcDialogue[];
  /**
   * Ordinary contextual dialogue while this mission is active for relevant
   * NPCs who are neither an offer nor the turn-in NPC.
   */
  activeNpcDialogue?: readonly MissionNpcDialogue[];
};

/**
 * Walk It Off — travel-and-talk. Two offer routes (Wade at the Crash Site, or
 * Tansy at The Jag for explorer-first remote acceptance), one location
 * requirement, and a Cutter item reward claimed at The Jag.
 */
export const WALK_IT_OFF: MissionDefinition = {
  id: MISSION_IDS.walkItOff,
  title: "Walk It Off",
  summary: "Reach The Jag and speak with Tansy Rusk.",
  continuationMissionId: MISSION_IDS.cutYourTeeth,
  offers: [
    {
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.crashSite,
      dialogueId: DIALOGUE_IDS.wadeOffer,
      activeDialogueId: DIALOGUE_IDS.wadeWalkItOffActiveFollowUp,
    },
    {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      dialogueId: DIALOGUE_IDS.tansyBeforeMission,
      acceptedContinuation: {
        dialogueId: DIALOGUE_IDS.tansyAfterRemoteAcceptance,
        completesMission: true,
      },
    },
  ],
  requirements: [
    { kind: "at_location", locationId: LOCATION_IDS.theJag, objective: "Travel to The Jag" },
  ],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.theJag,
    requiresStationary: true,
    objective: "Talk to Tansy Rusk",
    dialogueId: DIALOGUE_IDS.tansyCompletion,
    actionLabel: "Claim Cutter",
  },
  reward: { kind: "item", itemId: ITEM_IDS.salvageCutter },
  dialogue: {
    completionPresentationDialogueId: DIALOGUE_IDS.tansyAfterClaim,
    capacitySlotsDialogueId: DIALOGUE_IDS.tansyCapacitySlots,
    capacityMassDialogueId: DIALOGUE_IDS.tansyCapacityMass,
  },
  completedNpcDialogue: [{ npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadeFollowUp }],
};

/**
 * Cut Your Teeth (issue #110) — equip-and-collect. Teaches the real Inventory
 * → Equip flow and the Mining loop. Collection observes the player's CURRENT
 * carried Ferrite Shale — no provenance, history, or mined-since-acceptance
 * tracking — and scavenged shale counts exactly like mined shale. The shale is
 * shown, never consumed.
 */
export const CUT_YOUR_TEETH: MissionDefinition = {
  id: MISSION_IDS.cutYourTeeth,
  title: "Cut Your Teeth",
  summary:
    "Make five real Mining attempts with your equipped Salvage Cutter, then show Tansy Rusk a full stack of Ferrite Shale at The Jag.",
  prerequisiteMissionId: MISSION_IDS.walkItOff,
  continuationMissionId: MISSION_IDS.wasteNot,
  offers: [
    {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      dialogueId: DIALOGUE_IDS.tansyCutYourTeethOffer,
    },
  ],
  requirements: [
    { kind: "at_location", locationId: LOCATION_IDS.theJag, objective: "Return to The Jag" },
    {
      kind: "equipped_item",
      itemId: ITEM_IDS.salvageCutter,
      objective: "Equip the {item} from Inventory",
    },
    {
      kind: "tracked_activity",
      progressKey: "mining-attempts",
      activity: "mining",
      metric: "attempts",
      target: 5,
      objective: "Complete 5 Mining attempts — {current} / {target}",
      recommendedActionId: ACTION_IDS.ferriteShaleMining,
    },
    {
      kind: "carried_stack",
      itemId: ITEM_IDS.ferriteShale,
      turnIn: "show",
      objective: "Get a full stack of {item} — {carried} / {required}",
      recommendedActionId: ACTION_IDS.ferriteShaleMining,
    },
  ],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.theJag,
    requiresStationary: true,
    objective: "Show a full stack of Ferrite Shale to Tansy Rusk",
    dialogueId: DIALOGUE_IDS.tansyCutYourTeethTurnIn,
    actionLabel: "SHOW SHALE",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 100 },
  dialogue: {
    equipmentReminderDialogueId: DIALOGUE_IDS.tansyCutYourTeethEquipReminder,
    trackedActivityReminderDialogueId: DIALOGUE_IDS.tansyCutYourTeethMiningReminder,
    carriedReminderDialogueId: DIALOGUE_IDS.tansyCutYourTeethStackReminder,
    busyDialogueId: DIALOGUE_IDS.tansyCutYourTeethBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.tansyCutYourTeethCompletion,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyPostCutYourTeeth },
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadePostCutYourTeeth },
  ],
  activeNpcDialogue: [{ npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadeCutYourTeethActive }],
};

/** Waste Not is accepted only as Cut Your Teeth's authored continuation. */
export const WASTE_NOT: MissionDefinition = {
  id: MISSION_IDS.wasteNot,
  title: "Waste Not",
  summary:
    "Complete five Refining attempts at the Abandoned Processing Yard, then report to Wade Rusk at the Crash Site.",
  prerequisiteMissionId: MISSION_IDS.cutYourTeeth,
  continuationMissionId: MISSION_IDS.holdItTogether,
  offers: [],
  requirements: [
    {
      kind: "tracked_activity",
      progressKey: "refining-attempts",
      activity: "refining",
      metric: "attempts",
      target: 5,
      objective:
        "Complete 5 Refining attempts at the Abandoned Processing Yard — {current} / {target}",
      recommendedActionId: ACTION_IDS.refining,
    },
  ],
  turnIn: {
    npcId: NPC_IDS.wadeRusk,
    locationId: LOCATION_IDS.crashSite,
    requiresStationary: true,
    objective: "Return to Wade Rusk at the Crash Site",
    dialogueId: DIALOGUE_IDS.wadeWasteNotTurnIn,
    actionLabel: "REPORT TO WADE",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.refining, amount: 100 },
  dialogue: {
    trackedActivityReminderDialogueId: DIALOGUE_IDS.wadeWasteNotTrackedActivityReminder,
    busyDialogueId: DIALOGUE_IDS.wadeWasteNotBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.wadeWasteNotCompletion,
  },
  activeNpcDialogue: [{ npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyWasteNotActive }],
  completedNpcDialogue: [
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadePostWasteNot },
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyPostWasteNot },
  ],
};

/** Hold It Together is accepted only as Waste Not's authored continuation. */
export const HOLD_IT_TOGETHER: MissionDefinition = {
  id: MISSION_IDS.holdItTogether,
  title: "Hold It Together",
  summary: "Repair the Cargo Hold at the Crash Site, then report to Wade Rusk.",
  prerequisiteMissionId: MISSION_IDS.wasteNot,
  offers: [],
  requirements: [
    {
      kind: "repair_target_complete",
      targetId: REPAIR_TARGET_IDS.cargoHold,
      objective: "Repair the Cargo Hold at the Crash Site",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.wadeRusk,
    locationId: LOCATION_IDS.crashSite,
    requiresStationary: true,
    objective: "Report the repaired Cargo Hold to Wade Rusk",
    dialogueId: DIALOGUE_IDS.wadeHoldItTogetherTurnIn,
    actionLabel: "REPORT REPAIR",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.welding, amount: 100 },
  dialogue: {
    repairReminderDialogueId: DIALOGUE_IDS.wadeHoldItTogetherRepairReminder,
    busyDialogueId: DIALOGUE_IDS.wadeHoldItTogetherBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.wadeHoldItTogetherCompletion,
  },
  activeNpcDialogue: [
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyHoldItTogetherActive },
  ],
  completedNpcDialogue: [
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadePostHoldItTogether },
  ],
};

/**
 * Keep the Change — Wade's apprenticeship job (#170).
 *
 * The first mission that is neither the opening discovery nor an authored
 * continuation: Hold It Together names no continuation, so the player earns it
 * by going back to Wade and taking the job themselves.
 *
 * Wade's 24 Credits arrive up front as the offer's accept effect — the retail
 * cost of three Power Cells from Bix — and whatever the player does not spend
 * stays theirs. Meeting Bix is a real ordered requirement even for a player who
 * already carries Cells, because the job is also a professional introduction;
 * buying anything never is. The three Cells may come from any legitimate source
 * and are consumed at the delivery through the generic carried-stack boundary.
 */
export const KEEP_THE_CHANGE: MissionDefinition = {
  id: MISSION_IDS.keepTheChange,
  title: "Keep the Change",
  summary: "Meet Bix Weller in Holo Hollow, then get three Power Cells to Tansy Rusk at The Jag.",
  prerequisiteMissionId: MISSION_IDS.holdItTogether,
  offers: [
    {
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.crashSite,
      dialogueId: DIALOGUE_IDS.wadeKeepTheChangeOffer,
      actionLabel: "TAKE THE JOB",
      acceptEffect: { kind: "credits", amount: 24 },
      activeDialogueId: DIALOGUE_IDS.wadeKeepTheChangeActive,
    },
  ],
  requirements: [
    {
      kind: "npc_conversation",
      npcId: NPC_IDS.bixWeller,
      locationId: LOCATION_IDS.holoHollow,
      dialogueId: DIALOGUE_IDS.bixKeepTheChangeIntroduction,
      progressKey: "bix-introduction",
      objective: "Meet Bix Weller at his shop in Holo Hollow",
      actionLabel: "GOOD TO KNOW",
    },
    {
      kind: "carried_stack",
      itemId: ITEM_IDS.powerCell,
      quantity: 3,
      turnIn: "consume_required_quantity",
      objective: "Carry three {item} — {carried} / {required}",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.theJag,
    requiresStationary: true,
    objective: "Take the Power Cells to Tansy Rusk at The Jag",
    dialogueId: DIALOGUE_IDS.tansyKeepTheChangeTurnIn,
    actionLabel: "HAND OVER CELLS",
  },
  dialogue: {
    conversationReminderDialogueId: DIALOGUE_IDS.tansyKeepTheChangeConversationReminder,
    carriedReminderDialogueId: DIALOGUE_IDS.tansyKeepTheChangeCarriedReminder,
    busyDialogueId: DIALOGUE_IDS.tansyKeepTheChangeBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.tansyKeepTheChangeCompletion,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadePostKeepTheChange },
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyPostKeepTheChange },
  ],
};

/**
 * Out of the Weather — RuneSpace's first deliberately optional side Mission (#172).
 *
 * It hangs off Hold It Together rather than continuing from it: Welding was not
 * a quest-specific button, so the capability Wade taught is now simply something
 * the character knows how to do. Renn offers it; nothing offers it automatically,
 * and it names no continuation, so ignoring it forever costs the player nothing.
 * Keep the Change shares the same prerequisite and is entirely unaffected.
 *
 * The completion reward is 250 Welding XP on top of the 500 the ten genuine
 * Welding increments already paid — the work is the work, and Renn's is
 * recognition for it. There is deliberately no Credit payout: the reward the
 * issue actually cares about is that the Crew Stop stays fixed and the crews
 * will let the player ride along.
 */
export const OUT_OF_THE_WEATHER: MissionDefinition = {
  id: MISSION_IDS.outOfTheWeather,
  title: "Out of the Weather",
  summary: "Repair the Crew Stop on Holo Hollow's haul road, then tell Renn Calder.",
  prerequisiteMissionId: MISSION_IDS.holdItTogether,
  offers: [
    {
      npcId: NPC_IDS.rennCalder,
      locationId: LOCATION_IDS.holoHollow,
      dialogueId: DIALOGUE_IDS.rennOutOfTheWeatherOffer,
      actionLabel: "TAKE THE JOB",
    },
  ],
  requirements: [
    {
      kind: "repair_target_complete",
      targetId: REPAIR_TARGET_IDS.crewStop,
      objective: "Repair the Crew Stop in Holo Hollow",
      materialObjective: "Install {item} at the Crew Stop — {contributed} / {required}",
      weldingObjective: "Weld the Crew Stop — {current} / {target} welds",
      materialGuidance: "when_carrying",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.rennCalder,
    locationId: LOCATION_IDS.holoHollow,
    requiresStationary: true,
    objective: "Tell Renn Calder the Crew Stop is fixed",
    dialogueId: DIALOGUE_IDS.rennOutOfTheWeatherTurnIn,
    actionLabel: "TELL RENN",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.welding, amount: 250 },
  dialogue: {
    repairReminderDialogueId: DIALOGUE_IDS.rennOutOfTheWeatherRepairReminder,
    busyDialogueId: DIALOGUE_IDS.rennOutOfTheWeatherBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.rennOutOfTheWeatherCompletion,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.rennCalder, dialogueId: DIALOGUE_IDS.rennPostOutOfTheWeather },
  ],
};

/** Ordered chain of authored missions; later entries may require earlier ones. */
export const MISSIONS: readonly MissionDefinition[] = [
  WALK_IT_OFF,
  CUT_YOUR_TEETH,
  WASTE_NOT,
  HOLD_IT_TOGETHER,
  KEEP_THE_CHANGE,
  // The optional branch sits after the main chain: it is never a prerequisite
  // for anything, and completing or ignoring it changes nothing upstream.
  OUT_OF_THE_WEATHER,
];

const missions = new Map<string, MissionDefinition>(
  MISSIONS.map((mission) => [mission.id, mission]),
);

export function getMission(missionId: string): MissionDefinition | undefined {
  return missions.get(missionId);
}
