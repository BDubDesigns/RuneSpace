// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PracticeWeldingPanel } from "@/features/practice/PracticeWeldingPanel";
import { WorkOrderBenchPanel } from "@/features/practice/WorkOrderBenchPanel";
import { ResearchFieldAction } from "@/features/research/ResearchFieldAction";
import { ACTION_IDS } from "@/game/config/foundations";

const play = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  skew: 0,
  serverNowMs: () => Date.now() - play.skew,
}));
vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({ ...play, foregroundBusy: false }),
}));
vi.mock("@/features/missions/mission-pins", () => ({
  derivePinnedGuidanceTargets: () => ({ actionIds: new Set() }),
}));
vi.mock("@/features/welding/CleanPassControl", () => ({ CleanPassControl: () => null }));
vi.mock("@/features/practice/PracticeRunPanel", () => ({ PracticeRunPanel: () => null }));
vi.mock("@/features/shared/BoundedRunControl", () => ({
  BoundedRunProgress: () => null,
  BoundedRunSelector: () => null,
}));
vi.mock("@/features/shared/AutoDiscardSlagToggle", () => ({ AutoDiscardSlagToggle: () => null }));
vi.mock("@/features/shared/activity-context", () => ({
  ActivityContextRow: () => null,
  SkillProgressRow: () => null,
}));
vi.mock("@/features/research/use-research-command", () => ({ useResearchCommand: () => ({}) }));
vi.mock("@/game/domain/research-jobs", () => ({
  assignmentFactsOf: () => ({}),
  availableFieldAction: () => undefined,
  researchFieldActionTicks: () => 8,
  surfaceSampleFeedback: () => "",
}));
vi.mock("@/server/actions", () => ({}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = Date.parse("2026-01-01T00:00:00Z");
let host: HTMLDivElement;
let root: Root;
type Surface = "practice" | "work-order" | "research";
function state(surface: Surface, start: number, active = true) {
  play.state = {
    serverNow: new Date(start + 1000).toISOString(),
    characterId: "test",
    activeAction: active
      ? {
          actionId:
            surface === "research" ? ACTION_IDS.researchSurfaceSample : ACTION_IDS.practiceWelding,
          progressStartedAt: new Date(start).toISOString(),
          nextAttemptAt: new Date(start + 4000).toISOString(),
        }
      : undefined,
    practice: {
      unlocked: true,
      active,
      scrapPerWeld: 2,
      scrapAvailable: 2,
      affordableWelds: 1,
      sectionsPerWeld: 4,
      sectionsCompleted: 0,
      cycleActive: false,
      run: {},
    },
    welding: { level: 1, xpIntoLevel: 0 },
    location: { currentLocationId: "test" },
    research: { assignment: { assignmentId: "test", progress: { current: 0, target: 3 } } },
  };
}
async function render(surface: Surface, active = true) {
  const el =
    surface === "practice"
      ? React.createElement(PracticeWeldingPanel)
      : surface === "research"
        ? React.createElement(ResearchFieldAction)
        : React.createElement(WorkOrderBenchPanel, {
            active: {
              active,
              sectionsCompleted: 0,
              sections: 8,
              title: "Test",
              clientName: "Test",
              workOrderId: "test",
            } as never,
          });
  await act(async () => root.render(el));
}
function meter(surface: Surface) {
  return host.querySelector(
    `[aria-label^="${surface === "research" ? "Working" : "Current section"}:"]`,
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  play.skew = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
describe("action progress server clock", () => {
  for (const surface of ["practice", "work-order", "research"] as const) {
    it.each([-5000, 0, 5000])(`${surface} uses server time with skew %i`, async (skew) => {
      play.skew = skew;
      vi.setSystemTime(base + 1000 + skew);
      state(surface, base);
      await render(surface);
      expect(meter(surface)?.getAttribute("aria-label")).toContain("3.0s");
      expect(Number(meter(surface)?.getAttribute("aria-valuenow"))).toBeCloseTo(25);
      await act(async () => vi.advanceTimersByTime(500));
      expect(meter(surface)?.getAttribute("aria-label")).toContain("2.5s");
      expect(Number(meter(surface)?.getAttribute("aria-valuenow"))).toBeCloseTo(37.5);
    });
    it.each([-5000, 0, 5000])(`${surface} fill uses server time with skew %i`, async (skew) => {
      play.skew = skew;
      vi.setSystemTime(base + 1000 + skew);
      state(surface, base);
      await render(surface);
      expect(Number(meter(surface)?.getAttribute("aria-valuenow"))).toBeCloseTo(25);
    });
    it(`${surface} starts immediately and reaches its server deadline`, async () => {
      play.skew = 5_000;
      vi.setSystemTime(base + play.skew);
      state(surface, base, false);
      await render(surface, false);
      expect(meter(surface)).toBeNull();
      state(surface, base);
      await render(surface);
      expect(meter(surface)?.getAttribute("aria-label")).toContain("4.0s");
      expect(Number(meter(surface)?.getAttribute("aria-valuenow"))).toBe(0);
      await act(async () => vi.advanceTimersByTime(4_000));
      expect(Number(meter(surface)?.getAttribute("aria-valuenow"))).toBe(100);
      expect(meter(surface)?.getAttribute("aria-label")).toContain(
        surface === "research" ? "Resolving" : "0.0s",
      );
      state(surface, base, false);
      await render(surface, false);
      expect(meter(surface)).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
    it(`${surface} updates on projection and clears its interval`, async () => {
      vi.setSystemTime(base + 1000);
      state(surface, base);
      await render(surface);
      vi.setSystemTime(base + 5000);
      state(surface, base + 4000);
      await render(surface);
      expect(meter(surface)?.getAttribute("aria-label")).toContain("3.0s");
      play.skew = 500;
      play.state.serverNow = new Date(base + 4500).toISOString();
      await render(surface);
      expect(meter(surface)?.getAttribute("aria-label")).toContain("3.5s");
      state(surface, base + 4000, false);
      await render(surface, false);
      expect(meter(surface)).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});
