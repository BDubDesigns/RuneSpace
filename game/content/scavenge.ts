import { ITEM_IDS, type ItemId } from "@/game/config/foundations";

export type ScavengeOutcomeId =
  | "zilch"
  | "nothing_burger"
  | "nada"
  | "whammy"
  | "ferrite_shale_1"
  | "ferrite_shale_2"
  | "ferrite_shale_3"
  | "power_cell_1"
  | "power_cell_2"
  | "refined_ferrite_1"
  | "refined_ferrite_2";

export type ScavengeOutcome = {
  id: ScavengeOutcomeId;
  label: string;
  weightBps: number;
  itemId?: ItemId;
  quantity: number;
};

export const SCAVENGE_TOTAL_WEIGHT_BPS = 10_000;

/** The universal walking-Travel table. Weights are exact basis points. */
export const SCAVENGE_OUTCOMES: readonly ScavengeOutcome[] = [
  { id: "zilch", label: "Zilch", weightBps: 750, quantity: 0 },
  { id: "nothing_burger", label: "Nothing Burger", weightBps: 750, quantity: 0 },
  { id: "nada", label: "Nada", weightBps: 750, quantity: 0 },
  { id: "whammy", label: "Whammy!", weightBps: 750, quantity: 0 },
  {
    id: "ferrite_shale_1",
    label: "Ferrite Shale x1",
    weightBps: 2_000,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 1,
  },
  {
    id: "ferrite_shale_2",
    label: "Ferrite Shale x2",
    weightBps: 1_250,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 2,
  },
  {
    id: "ferrite_shale_3",
    label: "Ferrite Shale x3",
    weightBps: 750,
    itemId: ITEM_IDS.ferriteShale,
    quantity: 3,
  },
  {
    id: "power_cell_1",
    label: "Power Cell x1",
    weightBps: 750,
    itemId: ITEM_IDS.powerCell,
    quantity: 1,
  },
  {
    id: "power_cell_2",
    label: "Power Cell x2",
    weightBps: 500,
    itemId: ITEM_IDS.powerCell,
    quantity: 2,
  },
  {
    id: "refined_ferrite_1",
    label: "Refined Ferrite x1",
    weightBps: 1_000,
    itemId: ITEM_IDS.refinedFerrite,
    quantity: 1,
  },
  {
    id: "refined_ferrite_2",
    label: "Refined Ferrite x2",
    weightBps: 750,
    itemId: ITEM_IDS.refinedFerrite,
    quantity: 2,
  },
];

/** A mixed reel order keeps the four comedy outcomes visibly distinct. */
export const SCAVENGE_REEL_ORDER: readonly ScavengeOutcomeId[] = [
  "ferrite_shale_1",
  "zilch",
  "power_cell_1",
  "nothing_burger",
  "refined_ferrite_1",
  "ferrite_shale_3",
  "nada",
  "ferrite_shale_2",
  "whammy",
  "refined_ferrite_2",
  "power_cell_2",
];

export function getScavengeOutcome(id: string): ScavengeOutcome | undefined {
  return SCAVENGE_OUTCOMES.find((outcome) => outcome.id === id);
}

export function scavengeAwardBranches(): readonly ScavengeOutcome[] {
  const maximumByItem = new Map<ItemId, ScavengeOutcome>();
  for (const outcome of SCAVENGE_OUTCOMES) {
    if (!outcome.itemId) continue;
    const current = maximumByItem.get(outcome.itemId);
    if (!current || outcome.quantity > current.quantity) maximumByItem.set(outcome.itemId, outcome);
  }
  return Array.from(maximumByItem.values());
}
