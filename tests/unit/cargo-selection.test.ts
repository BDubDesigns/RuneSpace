import { describe, expect, it } from "vitest";
import { ITEM_IDS } from "@/game/config/foundations";
import type { PlayGameplayState } from "@/server/play";
import {
  resolveCargoSelection,
  sameCargoSelection,
  type CargoSelection,
} from "@/features/cargo/cargo-selection";
import { toggleSelection } from "@/features/shared/selectable-details";

const carriedShale = {
  id: "carried-shale",
  itemId: ITEM_IDS.ferriteShale,
  name: "Ferrite Shale",
  quantity: 2,
  stackLimit: 10,
  massGrams: 100,
};

const cargoShale = {
  id: "cargo-shale",
  itemId: ITEM_IDS.ferriteShale,
  name: "Ferrite Shale",
  quantity: 4,
  stackLimit: 10,
};

const carriedCutter = {
  id: "carried-cutter",
  itemId: ITEM_IDS.salvageCutter,
  name: "Salvage Cutter",
  massGrams: 5_000,
  currentCharge: 0,
};

const cargoCutter = {
  id: "cargo-cutter",
  itemId: ITEM_IDS.salvageCutter,
  name: "Salvage Cutter",
  massGrams: 5_000,
  currentCharge: 3,
};

function cargoState(): PlayGameplayState {
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
    inventory: {
      slotsUsed: 2,
      slotsAvailable: 6,
      massGrams: 5_200,
      capacityGrams: 50_000,
      stacks: [carriedShale],
      uniqueItems: [carriedCutter],
    },
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
        refinedFerriteContributed: 15,
        refinedFerriteRequired: 15,
        slagContributed: 6,
        slagRequired: 6,
        weldingProgress: 12,
        weldingIncrements: 12,
        materialComplete: true,
        complete: true,
        repairAvailable: true,
        availableContribution: { refinedFerrite: 0, slag: 0 },
      },
      stacks: [cargoShale],
      uniqueItems: [cargoCutter],
      slotsUsed: 2,
      capacitySlots: 32,
    },
    recentResult: { successes: 0, failures: 0, awardedXp: 0 },
    refiningRecentResult: { successes: 0, failures: 0, awardedXp: 0 },
    scavengeReveals: [],
  };
}

describe("Cargo Hold selection resolution", () => {
  it("resolves stack and unique entries from the area they belong to", () => {
    const state = cargoState();
    expect(
      resolveCargoSelection(state, { area: "carried", kind: "stack", id: carriedShale.id }),
    ).toEqual({ area: "carried", kind: "stack", entry: carriedShale });
    expect(
      resolveCargoSelection(state, { area: "cargo", kind: "stack", id: cargoShale.id }),
    ).toEqual({ area: "cargo", kind: "stack", entry: cargoShale });
    expect(
      resolveCargoSelection(state, { area: "carried", kind: "unique", id: carriedCutter.id }),
    ).toEqual({ area: "carried", kind: "unique", entry: carriedCutter });
    expect(
      resolveCargoSelection(state, { area: "cargo", kind: "unique", id: cargoCutter.id }),
    ).toEqual({ area: "cargo", kind: "unique", entry: cargoCutter });
  });

  it("never resolves an entry across the storage-area boundary", () => {
    const state = cargoState();
    expect(
      resolveCargoSelection(state, { area: "cargo", kind: "stack", id: carriedShale.id }),
    ).toBe(undefined);
    expect(
      resolveCargoSelection(state, { area: "carried", kind: "unique", id: cargoCutter.id }),
    ).toBe(undefined);
  });

  it("resolves a transferred-away entry to nothing so the selection can reconcile", () => {
    const state = cargoState();
    state.cargoHold.stacks = [];
    expect(resolveCargoSelection(state, { area: "cargo", kind: "stack", id: cargoShale.id })).toBe(
      undefined,
    );
    expect(resolveCargoSelection(state, undefined)).toBe(undefined);
  });

  it("keeps tracking a surviving stack whose authoritative quantity changed", () => {
    const state = cargoState();
    state.cargoHold.stacks = [{ ...cargoShale, quantity: 6 }];
    expect(
      resolveCargoSelection(state, { area: "cargo", kind: "stack", id: cargoShale.id }),
    ).toMatchObject({ area: "cargo", entry: { id: cargoShale.id, quantity: 6 } });
  });
});

describe("Cargo Hold selection toggling", () => {
  // The toggle rule itself is the shared selectable-details contract; Cargo
  // owns only what counts as the same selection.
  const toggle = (current: CargoSelection | undefined, next: CargoSelection) =>
    toggleSelection(current, next, sameCargoSelection);

  it("selecting the currently selected tile toggles its action area off", () => {
    const current = { area: "cargo" as const, kind: "stack" as const, id: cargoShale.id };
    expect(toggle(current, { ...current })).toBe(undefined);
  });

  it("selecting another tile moves the contextual action state to it", () => {
    const current = { area: "cargo" as const, kind: "stack" as const, id: cargoShale.id };
    expect(toggle(current, { area: "cargo", kind: "unique", id: cargoCutter.id })).toEqual({
      area: "cargo",
      kind: "unique",
      id: cargoCutter.id,
    });
    expect(toggle(undefined, current)).toEqual(current);
  });

  it("does not toggle off across storage areas or namespaces that share an ID", () => {
    expect(
      toggle(
        { area: "carried", kind: "stack", id: "same-id" },
        { area: "cargo", kind: "stack", id: "same-id" },
      ),
    ).toEqual({ area: "cargo", kind: "stack", id: "same-id" });
    expect(
      toggle(
        { area: "cargo", kind: "stack", id: "same-id" },
        { area: "cargo", kind: "unique", id: "same-id" },
      ),
    ).toEqual({ area: "cargo", kind: "unique", id: "same-id" });
  });
});
