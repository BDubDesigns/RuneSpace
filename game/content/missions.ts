import {
  ACTION_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
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
import { merchantRetailPrice } from "@/game/content/merchants";

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
      activity: TrackedMissionActivity;
      /**
       * Closed production metric vocabulary. `attempts` is one resolved unit of
       * the activity, succeeded or failed: a Mining or Refining attempt, a
       * completed Practice weld (never a section, a start, or a button press,
       * #190), a completed Work Order. `completions` is one SUCCESSFUL unit only
       * (#232): a Fabrication workpiece that produced its output — never a start,
       * a busted workpiece, or an item obtained any other way — and a completed
       * Tinkering batch. Each activity has exactly one metric; validation holds
       * them together.
       */
      metric: "attempts" | "completions";
      /**
       * Count only this one authored action of the activity (#232): Return the
       * Favor needs a Salvage Cutter fabricated, not any Fabrication. Absent,
       * every action of the activity counts.
       */
      actionId?: ActionId;
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
       * One unique item instance with the character (#232): the smallest
       * unique-item counterpart to `carried_stack`. Items in the Cargo Hold
       * never count. No provenance: any instance of the item satisfies it, so
       * a Cutter bought, found or kept since the start is as good as a new one.
       *
       * `consume_one` hands one carried, unequipped instance over at turn-in,
       * so it can never take the tool in the player's hand. `show` takes
       * nothing, so an equipped instance counts for it too (#233).
       */
      kind: "carried_unique_item";
      itemId: ItemId;
      /** `show` inspects it, carried or equipped; `consume_one` hands one unequipped instance over. */
      turnIn: "show" | "consume_one";
      /** Player-facing copy; `{item}` receives the authoritative display name. */
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
 * The closed tracked-activity vocabulary. Fabrication and Tinkering (#232)
 * count only what genuinely completed.
 */
export type TrackedMissionActivity =
  | "mining"
  | "refining"
  | "practice_welding"
  | "work_order"
  | "fabrication"
  | "tinkering";

/**
 * A narrow Mission-local story fact (#232): a boolean the Mission remembers
 * only so an NPC can react to what the player actually did while it was
 * active. It is set once by the authoritative outcome it observes, lives in
 * the Mission's own progress-key space (and so dies with the Mission row), and
 * never changes a requirement, a reward, or progression. It is not a counter,
 * a lifetime statistic, or telemetry.
 *
 * Deliberately two closed observations, both Manual Override outcomes on one
 * authored Fabrication action — the first real need. A new kind of reactive
 * fact is a deliberate extension, not an authoring choice.
 */
export type MissionReactiveFact = {
  /** Stable key in this Mission's progress-key space. */
  key: string;
  observes:
    | {
        /** A Manual Override push busted a workpiece of this recipe while the Mission was active. */
        kind: "fabrication_override_bust";
        actionId: ActionId;
      }
    | {
        /**
         * The successful workpiece of this recipe that satisfied the named
         * tracked requirement had been pushed with Manual Override.
         */
        kind: "fabrication_override_success";
        actionId: ActionId;
        requirementProgressKey: string;
      };
};

/**
 * One authored dialogue variant chosen by a reactive fact (#232). Variants for
 * the same moment are tried in authored order — that order IS the priority —
 * and the first whose fact holds replaces the ordinary sequence. Every variant
 * rejoins the same story: they are openings, not branches.
 */
export type MissionReactiveDialogue = {
  factKey: string;
  /** The turn-in opening, or the reminder while the tracked activity is the objective. */
  moment: "turn_in" | "tracked_activity_reminder";
  dialogueId: DialogueId;
};

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
   * Keep the Change job budget). Absent for an ordinary offer.
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
  /**
   * Fact-chosen variants of the turn-in opening or the tracked-activity
   * reminder (#232), in priority order. See `MissionReactiveDialogue`.
   */
  reactive?: readonly MissionReactiveDialogue[];
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
   * Authored skill-level prerequisites, all of which must hold (#207, #209).
   *
   * Like `prerequisiteMissionId`, these are eligibility rules and never a
   * reveal mechanism: below the level the mission is simply not offered and
   * cannot be accepted, at the offer NPC or anywhere else. Projection derives
   * them and the authoritative acceptance command revalidates them from the
   * same authored content, so no surface holds a level literal of its own and
   * no Mission-specific check exists in a command.
   *
   * 10,001 Hours was the first use: Wade will not put customer property in
   * front of an apprentice below Welding 5, which is a rule about the work
   * rather than about Wade. Brace Yourself is the first Mission to name more
   * than one skill — a cave-in needs someone who can read the rock *and* set
   * a brace — which is why this is a list rather than a single entry. It stays
   * a flat conjunction on purpose: every prerequisite must hold, and there is
   * deliberately no "any of" or nested condition language here.
   */
  prerequisiteSkillLevels?: readonly MissionSkillPrerequisite[];
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
  /** Narrow Mission-local story facts for reactive dialogue (#232). */
  reactiveFacts?: readonly MissionReactiveFact[];
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
 * Wade's budget arrives up front as the offer's accept effect — the retail
 * cost of three Power Cells from Bix — and whatever the player does not spend
 * stays theirs. Meeting Bix is a real ordered requirement even for a player who
 * already carries Cells, because the job is also a professional introduction;
 * buying anything never is. The three Cells may come from any legitimate source
 * and are consumed at the delivery through the generic carried-stack boundary.
 */
/** The Power Cells Tansy needs, which is also what Wade's budget pays for. */
export const KEEP_THE_CHANGE_CELL_COUNT = 3;

/**
 * Wade's exact job budget: three Cells at Bix's authoritative retail price
 * (#230). Derived rather than authored, so a Power Cell price change moves the
 * budget with it and a stale total cannot survive — 36 Credits at Bix's 12.
 */
export const KEEP_THE_CHANGE_BUDGET_CREDITS =
  KEEP_THE_CHANGE_CELL_COUNT * merchantRetailPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.powerCell);

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
      acceptEffect: { kind: "credits", amount: KEEP_THE_CHANGE_BUDGET_CREDITS },
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
      quantity: KEEP_THE_CHANGE_CELL_COUNT,
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
  prerequisiteSkillLevels: [{ skillId: SKILL_IDS.welding, level: 5 }],
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

/**
 * Return the Favor — Tansy's Fabrication lesson at Rusk Recovery (#232).
 *
 * A deliberate pickup after 10,000 Hours, never an automatic continuation:
 * learning a whole new skill is choosing new work from Tansy. Accepting it
 * opens the Fabrication Station; completing it — her demonstration — opens
 * Tinkering and hands straight on to Break It Down.
 *
 * The fabrication objective counts only a Salvage Cutter the player genuinely
 * fabricates while the Mission is active: buying one, being given one, or
 * owning one already cannot satisfy it, and a busted workpiece is not a Cutter.
 * The hand-in needs no provenance at all — any unequipped Salvage Cutter the
 * player is carrying will do, and the starter Cutter is never singled out.
 *
 * Manual Override stays fully usable on this first craft. Two narrow facts let
 * Tansy react to what she watched: whether an Override push busted a Cutter
 * workpiece, and whether the Cutter that counted had been pushed. Neither is a
 * counter, and neither changes the reward or the requirements.
 */
export const RETURN_THE_FAVOR: MissionDefinition = {
  id: MISSION_IDS.returnTheFavor,
  title: "Return the Favor",
  summary:
    "Fabricate a Salvage Cutter at Rusk Recovery's Fabrication Station and hand Tansy Rusk a Salvage Cutter.",
  prerequisiteMissionId: MISSION_IDS.tenThousandHours,
  continuationMissionId: MISSION_IDS.breakItDown,
  offers: [
    {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.ruskRecovery,
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorOffer,
      actionLabel: "TAKE THE JOB",
    },
  ],
  requirements: [
    {
      kind: "tracked_activity",
      progressKey: "salvage-cutter-fabricated",
      activity: "fabrication",
      metric: "completions",
      actionId: ACTION_IDS.salvageCutterFabrication,
      target: 1,
      objective: "Fabricate a Salvage Cutter at the Fabrication Station — {current} / {target}",
      recommendedActionId: ACTION_IDS.salvageCutterFabrication,
    },
    {
      kind: "carried_unique_item",
      itemId: ITEM_IDS.salvageCutter,
      turnIn: "consume_one",
      objective: "Carry an unequipped {item} to hand over",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.ruskRecovery,
    requiresStationary: true,
    objective: "Bring Tansy Rusk the Salvage Cutter",
    dialogueId: DIALOGUE_IDS.tansyReturnTheFavorTurnIn,
    actionLabel: "HAND OVER THE CUTTER",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.fabrication, amount: 100 },
  reactiveFacts: [
    {
      key: "override-bust",
      observes: {
        kind: "fabrication_override_bust",
        actionId: ACTION_IDS.salvageCutterFabrication,
      },
    },
    {
      key: "override-success",
      observes: {
        kind: "fabrication_override_success",
        actionId: ACTION_IDS.salvageCutterFabrication,
        requirementProgressKey: "salvage-cutter-fabricated",
      },
    },
  ],
  dialogue: {
    trackedActivityReminderDialogueId: DIALOGUE_IDS.tansyReturnTheFavorReminder,
    // With the Cutter made but none carried unequipped, the ordinary reminder
    // still says exactly what is missing: one Salvage Cutter, brought to her.
    carriedReminderDialogueId: DIALOGUE_IDS.tansyReturnTheFavorReminder,
    busyDialogueId: DIALOGUE_IDS.tansyFabricationChapterBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.tansyReturnTheFavorCompletion,
    // Priority is authored order: a bust she saw outranks a clean Override
    // success, and either outranks the ordinary opening. All three rejoin the
    // same inspection, demonstration and continuation.
    reactive: [
      {
        factKey: "override-bust",
        moment: "turn_in",
        dialogueId: DIALOGUE_IDS.tansyReturnTheFavorBustTurnIn,
      },
      {
        factKey: "override-success",
        moment: "turn_in",
        dialogueId: DIALOGUE_IDS.tansyReturnTheFavorOverrideTurnIn,
      },
      {
        factKey: "override-bust",
        moment: "tracked_activity_reminder",
        dialogueId: DIALOGUE_IDS.tansyReturnTheFavorBustReminder,
      },
    ],
  },
};

/**
 * Break It Down — the second half of Tansy's lesson (#232).
 *
 * An authored automatic continuation: it is the next beat of the same teaching
 * sequence, so it has no offer of its own. One genuinely completed Tinkering
 * batch of any eligible item satisfies it; reporting back to Tansy closes the
 * chapter, and her completion sends her home to The Jag (`game/content/npcs.ts`).
 */
export const BREAK_IT_DOWN: MissionDefinition = {
  id: MISSION_IDS.breakItDown,
  title: "Break It Down",
  summary:
    "Tinker one eligible fabricated item at the Fabrication Station, then report to Tansy Rusk.",
  prerequisiteMissionId: MISSION_IDS.returnTheFavor,
  offers: [],
  requirements: [
    {
      kind: "tracked_activity",
      progressKey: "tinkering-batches",
      activity: "tinkering",
      metric: "completions",
      target: 1,
      objective: "Tinker one eligible fabricated item — {current} / {target}",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.ruskRecovery,
    requiresStationary: true,
    objective: "Return to Tansy at Rusk Recovery",
    dialogueId: DIALOGUE_IDS.tansyBreakItDownTurnIn,
    actionLabel: "TELL TANSY",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.fabrication, amount: 250 },
  dialogue: {
    trackedActivityReminderDialogueId: DIALOGUE_IDS.tansyBreakItDownReminder,
    busyDialogueId: DIALOGUE_IDS.tansyFabricationChapterBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.tansyBreakItDownCompletion,
  },
};

/**
 * Brace Yourself — Tansy reopens the Deep Jag (#209).
 *
 * A sibling branch to 10,001 Hours rather than a successor to it: a player may
 * do either, both, or neither first. Since #232 its story gate is Tansy's
 * Fabrication chapter — Break It Down is what sends her back to The Jag, where
 * she raises the Deep Jag — so nothing here mentions Work Orders at all.
 *
 * It is the first Mission to name two skills. Tansy is not asking for a
 * certificate — a cave-in needs someone who can read which rock is holding and
 * someone who can lay a bead that will take load, and below either of those she
 * simply does not raise the subject. Both levels are authored here, where the
 * projection and the acceptance command read the same list.
 *
 * The brace and jack hardware is Tansy's, supplied as part of the job: there is
 * deliberately no carried "brace" item, because the fiction is that she has had
 * the expensive part sitting in storage for years and was waiting for someone
 * worth spending it on. What the player brings is ordinary material — 25
 * Refined Ferrite and 5 Power Cells — and the welding.
 *
 * The requirement observes the repair target and nothing else. Opening the mine
 * is the repair's own doing (the fifteenth section completes it, and the
 * location-state boundary reads that completion directly), so this Mission
 * neither unlocks Deep Jag nor is needed to keep it open: a player who finishes
 * the brace and never walks back to Tansy still has a working mine. The 250
 * Welding XP here is Tansy's recognition on top of the 750 the fifteen genuine
 * sections already paid.
 */
export const BRACE_YOURSELF: MissionDefinition = {
  id: MISSION_IDS.braceYourself,
  title: "Brace Yourself",
  summary: "Set Tansy Rusk's brace in the collapsed Deep Jag passage, then report back to her.",
  // The Fabrication teaching chapter now canonically precedes the Deep Jag
  // (#232): Tansy is back at The Jag only once Break It Down is complete.
  prerequisiteMissionId: MISSION_IDS.breakItDown,
  prerequisiteSkillLevels: [
    { skillId: SKILL_IDS.mining, level: 5 },
    { skillId: SKILL_IDS.welding, level: 5 },
  ],
  offers: [
    {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      dialogueId: DIALOGUE_IDS.tansyBraceYourselfOffer,
      actionLabel: "TAKE THE JOB",
      acceptedContinuation: { dialogueId: DIALOGUE_IDS.tansyBraceYourselfAccepted },
      // No acceptance effect: Tansy supplies the brace hardware as world
      // equipment, and the player buys or mines their own material.
    },
  ],
  requirements: [
    {
      kind: "repair_target_complete",
      targetId: REPAIR_TARGET_IDS.deepJagCaveIn,
      objective: "Brace the collapsed passage at Deep Jag",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.theJag,
    requiresStationary: true,
    objective: "Tell Tansy Rusk the Deep Jag is open",
    dialogueId: DIALOGUE_IDS.tansyBraceYourselfTurnIn,
    actionLabel: "TELL TANSY",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.welding, amount: 250 },
  dialogue: {
    repairReminderDialogueId: DIALOGUE_IDS.tansyBraceYourselfRepairReminder,
    busyDialogueId: DIALOGUE_IDS.tansyBraceYourselfBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.tansyBraceYourselfCompletion,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyPostBraceYourself },
  ],
};

/**
 * A Cut Above — Tansy's Fabrication 5 lesson at The Jag (#233).
 *
 * What it teaches is a rule, not a recipe: new recipes unlock as Fabrication
 * improves. So the Loadsteel Cutter recipe is already open at Fabrication 5
 * whether or not this is ever accepted — accepting it unlocks nothing — and
 * there is no Refining requirement at all, because Fabrication and Refining are
 * separate professions.
 *
 * Return the Favor already proved the player can fabricate a Cutter, so this
 * only asks to see one: any Loadsteel Cutter carried or equipped counts,
 * however it was come by and whatever its charge — including one owned before
 * accepting, which satisfies the objective at once. One left in the Cargo Hold
 * is not with the player and does not. Showing takes nothing: the player keeps
 * the tool.
 */
export const A_CUT_ABOVE: MissionDefinition = {
  id: MISSION_IDS.aCutAbove,
  title: "A Cut Above",
  summary:
    "Fabricate a Loadsteel Cutter at Rusk Recovery's Fabrication Station, then show Tansy Rusk at The Jag.",
  prerequisiteMissionId: MISSION_IDS.braceYourself,
  prerequisiteSkillLevels: [{ skillId: SKILL_IDS.fabrication, level: 5 }],
  offers: [
    {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      dialogueId: DIALOGUE_IDS.tansyACutAboveOffer,
      actionLabel: "TAKE THE JOB",
    },
  ],
  requirements: [
    {
      kind: "carried_unique_item",
      itemId: ITEM_IDS.loadsteelCutter,
      turnIn: "show",
      objective: "Show Tansy a {item}",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.tansyRusk,
    locationId: LOCATION_IDS.theJag,
    requiresStationary: true,
    objective: "Show Tansy a Loadsteel Cutter",
    dialogueId: DIALOGUE_IDS.tansyACutAboveTurnIn,
    actionLabel: "SHOW HER THE CUTTER",
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.fabrication, amount: 500 },
  dialogue: {
    carriedReminderDialogueId: DIALOGUE_IDS.tansyACutAboveReminder,
    // Her ordinary "finish what you're doing" beat at The Jag.
    busyDialogueId: DIALOGUE_IDS.tansyBraceYourselfBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.tansyACutAboveCompletion,
  },
};

/**
 * Cutting Costs — Renn buys a Loadsteel Cutter (#233).
 *
 * An optional purchase, deliberately open to anyone past Brace Yourself: no
 * Fabrication level, and no A Cut Above. Renn wants the Cutter, not proof of
 * who made it, so any Loadsteel Cutter the player is carrying and not wearing
 * will do — made, traded, gifted or otherwise legitimately theirs — through the
 * same unique-item turn-in Return the Favor uses. He keeps it, because he is
 * buying it, and pays once through the ordinary exactly-once Credit reward.
 */
export const CUTTING_COSTS: MissionDefinition = {
  id: MISSION_IDS.cuttingCosts,
  title: "Cutting Costs",
  summary: "Bring Renn Calder a Loadsteel Cutter in Holo Hollow. He'll pay for it.",
  prerequisiteMissionId: MISSION_IDS.braceYourself,
  offers: [
    {
      npcId: NPC_IDS.rennCalder,
      locationId: LOCATION_IDS.holoHollow,
      dialogueId: DIALOGUE_IDS.rennCuttingCostsOffer,
      actionLabel: "TAKE THE JOB",
    },
  ],
  requirements: [
    {
      kind: "carried_unique_item",
      itemId: ITEM_IDS.loadsteelCutter,
      turnIn: "consume_one",
      objective: "Bring Renn a {item}",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.rennCalder,
    locationId: LOCATION_IDS.holoHollow,
    requiresStationary: true,
    objective: "Bring Renn Calder the Loadsteel Cutter in Holo Hollow",
    dialogueId: DIALOGUE_IDS.rennCuttingCostsTurnIn,
    actionLabel: "HAND OVER THE CUTTER",
  },
  reward: { kind: "credits", amount: 500 },
  dialogue: {
    carriedReminderDialogueId: DIALOGUE_IDS.rennCuttingCostsReminder,
    // His ordinary "finish it, I'll be here" beat.
    busyDialogueId: DIALOGUE_IDS.rennOutOfTheWeatherBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.rennCuttingCostsCompletion,
  },
};

/**
 * Each of Curly's two payments for his storage mount (#292): half when the
 * player takes the job, half when they report it done. The two halves are the
 * whole 300-Credit payment — there is no separate materials allowance.
 */
export const CURLY_MUST_STASH_PAYMENT_CREDITS = 150;

/**
 * Curly Must-Stash — an optional paid commission at HH B&B (#292).
 *
 * Curly already owns his storage container; what he needs is somewhere to put
 * it, so the job is the mount and nothing else. It is the same Tier-1 build as
 * The Jag's stash mount, done through the ordinary Mission-authorized repair
 * target inside the B&B, and the work pays its own Welding XP — the Mission
 * adds none. The finished mount holds Curly's box in Curly's room: it is a job
 * finished for him, never storage the player owns or can open.
 *
 * He pays half on acceptance (the offer's acceptance effect) and half on the
 * turn-in (the ordinary completion reward), each exactly once through the
 * generic Mission commands. It names no continuation and nothing requires it,
 * so ignoring it changes nothing anywhere else, including the player's own
 * stash mounts.
 */
export const CURLY_MUST_STASH: MissionDefinition = {
  id: MISSION_IDS.curlyMustStash,
  title: "Curly Must-Stash",
  summary: "Weld a mount for Curly's storage container in his room at HH B&B.",
  prerequisiteMissionId: MISSION_IDS.keepTheChange,
  prerequisiteSkillLevels: [{ skillId: SKILL_IDS.welding, level: 1 }],
  offers: [
    {
      npcId: NPC_IDS.curly,
      locationId: LOCATION_IDS.holoHollow,
      dialogueId: DIALOGUE_IDS.curlyMustStashOffer,
      actionLabel: "TAKE THE JOB",
      acceptEffect: { kind: "credits", amount: CURLY_MUST_STASH_PAYMENT_CREDITS },
      acceptedContinuation: { dialogueId: DIALOGUE_IDS.curlyMustStashAccepted },
    },
  ],
  requirements: [
    {
      kind: "repair_target_complete",
      targetId: REPAIR_TARGET_IDS.curlyStashMount,
      objective: "Build Curly's stash mount at HH B&B",
    },
  ],
  turnIn: {
    npcId: NPC_IDS.curly,
    locationId: LOCATION_IDS.holoHollow,
    requiresStationary: true,
    objective: "Collect the rest of your payment from Curly at HH B&B",
    dialogueId: DIALOGUE_IDS.curlyMustStashTurnIn,
    actionLabel: "COLLECT PAYMENT",
  },
  reward: { kind: "credits", amount: CURLY_MUST_STASH_PAYMENT_CREDITS },
  dialogue: {
    repairReminderDialogueId: DIALOGUE_IDS.curlyMustStashRepairReminder,
    completionPresentationDialogueId: DIALOGUE_IDS.curlyMustStashCompletion,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.curly, dialogueId: DIALOGUE_IDS.curlyPostCurlyMustStash },
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
  // Tansy's Fabrication chapter (#232): after 10,000 Hours, independent of
  // 10,001 Hours, and before the Deep Jag.
  RETURN_THE_FAVOR,
  BREAK_IT_DOWN,
  // Deep Jag's branch is 10,001 Hours' sibling, not its successor: neither
  // needs the other (#209). Its story gate is Break It Down (#232).
  BRACE_YOURSELF,
  // Tansy's Fabrication 5 lesson (#233): after Brace Yourself, at Fabrication 5.
  A_CUT_ABOVE,
  // The optional branch sits after the main chain: it is never a prerequisite
  // for anything, and completing or ignoring it changes nothing upstream.
  OUT_OF_THE_WEATHER,
  // Renn's optional purchase (#233): after Brace Yourself, at any Fabrication
  // level and whether or not A Cut Above was ever taken.
  CUTTING_COSTS,
  // Curly's optional commission at HH B&B (#292), after Keep the Change.
  CURLY_MUST_STASH,
];

const missions = new Map<string, MissionDefinition>(
  MISSIONS.map((mission) => [mission.id, mission]),
);

export function getMission(missionId: string): MissionDefinition | undefined {
  return missions.get(missionId);
}
