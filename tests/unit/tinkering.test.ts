import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  tinkeringActionIds,
  tinkeringTargetForActionId,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS } from "@/game/config/foundations";
import { BOUNDED_RUN_MAX, boundedRunAllowance } from "@/game/domain/bounded-run";
import type { StackState } from "@/game/domain/inventory";
import {
  orderInstancesForConsumption,
  resolveTinkering,
  tinkeringAffordableBatches,
  tinkeringDurationTicks,
  tinkeringScrapYield,
  tinkeringStartCheck,
  tinkeringXp,
  type TinkeringSnapshot,
  type TinkeringUniqueInstance,
} from "@/game/domain/tinkering";

/**
 * Tinkering (#232): the universal recovery / XP / duration rules at their
 * exact Tier-1 values, complete batches only, Auto-discard Scrap, the
 * committed cycle, and the first-alpha last-Cutter guard.
 */

const balance = getEffectiveGameBalance();
const target = (actionId: string) => tinkeringTargetForActionId(actionId, balance)!;
const bracket = target(ACTION_IDS.mountingBracketTinkering);
const box = target(ACTION_IDS.scrapBoxTinkering);
const cutter = target(ACTION_IDS.salvageCutterTinkering);

function stacks(...entries: [itemId: string, quantity: number][]): StackState<string>[] {
  return entries.map(([itemId, quantity], index) => ({
    id: `s${index}`,
    itemId: itemId as StackState<string>["itemId"],
    quantity,
  }));
}

function instance(
  id: string,
  itemId: string,
  charge: number | null,
  createdAt: string,
): TinkeringUniqueInstance {
  return { id, itemId, currentCharge: charge, createdAt };
}

function snapshot(overrides: Partial<TinkeringSnapshot> = {}): TinkeringSnapshot {
  return {
    fabricationLevel: 1,
    stacks: [],
    carriedUniqueItems: [],
    ownedMiningCutters: 1,
    slotsAvailable: 4,
    massAvailableGrams: 30_000,
    autoDiscardScrap: false,
    finishCurrent: false,
    allowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
    ...overrides,
  };
}

describe("the Tier-1 Tinkering set and its exact values", () => {
  it("authors exactly the three eligible Tier-1 targets — never Direct Scrap", () => {
    expect(tinkeringActionIds(balance)).toEqual([
      ACTION_IDS.mountingBracketTinkering,
      ACTION_IDS.scrapBoxTinkering,
      ACTION_IDS.salvageCutterTinkering,
    ]);
    expect(tinkeringActionIds(balance).map((id) => target(id).recipe.actionId)).not.toContain(
      ACTION_IDS.scrapMetalFabrication,
    );
  });

  it.each([
    ["Salvage Cutter", cutter, 65, 40, 3],
    ["Scrap Box", box, 81, 72, 3],
    ["Mounting Bracket", bracket, 25, 24, 1],
  ] as const)(
    "%s: base XP, twice the duration, 1 Scrap per 2 input units rounded up",
    (_, each, xp, ticks, scrap) => {
      expect(tinkeringXp(each.recipe)).toBe(xp);
      expect(tinkeringDurationTicks(each.recipe, balance)).toBe(ticks);
      expect(tinkeringScrapYield(each.recipe, balance)).toBe(scrap);
    },
  );

  it("rounds the universal formula up for an odd number of input units", () => {
    expect(tinkeringScrapYield({ inputs: [{ quantity: 3 }] } as never, balance)).toBe(2);
    expect(tinkeringScrapYield({ inputs: [{ quantity: 1 }] } as never, balance)).toBe(1);
  });

  it("follows the recipe's Fabrication level", () => {
    expect(
      tinkeringStartCheck(
        snapshot({ fabricationLevel: 0, stacks: stacks([ITEM_IDS.mountingBracket, 1]) }),
        bracket,
      ),
    ).toEqual({ ok: false, reason: "recipe_locked" });
  });
});

describe("what one batch takes", () => {
  it("counts only complete batches of carried, unequipped items", () => {
    expect(
      tinkeringAffordableBatches(
        snapshot({ stacks: stacks([ITEM_IDS.mountingBracket, 3], [ITEM_IDS.mountingBracket, 2]) }),
        bracket,
      ),
    ).toBe(5);
    expect(
      tinkeringAffordableBatches(
        snapshot({ carriedUniqueItems: [instance("b", ITEM_IDS.scrapBox, null, "2026-01-01")] }),
        box,
      ),
    ).toBe(1);
  });

  it("spends the least value first: uncharged before charged, then the newest", () => {
    const ordered = orderInstancesForConsumption([
      instance("old-charged", ITEM_IDS.salvageCutter, 10, "2026-01-01T00:00:00.000Z"),
      instance("old-empty", ITEM_IDS.salvageCutter, 0, "2026-01-01T00:00:00.000Z"),
      instance("new-empty", ITEM_IDS.salvageCutter, null, "2026-02-01T00:00:00.000Z"),
    ]);
    expect(ordered.map((each) => each.id)).toEqual(["new-empty", "old-empty", "old-charged"]);
  });
});

