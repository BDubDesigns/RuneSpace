import { describe, expect, it } from "vitest";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";
import { BOUNDED_RUN_MAX } from "@/game/domain/bounded-run";
import {
  fabricateVisibleRecipes,
  learnedRecipes,
  tinkerVisibleTargets,
} from "@/features/fabrication/station-lists";
import {
  fabricationResultBeat,
  observeFabricationRun,
  observeTinkeringRun,
  tinkeringResultBeat,
} from "@/features/fabrication/station-results";
import type { FabricationRunState, FabricationRunWorkpiece } from "@/server/fabrication";
import type { FabricationRecipeProjection, TinkeringTargetProjection } from "@/server/play";
import type { TinkeringRunBatch, TinkeringRunState } from "@/server/tinkering";

/**
 * The #232 human-preview station presentation: which recipes and targets the
 * station lists, and the inline result beat derived from authoritative run
 * counters.
 */

const recipe = (
  actionId: string,
  overrides: Partial<FabricationRecipeProjection> = {},
): FabricationRecipeProjection => ({
  actionId,
  outputItemId: ITEM_IDS.mountingBracket,
  outputName: "Mounting Bracket",
  outputQuantity: 1,
  minimumLevel: 1,
  unlocked: true,
  durationTicks: 12,
  baseXp: 25,
  inputs: [],
  inputsAvailable: true,
  affordableBatches: 1,
  ...overrides,
});

const target = (
  actionId: string,
  overrides: Partial<TinkeringTargetProjection> = {},
): TinkeringTargetProjection => ({
  actionId,
  itemId: ITEM_IDS.mountingBracket,
  name: "Mounting Bracket",
  batchQuantity: 1,
  minimumLevel: 1,
  unlocked: true,
  durationTicks: 24,
  xp: 25,
  scrap: 1,
  carriedBatches: 1,
  affordableBatches: 1,
  lastCutterBlocked: false,
  ...overrides,
});

describe("Fabricate lists what can be made now", () => {
  const ready = recipe("ready");
  const short = recipe("short", { inputsAvailable: false, affordableBatches: 0 });
  const locked = recipe("locked", { unlocked: false, minimumLevel: 5 });

  it("shows only level-unlocked recipes whose materials are carried", () => {
    expect(fabricateVisibleRecipes([ready, short, locked], new Set())).toEqual([ready]);
  });

  it("keeps a Mission-guided recipe visible even without its materials", () => {
    expect(fabricateVisibleRecipes([ready, short, locked], new Set(["short"]))).toEqual([
      ready,
      short,
    ]);
  });

  it("lists every level-unlocked recipe in Recipes, carried or not, and nothing above level", () => {
    expect(learnedRecipes([ready, short, locked])).toEqual([ready, short]);
  });
});

describe("Tinker lists what can be taken apart now", () => {
  it("shows unlocked targets with a complete carried batch, and hides the rest", () => {
    const ready = target("ready");
    const none = target("none", { carriedBatches: 0, affordableBatches: 0 });
    const locked = target("locked", { unlocked: false });
    expect(tinkerVisibleTargets([ready, none, locked])).toEqual([ready]);
  });

  it("keeps a carried last Cutter visible so its safety reason can show", () => {
    const lastCutter = target(ACTION_IDS.salvageCutterTinkering, {
      itemId: ITEM_IDS.salvageCutter,
      carriedBatches: 1,
      affordableBatches: 0,
      lastCutterBlocked: true,
    });
    expect(tinkerVisibleTargets([lastCutter])).toEqual([lastCutter]);
  });
});

const workpiece = (
  sequence: number,
  overrides: Partial<FabricationRunWorkpiece> = {},
): FabricationRunWorkpiece => ({
  sequence,
  resolvedAt: `2026-09-27T10:00:${String(sequence).padStart(2, "0")}.000Z`,
  recipeActionId: ACTION_IDS.mountingBracketFabrication,
  result: "success",
  xpAwarded: 25,
  usedOverride: false,
  safePushes: 0,
  exactPushes: 0,
  ...overrides,
});

function fabricationRun(workpieces: FabricationRunWorkpiece[]): FabricationRunState {
  const successes = workpieces.filter((entry) => entry.result === "success");
  return {
    selection: BOUNDED_RUN_MAX,
    batches: workpieces.length,
    successes: successes.length,
    busts: workpieces.length - successes.length,
    inputsConsumed: {},
    outputsGained: successes.length > 0 ? { [ITEM_IDS.mountingBracket]: successes.length } : {},
    xpGained: workpieces.reduce((sum, entry) => sum + entry.xpAwarded, 0),
    recentWorkpieces: workpieces.slice(-10),
  };
}

