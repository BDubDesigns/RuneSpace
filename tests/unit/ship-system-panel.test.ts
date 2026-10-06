import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { getItemPresentation } from "@/game/content/item-presentation";
import { REPAIR_TARGETS } from "@/game/content/repair-targets";
import { CargoHoldPanel } from "@/features/cargo/CargoHoldPanel";
import { deriveShipSystemState, ShipSystemPanel } from "@/features/ship/ShipSystemPanel";
import type { PlayGameplayState, RepairProjection } from "@/server/play";

const play = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({
    state: play.state,
    foregroundBusy: false,
    enqueueForeground: () => undefined,
    releaseCommand: () => undefined,
    acceptState: () => undefined,
  }),
}));

// The panels import server actions as values; rendering never calls them, and
// the real module would validate a database environment this test has no use for.
vi.mock("@/server/actions", () => ({
  contributeRepairMaterialsAction: vi.fn(),
  startWeldingAction: vi.fn(),
  stopWeldingAction: vi.fn(),
  depositCargoStackAction: vi.fn(),
  depositCargoUniqueItemAction: vi.fn(),
  withdrawCargoStackAction: vi.fn(),
  withdrawCargoUniqueItemAction: vi.fn(),
}));

/**
 * The shared ship-system presentation (#322): every major system on the crashed
 * ship is visible from the start, and whether it can be repaired is decided by
 * the repair target's own authorization and completion — never by the panel
 * knowing a Mission. Server-side refusal of repair commands before authorization
 * is proven against PostgreSQL (`tests/integration/wheel-be-right-back.test.ts`);
 * the journey in a browser is `tests/e2e/cargo-hold.spec.ts` and
 * `tests/e2e/wheel-be-right-back.spec.ts`.
 */

const balance = getEffectiveGameBalance();

function repairOf(targetId: string, phase: "offline" | "repair" | "complete"): RepairProjection {
  const recipe = getRepairTargetBalance(targetId, balance);
  const names = (itemId: string) => getItemPresentation(itemId)?.displayName ?? itemId;
  return {
    targetId,
    materials: recipe.materials.map((material) => ({
      itemId: material.itemId,
      name: names(material.itemId),
      required: material.quantity,
      contributed: phase === "complete" ? material.quantity : 0,
      remaining: phase === "complete" ? 0 : material.quantity,
      availableContribution: 0,
    })),
    weldingProgress: phase === "complete" ? recipe.repairIncrements : 0,
    weldingIncrements: recipe.repairIncrements,
    materialComplete: phase === "complete",
    complete: phase === "complete",
    repairAvailable: phase !== "offline",
    canContribute: false,
  };
}

function setState(
  cargo: "offline" | "repair" | "complete",
  gear: "offline" | "repair" | "complete",
) {
  const cargoRepair = repairOf(REPAIR_TARGET_IDS.cargoHold, cargo);
  play.state = {
    characterId: "character",
    missions: [],
    activeAction: undefined,
    repairs: {
      [REPAIR_TARGET_IDS.cargoHold]: cargoRepair,
      [REPAIR_TARGET_IDS.landingGear]: repairOf(REPAIR_TARGET_IDS.landingGear, gear),
    },
    cargoHold: {
      repair: cargoRepair,
      stacks: [],
      uniqueItems: [],
      slotsUsed: 3,
      capacitySlots: balance.cargoHold.capacitySlots,
    },
    welding: { level: 1, xpIntoLevel: 0, xpToNextLevel: 100 },
    inventory: { slotsUsed: 0, slotsAvailable: 8, massGrams: 0, capacityGrams: 50_000 },
    carriedByItemId: {},
  } as unknown as PlayGameplayState;
}

const landingGear = () =>
  renderToStaticMarkup(
    React.createElement(ShipSystemPanel, {
      targetId: REPAIR_TARGET_IDS.landingGear,
      materialsPrompt: "Bring the parts.",
      weldingPrompt: "Weld them.",
    }),
  );
const cargoHold = () => renderToStaticMarkup(React.createElement(CargoHoldPanel));

describe("a ship system's state is only its repair target's projection", () => {
  it("is offline until authorized, repairing once authorized, complete once finished", () => {
    expect(deriveShipSystemState(undefined)).toBe("offline");
    expect(deriveShipSystemState({ repairAvailable: false, complete: false })).toBe("offline");
    expect(deriveShipSystemState({ repairAvailable: true, complete: false })).toBe("repair");
    expect(deriveShipSystemState({ repairAvailable: true, complete: true })).toBe("complete");
    // A finished repair stays finished whatever authorizes it.
    expect(deriveShipSystemState({ repairAvailable: false, complete: true })).toBe("complete");
  });

  it("is driven by authorization and completion alone: no Mission is named in the shell", () => {
    const source = readFileSync("features/ship/ShipSystemPanel.tsx", "utf8");
    expect(source).not.toMatch(/MISSION_IDS|missionId|wheel_be|holdItTogether/i);
    expect(source).not.toMatch(/REPAIR_TARGET_IDS/);
  });
});

