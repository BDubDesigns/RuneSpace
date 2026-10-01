import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ITEM_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import type { PlayGameplayState } from "@/server/play";
import { CARGO_HOLD_STORAGE_LABELS, projectCargoHoldStorage } from "@/features/cargo/cargo-storage";
import {
  resolveStorageSelection,
  sameStorageSelection,
  type StorageProjection,
  type StorageSelection,
} from "@/features/storage/storage-selection";
import {
  StorageTransferSurface,
  type StorageTransferAdapter,
} from "@/features/storage/StorageTransferSurface";
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
    progression: { characterLevel: 1, skills: [] },
    skillTotalXp: {},
    missions: [],
    location: { currentLocationId: "crash_site" },
    repairs: {},
    workOrders: {
      revealed: false,
      requiredWeldingLevel: 5,
      meetsWeldingLevel: false,
      unlocked: false,
      missionAvailable: false,
      postings: [],
      refresh: {
        unlocked: false,
        requiredRefiningLevel: 5,
        meetsRefiningLevel: false,
        availableToday: false,
        firstUnlock: true,
        resetDate: "2026-01-01",
      },
    },
    practice: {
      unlocked: false,
      active: false,
      sectionsCompleted: 0,
      sectionsPerWeld: 10,
      cycleActive: false,
      scrapAvailable: 0,
      scrapPerWeld: 2,
      affordableWelds: 0,
      finishCurrentWeld: false,
      run: {
        selection: 1,
        welds: 0,
        scrapConsumed: 0,
        slagKept: 0,
        slagDiscarded: 0,
        xpGained: 0,
        recentWelds: [],
      },
    },
    credits: 0,
    mining: { totalXp: 0, level: 1, xpIntoLevel: 0 },
    refining: { totalXp: 0, level: 1, xpIntoLevel: 0 },
    welding: { totalXp: 0, level: 1, xpIntoLevel: 0 },
    fabrication: { totalXp: 0, level: 1, xpIntoLevel: 0 },
    fabricationStation: {
      unlocked: false,
      recipes: [],
      manualOverrideEnabled: false,
      run: {
        selection: 1,
        batches: 0,
        successes: 0,
        busts: 0,
        inputsConsumed: {},
        outputsGained: {},
        xpGained: 0,
        recentWorkpieces: [],
      },
    },
    tinkering: {
      unlocked: false,
      active: false,
      autoDiscardScrap: false,
      finishCurrent: false,
      targets: [],
      run: {
        selection: 1,
        batches: 0,
        itemsConsumed: {},
        scrapKept: 0,
        scrapDiscarded: 0,
        xpGained: 0,
        recentBatches: [],
      },
    },
    refiningRecipes: [],
    locationStates: {},
    carriedByItemId: {},
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
      itemsGained: {},
      xpGained: 0,
      recentAttempts: [],
    },
    autoDiscardSlag: false,
    refiningRun: {
      selection: 1,
      attempts: 0,
      successes: 0,
      failures: 0,
      outputsGained: {},
      outputsDiscarded: {},
      inputsConsumed: {},
      xpGained: 0,
      recentAttempts: [],
    },
    cargoHold: {
      repair: {
        targetId: REPAIR_TARGET_IDS.cargoHold,
        materials: [
          {
            itemId: ITEM_IDS.refinedFerrite,
            name: "Refined Ferrite",
            required: 15,
            contributed: 15,
            remaining: 0,
            availableContribution: 0,
          },
          {
            itemId: ITEM_IDS.slag,
            name: "Slag",
            required: 6,
            contributed: 6,
            remaining: 0,
            availableContribution: 0,
          },
        ],
        weldingProgress: 12,
        weldingIncrements: 12,
        materialComplete: true,
        complete: true,
        repairAvailable: true,
        canContribute: false,
      },
      stacks: [cargoShale],
      uniqueItems: [cargoCutter],
      slotsUsed: 2,
      capacitySlots: 32,
    },
    recentResult: { successes: 0, failures: 0, awardedXp: 0 },
    refiningRecentResult: { successes: 0, failures: 0, awardedXp: 0 },
    scavengeReveals: [],
    merchantDailyPurchases: {},
  };
}

const carried = (state: PlayGameplayState) => projectCargoHoldStorage(state).carried;

