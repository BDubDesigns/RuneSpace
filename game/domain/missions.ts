import type { MissionDefinition } from "@/game/content/missions";

export type MissionState = "not_accepted" | "active" | "ready_for_completion" | "completed";

export type MissionRecordState = {
  acceptedAt?: Date | null;
  completedAt?: Date | null;
};

export type MissionProjection = {
  missionId: string;
  title: string;
  summary: string;
  state: MissionState;
  currentObjective?: string;
  offeringNpcId: string;
  completionNpcId: string;
  rewardItemId: string;
};

export function deriveMissionState(input: {
  mission: MissionRecordState | undefined;
  relevantLocationId: string;
  currentLocationId: string;
  stationary: boolean;
}): MissionState {
  if (!input.mission?.acceptedAt) return "not_accepted";
  if (input.mission.completedAt) return "completed";
  if (input.currentLocationId === input.relevantLocationId && input.stationary) {
    return "ready_for_completion";
  }
  return "active";
}

export function projectMission(
  definition: MissionDefinition,
  mission: MissionRecordState | undefined,
  currentLocationId: string,
  stationary: boolean,
): MissionProjection {
  const state = deriveMissionState({
    mission,
    relevantLocationId: definition.relevantLocationId,
    currentLocationId,
    stationary,
  });
  const currentObjective =
    state === "active"
      ? definition.relevantLocationId === currentLocationId
        ? definition.completionObjective
        : definition.travelObjective
      : state === "ready_for_completion"
        ? definition.completionObjective
        : undefined;
  return {
    missionId: definition.id,
    title: definition.title,
    summary: definition.summary,
    state,
    currentObjective,
    offeringNpcId: definition.offeringNpcId,
    completionNpcId: definition.completionNpcId,
    rewardItemId: definition.rewardItemId,
  };
}
