import { SKILL_IDS } from "@/game/config/foundations";
import type { ItemSourceFacts } from "@/game/domain/item-sources";
import type { PlayGameplayState } from "@/server/play";

/**
 * What the item-source reference needs to know about the active character,
 * read from the Play projection that is already on screen (#326). Nothing is
 * fetched or persisted for this feature, and nothing here is computed: levels,
 * Mission acceptance and each location's resolved actions are the server's.
 */
export function itemSourceFactsFromState(
  state: Pick<
    PlayGameplayState,
    "mining" | "refining" | "welding" | "fabrication" | "missions" | "locationStates"
  >,
): ItemSourceFacts {
  return {
    skillLevels: {
      [SKILL_IDS.mining]: state.mining.level,
      [SKILL_IDS.refining]: state.refining.level,
      [SKILL_IDS.welding]: state.welding.level,
      [SKILL_IDS.fabrication]: state.fabrication.level,
    },
    acceptedMissionIds: new Set(
      state.missions
        .filter((mission) => mission.state !== "not_accepted")
        .map((mission) => mission.missionId),
    ),
    locationStates: state.locationStates,
  };
}