describe("Cargo Hold storage projection", () => {
  it("projects the authoritative Play state into the generic carried/destination shape", () => {
    const projection = projectCargoHoldStorage(cargoState());
    expect(projection.carried).toEqual({
      stacks: [carriedShale],
      uniqueItems: [carriedCutter],
      slotsUsed: 2,
      // Carried capacity is the inventory's used plus available slots.
      capacitySlots: 8,
    });
    expect(projection.destination).toEqual({
      stacks: [cargoShale],
      uniqueItems: [cargoCutter],
      slotsUsed: 2,
      capacitySlots: 32,
    });
  });

  it("re-projects every render so no stale entry details are cached", () => {
    const state = cargoState();
    state.cargoHold.stacks = [{ ...cargoShale, quantity: 1 }];
    state.cargoHold.slotsUsed = 2;
    expect(projectCargoHoldStorage(state).destination.stacks[0]).toMatchObject({ quantity: 1 });
    expect(carried(state).stacks).toBe(state.inventory.stacks);
  });
});

describe("storage selection resolution (Cargo Hold host)", () => {
  const resolve = (state: PlayGameplayState, selection: StorageSelection | undefined) =>
    resolveStorageSelection(projectCargoHoldStorage(state), selection);

  it("resolves stack and unique entries from the area they belong to", () => {
    const state = cargoState();
    expect(resolve(state, { area: "carried", kind: "stack", id: carriedShale.id })).toEqual({
      area: "carried",
      kind: "stack",
      entry: carriedShale,
    });
    expect(resolve(state, { area: "stored", kind: "stack", id: cargoShale.id })).toEqual({
      area: "stored",
      kind: "stack",
      entry: cargoShale,
    });
    expect(resolve(state, { area: "carried", kind: "unique", id: carriedCutter.id })).toEqual({
      area: "carried",
      kind: "unique",
      entry: carriedCutter,
    });
    expect(resolve(state, { area: "stored", kind: "unique", id: cargoCutter.id })).toEqual({
      area: "stored",
      kind: "unique",
      entry: cargoCutter,
    });
  });

  it("never resolves an entry across the storage-area boundary", () => {
    const state = cargoState();
    expect(resolve(state, { area: "stored", kind: "stack", id: carriedShale.id })).toBe(undefined);
    expect(resolve(state, { area: "carried", kind: "unique", id: cargoCutter.id })).toBe(undefined);
    // Nor across the stack/unique namespace inside one area.
    expect(resolve(state, { area: "stored", kind: "unique", id: cargoShale.id })).toBe(undefined);
  });

  it("resolves a transferred-away entry to nothing so the selection can reconcile", () => {
    const state = cargoState();
    state.cargoHold.stacks = [];
    expect(resolve(state, { area: "stored", kind: "stack", id: cargoShale.id })).toBe(undefined);
    expect(resolve(state, undefined)).toBe(undefined);
  });

  it("keeps tracking a surviving stack whose authoritative quantity changed", () => {
    const state = cargoState();
    state.cargoHold.stacks = [{ ...cargoShale, quantity: 6 }];
    expect(resolve(state, { area: "stored", kind: "stack", id: cargoShale.id })).toMatchObject({
      area: "stored",
      entry: { id: cargoShale.id, quantity: 6 },
    });
  });
});

describe("storage selection resolution (generic destination)", () => {
  // A destination that is not the Cargo Hold: different slots, ids that collide
  // with the carried side. Nothing about the resolver depends on the host.
  const stash: StorageProjection = {
    carried: { stacks: [carriedShale], uniqueItems: [], slotsUsed: 1, capacitySlots: 8 },
    destination: {
      stacks: [{ ...cargoShale, id: carriedShale.id, quantity: 9 }],
      uniqueItems: [],
      slotsUsed: 1,
      capacitySlots: 4,
    },
  };

  it("keeps carried and stored entries that share an ID in separate namespaces", () => {
    expect(
      resolveStorageSelection(stash, { area: "carried", kind: "stack", id: carriedShale.id }),
    ).toMatchObject({ area: "carried", entry: { quantity: 2 } });
    expect(
      resolveStorageSelection(stash, { area: "stored", kind: "stack", id: carriedShale.id }),
    ).toMatchObject({ area: "stored", entry: { quantity: 9 } });
  });
});

