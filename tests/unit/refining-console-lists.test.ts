import { describe, expect, it } from "vitest";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";
import {
  learnedRefiningRecipes,
  refineVisibleRecipes,
  refiningChance,
  refiningRecipeLine,
  refiningUnmetRequirements,
} from "@/features/refining/refining-lists";
import type { RefiningRecipeProjection } from "@/server/play";

/**
 * #239: the Refining console's Refine / Recipes split. Refine lists what can
 * begin now (plus a Mission-guided recipe with what it is missing); Recipes
 * lists everything the character's level unlocks; neither lists anything above
 * the character's level unless a Mission is pointing at it.
 */

const recipe = (
  actionId: string,
  overrides: Partial<RefiningRecipeProjection> = {},
): RefiningRecipeProjection => ({
  actionId,
  outputItemId: ITEM_IDS.refinedFerrite,
  outputName: "Refined Ferrite",
  outputQuantity: 1,
  outputStackLimit: 5,
  minimumLevel: 1,
  unlocked: true,
  attemptDurationTicks: 7,
  successChanceBps: 4_000,
  successXp: 15,
  failureXp: 3,
  deterministic: false,
  affordableBatches: 1,
  inputs: [{ itemId: ITEM_IDS.ferriteShale, name: "Ferrite Shale", quantity: 2, carried: 2 }],
  failureOutcomes: [],
  inputsAvailable: true,
  ...overrides,
});

const ready = recipe(ACTION_IDS.refining);
const shortOfMaterial = recipe(ACTION_IDS.ferriteShaleSlagRefining, {
  affordableBatches: 0,
  inputs: [{ itemId: ITEM_IDS.ferriteShale, name: "Ferrite Shale", quantity: 2, carried: 1 }],
  inputsAvailable: false,
});
const aboveLevel = recipe(ACTION_IDS.galvanicStockRefining, {
  minimumLevel: 5,
  unlocked: false,
  affordableBatches: 0,
  inputs: [{ itemId: ITEM_IDS.galvanite, name: "Galvanite", quantity: 2, carried: 4 }],
});
const all = [ready, shortOfMaterial, aboveLevel];

describe("Refine lists what can be refined now", () => {
  it("shows only level-unlocked recipes whose materials are carried", () => {
    expect(refineVisibleRecipes(all, new Set()).map((each) => each.actionId)).toEqual([
      ACTION_IDS.refining,
    ]);
  });

  it("keeps a Mission-guided recipe visible even without its materials", () => {
    expect(
      refineVisibleRecipes(all, new Set([ACTION_IDS.ferriteShaleSlagRefining])).map(
        (each) => each.actionId,
      ),
    ).toEqual([ACTION_IDS.refining, ACTION_IDS.ferriteShaleSlagRefining]);
  });

  it("says exactly what a guided recipe is missing", () => {
    expect(refiningUnmetRequirements(shortOfMaterial, 5)).toEqual(["Need 1 more Ferrite Shale"]);
    expect(refiningUnmetRequirements(aboveLevel, 1)).toEqual(["Requires Refining 5 (you are 1)"]);
    expect(refiningUnmetRequirements(ready, 1)).toEqual([]);
  });
});

describe("Recipes lists what the character knows", () => {
  it("lists every level-unlocked recipe, carried or not, and nothing above level", () => {
    expect(learnedRefiningRecipes(all).map((each) => each.actionId)).toEqual([
      ACTION_IDS.refining,
      ACTION_IDS.ferriteShaleSlagRefining,
    ]);
  });
});

describe("a recipe tile's facts", () => {
  it("writes one authored attempt, never a run total", () => {
    expect(refiningRecipeLine(ready)).toBe("2 Ferrite Shale → 1 Refined Ferrite");
  });

  it("shows a rolled chance, or Certain for a recipe that never rolls", () => {
    expect(refiningChance(ready)).toBe("40.00%");
    expect(
      refiningChance(recipe(ACTION_IDS.ferriteShaleSlagRefining, { deterministic: true })),
    ).toBe("Certain");
  });
});
