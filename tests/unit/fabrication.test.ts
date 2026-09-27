import { describe, expect, it } from "vitest";
import {
  fabricationActionIds,
  fabricationRecipeForActionId,
  getEffectiveGameBalance,
  getItemDefinition,
  skillLevelThresholds,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_QUANTITY_CEILING,
  ITEM_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { BOUNDED_RUN_MAX, boundedRunAllowance } from "@/game/domain/bounded-run";
import { deriveEquipmentLoadout } from "@/game/domain/equipment";
import {
  fabricationAffordableBatches,
  fabricationStartCheck,
  resolveFabrication,
  resolveFabricationWorkpieceNow,
  type FabricationRunSnapshot,
} from "@/game/domain/fabrication";
import type { StackState } from "@/game/domain/inventory";
import type { ManualOverrideState, OverrideRandom } from "@/game/domain/manual-override";
import { fabricationRunSummary } from "@/features/fabrication/station-copy";
import type { FabricationRecipeProjection } from "@/server/play";

/**
 * Tier-1 Fabrication (#232): the exact authored recipes, and the pure
 * workpiece rules — capacity after the inputs leave, numeric and Max runs,
 * Finish Current, holding a finished Override workpiece at 0, and busts.
 */

const balance = getEffectiveGameBalance();
const recipe = (actionId: string) => fabricationRecipeForActionId(actionId, balance)!;
const bracket = recipe(ACTION_IDS.mountingBracketFabrication);
const scrap = recipe(ACTION_IDS.scrapMetalFabrication);
const box = recipe(ACTION_IDS.scrapBoxFabrication);
const cutter = recipe(ACTION_IDS.salvageCutterFabrication);
const lowest: OverrideRandom = { nextInt: () => 0 };

function stacks(...entries: [itemId: string, quantity: number][]): StackState<string>[] {
  return entries.map(([itemId, quantity], index) => ({
    id: `s${index}`,
    itemId: itemId as StackState<string>["itemId"],
    quantity,
  }));
}

function snapshot(
  carried: StackState<string>[],
  overrides: Partial<FabricationRunSnapshot> = {},
): FabricationRunSnapshot {
  return {
    fabricationLevel: 1,
    stacks: carried,
    slotsAvailable: 8 - carried.length,
    massAvailableGrams: 30_000,
    allowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
    finishCurrent: false,
    overrideEnabled: false,
    ...overrides,
  };
}

describe("the exact Tier-1 recipes", () => {
  it("authors exactly four Fabrication-1 recipes", () => {
    expect(fabricationActionIds(balance)).toEqual([
      ACTION_IDS.mountingBracketFabrication,
      ACTION_IDS.scrapMetalFabrication,
      ACTION_IDS.scrapBoxFabrication,
      ACTION_IDS.salvageCutterFabrication,
    ]);
  });

  it("Mounting Bracket: 2 Refined Ferrite → 1, 12 ticks, 25 XP; 300 g, stack 5", () => {
    expect(bracket).toMatchObject({
      outputItemId: ITEM_IDS.mountingBracket,
      outputQuantity: 1,
      minimumLevel: 1,
      durationTicks: 12,
      baseXp: 25,
      inputs: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 2 }],
    });
    expect(getItemDefinition(ITEM_IDS.mountingBracket)).toEqual({
      itemId: ITEM_IDS.mountingBracket,
      kind: "stack",
      stackLimit: 5,
      massGrams: 300,
    });
  });

  it("Direct Scrap: 2 Refined Ferrite → 1 Scrap Metal, 10 ticks, 10 XP", () => {
    expect(scrap).toMatchObject({
      outputItemId: ITEM_IDS.scrapMetal,
      outputQuantity: 1,
      minimumLevel: 1,
      durationTicks: 10,
      baseXp: 10,
      inputs: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 2 }],
    });
  });

  it("Scrap Box: 1 Bracket + 2 Scrap + 3 Refined Ferrite, 36 ticks, 81 XP; unique 5 kg, +3 slots", () => {
    expect(box).toMatchObject({
      outputItemId: ITEM_IDS.scrapBox,
      outputQuantity: 1,
      minimumLevel: 1,
      durationTicks: 36,
      baseXp: 81,
      inputs: [
        { itemId: ITEM_IDS.mountingBracket, quantity: 1 },
        { itemId: ITEM_IDS.scrapMetal, quantity: 2 },
        { itemId: ITEM_IDS.refinedFerrite, quantity: 3 },
      ],
    });
    expect(getItemDefinition(ITEM_IDS.scrapBox)).toEqual({
      itemId: ITEM_IDS.scrapBox,
      kind: "unique",
      massGrams: 5_000,
    });
    expect(balance.items.scrapBox.slotCapacity).toBe(3);
  });

  it("the Scrap Box is a container in the existing two container slots, never a third", () => {
    const loadout = deriveEquipmentLoadout({
      assignments: [
        {
          assignmentKind: "container",
          suitSlotId: "container_attachment_1",
          itemInstanceId: "mykea",
        },
        {
          assignmentKind: "container",
          suitSlotId: "container_attachment_2",
          itemInstanceId: "box",
        },
      ],
      instances: [
        { id: "mykea", itemId: ITEM_IDS.mykeaSchleppraum8 },
        { id: "box", itemId: ITEM_IDS.scrapBox },
      ],
      stacks: [],
      balance,
    });
    expect(loadout.containerSlotCapacity).toBe(8 + 3);
    expect(balance.carrying.containerSuitSlotIds).toHaveLength(2);
  });

  it("Salvage Cutter: 5 Refined Ferrite + 1 Power Cell, 20 ticks, 65 XP", () => {
    expect(cutter).toMatchObject({
      outputItemId: ITEM_IDS.salvageCutter,
      outputQuantity: 1,
      minimumLevel: 1,
      durationTicks: 20,
      baseXp: 65,
      inputs: [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
        { itemId: ITEM_IDS.powerCell, quantity: 1 },
      ],
    });
  });

  it("is a standard skill on the shared curve", () => {
    expect(skillLevelThresholds(SKILL_IDS.fabrication)).toEqual(
      standardSkillLevelThresholds(balance),
    );
  });
});

