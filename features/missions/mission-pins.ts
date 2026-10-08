import type { NpcConversationEntry } from "@/game/domain/conversation";
import {
  deriveMissionGuidanceTargets,
  type MissionGuidanceTargets,
  type MissionProjection,
} from "@/game/domain/missions";
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

/**
 * The Missions whose guidance the player has asked to see (#335): every
 * Mission except an accepted one the player has unpinned. Not-yet-accepted
 * Missions stay, since their available-offer indicators are not jobs and
 * cannot be pinned. Presentation only; gameplay, the Mission Log and
 * conversation routing keep reading the full `state.missions`.
 */
export function guidancePresentationMissions(state: PlayGameplayState): MissionProjection[] {
  return state.missions.filter(
    (mission) =>
      (mission.state !== "active" && mission.state !== "ready_for_completion") ||
      isMissionPinned(state, mission.missionId),
  );
}

/**
 * The one guidance selection every Map/UI consumer shares: the union of
 * targets over the pinned accepted Missions and the available offers, so a
 * highlight two pinned Missions share survives unpinning either of them.
 */
export function derivePinnedGuidanceTargets(state: PlayGameplayState): MissionGuidanceTargets {
  return deriveMissionGuidanceTargets(guidancePresentationMissions(state));
}

/**
 * Drops the guidance flag from the conversation entries of Missions the player
 * has unpinned (#335). The entry itself, its routing and its action are
 * untouched: only the green/blue highlight on the conversation button goes.
 */
export function presentConversationEntries(
  state: PlayGameplayState,
  entries: readonly NpcConversationEntry[],
): readonly NpcConversationEntry[] {
  const hidden = new Set(
    guidanceMissions(state)
      .filter((mission) => !isMissionPinned(state, mission.missionId))
      .map((mission) => mission.missionId),
  );
  if (hidden.size === 0) return entries;
  return entries.map((entry) => {
    if (entry.kind !== "mission" || !hidden.has(entry.missionId)) return entry;
    const { guidance: _guidance, ...rest } = entry;
    return rest;
  });
}