describe("before a Mission authorizes the repair", () => {
  it("shows the Landing Gear as a damaged system with no recipe and no controls", () => {
    setState("offline", "offline");
    const markup = landingGear();
    expect(markup).toContain('data-ship-system="landing_gear"');
    expect(markup).toContain('data-ship-system-state="offline"');
    expect(markup).toContain(">Ship<");
    expect(markup).toContain(">Landing Gear<");
    expect(markup).toContain("The landing gear is damaged and cannot be repaired yet.");
    for (const hidden of [
      "<button",
      "data-repair-work-panel",
      "data-repair-contribute",
      "Wheel Assembl",
      "Mounting Bracket",
      "Wire Spool",
      "Welding",
      "Install",
    ]) {
      expect(markup, hidden).not.toContain(hidden);
    }
  });

  it("keeps the Cargo Hold visible, damaged and noninteractive, as before", () => {
    setState("offline", "offline");
    const markup = cargoHold();
    expect(markup).toContain("data-cargo-hold");
    expect(markup).toContain('data-ship-system-state="offline"');
    expect(markup).toContain(">Ship<");
    expect(markup).toContain(">Cargo Hold<");
    expect(markup).toContain("The Cargo Hold is buckled from the crash and still inaccessible.");
    for (const hidden of ["<button", "Refined Ferrite", "Slag", "Welding", "CARGO HOLD"]) {
      expect(markup, hidden).not.toContain(hidden);
    }
  });

  it("never states a recipe or a progression hint in any system's offline copy", () => {
    const itemNames = [
      "Wheel Assembl",
      "Bracket",
      "Spool",
      "Ferrite",
      "Slag",
      "Galvan",
      "Mission",
      "Wade",
      "Propulsion",
    ];
    for (const target of REPAIR_TARGETS.filter((entry) => entry.offlineStatus)) {
      for (const name of itemNames) {
        expect(target.offlineStatus, `${target.id}: ${name}`).not.toContain(name);
      }
    }
  });
});

describe("once the repair is authorized", () => {
  it("expands the same panel into the standard repair presentation", () => {
    setState("repair", "repair");
    const markup = landingGear();
    expect(markup).toContain('data-ship-system="landing_gear"');
    expect(markup).toContain('data-ship-system-state="repair"');
    expect(markup).toContain('data-repair-work-panel="landing_gear"');
    expect(markup).toContain("data-repair-contribute");
    expect(markup).toContain("Wheel Assembly");
    expect(markup).not.toContain("The landing gear is damaged and cannot be repaired yet.");
  });

  it("moves the Cargo Hold's repair onto the same presentation, with no bespoke repair cards", () => {
    setState("repair", "offline");
    const markup = cargoHold();
    expect(markup).toContain("data-cargo-hold");
    expect(markup).toContain('data-ship-system-state="repair"');
    expect(markup).toContain('data-repair-work-panel="cargo_hold"');
    expect(markup).toContain("data-repair-contribute");
    expect(markup).not.toContain("data-cargo-repair-material");
    expect(markup).not.toContain("CONTRIBUTE MATERIALS");
  });

  it("changes only the Cargo Hold's own state when only its job is authorized", () => {
    setState("repair", "offline");
    expect(cargoHold()).toContain('data-ship-system-state="repair"');
    expect(landingGear()).toContain('data-ship-system-state="offline"');
  });
});

describe("after completion", () => {
  it("keeps the Landing Gear visible with its authored status and no repair controls", () => {
    setState("complete", "complete");
    const markup = landingGear();
    expect(markup).toContain('data-ship-system-state="complete"');
    expect(markup).toContain("Landing gear restored. Propulsion offline.");
    expect(markup).not.toContain("data-repair-work-panel");
    expect(markup).not.toContain("<button");
  });

  it("keeps the Cargo Hold visible and operational with its storage control", () => {
    setState("complete", "offline");
    const markup = cargoHold();
    expect(markup).toContain('data-ship-system-state="complete"');
    expect(markup).toContain("Cargo Hold operational.");
    expect(markup).toContain('data-cargo-hold-status="operational"');
    expect(markup).toContain("3 / 32 SLOTS OCCUPIED");
    expect(markup).toContain("OPEN CARGO HOLD");
    expect(markup).not.toContain("data-repair-work-panel");
  });
});
