import { describe, expect, it } from "vitest";
import {
  equipmentDefinitions,
  getEffectiveGameBalance,
  getEquipmentDefinition,
  getItemMaximumCharge,
  getMiningToolDefinition,
} from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  deriveEquipmentLoadout,
  isCompatibleEquipmentAssignment,
  planEquipmentChange,
  unmetEquipRequirement,
} from "@/game/domain/equipment";
import {
  boostedMiningAttemptDurationTicks,
  miningAttemptDurationTicks,
  miningSuccessChanceBps,
  miningYieldRange,
  normalizeCutterCharge,
  resolveMining,
  type MiningRandom,
  type MiningSnapshot,
} from "@/game/domain/mining";
import { scaledAttemptDurationTicks } from "@/game/domain/timing";

/**
 * The equipment-definition boundary and the Loadsteel Cutter's Mining (#233).
 *
 * Every Mining tool and every container resolves through one authored
 * boundary; the Salvage Cutter's behaviour is exactly what it was; and the
 * Loadsteel Cutter's permanent 0.8×, the shared charged 2× on top of it, its
 * +1 charged maximum yield, its ten-attempt Cell and its Mining 5 requirement
 * hold at both sources.
 */

const balance = getEffectiveGameBalance();
const ferrite = balance.mining.sources.ferriteShale;
const galvanite = balance.mining.sources.galvanite;
const salvage = getMiningToolDefinition(ITEM_IDS.salvageCutter, balance)!;
const loadsteel = getMiningToolDefinition(ITEM_IDS.loadsteelCutter, balance)!;

function rolls(basisPoints: number[], units: number[] = []): MiningRandom {
  return {
    nextBasisPoints: () => basisPoints.shift() ?? 0,
    nextUnit: () => units.shift() ?? 0,
  };
}

const ready: MiningSnapshot = {
  miningLevel: 5,
  tool: loadsteel,
  cutterCharge: 0,
  existingStacks: [],
  slotsAvailable: 8,
  massAvailableGrams: 30_000,
};

describe("the canonical equipment-definition boundary", () => {
  it("authors both Mining tools and all three containers, and nothing else", () => {
    expect(
      equipmentDefinitions(balance).map((definition) => [definition.itemId, definition.kind]),
    ).toEqual([
      [ITEM_IDS.salvageCutter, "mining_tool"],
      [ITEM_IDS.loadsteelCutter, "mining_tool"],
      [ITEM_IDS.mykeaSchleppraum8, "container"],
      [ITEM_IDS.scrapBox, "container"],
      [ITEM_IDS.freightHarness, "container"],
    ]);
    expect(getEquipmentDefinition(ITEM_IDS.powerCell, balance)).toBeUndefined();
    expect(getEquipmentDefinition(ITEM_IDS.galvanicWireSpool, balance)).toBeUndefined();
  });

  it("keeps the Salvage Cutter's authored facts exactly", () => {
    expect(salvage).toEqual({
      kind: "mining_tool",
      itemId: ITEM_IDS.salvageCutter,
      assignmentKind: "gear",
      suitSlotIds: ["mining_tool"],
      requiredMiningLevel: 1,
      maximumCharge: 10,
      baseDurationMultiplierBps: 10_000,
      chargedYieldMaximumBonus: 0,
    });
  });

  it("authors the Loadsteel Cutter as a separate Mining 5 tool in the same one tool slot", () => {
    expect(loadsteel).toEqual({
      kind: "mining_tool",
      itemId: ITEM_IDS.loadsteelCutter,
      assignmentKind: "gear",
      suitSlotIds: ["mining_tool"],
      requiredMiningLevel: 5,
      maximumCharge: 10,
      baseDurationMultiplierBps: 8_000,
      chargedYieldMaximumBonus: 1,
    });
    expect(getItemMaximumCharge(ITEM_IDS.loadsteelCutter, balance)).toBe(10);
    expect(getItemMaximumCharge(ITEM_IDS.scrapBox, balance)).toBeUndefined();
  });

  it("resolves every container's slots from the one boundary, in the existing two slots only", () => {
    const slots = equipmentDefinitions(balance).flatMap((definition) =>
      definition.kind === "container" ? [[definition.itemId, definition.slotCapacity]] : [],
    );
    expect(slots).toEqual([
      [ITEM_IDS.mykeaSchleppraum8, 8],
      [ITEM_IDS.scrapBox, 3],
      [ITEM_IDS.freightHarness, 6],
    ]);
    for (const itemId of [ITEM_IDS.mykeaSchleppraum8, ITEM_IDS.scrapBox, ITEM_IDS.freightHarness]) {
      expect(getEquipmentDefinition(itemId, balance)?.suitSlotIds).toEqual([
        "container_attachment_1",
        "container_attachment_2",
      ]);
    }
  });
});

