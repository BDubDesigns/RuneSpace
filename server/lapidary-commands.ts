import { createCraftingCommands, type CraftingCommandError } from "@/server/crafting-commands";
import { lapidaryActivity } from "@/server/lapidary";
import { LAPIDARY_WORKBENCH } from "@/game/content/lapidary";
export type LapidaryCommandError = `lapidary_${CraftingCommandError}`;
export const { start: startLapidary, finishCurrent: finishCurrentLapidary } =
  createCraftingCommands(lapidaryActivity, LAPIDARY_WORKBENCH.locationId, "lapidary");
