import {
  getScavengeOutcome,
  SCAVENGE_OUTCOMES,
  SCAVENGE_REEL_ORDER,
  SCAVENGE_TOTAL_WEIGHT_BPS,
  type ScavengeOutcome,
  type ScavengeOutcomeId,
} from "@/game/content/scavenge";

export const SCAVENGE_REEL_CYCLE_HEIGHT_PX = 1_320;
export const SCAVENGE_REEL_VIEWPORT_HEIGHT_PX = 304;
export const SCAVENGE_REEL_MIN_COMPLETE_CYCLES = 2;
export const SCAVENGE_REEL_MAX_COMPLETE_CYCLES = 4;
export const SCAVENGE_REEL_MIN_DURATION_MS = 3_000;
export const SCAVENGE_REEL_EXTRA_CYCLE_DURATION_MS = 1_000;
export const SCAVENGE_REEL_DURATION_VARIATION_MS = 700;
const SCAVENGE_REEL_MIN_LANDING_FRACTION = 0.05;
const SCAVENGE_REEL_MAX_LANDING_FRACTION = 0.95;
export const SCAVENGE_REEL_TARGET_CYCLE_OFFSET = 1;
const SCAVENGE_REEL_MAX_INITIAL_OFFSET_CYCLES = 1;

export type ScavengeReelPanel = ScavengeOutcome & {
  topPx: number;
  heightPx: number;
};

export type ScavengeReelAnimationPlan = {
  outcomeId: ScavengeOutcomeId;
  initialOffsetPx: number;
  destinationOffsetPx: number;
  durationMs: number;
  completeCycles: number;
  landingFraction: number;
  targetPanelTopPx: number;
  targetPanelHeightPx: number;
};

function unitRandom(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
  return Math.min(value, 0.999_999);
}

/**
 * The target can be in the cycle immediately after the completed cycles, the
 * randomized start can consume one cycle, and the pointer is centered in a
 * viewport rather than placed at its top edge. Deriving the count from those
 * facts keeps the rendered strip large enough for the furthest valid target
 * instead of relying on a hand-counted buffer.
 */
export function scavengeReelCycleCount(
  cycleHeightPx = SCAVENGE_REEL_CYCLE_HEIGHT_PX,
  viewportHeightPx = SCAVENGE_REEL_VIEWPORT_HEIGHT_PX,
): number {
  if (!Number.isFinite(cycleHeightPx) || cycleHeightPx <= 0) {
    throw new RangeError("Scavenge reel cycle height must be positive");
  }
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) {
    throw new RangeError("Scavenge reel viewport height must be positive");
  }
  const maximumTargetOffsetPx =
    (SCAVENGE_REEL_MAX_COMPLETE_CYCLES +
      SCAVENGE_REEL_TARGET_CYCLE_OFFSET +
      SCAVENGE_REEL_MAX_INITIAL_OFFSET_CYCLES) *
    cycleHeightPx;
  return Math.ceil((maximumTargetOffsetPx + viewportHeightPx / 2) / cycleHeightPx);
}

export const SCAVENGE_REEL_CYCLE_COUNT = scavengeReelCycleCount();

export function scavengeReelRenderedStripHeight(
  cycleHeightPx = SCAVENGE_REEL_CYCLE_HEIGHT_PX,
  viewportHeightPx = SCAVENGE_REEL_VIEWPORT_HEIGHT_PX,
): number {
  return scavengeReelCycleCount(cycleHeightPx, viewportHeightPx) * cycleHeightPx;
}

