import { describe, expect, it } from "vitest";
import {
  SCAVENGE_OUTCOMES,
  SCAVENGE_REEL_ORDER,
  SCAVENGE_TOTAL_WEIGHT_BPS,
  scavengeAwardBranches,
} from "@/game/content/scavenge";
import {
  resolveScavengeOutcome,
  scavengeOpportunityStartTick,
  scavengeWindowAt,
} from "@/game/domain/scavenge";
import {
  createScavengeReelAnimationPlan,
  SCAVENGE_REEL_CYCLE_HEIGHT_PX,
  SCAVENGE_REEL_MAX_COMPLETE_CYCLES,
  SCAVENGE_REEL_MIN_COMPLETE_CYCLES,
  SCAVENGE_REEL_DURATION_VARIATION_MS,
  SCAVENGE_REEL_EXTRA_CYCLE_DURATION_MS,
  SCAVENGE_REEL_MIN_DURATION_MS,
  SCAVENGE_REEL_TARGET_CYCLE_OFFSET,
  SCAVENGE_REEL_VIEWPORT_HEIGHT_PX,
  scavengeReelRenderedStripHeight,
  scavengeReelPanels,
} from "@/features/travel/scavenge-reel";

const EXPECTED_WEIGHTS = {
  zilch: 750,
  nothing_burger: 750,
  nada: 750,
  whammy: 750,
  ferrite_shale_1: 2_000,
  ferrite_shale_2: 1_250,
  ferrite_shale_3: 750,
  power_cell_1: 750,
  power_cell_2: 500,
  refined_ferrite_1: 1_000,
  refined_ferrite_2: 750,
} as const;

describe("issue #88 Scavenge table", () => {
  it("keeps the approved 10,000-basis-point table and 70/30 useful split", () => {
    const weights = Object.fromEntries(
      SCAVENGE_OUTCOMES.map((outcome) => [outcome.id, outcome.weightBps]),
    );
    expect(weights).toEqual(EXPECTED_WEIGHTS);
    expect(SCAVENGE_OUTCOMES.reduce((total, outcome) => total + outcome.weightBps, 0)).toBe(
      SCAVENGE_TOTAL_WEIGHT_BPS,
    );
    expect(
      SCAVENGE_OUTCOMES.filter((outcome) => outcome.itemId).reduce(
        (total, outcome) => total + outcome.weightBps,
        0,
      ),
    ).toBe(7_000);
    expect(scavengeAwardBranches().map((outcome) => [outcome.itemId, outcome.quantity])).toEqual([
      ["ferrite_shale", 3],
      ["power_cell", 2],
      ["refined_ferrite", 2],
    ]);
  });

  it("maps every deterministic basis-point boundary to one authoritative outcome", () => {
    let boundary = 0;
    for (const outcome of SCAVENGE_OUTCOMES) {
      expect(resolveScavengeOutcome(boundary)).toEqual(outcome);
      boundary += outcome.weightBps;
      expect(resolveScavengeOutcome(boundary - 1)).toEqual(outcome);
    }
    expect(boundary).toBe(SCAVENGE_TOTAL_WEIGHT_BPS);
  });
});

