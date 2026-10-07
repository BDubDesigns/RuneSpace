import type { MissionProjection } from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";

export type AcceptedMission = MissionProjection & { state: "active" | "ready_for_completion" };

/**
 * Accepted, non-completed Missions in the authoritative Mission order: the one
 * list both Current Missions and the Mission Log's Active section start from,
 * so the two can never disagree about which Missions are active.
 */
export function guidanceMissions(state: PlayGameplayState): AcceptedMission[] {
  return state.missions.filter(
    (mission): mission is AcceptedMission =>
      mission.state === "active" || mission.state === "ready_for_completion",
  );
}

/**
 * Whether the player has this Mission pinned (#325). Absence of an unpin is
 * pinned, so every newly accepted or auto-continued Mission starts pinned.
 * A presentation preference only: nothing about the Mission reads it.
 */
export function isMissionPinned(state: PlayGameplayState, missionId: string): boolean {
  return !state.unpinnedMissionIds.includes(missionId);
}

/** The active Missions Current Missions shows: accepted, not completed, pinned. */
export function pinnedGuidanceMissions(state: PlayGameplayState): AcceptedMission[] {
  return guidanceMissions(state).filter((mission) => isMissionPinned(state, mission.missionId));
}
