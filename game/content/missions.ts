import {
  ACTION_IDS,
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
  type ActionId,
  type DialogueId,
  type ItemId,
  type LocationId,
  type MissionId,
  type NpcId,
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
 * One reusable live-state requirement evaluated against current authoritative
 * character state on every projection. Requirements never create progress
 * tracking: satisfaction is recomputed from live location/equipment/inventory.
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
       * duplicating balance values in quest content.
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
   * Optional authored continuation shown immediately after acceptance at this
   * offer (e.g. Tansy's remote-acceptance follow-up that leads straight to the
   * Cutter claim).
   */
  acceptedContinuationDialogueId?: DialogueId;
  /**
   * Authored dialogue while this mission is active (e.g. Wade reminding the
   * player to reach Tansy at The Jag). Distinct from ordinary completed-story
   * dialogue authored via completedNpcDialogue.
   */
  activeDialogueId?: DialogueId;
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
 * "NPC home equals quest location" invariant.
 */
export type MissionTurnIn = {
  npcId: NpcId;
  locationId: LocationId;
  requiresStationary: true;
  /** Objective copy once every requirement holds. */
  objective: string;
  /** The turn-in dialogue sequence (carries the complete_mission action). */
  dialogueId: DialogueId;
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
  /** One or more authored offer interactions (possibly several routes). */
  offers: readonly MissionOffer[];
  /** Ordered reusable live-state requirements. */
  requirements: readonly MissionRequirement[];
  turnIn: MissionTurnIn;
  reward: MissionReward;
  /**
   * Player-facing copy shown while the mission is available but not yet
   * accepted, pointing the player at the quest giver. Absent for missions
   * (Walk It Off) that deliberately keep explorer-first discovery.
   */
  availableObjective?: string;
  dialogue: MissionDialogue;
  /**
   * Ordinary post-completion story dialogue for one or more relevant NPCs
   * after this mission completes, including NPCs who were not this mission's
   * offer or turn-in participant. Selected by latest/furthest completed state
   * in the router; never replays the one-shot completion presentation.
   */
  completedNpcDialogue?: readonly MissionNpcDialogue[];
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
      acceptedContinuationDialogueId: DIALOGUE_IDS.tansyAfterRemoteAcceptance,
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
    "Equip your Salvage Cutter, then show Tansy Rusk a full stack of Ferrite Shale at The Jag.",
  prerequisiteMissionId: MISSION_IDS.walkItOff,
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
  },
  reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 100 },
  availableObjective: "Speak with Tansy Rusk at The Jag to begin Cut Your Teeth.",
  dialogue: {
    equipmentReminderDialogueId: DIALOGUE_IDS.tansyCutYourTeethEquipReminder,
    carriedReminderDialogueId: DIALOGUE_IDS.tansyCutYourTeethStackReminder,
    busyDialogueId: DIALOGUE_IDS.tansyCutYourTeethBusy,
    completionPresentationDialogueId: DIALOGUE_IDS.tansyCutYourTeethCompletion,
  },
  completedNpcDialogue: [
    { npcId: NPC_IDS.tansyRusk, dialogueId: DIALOGUE_IDS.tansyPostCutYourTeeth },
    { npcId: NPC_IDS.wadeRusk, dialogueId: DIALOGUE_IDS.wadePostCutYourTeeth },
  ],
};

/** Ordered chain of authored missions; later entries may require earlier ones. */
export const MISSIONS: readonly MissionDefinition[] = [WALK_IT_OFF, CUT_YOUR_TEETH];

const missions = new Map<string, MissionDefinition>(
  MISSIONS.map((mission) => [mission.id, mission]),
);

export function getMission(missionId: string): MissionDefinition | undefined {
  return missions.get(missionId);
}
