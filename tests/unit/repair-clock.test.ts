// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepairWorkPanel } from "@/features/welding/RepairWorkPanel";
import { CrewStopPanel } from "@/features/local-places/CrewStopPanel";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { GAME_TICK_MS, REPAIR_TARGET_IDS } from "@/game/config/foundations";

const mock = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  skew: 0,
  serverNowMs: () => Date.now() - mock.skew,
}));
vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({ state: mock.state, serverNowMs: mock.serverNowMs, foregroundBusy: false }),
}));
vi.mock("@/features/missions/mission-pins", () => ({
  derivePinnedGuidanceTargets: () => ({ repairTargetIds: new Set() }),
}));
vi.mock("@/features/travel/crew-hauler-rides", () => ({ availableCrewHaulerRides: () => [] }));
vi.mock("@/server/actions", () => ({
  claimCleanPassAction: vi.fn(),
  contributeRepairMaterialsAction: vi.fn(),
  startWeldingAction: vi.fn(),
  stopWeldingAction: vi.fn(),
}));
vi.mock("@/features/diagnostics/client", () => ({ reportClientDiagnostic: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = Date.parse("2026-01-01T00:00:00.000Z");
const duration = getEffectiveGameBalance().welding.attemptDurationTicks * GAME_TICK_MS;
let host: HTMLDivElement;
let root: Root;
function setState(targetId: string, start: number, active = true) {
  const target = getRepairTargetBalance(targetId, getEffectiveGameBalance());
  const repair = {
    repairAvailable: true,
    complete: false,
    materialComplete: true,
    materials: [],
    weldingProgress: 1,
    weldingIncrements: target.repairIncrements,
  };
  mock.state = {
    characterId: "test",
    repairs: { [targetId]: repair },
    activeAction: active
      ? {
          actionId: target.actionId,
          progressStartedAt: new Date(start).toISOString(),
          nextAttemptAt: new Date(start + duration).toISOString(),
        }
      : undefined,
    serverNow: new Date(start + 1_000).toISOString(),
    missions: [],
    unpinnedMissionIds: [],
    location: { currentLocationId: "test" },
    welding: { level: 1, xpIntoLevel: 0, xpToNextLevel: 100 },
    inventory: { slotsUsed: 0, slotsAvailable: 8, massGrams: 0, capacityGrams: 50000 },
    carriedByItemId: {},
  };
}
async function render(targetId: string) {
  const component =
    targetId === REPAIR_TARGET_IDS.crewStop
      ? React.createElement(CrewStopPanel)
      : React.createElement(RepairWorkPanel, {
          targetId,
          title: "Test",
          materialsPrompt: "",
          weldingPrompt: "",
        });
  await act(async () => root.render(component));
}
function currentWeld() {
  return host.querySelector('[aria-label^="Current weld:"]');
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.skew = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
describe("repair display clock (#470)", () => {
  for (const targetId of [REPAIR_TARGET_IDS.deepJagCaveIn, REPAIR_TARGET_IDS.crewStop]) {
    it.each([-5_000, 0, 5_000])(`${targetId} rehydrates and ticks with skew %i`, async (skew) => {
      mock.skew = skew;
      vi.setSystemTime(base + 1_000 + skew);
      setState(targetId, base);
      await render(targetId);
      expect(currentWeld()?.getAttribute("aria-label")).toBe(
        `Current weld: ${((duration - 1_000) / 1_000).toFixed(1)}s`,
      );
      expect(Number(currentWeld()?.getAttribute("aria-valuenow"))).toBeCloseTo(100_000 / duration);
      await act(async () => vi.advanceTimersByTime(500));
      expect(Number(currentWeld()?.getAttribute("aria-valuenow"))).toBeCloseTo(150_000 / duration);
    });
    it(`${targetId} refreshes at section changes and cleans up on stop`, async () => {
      vi.setSystemTime(base + 1_000);
      setState(targetId, base);
      await render(targetId);
      vi.setSystemTime(base + duration + 1_000);
      setState(targetId, base + duration);
      await render(targetId);
      expect(Number(currentWeld()?.getAttribute("aria-valuenow"))).toBeCloseTo(100_000 / duration);
      setState(targetId, base + duration, false);
      await render(targetId);
      expect(currentWeld()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});
