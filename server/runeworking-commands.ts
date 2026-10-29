import { createCraftingCommands } from "@/server/crafting-commands";
import { runeworkingActivity } from "@/server/runeworking";
import { HILLTOP_WORKSHOP_CONTENT } from "@/game/content/hilltop-workshop";
import type { CraftingCommandError } from "@/server/crafting-commands";
export type RuneworkingCommandError = `runeworking_${CraftingCommandError}`;
export const { start: startRuneworking, finishCurrent: finishCurrentRuneworking } =
  createCraftingCommands(runeworkingActivity, HILLTOP_WORKSHOP_CONTENT.locationId, "runeworking");
