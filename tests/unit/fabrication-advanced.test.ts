import { describe, expect, it } from "vitest";
import {
  fabricationRecipeForActionId,
  getEffectiveGameBalance,
  getEquipmentDefinition,
  getItemDefinition,
  tinkeringTargetForActionId,
  tinkeringTargets,
  type FabricationRecipeBalance,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";
import { BOUNDED_RUN_MAX, boundedRunAllowance } from "@/game/domain/bounded-run";
import {
  fabricationAffordableBatches,
  fabricationRecipeUnlocked,
  fabricationStartCheck,
  resolveFabrication,
  resolveFabricationWorkpieceNow,
  type FabricationRunSnapshot,
} from "@/game/domain/fabrication";
import type { StackState } from "@/game/domain/inventory";
import type { ManualOverrideState, OverrideRandom } from "@/game/domain/manual-override";
import {
  resolveTinkering,
  tinkeringAffordableBatches,
  tinkeringDurationTicks,
  tinkeringScrapYield,
  tinkeringStartCheck,
  tinkeringUnlocked,
  tinkeringXp,
  usableMiningCutterCount,
  type TinkeringSnapshot,
  type TinkeringUniqueInstance,
} from "@/game/domain/tinkering";
import { fabricationRunSummary } from "@/features/fabrication/station-copy";
import type { FabricationRecipeProjection } from "@/server/play";

/**
 * Fabrication 5 and 8 (#233): the exact authored recipes and items, the level
 * gates (and the absence of any Refining gate), the two-Cell batch, #232's
 * atomic workpiece and Manual Override on every new recipe, and the advanced
 * Tinkering entries the universal rules derive — with the last-usable-Cutter
 * guard covering both Mining tools.
 */

const balance = getEffectiveGameBalance();
const recipe = (actionId: string) => fabricationRecipeForActionId(actionId, balance)!;
const galvanicScrap = recipe(ACTION_IDS.galvanicScrapFabrication);
const wireSpool = recipe(ACTION_IDS.galvanicWireSpoolFabrication);
const powerCells = recipe(ACTION_IDS.powerCellFabrication);
const loadsteel = recipe(ACTION_IDS.loadsteelCutterFabrication);
const harness = recipe(ACTION_IDS.freightHarnessFabrication);
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
    fabricationLevel: 8,
    stacks: carried,
    slotsAvailable: 11 - carried.length,
    massAvailableGrams: 30_000,
    allowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
    finishCurrent: false,
    overrideEnabled: false,
    ...overrides,
  };
}

/** Exactly one batch's inputs of a recipe, in stacks no fuller than each item allows. */
function oneBatch(each: FabricationRecipeBalance): StackState<string>[] {
  const entries: [string, number][] = [];
  for (const input of each.inputs) {
    const definition = getItemDefinition(input.itemId, balance);
    const limit = definition?.kind === "stack" ? definition.stackLimit : 1;
    for (let left = input.quantity; left > 0; left -= limit) {
      entries.push([input.itemId, Math.min(limit, left)]);
    }
  }
  return stacks(...entries);
}