describe("the first-alpha last-Cutter guard", () => {
  const carriedCutter = instance("c1", ITEM_IDS.salvageCutter, 0, "2026-01-01");

  it("refuses the batch that would leave zero usable Mining Cutters", () => {
    const only = snapshot({ carriedUniqueItems: [carriedCutter], ownedMiningCutters: 1 });
    expect(tinkeringStartCheck(only, cutter)).toEqual({ ok: false, reason: "last_cutter" });
    expect(tinkeringAffordableBatches(only, cutter)).toBe(0);
  });

  it("allows it while another Cutter is owned anywhere — equipped or in the Cargo Hold", () => {
    const spare = snapshot({ carriedUniqueItems: [carriedCutter], ownedMiningCutters: 2 });
    expect(tinkeringStartCheck(spare, cutter)).toEqual({ ok: true });
    expect(tinkeringAffordableBatches(spare, cutter)).toBe(1);
  });

  it("never selects an equipped Cutter: only carried, unequipped instances are candidates", () => {
    // Two owned — one equipped, one in the Cargo Hold — but none carried unequipped.
    expect(
      tinkeringStartCheck(snapshot({ carriedUniqueItems: [], ownedMiningCutters: 2 }), cutter),
    ).toEqual({ ok: false, reason: "no_eligible_items" });
  });
});

describe("Auto-discard Scrap and the committed cycle", () => {
  it("off: refuses a cycle whose Scrap would not fit; on: begins it anyway", () => {
    const full = snapshot({ stacks: stacks([ITEM_IDS.mountingBracket, 5]), slotsAvailable: 0 });
    expect(tinkeringStartCheck(full, bracket)).toEqual({ ok: false, reason: "no_room_for_scrap" });
    expect(tinkeringStartCheck({ ...full, autoDiscardScrap: true }, bracket)).toEqual({ ok: true });
  });

  it("commits the batch the instant a cycle begins and keeps whole ticks of progress", () => {
    const started = resolveTinkering({
      elapsedTicks: 10,
      snapshot: snapshot({ stacks: stacks([ITEM_IDS.mountingBracket, 2]) }),
      target: bracket,
    });
    expect(started.stackUpdates).toEqual([{ id: "s0", quantity: 1 }]);
    expect(started.cycle).toEqual({ targetActionId: bracket.actionId, ticksCompleted: 10 });
    expect(started.resolved).toEqual([]);
    expect(started.consumedTicks).toBe(10);
  });

  it("resumes a committed cycle without committing another", () => {
    const resumed = resolveTinkering({
      elapsedTicks: 14,
      snapshot: snapshot({
        stacks: stacks([ITEM_IDS.mountingBracket, 1]),
        cycle: { targetActionId: bracket.actionId, ticksCompleted: 10 },
        allowance: boundedRunAllowance(1, 0),
      }),
      target: bracket,
    });
    expect(resumed.resolved).toHaveLength(1);
    expect(resumed.stackUpdates).toEqual([]);
    expect(resumed.createdStacks).toEqual([{ itemId: ITEM_IDS.scrapMetal, quantity: 1 }]);
    expect(resumed.stopReason).toBe("run_completed");
  });

  it("discards the Scrap when on and still pays the XP", () => {
    const discarded = resolveTinkering({
      elapsedTicks: 72,
      snapshot: snapshot({
        carriedUniqueItems: [instance("box", ITEM_IDS.scrapBox, null, "2026-01-01")],
        autoDiscardScrap: true,
        allowance: boundedRunAllowance(1, 0),
      }),
      target: box,
    });
    expect(discarded).toMatchObject({
      awardedXp: 81,
      scrapKept: 0,
      scrapDiscarded: 3,
      consumedInstanceIds: ["box"],
    });
    expect(discarded.createdStacks).toEqual([]);
  });

  it("Finish Current completes the committed item and commits no other", () => {
    const finished = resolveTinkering({
      elapsedTicks: 1_000,
      snapshot: snapshot({
        stacks: stacks([ITEM_IDS.mountingBracket, 2]),
        cycle: { targetActionId: bracket.actionId, ticksCompleted: 5 },
        finishCurrent: true,
      }),
      target: bracket,
    });
    expect(finished.resolved).toHaveLength(1);
    expect(finished.stackUpdates).toEqual([]);
    expect(finished.stopReason).toBe("finished_current_item");
    expect(finished.finishCurrentHonoured).toBe(true);
  });

  it("runs Max until no complete batch is left, and stops before the last Cutter", () => {
    const max = resolveTinkering({
      elapsedTicks: 10_000,
      snapshot: snapshot({ stacks: stacks([ITEM_IDS.mountingBracket, 3]) }),
      target: bracket,
    });
    expect(max.resolved).toHaveLength(3);
    expect(max.stopReason).toBe("no_eligible_items");
    const cutters = resolveTinkering({
      elapsedTicks: 10_000,
      snapshot: snapshot({
        carriedUniqueItems: [
          instance("a", ITEM_IDS.salvageCutter, 0, "2026-01-01"),
          instance("b", ITEM_IDS.salvageCutter, 0, "2026-01-02"),
        ],
        ownedMiningCutters: 2,
      }),
      target: cutter,
    });
    expect(cutters.resolved).toHaveLength(1);
    expect(cutters.stopReason).toBe("last_cutter");
  });
});