describe("the affordable count and the start check", () => {
  it("counts what the carried inputs pay for, capped by the ceiling", () => {
    const carried = stacks(
      [ITEM_IDS.refinedFerrite, 5],
      [ITEM_IDS.refinedFerrite, 5],
      [ITEM_IDS.powerCell, 1],
    );
    expect(fabricationAffordableBatches({ fabricationLevel: 1, stacks: carried }, cutter)).toBe(1);
    expect(fabricationAffordableBatches({ fabricationLevel: 1, stacks: carried }, bracket)).toBe(5);
    expect(fabricationAffordableBatches({ fabricationLevel: 1, stacks: [] }, box)).toBe(0);
    expect(BOUNDED_RUN_QUANTITY_CEILING).toBe(999);
  });

  it("judges room after the inputs leave, so an output may use the slot they free", () => {
    const full = snapshot(stacks([ITEM_IDS.refinedFerrite, 5], [ITEM_IDS.powerCell, 1]), {
      slotsAvailable: 0,
    });
    expect(fabricationStartCheck(full, cutter)).toMatchObject({ ok: true });
    const heavy = snapshot(stacks([ITEM_IDS.refinedFerrite, 5], [ITEM_IDS.powerCell, 1]), {
      slotsAvailable: 0,
      massAvailableGrams: 3_749,
    });
    // 5 kg in, 1.25 kg out: 3.75 kg short by one gram.
    expect(fabricationStartCheck(heavy, cutter)).toEqual({
      ok: false,
      reason: "carried_mass_capacity_reached",
    });
  });

  it("refuses without the complete input set", () => {
    expect(fabricationStartCheck(snapshot(stacks([ITEM_IDS.refinedFerrite, 4])), cutter)).toEqual({
      ok: false,
      reason: "insufficient_inputs",
    });
  });
});