describe("the exact Fabrication 5 and 8 recipes", () => {
  it("Direct Galvanic Scrap: 1 Galvanic Stock → 2 Scrap Metal, 14 ticks, 15 XP, Fabrication 5", () => {
    expect(galvanicScrap).toEqual({
      actionId: ACTION_IDS.galvanicScrapFabrication,
      outputItemId: ITEM_IDS.scrapMetal,
      outputQuantity: 2,
      minimumLevel: 5,
      durationTicks: 14,
      baseXp: 15,
      inputs: [{ itemId: ITEM_IDS.galvanicStock, quantity: 1 }],
    });
  });

  it("Galvanic Wire Spool: 1 Galvanic Stock → 1, 24 ticks, 45 XP; 1,000 g, stack 3", () => {
    expect(wireSpool).toEqual({
      actionId: ACTION_IDS.galvanicWireSpoolFabrication,
      outputItemId: ITEM_IDS.galvanicWireSpool,
      outputQuantity: 1,
      minimumLevel: 5,
      durationTicks: 24,
      baseXp: 45,
      inputs: [{ itemId: ITEM_IDS.galvanicStock, quantity: 1 }],
    });
    expect(getItemDefinition(ITEM_IDS.galvanicWireSpool, balance)).toEqual({
      itemId: ITEM_IDS.galvanicWireSpool,
      kind: "stack",
      stackLimit: 3,
      massGrams: 1_000,
    });
  });

  it("Power Cells: 1 Galvanic Stock → 2 ordinary Power Cells, 30 ticks, 75 XP", () => {
    expect(powerCells).toEqual({
      actionId: ACTION_IDS.powerCellFabrication,
      outputItemId: ITEM_IDS.powerCell,
      outputQuantity: 2,
      minimumLevel: 5,
      durationTicks: 30,
      baseXp: 75,
      inputs: [{ itemId: ITEM_IDS.galvanicStock, quantity: 1 }],
    });
    // The output is the one ordinary Power Cell — there is no uncharged variant.
    expect(Object.values(ITEM_IDS).filter((id) => id.includes("power_cell"))).toEqual([
      ITEM_IDS.powerCell,
    ]);
  });

  it("Loadsteel Cutter: 2 Galvaferrite + 1 Wire Spool + 1 Power Cell, 45 ticks, 180 XP; unique 8 kg", () => {
    expect(loadsteel).toEqual({
      actionId: ACTION_IDS.loadsteelCutterFabrication,
      outputItemId: ITEM_IDS.loadsteelCutter,
      outputQuantity: 1,
      minimumLevel: 5,
      durationTicks: 45,
      baseXp: 180,
      inputs: [
        { itemId: ITEM_IDS.galvaferrite, quantity: 2 },
        { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
        { itemId: ITEM_IDS.powerCell, quantity: 1 },
      ],
    });
    expect(getItemDefinition(ITEM_IDS.loadsteelCutter, balance)).toEqual({
      itemId: ITEM_IDS.loadsteelCutter,
      kind: "unique",
      massGrams: 8_000,
    });
    // No Mounting Bracket padding.
    expect(loadsteel.inputs.map((input) => input.itemId)).not.toContain(ITEM_IDS.mountingBracket);
  });

  it("Freight Harness: 4 Galvaferrite + 2 Mounting Brackets, 60 ticks, 270 XP, Fabrication 8; unique 9 kg, +6 slots", () => {
    expect(harness).toEqual({
      actionId: ACTION_IDS.freightHarnessFabrication,
      outputItemId: ITEM_IDS.freightHarness,
      outputQuantity: 1,
      minimumLevel: 8,
      durationTicks: 60,
      baseXp: 270,
      inputs: [
        { itemId: ITEM_IDS.galvaferrite, quantity: 4 },
        { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
      ],
    });
    expect(getItemDefinition(ITEM_IDS.freightHarness, balance)).toEqual({
      itemId: ITEM_IDS.freightHarness,
      kind: "unique",
      massGrams: 9_000,
    });
    expect(getEquipmentDefinition(ITEM_IDS.freightHarness, balance)).toMatchObject({
      kind: "container",
      slotCapacity: 6,
    });
  });
});

describe("the level gates", () => {
  it.each([
    ["Direct Galvanic Scrap", galvanicScrap],
    ["Galvanic Wire Spool", wireSpool],
    ["Power Cells", powerCells],
    ["Loadsteel Cutter", loadsteel],
  ] as const)("%s unlocks at Fabrication 5 and not before", (_, each) => {
    expect(fabricationRecipeUnlocked(4, each)).toBe(false);
    expect(fabricationRecipeUnlocked(5, each)).toBe(true);
    expect(fabricationStartCheck(snapshot(oneBatch(each), { fabricationLevel: 4 }), each)).toEqual({
      ok: false,
      reason: "recipe_locked",
    });
    expect(
      fabricationAffordableBatches({ fabricationLevel: 4, stacks: oneBatch(each) }, each),
    ).toBe(0);
  });

  it("Fabrication 8 alone unlocks the Freight Harness", () => {
    expect(fabricationRecipeUnlocked(7, harness)).toBe(false);
    expect(fabricationRecipeUnlocked(8, harness)).toBe(true);
    expect(
      fabricationStartCheck(snapshot(oneBatch(harness), { fabricationLevel: 8 }), harness),
    ).toMatchObject({ ok: true });
  });

  it("asks nothing of Refining: acquired Galvanic Stock or Galvaferrite is valid input at Fabrication 5", () => {
    // The capacity snapshot has no Refining level to consult at all, and the
    // recipes author nothing but their Fabrication level.
    for (const each of [galvanicScrap, wireSpool, powerCells, loadsteel]) {
      expect(Object.keys(each)).not.toContain("refiningLevel");
      expect(
        fabricationStartCheck(snapshot(oneBatch(each), { fabricationLevel: 5 }), each),
      ).toMatchObject({ ok: true });
    }
  });
});

describe("the two-Cell Power Cell batch", () => {
  const projection: FabricationRecipeProjection = {
    actionId: powerCells.actionId,
    outputItemId: ITEM_IDS.powerCell,
    outputName: "Power Cell",
    outputQuantity: powerCells.outputQuantity,
    outputStackLimit: 5,
    minimumLevel: 5,
    unlocked: true,
    durationTicks: powerCells.durationTicks,
    baseXp: powerCells.baseXp,
    inputs: [{ itemId: ITEM_IDS.galvanicStock, name: "Galvanic Stock", quantity: 1, carried: 4 }],
    inputsAvailable: true,
    affordableBatches: 4,
  };

  it("counts batches, not Cells: four Galvanic Stock pay for four batches", () => {
    expect(
      fabricationAffordableBatches(
        { fabricationLevel: 5, stacks: stacks([ITEM_IDS.galvanicStock, 4]) },
        powerCells,
      ),
    ).toBe(4);
  });

  it("four selected batches still author a per-batch x2, while the run summary totals 8 Cells", () => {
    expect(projection.outputQuantity).toBe(2);
    expect(fabricationRunSummary(projection, 4)).toBe(
      "4 batches · 4 Galvanic Stock → 8 Power Cell · 72 sec · 300 base Fabrication XP",
    );
    expect(fabricationRunSummary(projection, BOUNDED_RUN_MAX)).toContain("2 Power Cell and 75");
  });

  it("makes both Cells of a batch at once, and four batches make eight", () => {
    const run = resolveFabrication({
      elapsedTicks: 4 * 30,
      snapshot: snapshot(stacks([ITEM_IDS.galvanicStock, 4]), {
        allowance: boundedRunAllowance(4, 0),
      }),
      recipe: powerCells,
      random: lowest,
    });
    expect(run.resolved).toHaveLength(4);
    expect(run.outputsGained).toEqual({ [ITEM_IDS.powerCell]: 8 });
    expect(run.inputsConsumed).toEqual({ [ITEM_IDS.galvanicStock]: 4 });
    expect(run.awardedXp).toBe(300);
    expect(run.stopReason).toBe("run_completed");
  });
});

describe("#232's atomic workpiece and Manual Override on every new recipe", () => {
  const override: ManualOverrideState = {
    load: 5,
    trend: "higher",
    safePushes: 1,
    exactPushes: 0,
    locked: true,
  };

  it.each([
    ["Direct Galvanic Scrap", galvanicScrap],
    ["Galvanic Wire Spool", wireSpool],
    ["Power Cells", powerCells],
    ["Loadsteel Cutter", loadsteel],
    ["Freight Harness", harness],
  ] as const)("%s: success takes every input and makes the whole output together", (_, each) => {
    const partial = resolveFabrication({
      elapsedTicks: each.durationTicks - 1,
      snapshot: snapshot(oneBatch(each)),
      recipe: each,
      random: lowest,
    });
    expect(partial).toMatchObject({ consumedTicks: 0, resolved: [], awardedXp: 0 });
    expect(partial.inputsConsumed).toEqual({});

    const done = resolveFabrication({
      elapsedTicks: each.durationTicks,
      snapshot: snapshot(oneBatch(each)),
      recipe: each,
      random: lowest,
    });
    expect(done.consumedTicks).toBe(each.durationTicks);
    expect(done.awardedXp).toBe(each.baseXp);
    expect(done.inputsConsumed).toEqual(
      Object.fromEntries(each.inputs.map((input) => [input.itemId, input.quantity])),
    );
    expect(done.outputsGained).toEqual({ [each.outputItemId]: each.outputQuantity });
    const unique = getItemDefinition(each.outputItemId, balance)?.kind === "unique";
    expect(done.uniqueItemsCreated).toBe(unique ? 1 : 0);
    expect(done.stopReason).toBe("insufficient_inputs");
  });

  it.each([
    ["Direct Galvanic Scrap", galvanicScrap],
    ["Galvanic Wire Spool", wireSpool],
    ["Power Cells", powerCells],
    ["Loadsteel Cutter", loadsteel],
    ["Freight Harness", harness],
  ] as const)(
    "%s: a locked Override pays its multiplier; a bust takes every input and makes nothing",
    (_, each) => {
      const locked = resolveFabrication({
        elapsedTicks: each.durationTicks,
        snapshot: snapshot(oneBatch(each), { override }),
        recipe: each,
        random: lowest,
      });
      // One safe push compounds ×1.20, in whole basis points and rounded down.
      expect(locked.awardedXp).toBe(Math.floor((each.baseXp * 12_000) / 10_000));
      expect(locked.resolved[0]).toMatchObject({ result: "success", usedOverride: true });

      const bust = resolveFabricationWorkpieceNow({
        snapshot: snapshot(oneBatch(each), { override: { ...override, locked: false } }),
        recipe: each,
        result: "bust",
        bust: { feed: 1, load: 9 },
        random: lowest,
      });
      expect(bust.awardedXp).toBe(0);
      expect(bust.outputsGained).toEqual({});
      expect(bust.uniqueItemsCreated).toBe(0);
      expect(bust.inputsConsumed).toEqual(
        Object.fromEntries(each.inputs.map((input) => [input.itemId, input.quantity])),
      );
    },
  );

  it("a finished Override workpiece holds at 0 on a Loadsteel Cutter exactly as on any recipe", () => {
    const held = resolveFabrication({
      elapsedTicks: 50_000,
      snapshot: snapshot(oneBatch(loadsteel), { override: { ...override, locked: false } }),
      recipe: loadsteel,
      random: lowest,
    });
    expect(held).toMatchObject({ held: true, consumedTicks: 0, resolved: [], awardedXp: 0 });
  });

  it("judges the Loadsteel Cutter's room after its inputs leave", () => {
    // Its input stacks fill the last slots; the Cutter uses one they free.
    const tight = snapshot(oneBatch(loadsteel), { slotsAvailable: 0 });
    expect(fabricationStartCheck(tight, loadsteel)).toMatchObject({ ok: true });
  });
});

function instance(
  id: string,
  itemId: string,
  charge: number | null = 0,
  createdAt = "2026-09-01T00:00:00.000Z",
): TinkeringUniqueInstance {
  return { id, itemId, currentCharge: charge, createdAt };
}

function tinkering(overrides: Partial<TinkeringSnapshot> = {}): TinkeringSnapshot {
  return {
    fabricationLevel: 8,
    miningLevel: 5,
    stacks: [],
    carriedUniqueItems: [],
    usableMiningCutters: 2,
    slotsAvailable: 4,
    massAvailableGrams: 30_000,
    autoDiscardScrap: false,
    finishCurrent: false,
    allowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
    ...overrides,
  };
}

describe("advanced Tinkering, from the universal rules alone", () => {
  const target = (actionId: string) => tinkeringTargetForActionId(actionId, balance)!;
  const spoolTarget = target(ACTION_IDS.galvanicWireSpoolTinkering);
  const cellTarget = target(ACTION_IDS.powerCellTinkering);
  const loadsteelTarget = target(ACTION_IDS.loadsteelCutterTinkering);
  const harnessTarget = target(ACTION_IDS.freightHarnessTinkering);

  it.each([
    // name, target, level, XP, ticks (seconds × 1/0.6), Scrap
    ["Galvanic Wire Spool", spoolTarget, 5, 45, 48, 1],
    ["Power Cells (2)", cellTarget, 5, 75, 60, 1],
    ["Loadsteel Cutter", loadsteelTarget, 5, 180, 90, 2],
    ["Freight Harness", harnessTarget, 8, 270, 120, 3],
  ] as const)(
    "%s: Fabrication %i, %i XP, %i ticks, %i Scrap",
    (_, each, level, xp, ticks, scrap) => {
      expect(tinkeringUnlocked(level - 1, each.recipe)).toBe(false);
      expect(tinkeringUnlocked(level, each.recipe)).toBe(true);
      expect(tinkeringXp(each.recipe)).toBe(xp);
      expect(tinkeringDurationTicks(each.recipe, balance)).toBe(ticks);
      expect(tinkeringScrapYield(each.recipe, balance)).toBe(scrap);
    },
  );

  it("derives every target's values from its recipe, with no item exception anywhere", () => {
    for (const each of tinkeringTargets(balance)) {
      const units = each.recipe.inputs.reduce((sum, input) => sum + input.quantity, 0);
      expect(tinkeringXp(each.recipe)).toBe(each.recipe.baseXp);
      expect(tinkeringDurationTicks(each.recipe, balance)).toBe(each.recipe.durationTicks * 2);
      expect(tinkeringScrapYield(each.recipe, balance)).toBe(Math.ceil(units / 2));
    }
  });

  it("takes Power Cells only as a complete two-Cell batch", () => {
    const one = tinkering({ stacks: stacks([ITEM_IDS.powerCell, 1]) });
    expect(tinkeringAffordableBatches(one, cellTarget)).toBe(0);
    expect(tinkeringStartCheck(one, cellTarget)).toEqual({
      ok: false,
      reason: "no_eligible_items",
    });
    const five = tinkering({ stacks: stacks([ITEM_IDS.powerCell, 5]) });
    expect(tinkeringAffordableBatches(five, cellTarget)).toBe(2);
    const run = resolveTinkering({
      elapsedTicks: 60 * 3,
      snapshot: five,
      target: cellTarget,
    });
    expect(run.resolved).toHaveLength(2);
    expect(run.itemsCommitted).toEqual({ [ITEM_IDS.powerCell]: 4 });
    expect(run.scrapKept).toBe(2);
    expect(run.awardedXp).toBe(150);
    // The fifth Cell is left alone: half a batch is never Tinkered.
    expect(run.stopReason).toBe("no_eligible_items");
  });

  it("dismantles a Freight Harness only once it is carried and unequipped", () => {
    expect(
      tinkeringStartCheck(
        tinkering({ carriedUniqueItems: [instance("h", ITEM_IDS.freightHarness, null)] }),
        harnessTarget,
      ),
    ).toEqual({ ok: true });
    expect(tinkeringStartCheck(tinkering(), harnessTarget)).toEqual({
      ok: false,
      reason: "no_eligible_items",
    });
  });
});

describe("the last-usable-Cutter guard covers both Mining tools", () => {
  const loadsteelTarget = tinkeringTargetForActionId(ACTION_IDS.loadsteelCutterTinkering, balance)!;
  const salvageTarget = tinkeringTargetForActionId(ACTION_IDS.salvageCutterTinkering, balance)!;
  const carriedLoadsteel = instance("l1", ITEM_IDS.loadsteelCutter);
  const carriedSalvage = instance("s1", ITEM_IDS.salvageCutter);

  it("counts every owned usable Cutter of either kind, by the character's Mining level", () => {
    const owned = [
      { itemId: ITEM_IDS.salvageCutter },
      { itemId: ITEM_IDS.loadsteelCutter },
      { itemId: ITEM_IDS.scrapBox },
    ];
    expect(usableMiningCutterCount(owned, 5, balance)).toBe(2);
    // Below Mining 5 a Loadsteel Cutter cannot be used, so it keeps no one mining.
    expect(usableMiningCutterCount(owned, 4, balance)).toBe(1);
  });

  it("refuses the Loadsteel Cutter that is the last usable Cutter", () => {
    const only = tinkering({ carriedUniqueItems: [carriedLoadsteel], usableMiningCutters: 1 });
    expect(tinkeringStartCheck(only, loadsteelTarget)).toEqual({
      ok: false,
      reason: "last_cutter",
    });
    expect(tinkeringAffordableBatches(only, loadsteelTarget)).toBe(0);
    const spare = tinkering({ carriedUniqueItems: [carriedLoadsteel], usableMiningCutters: 2 });
    expect(tinkeringStartCheck(spare, loadsteelTarget)).toEqual({ ok: true });
  });

  it("keeps a Salvage Cutter that a Mining 4 character's Loadsteel Cutter cannot replace", () => {
    // Salvage equipped elsewhere is not the case here: the carried Salvage is
    // the one usable Cutter, and the Loadsteel beside it needs Mining 5.
    const belowFive = tinkering({
      miningLevel: 4,
      carriedUniqueItems: [carriedSalvage, carriedLoadsteel],
      usableMiningCutters: 1,
    });
    expect(tinkeringStartCheck(belowFive, salvageTarget)).toEqual({
      ok: false,
      reason: "last_cutter",
    });
    // Taking the unusable Loadsteel Cutter apart leaves the usable Salvage one.
    expect(tinkeringStartCheck(belowFive, loadsteelTarget)).toEqual({ ok: true });
  });
});