describe("issue #88 weighted vertical reel", () => {
  it("derives unique readable panels with probability-proportional heights", () => {
    const cycleHeight = 1_000;
    const panels = scavengeReelPanels(cycleHeight);
    const outcomeById = new Map(SCAVENGE_OUTCOMES.map((outcome) => [outcome.id, outcome]));

    expect(panels).toHaveLength(SCAVENGE_REEL_ORDER.length);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(panels.length);
    expect(panels.reduce((total, panel) => total + panel.heightPx, 0)).toBeCloseTo(cycleHeight, 10);
    for (const panel of panels) {
      const outcome = outcomeById.get(panel.id);
      expect(outcome).toBeDefined();
      expect(panel.label).toBe(outcome?.label);
      expect(panel.quantity).toBe(outcome?.quantity);
      expect(panel.heightPx / cycleHeight).toBeCloseTo(
        (outcome?.weightBps ?? 0) / SCAVENGE_TOTAL_WEIGHT_BPS,
        10,
      );
    }
  });

  it("lands the authoritative result under the pointer inside the middle 90%", () => {
    for (const outcome of SCAVENGE_OUTCOMES) {
      const plan = createScavengeReelAnimationPlan({
        outcomeId: outcome.id,
        initialRandom: 0.5,
        landingRandom: 1,
        cycleRandom: 0.67,
        durationRandom: 0.5,
      });
      const panel = scavengeReelPanels().find((candidate) => candidate.id === outcome.id);
      expect(panel).toBeDefined();
      expect(plan.completeCycles).toBe(4);
      expect(plan.landingFraction).toBeLessThanOrEqual(0.95);
      expect(plan.landingFraction).toBeGreaterThanOrEqual(0.05);
      expect(
        (plan.completeCycles + SCAVENGE_REEL_TARGET_CYCLE_OFFSET) * SCAVENGE_REEL_CYCLE_HEIGHT_PX +
          (panel?.topPx ?? 0) +
          (panel?.heightPx ?? 0) * plan.landingFraction -
          plan.destinationOffsetPx,
      ).toBeCloseTo(SCAVENGE_REEL_VIEWPORT_HEIGHT_PX / 2, 10);
    }
  });

  it("keeps the panel under the pointer when the starting offset is randomized", () => {
    const panels = scavengeReelPanels();
    for (const outcome of SCAVENGE_OUTCOMES) {
      for (const initialRandom of [0, 0.25, 0.5, 0.999_999]) {
        const plan = createScavengeReelAnimationPlan({
          outcomeId: outcome.id,
          initialRandom,
          landingRandom: 0.5,
          cycleRandom: 0.67,
          durationRandom: 0.5,
        });
        const pointerPositionPx = plan.destinationOffsetPx + SCAVENGE_REEL_VIEWPORT_HEIGHT_PX / 2;
        const targetCycleTopPx =
          (plan.completeCycles + SCAVENGE_REEL_TARGET_CYCLE_OFFSET) * SCAVENGE_REEL_CYCLE_HEIGHT_PX;
        const landedPanel = panels.find((panel) => {
          const panelTopPx = targetCycleTopPx + panel.topPx;
          return pointerPositionPx >= panelTopPx && pointerPositionPx < panelTopPx + panel.heightPx;
        });
        expect(landedPanel?.id).toBe(outcome.id);
      }
    }
  });

  it("keeps every valid destination viewport inside the rendered strip", () => {
    const renderedStripHeightPx = scavengeReelRenderedStripHeight();
    for (const outcome of SCAVENGE_OUTCOMES) {
      for (const initialRandom of [0, 0.5, 0.999_999]) {
        for (const landingRandom of [0, 0.5, 1]) {
          for (const cycleRandom of [0, 0.34, 0.67, 0.999_999]) {
            const plan = createScavengeReelAnimationPlan({
              outcomeId: outcome.id,
              initialRandom,
              landingRandom,
              cycleRandom,
              durationRandom: 0.5,
            });
            expect(plan.destinationOffsetPx).toBeGreaterThanOrEqual(0);
            expect(plan.destinationOffsetPx + SCAVENGE_REEL_VIEWPORT_HEIGHT_PX).toBeLessThanOrEqual(
              renderedStripHeightPx,
            );
            expect(plan.initialOffsetPx + SCAVENGE_REEL_VIEWPORT_HEIGHT_PX).toBeLessThanOrEqual(
              renderedStripHeightPx,
            );
          }
        }
      }
    }
  });

  it("varies the initial offset, cycles, and duration within bounded limits", () => {
    const plans = [0, 0.34, 0.67, 0.999_999].map((cycleRandom, index) =>
      createScavengeReelAnimationPlan({
        outcomeId: "ferrite_shale_1",
        initialRandom: index / 3,
        landingRandom: 0.5,
        cycleRandom,
        durationRandom: index / 3,
      }),
    );
    expect(plans.map((plan) => plan.completeCycles)).toEqual([
      SCAVENGE_REEL_MIN_COMPLETE_CYCLES,
      SCAVENGE_REEL_MIN_COMPLETE_CYCLES + 1,
      SCAVENGE_REEL_MAX_COMPLETE_CYCLES,
      SCAVENGE_REEL_MAX_COMPLETE_CYCLES,
    ]);
    expect(plans.map((plan) => plan.initialOffsetPx)).toEqual([0, 440, 880, 1_320]);
    expect(Math.max(...plans.map((plan) => plan.initialOffsetPx))).toBeGreaterThan(
      SCAVENGE_REEL_CYCLE_HEIGHT_PX * 0.75,
    );
    expect(plans[0]?.durationMs).toBe(SCAVENGE_REEL_MIN_DURATION_MS);
    expect(plans.at(-1)?.durationMs).toBe(
      SCAVENGE_REEL_MIN_DURATION_MS +
        2 * SCAVENGE_REEL_EXTRA_CYCLE_DURATION_MS +
        SCAVENGE_REEL_DURATION_VARIATION_MS,
    );
    for (const plan of plans) {
      const cycleAdjustedMinimum =
        SCAVENGE_REEL_MIN_DURATION_MS +
        (plan.completeCycles - SCAVENGE_REEL_MIN_COMPLETE_CYCLES) *
          SCAVENGE_REEL_EXTRA_CYCLE_DURATION_MS;
      expect(plan.durationMs).toBeGreaterThanOrEqual(cycleAdjustedMinimum);
      expect(plan.durationMs).toBeLessThanOrEqual(
        cycleAdjustedMinimum + SCAVENGE_REEL_DURATION_VARIATION_MS,
      );
      expect(plan.initialOffsetPx).toBeGreaterThanOrEqual(0);
      expect(plan.initialOffsetPx).toBeLessThanOrEqual(SCAVENGE_REEL_CYCLE_HEIGHT_PX);
    }
  });
});

