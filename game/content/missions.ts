import {
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  type ItemId,
  type LocationId,
  type MissionId,
  type NpcId,
} from "@/game/config/foundations";

export type MissionDefinition = {
  id: MissionId;
  title: string;
  summary: string;
  offeringNpcId: NpcId;
  completionNpcId: NpcId;
  relevantLocationId: LocationId;
  rewardItemId: ItemId;
  travelObjective: string;
  completionObjective: string;
};

/**
 * Authored mission identity/content. Objective semantics remain deliberately
 * narrow to the one real travel-and-talk slice proved by this issue.
 */
export const WALK_IT_OFF: MissionDefinition = {
  id: MISSION_IDS.walkItOff,
  title: "Walk It Off",
  summary: "Reach The Jag and speak with Tansy Rusk.",
  offeringNpcId: NPC_IDS.wadeRusk,
  completionNpcId: NPC_IDS.tansyRusk,
  relevantLocationId: LOCATION_IDS.theJag,
  rewardItemId: ITEM_IDS.salvageCutter,
  travelObjective: "Travel to The Jag",
  completionObjective: "Talk to Tansy Rusk",
};

const missions = new Map<string, MissionDefinition>([[WALK_IT_OFF.id, WALK_IT_OFF]]);

export function getMission(missionId: string): MissionDefinition | undefined {
  return missions.get(missionId);
}

export const MISSIONS: readonly MissionDefinition[] = [WALK_IT_OFF];
