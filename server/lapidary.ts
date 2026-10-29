import { and, eq } from "drizzle-orm";
import { characterLapidaryState, characterMissions } from "@/db/rune-space";
import { lapidaryRecipes, lapidaryActionIds } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { LAPIDARY_WORKBENCH } from "@/game/content/lapidary";
import { THEYRE_MINERALS_MARIE } from "@/game/content/missions";
import {
  missionActivityAccess,
  validateMissionActivityAccess,
} from "@/game/domain/activity-access";
import { createCraftingActivity } from "@/server/deterministic-crafting";
import type { DatabaseTransaction } from "@/server/action-resolution";

validateMissionActivityAccess(
  LAPIDARY_WORKBENCH.access,
  THEYRE_MINERALS_MARIE,
  lapidaryActionIds(),
);
export async function loadLapidaryAccess(transaction: DatabaseTransaction, characterId: string) {
  const [row] = await transaction
    .select()
    .from(characterMissions)
    .where(
      and(
        eq(characterMissions.characterId, characterId),
        eq(characterMissions.missionId, LAPIDARY_WORKBENCH.access.missionId),
      ),
    );
  return missionActivityAccess(LAPIDARY_WORKBENCH.access, THEYRE_MINERALS_MARIE, row);
}
export const lapidaryActivity = createCraftingActivity({
  table: characterLapidaryState,
  skillId: SKILL_IDS.lapidary,
  activity: "lapidary",
  recipes: lapidaryRecipes,
  loadAccess: loadLapidaryAccess,
});