describe("the Fabrication result beat", () => {
  it("acknowledges one finished workpiece with its item and XP", () => {
    const before = observeFabricationRun(fabricationRun([]));
    expect(fabricationResultBeat(before, fabricationRun([workpiece(1)]))).toEqual({
      kind: "fabrication",
      tone: "success",
      headline: "Mounting Bracket fabricated",
      details: ["+25 Fabrication XP"],
    });
  });

  it("names the earned multiplier for an Override success", () => {
    const before = observeFabricationRun(fabricationRun([]));
    const pushed = workpiece(1, { usedOverride: true, exactPushes: 1, xpAwarded: 32 });
    expect(fabricationResultBeat(before, fabricationRun([pushed]))?.details).toEqual([
      "Manual Override 1.30×",
      "+32 Fabrication XP",
    ]);
  });

  it("keeps a bust distinct: materials lost, no XP", () => {
    const before = observeFabricationRun(fabricationRun([]));
    const bust = workpiece(1, { result: "bust", xpAwarded: 0, bust: { feed: 3, load: 9 } });
    expect(fabricationResultBeat(before, fabricationRun([bust]))).toMatchObject({
      tone: "bust",
      headline: "Workpiece bust · materials lost",
      details: ["No XP"],
    });
  });

  it("aggregates everything resolved since the last look into one beat, beyond the history", () => {
    const seen = fabricationRun([workpiece(1)]);
    const later = fabricationRun(
      Array.from({ length: 14 }, (_, index) =>
        index === 7 ? workpiece(index + 1, { result: "bust", xpAwarded: 0 }) : workpiece(index + 1),
      ),
    );
    expect(fabricationResultBeat(observeFabricationRun(seen), later)).toEqual({
      kind: "fabrication",
      tone: "mixed",
      headline: "12 × Mounting Bracket fabricated",
      details: ["Workpiece bust · materials lost", "+300 Fabrication XP"],
    });
  });

  it("counts a new run from zero, and says nothing when nothing resolved", () => {
    const old = observeFabricationRun(fabricationRun([workpiece(1), workpiece(2), workpiece(3)]));
    const fresh = fabricationRun([
      workpiece(1, { resolvedAt: "2026-09-27T11:00:00.000Z" }),
      workpiece(2, { resolvedAt: "2026-09-27T11:00:07.000Z" }),
    ]);
    expect(fabricationResultBeat(old, fresh)?.headline).toBe("2 × Mounting Bracket fabricated");
    expect(fabricationResultBeat(old, fabricationRun([]))).toBeUndefined();
  });
});

describe("the Tinkering result beat", () => {
  const batch = (sequence: number, overrides: Partial<TinkeringRunBatch> = {}) => ({
    sequence,
    resolvedAt: `2026-09-27T10:01:${String(sequence).padStart(2, "0")}.000Z`,
    itemId: ITEM_IDS.mountingBracket,
    quantity: 1,
    xpAwarded: 25,
    scrapKept: 1,
    scrapDiscarded: 0,
    ...overrides,
  });
  const run = (batches: TinkeringRunBatch[]): TinkeringRunState => ({
    selection: BOUNDED_RUN_MAX,
    batches: batches.length,
    itemsConsumed: {},
    scrapKept: batches.reduce((sum, entry) => sum + entry.scrapKept, 0),
    scrapDiscarded: batches.reduce((sum, entry) => sum + entry.scrapDiscarded, 0),
    xpGained: batches.reduce((sum, entry) => sum + entry.xpAwarded, 0),
    recentBatches: batches.slice(-10),
  });

  it("acknowledges a dismantled item with its Scrap and XP", () => {
    expect(tinkeringResultBeat(observeTinkeringRun(run([])), run([batch(1)]))).toEqual({
      kind: "tinkering",
      tone: "success",
      headline: "Mounting Bracket dismantled",
      details: ["+1 Scrap Metal", "+25 Fabrication XP"],
    });
  });

  it("aggregates a Max run and reports discarded Scrap rather than kept", () => {
    const discarded = (sequence: number) => batch(sequence, { scrapKept: 0, scrapDiscarded: 1 });
    expect(
      tinkeringResultBeat(
        observeTinkeringRun(run([])),
        run([discarded(1), discarded(2), discarded(3)]),
      ),
    ).toMatchObject({
      headline: "3 × Mounting Bracket dismantled",
      details: ["3 Scrap discarded", "+75 Fabrication XP"],
    });
  });
});
