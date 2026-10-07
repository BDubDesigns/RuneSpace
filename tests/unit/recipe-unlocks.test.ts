import { describe, expect, it } from "vitest";
import { ACTION_IDS, ITEM_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance, type EffectiveGameBalance } from "@/game/config/balance";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import {
  recipeUnlockName,
  recipeUnlockNoticeBody,
  recipesUnlockedBetween,
  skillRecipes,
} from "@/game/domain/recipe-unlocks";

/**
 * Recipe-unlock derivation (issue #274). Everything is read from the canonical
 * recipe registries, so these assertions name authored action IDs rather than
 * a separate unlock list — there is none.
 */

const unlocked = (skillId: string, from: number, to: number, balance?: EffectiveGameBalance) =>
  recipesUnlockedBetween(skillId, from, to, balance).map((recipe) => recipe.actionId);

const itemName = (itemId: string) => resolveItemPresentation(itemId, itemId).displayName;

describe("recipesUnlockedBetween", () => {
  it("finds nothing when the level did not rise", () => {
    expect(unlocked(SKILL_IDS.refining, 5, 5)).toEqual([]);
    expect(unlocked(SKILL_IDS.refining, 4, 4)).toEqual([]);
    expect(unlocked(SKILL_IDS.refining, 6, 5)).toEqual([]);
  });

  it("finds every recipe at an exactly crossed level", () => {
    expect(unlocked(SKILL_IDS.refining, 4, 5)).toEqual([
      ACTION_IDS.galvanicStockRefining,
      ACTION_IDS.ferriteShaleSlagRefining,
      ACTION_IDS.galvaniteSlagRefining,
    ]);
    expect(unlocked(SKILL_IDS.fabrication, 4, 5)).toEqual([
      ACTION_IDS.galvanicScrapFabrication,
      ACTION_IDS.galvanicWireSpoolFabrication,
      ACTION_IDS.powerCellFabrication,
      ACTION_IDS.loadsteelCutterFabrication,
      ACTION_IDS.wheelAssemblyFabrication,
    ]);
  });

  it("never skips a recipe when an award skips levels", () => {
    expect(unlocked(SKILL_IDS.refining, 4, 6)).toEqual(unlocked(SKILL_IDS.refining, 4, 5));
    expect(unlocked(SKILL_IDS.refining, 4, 8)).toEqual([
      ACTION_IDS.galvanicStockRefining,
      ACTION_IDS.ferriteShaleSlagRefining,
      ACTION_IDS.galvaniteSlagRefining,
      ACTION_IDS.galvaferriteRefining,
    ]);
    expect(unlocked(SKILL_IDS.fabrication, 1, 9)).toEqual([
      ACTION_IDS.galvanicScrapFabrication,
      ACTION_IDS.galvanicWireSpoolFabrication,
      ACTION_IDS.powerCellFabrication,
      ACTION_IDS.loadsteelCutterFabrication,
      ACTION_IDS.wheelAssemblyFabrication,
      // Fabrication 8, in authored order: the Drive Mount (#330), then the Harness.
      ACTION_IDS.driveMountFabrication,
      ACTION_IDS.freightHarnessFabrication,
    ]);
  });

  it("never repeats a recipe below the previous level", () => {
    expect(unlocked(SKILL_IDS.refining, 5, 7)).toEqual([]);
    expect(unlocked(SKILL_IDS.refining, 6, 8)).toEqual([ACTION_IDS.galvaferriteRefining]);
    expect(unlocked(SKILL_IDS.refining, 8, 20)).toEqual([]);
  });

  it("finds nothing for a level rise with no recipe or a skill with no recipes", () => {
    expect(unlocked(SKILL_IDS.refining, 1, 2)).toEqual([]);
    expect(unlocked(SKILL_IDS.refining, 5, 6)).toEqual([]);
    expect(unlocked(SKILL_IDS.mining, 1, 10)).toEqual([]);
    expect(unlocked(SKILL_IDS.welding, 1, 10)).toEqual([]);
  });

  it("discovers a newly authored recipe with no notification-specific registration", () => {
    const balance = structuredClone(getEffectiveGameBalance());
    const authored = {
      ...balance.refining.recipes.galvanicStock,
      actionId: "future-refining-recipe",
      minimumLevel: 7,
    };
    (balance.refining.recipes as Record<string, unknown>).futureRecipe = authored;
    expect(unlocked(SKILL_IDS.refining, 6, 7, balance)).toEqual(["future-refining-recipe"]);
    expect(unlocked(SKILL_IDS.refining, 4, 8, balance)).toEqual([
      ACTION_IDS.galvanicStockRefining,
      ACTION_IDS.ferriteShaleSlagRefining,
      ACTION_IDS.galvaniteSlagRefining,
      "future-refining-recipe",
      ACTION_IDS.galvaferriteRefining,
    ]);
  });
});

describe("recipe-unlock notice text", () => {
  it("names a recipe by its output, adding inputs only when another recipe shares the output", () => {
    const refining = skillRecipes(SKILL_IDS.refining);
    const names = recipesUnlockedBetween(SKILL_IDS.refining, 4, 5).map((recipe) =>
      recipeUnlockName(recipe, refining, itemName),
    );
    expect(names).toEqual(["Galvanic Stock", "Slag from Ferrite Shale", "Slag from Galvanite"]);

    const fabrication = skillRecipes(SKILL_IDS.fabrication);
    const galvanicScrap = fabrication.find(
      (recipe) => recipe.actionId === ACTION_IDS.galvanicScrapFabrication,
    )!;
    expect(recipeUnlockName(galvanicScrap, fabrication, itemName)).toBe(
      `${itemName(ITEM_IDS.scrapMetal)} from ${itemName(ITEM_IDS.galvanicStock)}`,
    );
  });

  it("groups every unlocked recipe from one progression event into one message", () => {
    expect(
      recipeUnlockNoticeBody({
        skillName: "Refining",
        level: 5,
        recipeNames: ["Galvanic Stock", "Slag from Ferrite Shale", "Slag from Galvanite"],
      }),
    ).toBe(
      [
        "Refining Level 5 reached.",
        "New recipes unlocked:",
        "- Galvanic Stock",
        "- Slag from Ferrite Shale",
        "- Slag from Galvanite",
      ].join("\n"),
    );
    expect(
      recipeUnlockNoticeBody({ skillName: "Refining", level: 8, recipeNames: ["Galvaferrite"] }),
    ).toBe("Refining Level 8 reached.\nNew recipe unlocked:\n- Galvaferrite");
  });
});
