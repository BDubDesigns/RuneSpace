import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import { formatMassGrams } from "@/game/domain/mass";
import { carriedItemMassGrams } from "@/game/domain/equipment";
import type { MiningGameplayState } from "@/server/mining";
import {
  derivePowerCellLoadAvailability,
  resolveInventorySelection,
} from "@/features/mining/inventory-selection";
import { InventoryDetailsStats } from "@/features/mining/InventoryDetailsStats";

const balance = getEffectiveGameBalance();

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
    missions: [],
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
    equipment: { aggregateContainerSlots: 8, carriedPowerCellQuantity: 0, slots: [] },
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

/**
 * Mirrors what InventoryDetailsStats now renders generically for any stack
 * selection: Quantity + Stack limit + Unit mass + Total mass — all from the
 * projected entry, formatted canonically, with no per-item branch. This helper
 * documents the expected values; the regression below proves the *real*
 * component renders them.
 */
function genericStackDetails(entry: MiningGameplayState["inventory"]["stacks"][number]) {
  return {
    quantity: String(entry.quantity),
    stackLimit: String(entry.stackLimit),
    unitMass: formatMassGrams(entry.massGrams),
    totalMass: formatMassGrams(entry.massGrams * entry.quantity),
  };
}

describe("inventory generic stack details — issue #119", () => {
  it("every stackable item has canonical mass + stack limit (no missing branch)", () => {
    for (const itemId of [
      ITEM_IDS.ferriteShale,
      ITEM_IDS.powerCell,
      ITEM_IDS.refinedFerrite,
      ITEM_IDS.slag,
    ] as const) {
      const def = getItemDefinition(itemId, balance);
      expect(def?.kind).toBe("stack");
      if (def?.kind === "stack") {
        expect(def.massGrams).toBeGreaterThan(0);
        expect(def.stackLimit).toBeGreaterThan(0);
      }
      // Authoritative domain resolver must agree, not just the UI map.
      expect(carriedItemMassGrams(itemId, balance)).toBe(def?.massGrams);
    }
  });

  it("regression: Refined Ferrite renders generic stack details without an item-ID branch", () => {
    const refinedFerriteStack: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "stack-refined",
      itemId: ITEM_IDS.refinedFerrite,
      name: "Refined Ferrite",
      quantity: 3,
      stackLimit: balance.items.refinedFerrite.stackLimit,
      massGrams: balance.items.refinedFerrite.massGrams,
    };
    expect(genericStackDetails(refinedFerriteStack)).toEqual({
      quantity: "3",
      stackLimit: "5",
      unitMass: "150 g",
      totalMass: "450 g",
    });
    // Must come from projection, not from balance.items.refinedFerrite read inside the panel.
    expect(refinedFerriteStack.massGrams).toBe(
      carriedItemMassGrams(ITEM_IDS.refinedFerrite, balance),
    );
  });

  it("regression: Slag renders the same generic stack details (second previously-unhandled stackable)", () => {
    const slagStack: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "stack-slag",
      itemId: ITEM_IDS.slag,
      name: "Slag",
      quantity: 10,
      stackLimit: balance.items.slag.stackLimit,
      massGrams: balance.items.slag.massGrams,
    };
    expect(genericStackDetails(slagStack)).toEqual({
      quantity: "10",
      stackLimit: "10",
      unitMass: "150 g",
      totalMass: "1.5 kg",
    });
  });

  it("total mass multiplies the selected stack quantity and formats canonically across the <1000 / >=1000 boundary", () => {
    const shaleFull: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "s",
      itemId: ITEM_IDS.ferriteShale,
      name: "Ferrite Shale",
      quantity: 10,
      stackLimit: 10,
      massGrams: 100,
    };
    expect(genericStackDetails(shaleFull).totalMass).toBe("1 kg"); // 10 * 100 g

    const shaleMid: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "s2",
      itemId: ITEM_IDS.ferriteShale,
      name: "Ferrite Shale",
      quantity: 5,
      stackLimit: 10,
      massGrams: 100,
    };
    expect(genericStackDetails(shaleMid).totalMass).toBe("500 g");
    expect(genericStackDetails(shaleMid).unitMass).toBe("100 g");

    const powerCellTriple: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "p",
      itemId: ITEM_IDS.powerCell,
      name: "Power Cell",
      quantity: 3,
      stackLimit: 5,
      massGrams: 500,
    };
    expect(genericStackDetails(powerCellTriple).totalMass).toBe("1.5 kg"); // 3 * 500

    // Fractional kg stripping (e.g. 1010 g already covered by mass.test, but total still goes through same formatter)
    expect(formatMassGrams(1010)).toBe("1.01 kg");
    expect(formatMassGrams(1100)).toBe("1.1 kg");
  });

  it("Power Cell still receives item-specific Load behavior while ordinary stackables do not", () => {
    const powerCellStack: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "stack-cell",
      itemId: ITEM_IDS.powerCell,
      name: "Power Cell",
      quantity: 2,
      stackLimit: 5,
      massGrams: 500,
    };
    const refinedFerriteStack: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "stack-refined",
      itemId: ITEM_IDS.refinedFerrite,
      name: "Refined Ferrite",
      quantity: 2,
      stackLimit: 5,
      massGrams: 150,
    };

    const powerCellState = baseState(inventoryState([powerCellStack], []));
    powerCellState.equipment.carriedPowerCellQuantity = 2;
    powerCellState.equipment.salvageCutter = {
      currentCharge: 0,
      maximumCharge: 10,
      boostedAttemptDurationTicks: 5,
    };
    const powerCellSelection = resolveInventorySelection(powerCellState.inventory, {
      kind: "stack",
      id: powerCellStack.id,
    });
    expect(derivePowerCellLoadAvailability(powerCellState, powerCellSelection, false)).toEqual({
      enabled: true,
    });

    const refinedState = baseState(inventoryState([refinedFerriteStack], []));
    refinedState.equipment.carriedPowerCellQuantity = 0;
    refinedState.equipment.salvageCutter = {
      currentCharge: 0,
      maximumCharge: 10,
      boostedAttemptDurationTicks: 5,
    };
    const refinedSelection = resolveInventorySelection(refinedState.inventory, {
      kind: "stack",
      id: refinedFerriteStack.id,
    });
    // Ordinary stackables are not Power Cells — no Load surface at all, even when a Cutter is equipped.
    expect(derivePowerCellLoadAvailability(refinedState, refinedSelection, false)).toBeUndefined();
  });

  it("unique-item details remain metadata-driven and mass stays canonically formatted", () => {
    const cutter = {
      id: "instance-cutter",
      itemId: ITEM_IDS.salvageCutter,
      name: "Salvage Cutter",
      massGrams: 5_000,
      currentCharge: 3,
    } as const;
    expect(formatMassGrams(cutter.massGrams)).toBe("5 kg");

    const container = {
      id: "instance-container",
      itemId: ITEM_IDS.mykeaSchleppraum8,
      name: "MYKEA Schleppraum-8",
      massGrams: 10_000,
    } as const;
    expect(formatMassGrams(container.massGrams)).toBe("10 kg");
  });
});