export function scavengeReelPanels(
  cycleHeightPx = SCAVENGE_REEL_CYCLE_HEIGHT_PX,
): readonly ScavengeReelPanel[] {
  if (!Number.isFinite(cycleHeightPx) || cycleHeightPx <= 0) {
    throw new RangeError("Scavenge reel cycle height must be positive");
  }
  const totalWeightBps = SCAVENGE_OUTCOMES.reduce((total, outcome) => total + outcome.weightBps, 0);
  if (totalWeightBps !== SCAVENGE_TOTAL_WEIGHT_BPS) {
    throw new Error("Scavenge reel weights must total 10,000 basis points");
  }
  let topPx = 0;
  return SCAVENGE_REEL_ORDER.map((outcomeId) => {
    const outcome = getScavengeOutcome(outcomeId);
    if (!outcome) throw new Error(`Missing Scavenge reel outcome: ${outcomeId}`);
    const heightPx = (outcome.weightBps / totalWeightBps) * cycleHeightPx;
    const panel = { ...outcome, topPx, heightPx };
    topPx += heightPx;
    return panel;
  });
}

export function createScavengeReelAnimationPlan(input: {
  outcomeId: ScavengeOutcomeId;
  initialRandom: number;
  landingRandom: number;
  cycleRandom: number;
  durationRandom: number;
  cycleHeightPx?: number;
  viewportHeightPx?: number;
}): ScavengeReelAnimationPlan {
  const cycleHeightPx = input.cycleHeightPx ?? SCAVENGE_REEL_CYCLE_HEIGHT_PX;
  const viewportHeightPx = input.viewportHeightPx ?? SCAVENGE_REEL_VIEWPORT_HEIGHT_PX;
  const panels = scavengeReelPanels(cycleHeightPx);
  const targetPanel = panels.find((panel) => panel.id === input.outcomeId);
  if (!targetPanel) throw new Error(`Missing Scavenge reel target: ${input.outcomeId}`);
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) {
    throw new RangeError("Scavenge reel viewport height must be positive");
  }

  const initialRandom = unitRandom(input.initialRandom, "Initial reel position");
  const landingRandom = unitRandom(input.landingRandom, "Reel landing position");
  const cycleRandom = unitRandom(input.cycleRandom, "Reel cycle count");
  const durationRandom = unitRandom(input.durationRandom, "Reel duration");
  const completeCycles =
    SCAVENGE_REEL_MIN_COMPLETE_CYCLES +
    Math.floor(
      cycleRandom * (SCAVENGE_REEL_MAX_COMPLETE_CYCLES - SCAVENGE_REEL_MIN_COMPLETE_CYCLES + 1),
    );
  const landingFraction =
    SCAVENGE_REEL_MIN_LANDING_FRACTION +
    landingRandom * (SCAVENGE_REEL_MAX_LANDING_FRACTION - SCAVENGE_REEL_MIN_LANDING_FRACTION);
  const initialOffsetPx = Math.round(initialRandom * cycleHeightPx);
  const targetPanelTopPx =
    (completeCycles + SCAVENGE_REEL_TARGET_CYCLE_OFFSET) * cycleHeightPx +
    targetPanel.topPx +
    targetPanel.heightPx * landingFraction -
    viewportHeightPx / 2;
  const renderedStripHeightPx = scavengeReelRenderedStripHeight(cycleHeightPx, viewportHeightPx);
  if (
    initialOffsetPx < 0 ||
    initialOffsetPx + viewportHeightPx > renderedStripHeightPx ||
    targetPanelTopPx < 0 ||
    targetPanelTopPx + viewportHeightPx > renderedStripHeightPx
  ) {
    throw new Error("Scavenge reel animation plan exceeds its rendered strip bounds");
  }

  return {
    outcomeId: input.outcomeId,
    initialOffsetPx,
    destinationOffsetPx: targetPanelTopPx,
    durationMs:
      SCAVENGE_REEL_MIN_DURATION_MS +
      (completeCycles - SCAVENGE_REEL_MIN_COMPLETE_CYCLES) * SCAVENGE_REEL_EXTRA_CYCLE_DURATION_MS +
      Math.round(durationRandom * SCAVENGE_REEL_DURATION_VARIATION_MS),
    completeCycles,
    landingFraction,
    targetPanelTopPx,
    targetPanelHeightPx: targetPanel.heightPx,
  };
}
