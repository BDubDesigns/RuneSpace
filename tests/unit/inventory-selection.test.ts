import { describe, expect, it } from "vitest";
import { ITEM_IDS } from "@/game/config/foundations";
import type { MiningGameplayState } from "@/server/mining";
import {
  derivePowerCellLoadAvailability,
  resolveInventorySelection,
  stackDropActions,
  toggleInventorySelection,
} from "@/features/mining/inventory-selection";
import { DiscardInventoryStackRequestSchema } from "@/game/schemas/gameplay";

function inventoryState(
  stacks: MiningGameplayState["inventory"]["stacks"] = [],
  uniqueItems: MiningGameplayState["inventory"]["uniqueItems"] = [],
): MiningGameplayState["inventory"] {
  return {
    slotsUsed: stacks.length + uniqueItems.length,
    slotsAvailable: 8 - stacks.length - uniqueItems.length,
    massGrams: 0,
    capacityGrams: 50_000,
    stacks,
    uniqueItems,
  };
}

function baseState(inventory: MiningGameplayState["inventory"]): MiningGameplayState {
  return {
    characterId: "character-1",
    location: { currentLocationId: "crash_site" },
    mining: { totalXp: 0, level: 1, xpIntoLevel: 0 },
    refining: { totalXp: 0, level: 1, xpIntoLevel: 0 },
    welding: { totalXp: 0, level: 1, xpIntoLevel: 0 },
    successChanceBps: 3_500,
    refiningSuccessChanceBps: 4_000,
    ferriteShaleQuantity: 0,
    refinedFerriteQuantity: 0,
    slagQuantity: 0,
    inventory,
    equipment: {
      aggregateContainerSlots: 8,
      carriedPowerCellQuantity: 0,
      slots: [],
    },
    run: {
      attempts: 0,
      successes: 0,
      failures: 0,
      shaleGained: 0,
      xpGained: 0,
      recentAttempts: [],
    },
    refiningRun: {
      attempts: 0,
      successes: 0,
      failures: 0,
      ferriteGained: 0,
      slagGained: 0,
      shaleConsumed: 0,
      xpGained: 0,
      recentAttempts: [],
    },
    cargoHold: {
      repair: {
        refinedFerriteContributed: 0,
        refinedFerriteRequired: 15,
        slagContributed: 0,
        slagRequired: 6,
        weldingProgress: 0,
        weldingIncrements: 12,
        materialComplete: false,
        complete: false,
        availableContribution: { refinedFerrite: 0, slag: 0 },
      },
      stacks: [],
      uniqueItems: [],
      slotsUsed: 0,
      capacitySlots: 32,
    },
    recentResult: { successes: 0, failures: 0, awardedXp: 0 },
    refiningRecentResult: { successes: 0, failures: 0, awardedXp: 0 },
    scavengeReveals: [],
  };
}

const ferriteStack = {
  id: "stack-ferrite",
  itemId: ITEM_IDS.ferriteShale,
  name: "Ferrite Shale",
  quantity: 5,
  stackLimit: 10,
};

const powerCellStack = {
  id: "stack-cell",
  itemId: ITEM_IDS.powerCell,
  name: "Power Cell",
  quantity: 2,
  stackLimit: 5,
};

const carriedCutter = {
  id: "instance-cutter",
  itemId: ITEM_IDS.salvageCutter,
  name: "Salvage Cutter",
  massGrams: 5_000,
  currentCharge: 3,
};

