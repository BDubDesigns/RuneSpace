import { ACTION_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { MINERALS_MARIE_STAGE_IDS } from "@/game/content/missions";
import type { MissionActivityAccessPolicy } from "@/game/domain/activity-access";

export const LAPIDARY_WORKBENCH = {
  locationId: LOCATION_IDS.wernersLab,
  access: {
    missionId: MISSION_IDS.theyreMineralsMarie,
    supervisedStages: [
      { stageId: MINERALS_MARIE_STAGE_IDS.shape, actionId: ACTION_IDS.shapeStone },
      { stageId: MINERALS_MARIE_STAGE_IDS.cut, actionId: ACTION_IDS.cutQuartz },
    ],
  } satisfies MissionActivityAccessPolicy,
} as const;
