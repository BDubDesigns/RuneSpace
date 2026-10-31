import { createCraftingCommands } from "@/server/crafting-commands";
import { runeworkingActivity } from "@/server/runeworking";
import { isActionAvailableAtLocation } from "@/game/content/locations";
import type { CraftingCommandError } from "@/server/crafting-commands";
export type RuneworkingCommandError = `runeworking_${CraftingCommandError}`;
export const { start: startRuneworking, finishCurrent: finishCurrentRuneworking } =
  // A recipe is startable at whichever Rig station authors its action: Hilltop
  // Workshop's Seeker, or the personal Rig's Skatboll TP Rune (#441).
  createCraftingCommands(
    runeworkingActivity,
    (locationId, actionId) => isActionAvailableAtLocation(locationId, actionId),
    "runeworking",
  );