describe("lazy resolution", () => {
  it("resolves whole workpieces only, each consuming its inputs and making its output", () => {
    const carried = stacks([ITEM_IDS.refinedFerrite, 5]);
    const partial = resolveFabrication({
      elapsedTicks: 11,
      snapshot: snapshot(carried),
      recipe: bracket,
      random: lowest,
    });
    expect(partial).toMatchObject({ consumedTicks: 0, resolved: [], awardedXp: 0 });
    const two = resolveFabrication({
      elapsedTicks: 24,
      snapshot: snapshot(carried),
      recipe: bracket,
      random: lowest,
    });
    expect(two.resolved).toHaveLength(2);
    expect(two.consumedTicks).toBe(24);
    expect(two.awardedXp).toBe(50);
    expect(two.stackUpdates).toEqual([{ id: "s0", quantity: 1 }]);
    expect(two.createdStacks).toEqual([{ itemId: ITEM_IDS.mountingBracket, quantity: 2 }]);
    expect(two.stopReason).toBe("insufficient_inputs");
  });

  it("stops a number at its count with 'run completed', and Max with the ordinary reason", () => {
    const carried = stacks([ITEM_IDS.refinedFerrite, 5], [ITEM_IDS.refinedFerrite, 5]);
    const numeric = resolveFabrication({
      elapsedTicks: 1_000,
      snapshot: snapshot(carried, { allowance: boundedRunAllowance(2, 0) }),
      recipe: scrap,
      random: lowest,
    });
    expect(numeric.resolved).toHaveLength(2);
    expect(numeric.stopReason).toBe("run_completed");
    const max = resolveFabrication({
      elapsedTicks: 1_000,
      snapshot: snapshot(carried),
      recipe: scrap,
      random: lowest,
    });
    expect(max.resolved).toHaveLength(5);
    expect(max.stopReason).toBe("insufficient_inputs");
  });

  it("Finish Current resolves the workpiece on the machine and starts no other", () => {
    const resolved = resolveFabrication({
      elapsedTicks: 1_000,
      snapshot: snapshot(stacks([ITEM_IDS.refinedFerrite, 5]), { finishCurrent: true }),
      recipe: bracket,
      random: lowest,
    });
    expect(resolved.resolved).toHaveLength(1);
    expect(resolved.stopReason).toBe("finished_current");
  });

  it("holds an unlocked Override workpiece at 0 indefinitely, and resolves a locked one with its multiplier", () => {
    const override: ManualOverrideState = {
      load: 5,
      trend: "higher",
      safePushes: 1,
      exactPushes: 0,
      locked: false,
    };
    const held = resolveFabrication({
      elapsedTicks: 50_000,
      snapshot: snapshot(stacks([ITEM_IDS.refinedFerrite, 5]), { override }),
      recipe: bracket,
      random: lowest,
    });
    expect(held).toMatchObject({ held: true, consumedTicks: 0, resolved: [], awardedXp: 0 });
    expect(held.override).toEqual(override);
    expect(held.stopReason).toBeUndefined();
    const locked = resolveFabrication({
      elapsedTicks: 12,
      snapshot: snapshot(stacks([ITEM_IDS.refinedFerrite, 2]), {
        override: { ...override, locked: true },
      }),
      recipe: bracket,
      random: lowest,
    });
    expect(locked.awardedXp).toBe(30);
    expect(locked.resolved[0]).toMatchObject({ usedOverride: true, safePushes: 1 });
  });

  it("gives every next workpiece a fresh 1.00× machine only while Override is on", () => {
    const on = resolveFabrication({
      elapsedTicks: 12,
      snapshot: snapshot(stacks([ITEM_IDS.refinedFerrite, 4]), { overrideEnabled: true }),
      recipe: bracket,
      random: lowest,
    });
    expect(on.override).toEqual({
      load: 2,
      trend: "higher",
      safePushes: 0,
      exactPushes: 0,
      locked: false,
    });
    const off = resolveFabrication({
      elapsedTicks: 12,
      snapshot: snapshot(stacks([ITEM_IDS.refinedFerrite, 4])),
      recipe: bracket,
      random: lowest,
    });
    expect(off.override).toBeUndefined();
  });

  it("busts atomically: every input consumed, no output, no XP; the run then decides as usual", () => {
    const override: ManualOverrideState = {
      load: 2,
      trend: "higher",
      safePushes: 0,
      exactPushes: 0,
      locked: false,
    };
    const bust = resolveFabricationWorkpieceNow({
      snapshot: snapshot(stacks([ITEM_IDS.refinedFerrite, 5], [ITEM_IDS.powerCell, 2]), {
        override,
        allowance: boundedRunAllowance(2, 0),
      }),
      recipe: cutter,
      result: "bust",
      bust: { feed: 10, load: 3 },
      random: lowest,
    });
    expect(bust.resolved).toEqual([
      {
        result: "bust",
        xpAwarded: 0,
        usedOverride: true,
        safePushes: 0,
        exactPushes: 0,
        bust: { feed: 10, load: 3 },
      },
    ]);
    expect(bust.awardedXp).toBe(0);
    expect(bust.uniqueItemsCreated).toBe(0);
    expect(bust.outputsGained).toEqual({});
    expect(bust.inputsConsumed).toEqual({
      [ITEM_IDS.refinedFerrite]: 5,
      [ITEM_IDS.powerCell]: 1,
    });
    // The second batch cannot begin: there is only one Cell's worth of Ferrite left.
    expect(bust.stopReason).toBe("insufficient_inputs");
  });
});

describe("the pre-start run summary (#229)", () => {
  const projection: FabricationRecipeProjection = {
    actionId: bracket.actionId,
    outputItemId: bracket.outputItemId,
    outputName: "Mounting Bracket",
    outputQuantity: 1,
    outputStackLimit: 5,
    minimumLevel: 1,
    unlocked: true,
    durationTicks: 12,
    baseXp: 25,
    inputs: [{ itemId: ITEM_IDS.refinedFerrite, name: "Refined Ferrite", quantity: 2, carried: 6 }],
    inputsAvailable: true,
    affordableBatches: 3,
  };

  it("totals a number exactly at the safe 1.00× baseline", () => {
    expect(fabricationRunSummary(projection, 3)).toBe(
      "3 batches · 6 Refined Ferrite → 3 Mounting Bracket · 21.6s · 75 base Fabrication XP",
    );
  });

  it("describes one batch for Max and never predicts a total", () => {
    const summary = fabricationRunSummary(projection, BOUNDED_RUN_MAX);
    expect(summary).toBe(
      "Max · 2 Refined Ferrite per batch · 1 Mounting Bracket and 25 Fabrication XP each · 7.2s each · runs until the next workpiece cannot begin",
    );
    expect(summary).not.toMatch(/\b3\b/);
  });
});
