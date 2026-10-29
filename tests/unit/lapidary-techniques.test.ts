import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LapidaryTechniquesCatalog } from "@/features/lapidary/LapidaryTechniquesCatalog";
import {
  learnedLapidaryTechniques,
  workLapidaryTechniques,
  lapidaryRecipeLine,
  lapidaryTechniqueItem,
  lapidaryUnmetRequirements,
  type LapidaryTechnique,
} from "@/features/lapidary/technique-presentation";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";
import type { LapidaryWorkbenchProjection } from "@/server/lapidary-state";

const stone: LapidaryTechnique = {
  actionId: ACTION_IDS.shapeStone,
  displayName: "Shape Stone",
  minimumLevel: 1,
  durationTicks: 20,
  baseXp: 15,
  inputs: [{ itemId: ITEM_IDS.stone, name: "Stone", quantity: 1, carried: 3, stackLimit: 5 }],
  authorized: true,
  canStart: true,
  affordableCycles: 3,
  outputItemId: undefined,
  outputQuantity: undefined,
  outputStackLimit: undefined,
  refusal: undefined,
};
const quartz: LapidaryTechnique = {
  ...stone,
  actionId: ACTION_IDS.cutQuartz,
  displayName: "Cut Quartz",
  durationTicks: 30,
  baseXp: 75,
  inputs: [
    { itemId: ITEM_IDS.uncutQuartz, name: "Uncut Quartz", quantity: 1, carried: 0, stackLimit: 2 },
  ],
  outputItemId: ITEM_IDS.cutQuartz,
  outputQuantity: 1,
  outputStackLimit: 2,
  canStart: false,
  affordableCycles: 0,
  refusal: "Bring the required material.",
};
const bench = (
  recipes: LapidaryTechnique[],
  access: LapidaryWorkbenchProjection["access"] = { kind: "unrestricted" },
) => ({ recipes, level: 1, access });

describe("Lapidary Work and Techniques", () => {
  it("keeps known but unauthorized techniques out of Work, even if guided or supplied", () => {
    const locked = { ...stone, authorized: false, canStart: false };
    expect(
      workLapidaryTechniques(bench([locked], { kind: "locked" }), new Set([locked.actionId])),
    ).toEqual([]);
    expect(learnedLapidaryTechniques([locked], 1)).toEqual([locked]);
  });
  it("lists carried-material techniques and keeps an authorized guided missing input visible", () => {
    expect(workLapidaryTechniques(bench([stone, quartz]), new Set())).toEqual([stone]);
    expect(workLapidaryTechniques(bench([stone, quartz]), new Set([quartz.actionId]))).toEqual([
      stone,
      quartz,
    ]);
    expect(lapidaryUnmetRequirements(quartz)).toEqual(["Need 1 more Uncut Quartz"]);
  });
  it.each([stone, quartz])(
    "keeps the supervised $displayName lesson visible without material, including when unpinned",
    (recipe) => {
      const missing = {
        ...recipe,
        inputs: recipe.inputs.map((input) => ({ ...input, carried: 0 })),
        canStart: false,
        affordableCycles: 0,
      };
      const other = { ...quartz, authorized: false };
      expect(
        workLapidaryTechniques(
          bench([missing, other], {
            kind: "supervised",
            stageId: "lesson",
            actionId: recipe.actionId,
          }),
          new Set(),
        ),
      ).toEqual([missing]);
      expect(lapidaryUnmetRequirements(missing)).toContain(`Need 1 more ${recipe.inputs[0]!.name}`);
    },
  );
  it("shows an empty Work list without materials and retains all level-known catalog entries", () => {
    const missing = { ...stone, inputs: stone.inputs.map((input) => ({ ...input, carried: 0 })) };
    expect(workLapidaryTechniques(bench([missing, quartz]), new Set())).toEqual([]);
    expect(learnedLapidaryTechniques([missing, quartz], 1)).toEqual([missing, quartz]);
    expect(learnedLapidaryTechniques([missing, quartz], 0)).toEqual([]);
  });
  it("keeps a material-supplied capacity refusal visible instead of hiding its reason", () => {
    const full = {
      ...stone,
      canStart: false,
      affordableCycles: 0,
      refusal: "Make room for the finished item.",
    };
    expect(workLapidaryTechniques(bench([full]), new Set())).toEqual([full]);
    expect(lapidaryUnmetRequirements(full)).toEqual([full.refusal]);
  });
  it("depicts practice's input without inventing an output, and Quartz's actual output", () => {
    expect(lapidaryTechniqueItem(stone)).toEqual({
      itemId: ITEM_IDS.stone,
      name: "Stone",
      quantity: 1,
      stackLimit: 5,
    });
    expect(lapidaryRecipeLine(stone)).toBe(
      "1 Stone → consumed for practice; produces nothing (no output)",
    );
    expect(lapidaryTechniqueItem(quartz).itemId).toBe(ITEM_IDS.cutQuartz);
    expect(lapidaryRecipeLine(quartz)).toBe("1 Uncut Quartz → 1 Cut Quartz");
  });
  it("renders the real catalog as read-only canonical item tiles, with authorization separate from knowledge", () => {
    const locked = {
      ...stone,
      authorized: false,
      refusal: "Speak to Werner before using this recipe.",
    };
    const html = renderToStaticMarkup(
      createElement(LapidaryTechniquesCatalog, {
        level: 1,
        recipes: [locked, quartz],
      }),
    );
    expect(html).toContain("data-lapidary-catalog-entry");
    expect(html).toContain("Werner’s authorization");
    expect(html).toContain("Speak to Werner before using this recipe.");
    expect(html).toContain("produces nothing (no output)");
    expect(html).toContain(encodeURIComponent("/item-art/cut-quartz.webp"));
    expect(html).toContain("Need 1 more Uncut Quartz");
    expect(html).not.toMatch(/<button|role="button"|data-lapidary-start|aria-pressed|Cut Stone/);
    const belowLevel = renderToStaticMarkup(
      createElement(LapidaryTechniquesCatalog, { level: 0, recipes: [stone, quartz] }),
    );
    expect(belowLevel).not.toContain("data-lapidary-catalog-entry");
  });
});