describe("storage selection toggling", () => {
  // The toggle rule itself is the shared selectable-details contract; storage
  // owns only what counts as the same selection.
  const toggle = (current: StorageSelection | undefined, next: StorageSelection) =>
    toggleSelection(current, next, sameStorageSelection);

  it("selecting the currently selected tile toggles its action area off", () => {
    const current = { area: "stored" as const, kind: "stack" as const, id: cargoShale.id };
    expect(toggle(current, { ...current })).toBe(undefined);
  });

  it("selecting another tile moves the contextual action state to it", () => {
    const current = { area: "stored" as const, kind: "stack" as const, id: cargoShale.id };
    expect(toggle(current, { area: "stored", kind: "unique", id: cargoCutter.id })).toEqual({
      area: "stored",
      kind: "unique",
      id: cargoCutter.id,
    });
    expect(toggle(undefined, current)).toEqual(current);
  });

  it("does not toggle off across storage areas or namespaces that share an ID", () => {
    expect(
      toggle(
        { area: "carried", kind: "stack", id: "same-id" },
        { area: "stored", kind: "stack", id: "same-id" },
      ),
    ).toEqual({ area: "stored", kind: "stack", id: "same-id" });
    expect(
      toggle(
        { area: "stored", kind: "stack", id: "same-id" },
        { area: "stored", kind: "unique", id: "same-id" },
      ),
    ).toEqual({ area: "stored", kind: "unique", id: "same-id" });
  });
});

describe("StorageTransferSurface", () => {
  const transfers: StorageTransferAdapter = {
    depositStack: vi.fn(),
    withdrawStack: vi.fn(),
    depositUniqueItem: vi.fn(),
    withdrawUniqueItem: vi.fn(),
  };
  const render = (
    state: PlayGameplayState,
    props: Partial<React.ComponentProps<typeof StorageTransferSurface>> = {},
  ) =>
    renderToStaticMarkup(
      React.createElement(StorageTransferSurface, {
        labels: CARGO_HOLD_STORAGE_LABELS,
        pending: false,
        projection: projectCargoHoldStorage(state),
        transfers,
        ...props,
      }),
    );

  it("renders both regions with the host's wording, occupancy and tiles", () => {
    const html = render(cargoState());
    expect(html).toContain('aria-label="Carried Inventory"');
    expect(html).toContain('aria-label="Cargo Hold storage"');
    expect(html).toContain('aria-label="Carried items"');
    expect(html).toContain('aria-label="Cargo Hold items"');
    expect(html).toContain('aria-label="Cargo storage mode"');
    expect(html).toContain('data-storage-area="carried"');
    expect(html).toContain('data-storage-area="stored"');
    expect(html).toContain("CARRIED");
    expect(html).toContain("CARGO");
    expect(html).toContain("2 / 8");
    expect(html).toContain("2 / 32");
    // Four occupied tiles, each a selectable toggle.
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(4);
    // Charged unique tiles keep their charge badge and description.
    expect(html).toContain("0/");
    expect(html).toContain("charges remaining");
  });

  it("offers no transfer control and no details until a tile is selected", () => {
    const html = render(cargoState());
    expect(html).not.toContain("data-storage-selection");
    expect(html).not.toMatch(/DEPOSIT|WITHDRAW/);
  });

  it("shows each region's own empty message", () => {
    const state = cargoState();
    state.inventory.stacks = [];
    state.inventory.uniqueItems = [];
    state.cargoHold.stacks = [];
    state.cargoHold.uniqueItems = [];
    const html = render(state);
    expect(html).toContain("No occupied carried items.");
    expect(html).toContain("No occupied Cargo Hold items.");
    expect(html).not.toContain("aria-pressed");
  });

  it("takes a different destination's wording and capacity without any Cargo Hold state", () => {
    const html = render(cargoState(), {
      labels: {
        title: "STASH",
        regionLabel: "Site stash storage",
        itemsLabel: "Site stash items",
        emptyMessage: "No occupied stash items.",
        switcherLabel: "Stash storage mode",
      },
      projection: {
        carried: { stacks: [], uniqueItems: [], slotsUsed: 0, capacitySlots: 8 },
        destination: { stacks: [], uniqueItems: [], slotsUsed: 0, capacitySlots: 4 },
      },
    });
    expect(html).toContain('aria-label="Site stash storage"');
    expect(html).toContain("STASH 0 / 4");
    expect(html).toContain("No occupied stash items.");
    expect(html).not.toContain("Cargo");
  });

  it("renders host-supplied region actions only where given, and none by default", () => {
    expect(render(cargoState())).not.toContain("data-bulk");
    const html = render(cargoState(), {
      renderRegionActions: ({ area, pending }) =>
        area === "carried"
          ? React.createElement("div", { "data-bulk": area, "data-pending": String(pending) })
          : null,
      pending: true,
    });
    expect(html.match(/data-bulk="carried"/g)).toHaveLength(1);
    expect(html).toContain('data-pending="true"');
    expect(html).not.toContain('data-bulk="stored"');
  });
});