describe("inventory selection resolution", () => {
  it("resolves a stack entry by its stable stack ID", () => {
    const inventory = inventoryState([ferriteStack], []);
    expect(resolveInventorySelection(inventory, { kind: "stack", id: ferriteStack.id })).toEqual({
      kind: "stack",
      entry: ferriteStack,
    });
  });

  it("resolves a unique item entry by its stable instance ID", () => {
    const inventory = inventoryState([], [carriedCutter]);
    expect(resolveInventorySelection(inventory, { kind: "unique", id: carriedCutter.id })).toEqual({
      kind: "unique",
      entry: carriedCutter,
    });
  });

  it("uses the explicit kind when both identity namespaces hold the same ID", () => {
    const inventory = inventoryState(
      [{ ...ferriteStack, id: "same-id" }],
      [{ ...carriedCutter, id: "same-id" }],
    );
    expect(resolveInventorySelection(inventory, { kind: "stack", id: "same-id" })).toMatchObject({
      kind: "stack",
      entry: { id: "same-id", itemId: ITEM_IDS.ferriteShale },
    });
    expect(resolveInventorySelection(inventory, { kind: "unique", id: "same-id" })).toMatchObject({
      kind: "unique",
      entry: { id: "same-id", itemId: ITEM_IDS.salvageCutter },
    });
  });

  it("clears safely when the selected stack was removed by an authoritative update", () => {
    const inventory = inventoryState([], []);
    expect(resolveInventorySelection(inventory, { kind: "stack", id: ferriteStack.id })).toBe(
      undefined,
    );
    expect(resolveInventorySelection(inventory, { kind: "unique", id: carriedCutter.id })).toBe(
      undefined,
    );
    expect(resolveInventorySelection(inventory, undefined)).toBe(undefined);
  });
});

describe("stack drop action derivation", () => {
  it("produces one non-duplicated destructive action for a one-item stack", () => {
    expect(stackDropActions(1)).toEqual([{ mode: "one", label: "Drop item" }]);
  });

  it("produces Drop 1 and the confirmed-quantity Drop stack for larger stacks", () => {
    expect(stackDropActions(5)).toEqual([
      { mode: "one", label: "Drop 1" },
      { mode: "stack", label: "Drop stack (5)" },
    ]);
  });

  it("exposes no destructive actions for impossible empty stacks", () => {
    expect(stackDropActions(0)).toEqual([]);
  });
});

describe("selection toggling", () => {
  it("selecting the currently selected entry toggles the selection off", () => {
    const current = { kind: "stack" as const, id: ferriteStack.id };
    expect(toggleInventorySelection(current, { kind: "stack", id: ferriteStack.id })).toBe(
      undefined,
    );
    const unique = { kind: "unique" as const, id: carriedCutter.id };
    expect(toggleInventorySelection(unique, { kind: "unique", id: carriedCutter.id })).toBe(
      undefined,
    );
  });

  it("selecting another item replaces the current selection", () => {
    const current = { kind: "stack" as const, id: ferriteStack.id };
    expect(toggleInventorySelection(current, { kind: "unique", id: carriedCutter.id })).toEqual({
      kind: "unique",
      id: carriedCutter.id,
    });
    expect(toggleInventorySelection(undefined, { kind: "stack", id: ferriteStack.id })).toEqual({
      kind: "stack",
      id: ferriteStack.id,
    });
  });

  it("does not toggle off across identity namespaces that share an ID", () => {
    expect(
      toggleInventorySelection({ kind: "stack", id: "same-id" }, { kind: "unique", id: "same-id" }),
    ).toEqual({ kind: "unique", id: "same-id" });
  });
});

