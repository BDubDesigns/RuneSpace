import {
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
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
 */
export type MissionReward =
  | { kind: "item"; itemId: ItemId }
  | { kind: "skill_xp"; skillId: SkillId; amount: number };

/**
 * One authored objective step observed against current authoritative state.
 * Steps never create progress tracking: satisfaction is recomputed from the
 * character's live equipment/inventory on every projection.
 */
export type MissionObjectiveStep =
  | {
      kind: "equip_item";
      /** The item that must currently occupy its compatible equipment slot. */
      itemId: ItemId;
      /** Player-facing copy; `{item}` receives the authoritative display name. */
      template: string;
    }
  | {
      kind: "carry_stack";
      /** The item whose current carried quantity is observed. */
      itemId: ItemId;
      /**
       * Omitted quantity means "one authoritative full stack": the projection
       * resolves the number from the item definition's stack limit rather than
       * duplicating balance values in quest content.
       */
      quantity?: number;
      /** Player-facing copy; `{item}`, `{carried}`, `{required}` are substituted. */
      template: string;
    };

export type MissionDefinition = {
  id: MissionId;
  title: string;
  summary: string;
  offeringNpcId: NpcId;
  completionNpcId: NpcId;
  relevantLocationId: LocationId;
  reward: MissionReward;
  /**
   * Stable mission ID that must be completed before this one can be offered
   * or accepted. Absent for the first mission in the chain.
   */
  prerequisiteMissionId?: MissionId;
  /** Objective copy while the mission points the player somewhere else. */
  travelObjective?: string;
  /** Objective copy once every step is satisfied at the mission location. */
  completionObjective?: string;
  /**
   * Player-facing copy shown while the mission is available but not yet
   * accepted, pointing the player at the quest giver. Mirrors how Walk It Off
   * presents "Travel to The Jag" before acceptance.
   */
  availableObjective?: string;
  /** Ordered objective steps evaluated before the completion objective. */
  objectiveSteps?: readonly MissionObjectiveStep[];
};

/**
 * Authored mission identity/content. Objective semantics remain deliberately
 * narrow to the real slices proved by production: travel-and-talk (Walk It
 * Off) and equip-and-collect (Cut Your Teeth).
 */
export const WALK_IT_OFF: MissionDefinition = {
  id: MISSION_IDS.walkItOff,
  title: "Walk It Off",
  summary: "Reach The Jag and speak with Tansy Rusk.",
  offeringNpcId: NPC_IDS.wadeRusk,
  completionNpcId: NPC_IDS.tansyRusk,
  relevantLocationId: LOCATION_IDS.theJag,
  reward: { kind: "item", itemId: ITEM_IDS.salvageCutter },
  travelObjective: "Travel to The Jag",
  completionObjective: "Talk to Tansy Rusk",
};

/**
 * Second story mission (issue #110). Teaches the real Inventory → Equip flow
 * and the Mining loop using the Salvage Cutter already granted by Walk It
 * Off. Collection observes the player's CURRENT carried Ferrite Shale — no
 * provenance, history, or mined-since-acceptance tracking — and scavenged
 * shale counts exactly like mined shale.
 */
export const CUT_YOUR_TEETH: MissionDefinition = {
  id: MISSION_IDS.cutYourTeeth,
  title: "Cut Your Teeth",
  summary:
    "Equip your Salvage Cutter, then show Tansy Rusk a full stack of Ferrite Shale at The Jag.",
  offeringNpcId: NPC_IDS.tansyRusk,
  completionNpcId: NPC_IDS.tansyRusk,
  relevantLocationId: LOCATION_IDS.theJag,
  reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 100 },
  prerequisiteMissionId: MISSION_IDS.walkItOff,
  travelObjective: "Return to The Jag",
  availableObjective: "Speak with Tansy Rusk at The Jag to begin Cut Your Teeth.",
  objectiveSteps: [
    {
      kind: "equip_item",
      itemId: ITEM_IDS.salvageCutter,
      template: "Equip the {item} from Inventory",
    },
    {
      kind: "carry_stack",
      itemId: ITEM_IDS.ferriteShale,
      template: "Get a full stack of {item} — {carried} / {required}",
    },
  ],
  completionObjective: "Show a full stack of Ferrite Shale to Tansy Rusk",
};

const missions = new Map<string, MissionDefinition>([
  [WALK_IT_OFF.id, WALK_IT_OFF],
  [CUT_YOUR_TEETH.id, CUT_YOUR_TEETH],
]);

export function getMission(missionId: string): MissionDefinition | undefined {
  return missions.get(missionId);
}

/** Ordered chain of authored missions; later entries may require earlier ones. */
export const MISSIONS: readonly MissionDefinition[] = [WALK_IT_OFF, CUT_YOUR_TEETH];