describe("equipping through the boundary", () => {
  const tool = { assignmentKind: "gear", suitSlotId: balance.carrying.miningToolSuitSlotId };
  const firstContainer = {
    assignmentKind: "container",
    suitSlotId: balance.carrying.containerSuitSlotIds[0],
  };
  const secondContainer = {
    assignmentKind: "container",
    suitSlotId: balance.carrying.containerSuitSlotIds[1],
  };
  const mykea = { id: "mykea", itemId: ITEM_IDS.mykeaSchleppraum8 };
  const harness = { id: "harness", itemId: ITEM_IDS.freightHarness };
  const salvageItem = { id: "salvage", itemId: ITEM_IDS.salvageCutter };
  const loadsteelItem = { id: "loadsteel", itemId: ITEM_IDS.loadsteelCutter };

  it("fits either Cutter to the Mining-tool slot and never to a container slot", () => {
    for (const itemId of [ITEM_IDS.salvageCutter, ITEM_IDS.loadsteelCutter]) {
      expect(isCompatibleEquipmentAssignment(itemId, tool, balance)).toBe(true);
      expect(isCompatibleEquipmentAssignment(itemId, firstContainer, balance)).toBe(false);
    }
    expect(isCompatibleEquipmentAssignment(ITEM_IDS.freightHarness, secondContainer, balance)).toBe(
      true,
    );
    expect(isCompatibleEquipmentAssignment(ITEM_IDS.freightHarness, tool, balance)).toBe(false);
  });

  it("adds a Freight Harness's six slots to the MYKEA's eight and carries its 9 kg", () => {
    const loadout = deriveEquipmentLoadout({
      assignments: [
        { ...firstContainer, itemInstanceId: mykea.id },
        { ...secondContainer, itemInstanceId: harness.id },
      ],
      instances: [mykea, harness],
      stacks: [],
      balance,
    });
    expect(loadout.containerSlotCapacity).toBe(14);
    expect(loadout.carriedMassGrams).toBe(19_000);
    expect(loadout.maximumCarryCapacityGrams).toBe(50_000);
  });

  it("names whichever Cutter is equipped, with its own definition", () => {
    const loadout = deriveEquipmentLoadout({
      assignments: [
        { ...tool, itemInstanceId: loadsteelItem.id },
        { ...firstContainer, itemInstanceId: mykea.id },
      ],
      instances: [loadsteelItem, mykea],
      stacks: [],
      balance,
    });
    expect(loadout.miningTool).toEqual({
      itemInstanceId: loadsteelItem.id,
      itemId: ITEM_IDS.loadsteelCutter,
      definition: loadsteel,
    });
    const none = deriveEquipmentLoadout({
      assignments: [{ ...firstContainer, itemInstanceId: mykea.id }],
      instances: [mykea],
      stacks: [],
      balance,
    });
    expect(none.miningTool).toBeUndefined();
  });

  it("refuses the Loadsteel Cutter below Mining 5, allows it at 5, and never gates the Salvage Cutter", () => {
    const plan = (item: { id: string; itemId: string }, miningLevel: number) =>
      planEquipmentChange({
        assignments: [{ ...firstContainer, itemInstanceId: mykea.id }],
        instances: [item, mykea],
        stacks: [],
        balance,
        miningLevel,
        change: { kind: "equip", itemInstanceId: item.id, target: tool },
      });
    expect(() => plan(loadsteelItem, 4)).toThrow("Requires Mining 5 to equip.");
    expect(plan(loadsteelItem, 5).miningTool?.itemId).toBe(ITEM_IDS.loadsteelCutter);
    expect(plan(salvageItem, 1).miningTool?.itemId).toBe(ITEM_IDS.salvageCutter);
    expect(unmetEquipRequirement(ITEM_IDS.loadsteelCutter, 4, balance)).toEqual({
      requiredMiningLevel: 5,
    });
    expect(unmetEquipRequirement(ITEM_IDS.loadsteelCutter, 5, balance)).toBeUndefined();
    expect(unmetEquipRequirement(ITEM_IDS.freightHarness, 1, balance)).toBeUndefined();
  });

  it("swaps one Cutter for the other in the single tool slot", () => {
    const swapped = planEquipmentChange({
      assignments: [
        { ...tool, itemInstanceId: salvageItem.id },
        { ...firstContainer, itemInstanceId: mykea.id },
      ],
      instances: [salvageItem, loadsteelItem, mykea],
      stacks: [],
      balance,
      miningLevel: 5,
      change: { kind: "equip", itemInstanceId: loadsteelItem.id, target: tool },
    });
    expect(swapped.miningTool?.itemId).toBe(ITEM_IDS.loadsteelCutter);
    expect(swapped.assignments.filter((each) => each.assignmentKind === "gear")).toHaveLength(1);
  });
});