describe("InventoryDetailsStats — real UI regression (issue #119)", () => {
  it("renders Refined Ferrite Quantity, Stack limit, Unit mass, and Total mass through the real panel component", () => {
    const refinedFerriteStack: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "stack-refined",
      itemId: ITEM_IDS.refinedFerrite,
      name: "Refined Ferrite",
      quantity: 3,
      stackLimit: balance.items.refinedFerrite.stackLimit,
      massGrams: balance.items.refinedFerrite.massGrams,
    };
    const html = renderToStaticMarkup(
      React.createElement(InventoryDetailsStats, {
        selection: { kind: "stack", entry: refinedFerriteStack },
      }),
    );
    // This would fail if the panel regressed to the old ferriteShale/powerCell-only branch,
    // because Refined Ferrite would fall through to Quantity-only with no mass/limit rows.
    expect(html).toContain('data-stat="quantity"');
    expect(html).toContain('data-stat="stack-limit"');
    expect(html).toContain('data-stat="unit-mass"');
    expect(html).toContain('data-stat="total-mass"');
    expect(html).toContain("Refined Ferrite");
    // Quantity uses the projected quantity, not a hard-coded per-item value.
    expect(html).toContain(">3<");
    // Stack limit + masses come from the authoritative projection via the canonical formatter.
    expect(html).toContain(">5<"); // stackLimit for refined ferrite
    expect(html).toContain("150 g"); // unit mass
    expect(html).toContain("450 g"); // 3 * 150 g
  });

  it("renders the same generic stack details for Slag and for total-mass boundary cases through the real component", () => {
    const slagStack: MiningGameplayState["inventory"]["stacks"][number] = {
      id: "stack-slag",
      itemId: ITEM_IDS.slag,
      name: "Slag",
      quantity: 10,
      stackLimit: balance.items.slag.stackLimit,
      massGrams: balance.items.slag.massGrams,
    };
    const html = renderToStaticMarkup(
      React.createElement(InventoryDetailsStats, {
        selection: { kind: "stack", entry: slagStack },
      }),
    );
    expect(html).toContain('data-stat="quantity"');
    expect(html).toContain('data-stat="stack-limit"');
    expect(html).toContain('data-stat="unit-mass"');
    expect(html).toContain('data-stat="total-mass"');
    expect(html).toContain("150 g");
    expect(html).toContain("1.5 kg"); // 10 * 150 g crosses the g→kg boundary
  });

  it("keeps unique-item rendering metadata-driven and does not emit stack rows", () => {
    const cutter = {
      id: "instance-cutter",
      itemId: ITEM_IDS.salvageCutter,
      name: "Salvage Cutter",
      massGrams: 5_000,
      currentCharge: 3,
    } as const;
    const html = renderToStaticMarkup(
      React.createElement(InventoryDetailsStats, {
        selection: { kind: "unique", entry: cutter },
      }),
    );
    expect(html).toContain('data-stat="mass"');
    expect(html).toContain("5 kg");
    expect(html).not.toContain('data-stat="total-mass"');
    expect(html).not.toContain('data-stat="unit-mass"');
  });
});
