import { skillLevelThresholds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import type { ItemSourceFacts } from "@/game/domain/item-sources";
import { deriveAcceptedMissionIds, deriveCompletedMissionIds } from "@/game/domain/missions";
import { levelFromXp } from "@/game/domain/progression";
import type { PlayGameplayState } from "@/server/play";

/**
 * What the item-source reference needs to know about the active character,
 * read from the Play projection that is already on screen (#326). Nothing is
 * fetched or persisted for this feature, and no rule is restated here: levels
 * come from each skill's authoritative XP through its own level curve, Mission
 * sets from the shared Mission derivations, and the Fabrication Station's
 * unlock and each location's resolved actions are the server's.
 */
export function itemSourceFactsFromState(
  state: Pick<
    PlayGameplayState,
    "skillTotalXp" | "missions" | "locationStates" | "fabricationStation"
  >,
): ItemSourceFacts {
  const skillLevels: Record<string, number> = {};
  for (const skillId of Object.values(SKILL_IDS)) {
    // A skill with no approved curve has no levels to gate on.
    const thresholds = skillLevelThresholds(skillId);
    if (thresholds)
      skillLevels[skillId] = levelFromXp(state.skillTotalXp[skillId] ?? 0, thresholds);
  }
  return {
    skillLevels,
    acceptedMissionIds: deriveAcceptedMissionIds(state.missions),
    completedMissionIds: deriveCompletedMissionIds(state.missions),
    fabricationStationUnlocked: state.fabricationStation.unlocked,
    locationStates: state.locationStates,
  };
}
