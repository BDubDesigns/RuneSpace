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
export const SCAVENGE_REEL_CYCLE_COUNT = 5;
export const SCAVENGE_REEL_MIN_DURATION_MS = 3_000;
export const SCAVENGE_REEL_EXTRA_CYCLE_DURATION_MS = 1_000;
export const SCAVENGE_REEL_DURATION_VARIATION_MS = 700;
const INITIAL_OFFSET_MAX_PX = 120;

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
  const completeCycles = 2 + Math.floor(cycleRandom * 3);
  const landingFraction = 0.05 + landingRandom * 0.9;
  const initialOffsetPx = Math.round(initialRandom * INITIAL_OFFSET_MAX_PX);
  const targetPanelTopPx =
    completeCycles * cycleHeightPx +
    targetPanel.topPx +
    targetPanel.heightPx * landingFraction -
    viewportHeightPx / 2;

  return {
    outcomeId: input.outcomeId,
    initialOffsetPx,
    destinationOffsetPx: targetPanelTopPx,
    durationMs:
      SCAVENGE_REEL_MIN_DURATION_MS +
      (completeCycles - 2) * SCAVENGE_REEL_EXTRA_CYCLE_DURATION_MS +
      Math.round(durationRandom * SCAVENGE_REEL_DURATION_VARIATION_MS),
    completeCycles,
    landingFraction,
    targetPanelTopPx,
    targetPanelHeightPx: targetPanel.heightPx,
  };
}
