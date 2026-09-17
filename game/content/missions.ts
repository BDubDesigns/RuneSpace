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
 * The real completion reward shapes proven by production content. A mission
 * grants at most one reward: an inventory item (Walk It Off), skill XP through
 * the authoritative progression boundary (Cut Your Teeth), Credits
 * (10,000 Hours), or one all-or-nothing stackable bundle (10,001 Hours).
 * Deliberately narrow — no reputation, multi-reward missions, or effect lists.
 *
 * Item rewards are granted as ONE new unique item instance (the generic
 * completion boundary's sole item execution path); registry validation
 * rejects stackable item rewards until a real mission earns that path.
 *
 * Credits are paid by the same exactly-once completion transaction that stamps
 * the mission complete, so Wade's fifty for a first day of shop time is never
 * granted by NPC-specific code and never granted twice (#190).
 */
export type MissionReward =
  | { kind: "item"; itemId: ItemId }
  | { kind: "skill_xp"; skillId: SkillId; amount: number }
  | { kind: "credits"; amount: number }
  /**
   * Several stackable items granted TOGETHER as one all-or-nothing bundle
   * (#207).
   *
   * Deliberately its own kind rather than an array of rewards: everything in a
   * bundle lands in one transaction or none of it does, and its capacity is
   * preflighted as one combined grant against an evolving hypothetical
   * inventory — never by proving each item fits independently from the same
   * starting snapshot, which would wrongly accept two items that each fit alone
   * but not together. 10,001 Hours' ten Refined Ferrite and five Power Cells
   * are the first real need for it.
   */
  | { kind: "stack_bundle"; items: readonly MissionRewardStackItem[] };

/** One stackable line of a `stack_bundle` reward. */
export type MissionRewardStackItem = { itemId: ItemId; quantity: number };

/**
 * An authored effect applied when one offer route's acceptance commits.
 *
 * This is what the person offering the job hands over so the work can start,
 * not a reward for finishing it: Keep the Change hands the player Wade's
 * Credits so they can go buy what the job needs, and 10,000 Hours hands them
 * the six pieces of Scrap his first three practice welds will consume. It is
 * applied inside the generic acceptance transaction, in the branch that has
 * already proven this is a genuinely fresh acceptance, so the existing
 * acceptance guard makes it exactly-once without a second mechanism.
 *
 * A `stack_item` grant is all-or-nothing against ordinary carrying capacity:
 * the acceptance is preflighted before anything is written, so a player without
 * room for the whole grant gets no items, no partial stack, and no accepted
 * Mission — just the authored refusal and an open invitation to come back.
 *
 * Deliberately narrow: two closed shapes, authored per offer route, never a
 * generic effect list or a scripting language.
 */
export type MissionAcceptEffect =
  | { kind: "credits"; amount: number }
  | { kind: "stack_item"; itemId: ItemId; quantity: number };

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
      activity: "mining" | "refining" | "practice_welding" | "work_order";
      /**
       * Closed production metric vocabulary: one resolved unit of that
       * activity. For Mining and Refining that is a resolved attempt; for
       * Practice Welding it is a completed weld — never a section, a start, or
       * a button press (#190).
       */
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
      /**
       * Player-facing copy for the job as a whole. The framework generates the
       * live phase copy — installing each material, then welding — from the
       * repair target's own identity and recipe (#172), so a requirement needs
       * nothing but its `kind` and `targetId` to read correctly at every stage.
       */
      objective: string;
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
  /**
   * Capacity refusal branches, for a grant that will not fit: an item reward at
   * the turn-in, or an authored `stack_item` acceptance effect at the offer
   * (#190). A mission may point both at one shared sequence when the person
   * refusing has nothing different to say about slots than about mass.
   */
  capacitySlotsDialogueId?: DialogueId;
  capacityMassDialogueId?: DialogueId;
};

/** One authored minimum skill level a mission requires before it is offered. */
export type MissionSkillPrerequisite = {
  skillId: SkillId;
  /** Positive integer level on that skill's approved progression curve. */
  level: number;
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
   * An authored skill-level prerequisite (#207).
   *
   * Like `prerequisiteMissionId`, this is an eligibility rule and never a
   * reveal mechanism: below the level the mission is simply not offered and
   * cannot be accepted, at the offer NPC or anywhere else. Projection derives
   * it and the authoritative acceptance command revalidates it from the same
   * authored content, so no surface holds a level literal of its own and no
   * Mission-specific check exists in a command.
   *
   * 10,001 Hours is the first use: Wade will not put customer property in front
   * of an apprentice below Welding 5, which is a rule about the work rather
   * than about Wade.
   */
  prerequisiteSkillLevel?: MissionSkillPrerequisite;
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
      actionLabel: "PITCH IN",
    },
  ],
  requirements: [
    {
      kind: "repair_target_complete",
      targetId: REPAIR_TARGET_IDS.crewStop,
      objective: "Repair the Crew Stop in Holo Hollow",
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
/**
 * 10,000 Hours — Wade's apprentice earns bench time (#190).
 *
 * The Mission chain's next main step, and deliberately not a continuation:
 * Keep the Change ends with Tansy calling Wade on comms and Wade telling the
 * player to come by the shop, and that is all the guidance the framework
 * gives. Rusk Recovery has been on the map since the beginning, so the player
 * walks there because a person they work for asked them to — not because an
 * accepted Mission revealed a destination.
 *
 * Wade owns the offer because it is his business, his apprentice, his
 * training, his Scrap, and his future client work. Tansy's part is the
 * handoff, not the assignment.
 *
 * The offer conversation IS the onboarding scene, so there is no mandatory
 * `npc_conversation` requirement whose only purpose would be meeting a man the
 * player is already standing in front of. Everything that scene establishes —
 * the shop, the bench, the six pieces of Scrap, and the line about client
 * property — commits with the ordinary acceptance: the authored
 * `stack_item` acceptance effect is preflighted all-or-nothing, so a player
 * without room leaves with no Scrap and no accepted Mission, hears Wade's
 * one shared refusal, and simply comes back when they have room.
 *
 * That same accepted state is the single source of truth for what the shop
 * opens up: the Workbench and Wade's Trade both read it, and it stays true
 * after completion, so there is no second `practice_unlocked` flag to drift.
 */
export const TEN_THOUSAND_HOURS: MissionDefinition = {
  id: MISSION_IDS.tenThousandHours,
  title: "10,000 Hours",
  summary: "Put real bench time in at Wade Rusk's Workbench in Rusk Recovery.",
  prerequisiteMissionId: MISSION_IDS.keepTheChange,
  offers: [
    {
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.ruskRecovery,
      dialogueId: DIALOGUE_IDS.wadeTenThousandHoursOffer,
      actionLabel: "PICK UP THE TORCH",
      // Six pieces, all at once or not at all: Practice consumes two per weld
      // and the Mission asks for three (§5, #190).
      acceptEffect: { kind: "stack_item", itemId: ITEM_IDS.scrapMetal, quantity: 6 },
      acceptedContinuation: { dialogueId: DIALOGUE_IDS.wadeTenThousandHoursAccepted },
    },
  ],
  requirements: [
    {
      // The Mission observes the real activity. Any genuine Practice weld
      // completed while this is active counts — Wade's free Scrap, Scrap the
      // player already had, and Scrap bought back from him are identical, and
      // a weld resolved by the ordinary background/offline path counts too.
      kind: "tracked_activity",
      progressKey: "practice-welds",
      activity: "practice_welding",
      metric: "attempts",
      target: 3,
      objective: "Complete 3 Practice Welds — {current} / {target}",
      recommendedActionId: ACTION_IDS.practiceWelding,
    },
  ],
  turnIn: {
    npcId: NPC_IDS.wadeRusk,
    locationId: LOCATION_IDS.ruskRecovery,
    requiresStationary: true,
    objective: "Show Wade Rusk the work at Rusk Recovery",
    dialogueId: DIALOGUE_IDS.wadeTenThousandHoursTurnIn,
    actionLabel: "SHOW HIM THE WORK",
  },
  // Credits, not Welding XP: the three real welds already paid their own XP
  // through the ordinary Welding path, and paying a second time for the same
  // work would be inventing progression the player did not earn.
  reward: { kind: "credits", amount: 50 },
  dialogue: {
    trackedActivityReminderDialogueId: DIALOGUE_IDS.wadeTenThousandHoursPracticeReminder,
    busyDialogueId: DIALOGUE_IDS.wadeTenThousandHoursBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.wadeTenThousandHoursCompletion,
    // One authored refusal for both capacity causes (#190).
    capacitySlotsDialogueId: DIALOGUE_IDS.wadeTenThousandHoursCapacityRefusal,
    capacityMassDialogueId: DIALOGUE_IDS.wadeTenThousandHoursCapacityRefusal,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadePostTenThousandHours },
  ],
};

/**
 * 10,001 Hours — the one-time onboarding for playable Work Orders (#207).
 *
 * Two things make it unusual, and both are generic framework features rather
 * than Mission-specific code. It is the first mission with an authored skill
 * prerequisite, because Wade's refusal to hand an under-trained apprentice a
 * customer's property is a rule about the work rather than about him. And its
 * ACCEPTANCE — not its turn-in — is the permanent authorization for the Work
 * Orders board, exactly as 10,000 Hours' acceptance opened the Workbench and
 * the Trade counter. Turning it in is Wade looking at the work, not a second
 * gate: the board stays usable with the objective already at 1/1 and Wade
 * still waiting.
 *
 * The requirement observes real Work Order completions through the same generic
 * tracked-activity path Mining, Refining and Practice use, so only the
 * authoritative completion transaction can advance it — never opening the
 * terminal, accepting a job, committing materials, or welding a section.
 */
export const TEN_THOUSAND_ONE_HOURS: MissionDefinition = {
  id: MISSION_IDS.tenThousandOneHours,
  title: "10,001 Hours",
  summary: "Take a paying job off Wade Rusk's Work Orders terminal and finish it.",
  prerequisiteMissionId: MISSION_IDS.tenThousandHours,
  // The board's own authored requirement, expressed once, where projection and
  // the acceptance command both read it.
  prerequisiteSkillLevel: { skillId: SKILL_IDS.welding, level: 5 },
  offers: [
    {
      npcId: NPC_IDS.wadeRusk,
      locationId: LOCATION_IDS.ruskRecovery,
      dialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursOffer,
      actionLabel: "TAKE THE WORK",
      acceptedContinuation: { dialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursAccepted },
      // No acceptance effect: the player buys their own material for a client
      // job, which is the whole point of the recipe being paid up front.
    },
  ],
  requirements: [
    {
      kind: "tracked_activity",
      progressKey: "work-orders-completed",
      activity: "work_order",
      metric: "attempts",
      target: 1,
      objective: "Complete 1 Work Order — {current} / {target}",
      recommendedActionId: ACTION_IDS.workOrderWelding,
    },
  ],
  turnIn: {
    npcId: NPC_IDS.wadeRusk,
    locationId: LOCATION_IDS.ruskRecovery,
    requiresStationary: true,
    objective: "Show Wade Rusk the finished job at Rusk Recovery",
    dialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursTurnIn,
    actionLabel: "SHOW HIM THE JOB",
  },
  // Shop stock, handed over together or not at all. Deliberately not Credits:
  // the job already paid those, and what Wade is solving is the apprentice
  // stopping work to go shopping for their own material.
  reward: {
    kind: "stack_bundle",
    items: [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 10 },
      { itemId: ITEM_IDS.powerCell, quantity: 5 },
    ],
  },
  dialogue: {
    trackedActivityReminderDialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursWorkOrderReminder,
    busyDialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursCompletion,
    // The bundle is large enough that slots and mass are genuinely different
    // problems, so unlike 10,000 Hours each cause gets its own authored beat.
    capacitySlotsDialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursCapacitySlotsRefusal,
    capacityMassDialogueId: DIALOGUE_IDS.wadeTenThousandOneHoursCapacityMassRefusal,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadePostTenThousandOneHours },
  ],
};

export const MISSIONS: readonly MissionDefinition[] = [
  WALK_IT_OFF,
  CUT_YOUR_TEETH,
  WASTE_NOT,
  HOLD_IT_TOGETHER,
  KEEP_THE_CHANGE,
  TEN_THOUSAND_HOURS,
  TEN_THOUSAND_ONE_HOURS,
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