describe("Power Cell load availability", () => {
  function stateWith(overrides: {
    cutter?: MiningGameplayState["equipment"]["salvageCutter"];
    carriedPowerCellQuantity?: number;
  }) {
    const inventory = inventoryState([powerCellStack], []);
    const state = baseState(inventory);
    state.equipment.carriedPowerCellQuantity = overrides.carriedPowerCellQuantity ?? 2;
    if (overrides.cutter !== undefined) {
      state.equipment.salvageCutter = overrides.cutter;
    }
    return state;
  }

  function depletedCutter() {
    return { currentCharge: 0, maximumCharge: 10, boostedAttemptDurationTicks: 5 };
  }

  it("enables loading a depleted equipped Cutter when a Power Cell stack is selected", () => {
    const state = stateWith({ cutter: depletedCutter() });
    const selection = resolveInventorySelection(state.inventory, {
      kind: "stack",
      id: powerCellStack.id,
    });
    expect(derivePowerCellLoadAvailability(state, selection, false)).toEqual({ enabled: true });
  });

  it("disables loading with the remaining-charge reason while the Cutter is charged", () => {
    const state = stateWith({
      cutter: { currentCharge: 4, maximumCharge: 10, boostedAttemptDurationTicks: 5 },
    });
    const selection = resolveInventorySelection(state.inventory, {
      kind: "stack",
      id: powerCellStack.id,
    });
    expect(derivePowerCellLoadAvailability(state, selection, false)).toEqual({
      enabled: false,
      reason: "charged",
      remainingCharge: 4,
    });
  });

  it("disables loading with the equip-first reason when no Cutter is equipped", () => {
    const state = stateWith({ cutter: undefined });
    const selection = resolveInventorySelection(state.inventory, {
      kind: "stack",
      id: powerCellStack.id,
    });
    expect(derivePowerCellLoadAvailability(state, selection, false)).toEqual({
      enabled: false,
      reason: "no_cutter",
    });
  });

  it("disables loading while a conflicting command is in flight", () => {
    const state = stateWith({});
    const selection = resolveInventorySelection(state.inventory, {
      kind: "stack",
      id: powerCellStack.id,
    });
    expect(derivePowerCellLoadAvailability(state, selection, true)).toEqual({
      enabled: false,
      reason: "busy",
    });
  });

  it("disables loading when no Power Cells are carried", () => {
    const state = stateWith({
      carriedPowerCellQuantity: 0,
      cutter: depletedCutter(),
    });
    const selection = resolveInventorySelection(state.inventory, {
      kind: "stack",
      id: powerCellStack.id,
    });
    expect(derivePowerCellLoadAvailability(state, selection, false)).toEqual({
      enabled: false,
      reason: "no_cells",
    });
  });

  it("offers no load surface for non-Power-Cell selections", () => {
    const inventory = inventoryState([ferriteStack], []);
    const state = baseState(inventory);
    state.equipment.salvageCutter = depletedCutter();
    const selection = resolveInventorySelection(state.inventory, {
      kind: "stack",
      id: ferriteStack.id,
    });
    expect(derivePowerCellLoadAvailability(state, selection, false)).toBe(undefined);
    expect(derivePowerCellLoadAvailability(state, undefined, false)).toBe(undefined);
  });

  it("offers no load surface for carried unique items", () => {
    const inventory = inventoryState([], [carriedCutter]);
    const state = baseState(inventory);
    state.equipment.salvageCutter = depletedCutter();
    const selection = resolveInventorySelection(state.inventory, {
      kind: "unique",
      id: carriedCutter.id,
    });
    expect(derivePowerCellLoadAvailability(state, selection, false)).toBe(undefined);
  });
});

describe("discard request boundary", () => {
  it("accepts only the narrow server-resolved fields", () => {
    expect(
      DiscardInventoryStackRequestSchema.safeParse({
        characterId: "c340e2b0-0000-4000-8000-000000000000",
        stackId: "e340e2b0-0000-4000-8000-000000000001",
        mode: "stack",
        expectedQuantity: 5,
      }).success,
    ).toBe(true);
    expect(
      DiscardInventoryStackRequestSchema.safeParse({
        characterId: "c340e2b0-0000-4000-8000-000000000000",
        stackId: "e340e2b0-0000-4000-8000-000000000001",
        mode: "one",
        expectedQuantity: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects forged or malformed discard commands", () => {
    const base = {
      characterId: "c340e2b0-0000-4000-8000-000000000000",
      stackId: "e340e2b0-0000-4000-8000-000000000001",
      mode: "stack",
      expectedQuantity: 5,
    };
    expect(
      DiscardInventoryStackRequestSchema.safeParse({ ...base, stackId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(DiscardInventoryStackRequestSchema.safeParse({ ...base, mode: "all" }).success).toBe(
      false,
    );
    expect(
      DiscardInventoryStackRequestSchema.safeParse({ ...base, expectedQuantity: 0 }).success,
    ).toBe(false);
    expect(
      DiscardInventoryStackRequestSchema.safeParse({ ...base, expectedQuantity: -1 }).success,
    ).toBe(false);
    // Unknown client-supplied item facts are stripped, never trusted: the
    // parsed request exposes only the narrow server-resolved fields.
    const forged = DiscardInventoryStackRequestSchema.safeParse({ ...base, itemId: "power_cell" });
    expect(forged.success).toBe(true);
    expect("itemId" in (forged.success ? forged.data : {})).toBe(false);
  });
});