describe("Mining durations under the shared whole-tick rules", () => {
  it("rounds a basis-point duration multiplier up to a whole tick, never below one", () => {
    expect(scaledAttemptDurationTicks(10, 8_000)).toBe(8);
    expect(scaledAttemptDurationTicks(15, 8_000)).toBe(12);
    expect(scaledAttemptDurationTicks(7, 8_000)).toBe(6);
    expect(scaledAttemptDurationTicks(1, 1)).toBe(1);
    expect(() => scaledAttemptDurationTicks(10, 0)).toThrow(RangeError);
  });

  it("leaves the Salvage Cutter exactly as it was: 10 / 5 and 15 / 8", () => {
    expect(miningAttemptDurationTicks(balance, ferrite, salvage, false)).toBe(10);
    expect(miningAttemptDurationTicks(balance, ferrite, salvage, true)).toBe(5);
    expect(miningAttemptDurationTicks(balance, galvanite, salvage, false)).toBe(15);
    expect(miningAttemptDurationTicks(balance, galvanite, salvage, true)).toBe(8);
    expect(boostedMiningAttemptDurationTicks(balance, ferrite)).toBe(5);
    expect(boostedMiningAttemptDurationTicks(balance, galvanite)).toBe(8);
  });

  it("makes the Loadsteel Cutter 8 / 4 at Ferrite Shale and 12 / 6 at Galvanite", () => {
    expect(miningAttemptDurationTicks(balance, ferrite, loadsteel, false)).toBe(8);
    expect(miningAttemptDurationTicks(balance, ferrite, loadsteel, true)).toBe(4);
    expect(miningAttemptDurationTicks(balance, galvanite, loadsteel, false)).toBe(12);
    expect(miningAttemptDurationTicks(balance, galvanite, loadsteel, true)).toBe(6);
    // The global charged rule is the shared 2×, applied on top — not replaced.
    expect(balance.mining.powerCellBoost.speedMultiplier).toBe(2);
  });
});