describe("issue #88 Scavenge timing", () => {
  it("keeps randomized opportunity starts within the approved three-to-thirty tick range", () => {
    const starts = Array.from({ length: 28 }, (_, basisPoints) =>
      scavengeOpportunityStartTick(basisPoints),
    );
    expect(new Set(starts).size).toBe(28);
    expect(Math.min(...starts)).toBe(3);
    expect(Math.max(...starts)).toBe(30);
  });

  it("keeps the client-visible claim window at five ticks", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const available = scavengeWindowAt({
      travelStartedAt: startedAt,
      opportunityStartTick: 3,
      now: new Date(startedAt.getTime() + 3 * 600),
      claimed: false,
    });
    expect(available.lifecycle).toBe("available");
    expect(available.opensAt).toEqual(new Date(startedAt.getTime() + 1_800));
    expect(available.expiresAt).toEqual(new Date(startedAt.getTime() + 4_800));
    expect(
      scavengeWindowAt({
        travelStartedAt: startedAt,
        opportunityStartTick: 3,
        now: new Date(startedAt.getTime() + 1_799),
        claimed: false,
      }).lifecycle,
    ).toBe("waiting");
    expect(
      scavengeWindowAt({
        travelStartedAt: startedAt,
        opportunityStartTick: 3,
        now: available.expiresAt,
        claimed: true,
      }).lifecycle,
    ).toBe("claimed");
    expect(
      scavengeWindowAt({
        travelStartedAt: startedAt,
        opportunityStartTick: 3,
        now: available.expiresAt,
        claimed: false,
      }).lifecycle,
    ).toBe("missed");
  });
});