describe("Loadsteel Mining resolution", () => {
  it.each([
    ["Ferrite Shale", ferrite, 8],
    ["Galvanite", galvanite, 12],
  ] as const)("resolves an uncharged %s attempt in %i ticks", (_, source, ticks) => {
    const early = resolveMining({
      elapsedTicks: ticks - 1,
      snapshot: ready,
      balance,
      source,
      random: rolls([0]),
    });
    expect(early.attempts).toHaveLength(0);
    const done = resolveMining({
      elapsedTicks: ticks,
      snapshot: ready,
      balance,
      source,
      random: rolls([0]),
    });
    expect(done.attempts).toEqual([
      expect.objectContaining({ boosted: false, durationTicks: ticks }),
    ]);
    expect(done.remainingCutterCharge).toBe(0);
  });

  it.each([
    ["Ferrite Shale", ferrite, 4],
    ["Galvanite", galvanite, 6],
  ] as const)("resolves a charged %s attempt in %i ticks", (_, source, ticks) => {
    const done = resolveMining({
      elapsedTicks: ticks,
      snapshot: { ...ready, cutterCharge: 10 },
      balance,
      source,
      random: rolls([0]),
    });
    expect(done.attempts).toEqual([
      expect.objectContaining({ boosted: true, durationTicks: ticks, chargeConsumed: true }),
    ]);
    expect(done.remainingCutterCharge).toBe(9);
  });

  it("consumes exactly one charge on a charged success and on a charged failure", () => {
    const success = resolveMining({
      elapsedTicks: 4,
      snapshot: { ...ready, cutterCharge: 3 },
      balance,
      source: ferrite,
      random: rolls([0]),
    });
    const failure = resolveMining({
      elapsedTicks: 4,
      snapshot: { ...ready, cutterCharge: 3 },
      balance,
      source: ferrite,
      random: rolls([9_999]),
    });
    expect(success).toMatchObject({ successes: 1, remainingCutterCharge: 2 });
    expect(failure).toMatchObject({ failures: 1, remainingCutterCharge: 2 });
  });

  it("gives ten charged attempts from one Cell's ten charge, then continues uncharged at 0.8×", () => {
    expect(normalizeCutterCharge(10, loadsteel)).toBe(10);
    expect(() => normalizeCutterCharge(11, loadsteel)).toThrow(RangeError);
    const run = resolveMining({
      elapsedTicks: 10 * 4 + 8,
      snapshot: { ...ready, cutterCharge: 10, massAvailableGrams: 100_000, slotsAvailable: 20 },
      balance,
      source: ferrite,
      random: rolls(Array(11).fill(9_999)),
    });
    expect(run.attempts.map((attempt) => attempt.durationTicks)).toEqual([...Array(10).fill(4), 8]);
    expect(run.attempts.filter((attempt) => attempt.chargeConsumed)).toHaveLength(10);
    expect(run.remainingCutterCharge).toBe(0);
    expect(run.consumedTicks).toBe(48);
  });

  it("raises only the maximum yield by one while charged: 1–3 at a 1–2 source", () => {
    expect(miningYieldRange(ferrite, loadsteel, true)).toEqual({ minimum: 1, maximum: 3 });
    expect(miningYieldRange(ferrite, loadsteel, false)).toEqual({ minimum: 1, maximum: 2 });
    expect(miningYieldRange(galvanite, loadsteel, true)).toEqual({ minimum: 1, maximum: 3 });
    expect(miningYieldRange(ferrite, salvage, true)).toEqual({ minimum: 1, maximum: 2 });

    // The source's own roll: the low side is still the minimum, the high side
    // is the raised maximum.
    const high = resolveMining({
      elapsedTicks: 4,
      snapshot: { ...ready, cutterCharge: 1 },
      balance,
      source: ferrite,
      random: rolls([0], [0.5]),
    });
    expect(high.attempts[0]).toMatchObject({ success: true, quantityAwarded: 3, xpAwarded: 15 });
    const low = resolveMining({
      elapsedTicks: 4,
      snapshot: { ...ready, cutterCharge: 1 },
      balance,
      source: ferrite,
      random: rolls([0], [0]),
    });
    expect(low.attempts[0]).toMatchObject({ success: true, quantityAwarded: 1, xpAwarded: 15 });
  });

  it("changes neither the success chance nor the XP", () => {
    const charged = resolveMining({
      elapsedTicks: 6,
      snapshot: { ...ready, cutterCharge: 1 },
      balance,
      source: galvanite,
      random: rolls([0], [0.5]),
    });
    expect(charged.attempts[0]).toMatchObject({
      thresholdBasisPoints: miningSuccessChanceBps(5, galvanite),
      xpAwarded: galvanite.successXp,
      quantityAwarded: 3,
    });
    expect(charged.awardedXp).toBe(25);
  });

  it("keeps the 0.8× once depleted, but loses the charged speed and the yield bonus", () => {
    const depleted = resolveMining({
      elapsedTicks: 8,
      snapshot: { ...ready, cutterCharge: 0 },
      balance,
      source: ferrite,
      random: rolls([0], [0.5]),
    });
    expect(depleted.attempts[0]).toMatchObject({
      boosted: false,
      durationTicks: 8,
      chargeConsumed: false,
      quantityAwarded: 2,
    });
  });

  it("falls back to the minimum at a stack or mass boundary, exactly as before", () => {
    const tight = resolveMining({
      elapsedTicks: 4,
      snapshot: {
        ...ready,
        cutterCharge: 1,
        existingStacks: [{ id: "f", itemId: ITEM_IDS.ferriteShale, quantity: 8 }],
        slotsAvailable: 0,
      },
      balance,
      source: ferrite,
      random: rolls([0], [0.5]),
    });
    expect(tight.attempts[0]).toMatchObject({ success: true, quantityAwarded: 1 });
  });

  it("refuses to mine with a Loadsteel Cutter below Mining 5, charged or not", () => {
    const belowFive = resolveMining({
      elapsedTicks: 100,
      snapshot: { ...ready, miningLevel: 4, cutterCharge: 10 },
      balance,
      source: ferrite,
      random: rolls([0]),
    });
    expect(belowFive).toMatchObject({
      consumedTicks: 0,
      attempts: [],
      remainingCutterCharge: 10,
      stopReason: "compatible_mining_tool_missing",
    });
  });

  it("uses exactly the tool it is given: the Salvage Cutter gains no Loadsteel effect", () => {
    const salvageRun = resolveMining({
      elapsedTicks: 5,
      snapshot: { ...ready, tool: salvage, cutterCharge: 1 },
      balance,
      source: ferrite,
      random: rolls([0], [0.5]),
    });
    expect(salvageRun.attempts[0]).toMatchObject({ durationTicks: 5, quantityAwarded: 2 });
  });
});
