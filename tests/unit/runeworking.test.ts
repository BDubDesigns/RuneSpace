import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  runeworkingActionIds,
  runeworkingRecipeForActionId,
  skillLevelThresholds,
  standardSkillLevelThresholds,
  type RuneworkingRecipeBalance,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_QUANTITY_CEILING,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { HILLTOP_WORKSHOP_CONTENT } from "@/game/content/hilltop-workshop";
import { getItemPresentation } from "@/game/content/item-presentation";
import { ITEM_CATEGORY_BY_ITEM_ID } from "@/game/content/item-categories";
import { getLocation, isActionAvailableAtLocation } from "@/game/content/locations";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { BOUNDED_RUN_MAX, boundedRunAllowance } from "@/game/domain/bounded-run";
import type { StackState } from "@/game/domain/inventory";
import { recipesUnlockedBetween } from "@/game/domain/recipe-unlocks";
import {
  resolveRuneworking,
  runeworkingAffordableCycles,
  runeworkingStartCheck,
  type RuneworkingRunSnapshot,
} from "@/game/domain/runeworking";
import { isTravelReplaceableAction } from "@/game/domain/travel-replacement";
import {
  runeworkingErrorMessage,
  runeworkingRunSummary,
  runeworkingStopIsExpected,
  runeworkingStopMessage,
} from "@/features/runeworking/rig-copy";
import type { RuneworkingRecipeProjection } from "@/server/play";

/**
 * Runeworking (#391): the exact authored skill, item and recipe, and the pure
 * cycle rules — capacity after the Fragment leaves, partial stacks first,
 * numeric and Max runs, Finish Current, a window shorter than a cycle, and an
 * offline catch-up that resolves every cycle that fits, each against the
 * inventory the one before it left.
 */

const balance = getEffectiveGameBalance();
const seeker = runeworkingRecipeForActionId(ACTION_IDS.beginnerEchoSeekerRuneworking, balance)!;
const FRAGMENT = ITEM_IDS.runeFragment;
const SEEKER = ITEM_IDS.beginnerEchoSeeker;

function stacks(...entries: [itemId: string, quantity: number][]): StackState<string>[] {
  return entries.map(([itemId, quantity], index) => ({
    id: `s${index}`,
    itemId: itemId as StackState<string>["itemId"],
    quantity,
  }));
}

function snapshot(
  carried: StackState<string>[],
  overrides: Partial<RuneworkingRunSnapshot> = {},
): RuneworkingRunSnapshot {
  return {
    runeworkingLevel: 1,
    stacks: carried,
    slotsAvailable: 8 - carried.length,
    massAvailableGrams: 30_000,
    allowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
    finishCurrent: false,
    ...overrides,
  };
}

const total = (resolved: ReturnType<typeof resolveRuneworking>, itemId: string) =>
  resolved.outputsGained[itemId] ?? 0;

describe("the approved skill, item and recipe", () => {
  it("adds Runeworking as a standard skill on the shared curve, Level 2 at 500 XP", () => {
    expect(SKILL_IDS.runeworking).toBe("runeworking");
    expect(skillLevelThresholds(SKILL_IDS.runeworking)).toEqual(standardSkillLevelThresholds());
    expect(skillLevelThresholds(SKILL_IDS.runeworking)![1]).toEqual({ level: 2, totalXp: 500 });
    expect(getSkillPresentation(SKILL_IDS.runeworking)).toEqual({
      displayName: "Runeworking",
      accentTone: "runeworking",
    });
  });

  it("ships the Seeker recipe: 1 Rune Fragment into 1 Seeker, 34 ticks, 25 XP, Level 1", () => {
    // The personal Rig's Skatboll TP Rune (#441) is the second recipe, at its own station.
    expect(runeworkingActionIds(balance)).toEqual([
      ACTION_IDS.beginnerEchoSeekerRuneworking,
      ACTION_IDS.skatbollTpRuneRuneworking,
    ]);
    expect(seeker).toEqual({
      actionId: ACTION_IDS.beginnerEchoSeekerRuneworking,
      outputItemId: SEEKER,
      outputQuantity: 1,
      minimumLevel: 1,
      durationTicks: 34,
      baseXp: 25,
      inputs: [{ itemId: FRAGMENT, quantity: 1 }],
    });
    expect((seeker.durationTicks * GAME_TICK_MS) / 1000).toBe(20.4);
    expect(balance.runeworking.skillId).toBe(SKILL_IDS.runeworking);
  });

  it("makes the Seeker an ordinary 200 g stack of five with the approved description and art", () => {
    expect(getItemDefinition(SEEKER, balance)).toEqual({
      itemId: SEEKER,
      kind: "stack",
      stackLimit: 5,
      massGrams: 200,
    });
    // Mass-conserving: the Seeker is the Fragment it was attuned from.
    expect(getItemDefinition(FRAGMENT, balance)?.massGrams).toBe(200);
    const presentation = getItemPresentation(SEEKER)!;
    expect(presentation.displayName).toBe("Beginner Echo Seeker");
    expect(presentation.pluralName).toBe("Beginner Echo Seekers");
    expect(presentation.description).toBe(
      "A fragment attuned to detect hidden disturbances in RuneSpace. Consume one to sense the direction of a hidden Resonance Echo on your current planet.",
    );
    expect(presentation.artworkSrc).toBe("/item-art/beginner-echo-seeker.webp");
    expect(presentation.rarity).toBeUndefined();
    expect(ITEM_CATEGORY_BY_ITEM_ID[SEEKER]).toBe("components-and-supplies");
  });

  it("hosts the Rig at Hilltop Workshop, opened by completing Not From Around Here", () => {
    expect(HILLTOP_WORKSHOP_CONTENT).toEqual({
      locationId: LOCATION_IDS.hilltopWorkshop,
      resonanceRigUnlockMissionId: MISSION_IDS.notFromAroundHere,
    });
    expect(
      isActionAvailableAtLocation(
        LOCATION_IDS.hilltopWorkshop,
        ACTION_IDS.beginnerEchoSeekerRuneworking,
      ),
    ).toBe(true);
    // No new hex, Local Place or Map status.
    expect(getLocation(LOCATION_IDS.hilltopWorkshop)?.mapStatus).toBeUndefined();
  });

  it("keeps a started cycle binding: Travel never replaces it", () => {
    expect(isTravelReplaceableAction(ACTION_IDS.beginnerEchoSeekerRuneworking)).toBe(false);
  });

  it("joins the recipe-unlock registry, which a Level 1 recipe never notifies", () => {
    expect(recipesUnlockedBetween(SKILL_IDS.runeworking, 1, 2, balance)).toEqual([]);
    expect(recipesUnlockedBetween(SKILL_IDS.runeworking, 0, 1, balance)).toEqual([seeker]);
  });
});

describe("one cycle's check", () => {
  it("needs a Fragment and room for the Seeker once the Fragment is gone", () => {
    expect(runeworkingStartCheck(snapshot(stacks()), seeker)).toEqual({
      ok: false,
      reason: "insufficient_inputs",
    });
    expect(runeworkingStartCheck(snapshot(stacks([FRAGMENT, 2])), seeker).ok).toBe(true);
  });

  it("lets the last Fragment free the slot its Seeker needs", () => {
    // One Fragment, no free slot: the Fragment's slot empties and the Seeker takes it.
    expect(
      runeworkingStartCheck(snapshot(stacks([FRAGMENT, 1]), { slotsAvailable: 0 }), seeker).ok,
    ).toBe(true);
  });

  it("refuses for slots when the Fragment's slot stays occupied and no partial stack has room", () => {
    expect(
      runeworkingStartCheck(snapshot(stacks([FRAGMENT, 2]), { slotsAvailable: 0 }), seeker),
    ).toEqual({ ok: false, reason: "inventory_slots_full" });
    // A full Seeker stack is no help either.
    expect(
      runeworkingStartCheck(
        snapshot(stacks([FRAGMENT, 2], [SEEKER, 5]), { slotsAvailable: 0 }),
        seeker,
      ),
    ).toEqual({ ok: false, reason: "inventory_slots_full" });
  });

  it("tops up a partial Seeker stack first, so no slot is needed", () => {
    expect(
      runeworkingStartCheck(
        snapshot(stacks([FRAGMENT, 2], [SEEKER, 3]), { slotsAvailable: 0 }),
        seeker,
      ).ok,
    ).toBe(true);
  });

  it("never refuses for mass: the Seeker weighs what the Fragment did", () => {
    expect(
      runeworkingStartCheck(snapshot(stacks([FRAGMENT, 2]), { massAvailableGrams: 0 }), seeker).ok,
    ).toBe(true);
  });

  it("counts affordable cycles from carried Fragments only, capped by the run ceiling", () => {
    expect(runeworkingAffordableCycles({ runeworkingLevel: 1, stacks: stacks() }, seeker)).toBe(0);
    expect(
      runeworkingAffordableCycles(
        { runeworkingLevel: 1, stacks: stacks([FRAGMENT, 10], [FRAGMENT, 4]) },
        seeker,
      ),
    ).toBe(14);
    expect(
      runeworkingAffordableCycles(
        {
          runeworkingLevel: 1,
          stacks: stacks([FRAGMENT, BOUNDED_RUN_QUANTITY_CEILING + 5]),
        },
        seeker,
      ),
    ).toBe(BOUNDED_RUN_QUANTITY_CEILING);
  });
});

describe("resolving cycles", () => {
  it("resolves nothing in a window shorter than one cycle", () => {
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks - 1,
      snapshot: snapshot(stacks([FRAGMENT, 3])),
      recipe: seeker,
    });
    expect(resolved.resolved).toEqual([]);
    expect(resolved.consumedTicks).toBe(0);
    expect(resolved.stopReason).toBeUndefined();
    expect(resolved.stackUpdates).toEqual([]);
  });

  it("completes one cycle atomically: one Fragment out, one Seeker in, 25 XP", () => {
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks,
      snapshot: snapshot(stacks([FRAGMENT, 3]), { allowance: boundedRunAllowance(3, 0) }),
      recipe: seeker,
    });
    expect(resolved.resolved).toEqual([{ xpAwarded: 25 }]);
    expect(resolved.awardedXp).toBe(25);
    expect(resolved.inputsConsumed).toEqual({ [FRAGMENT]: 1 });
    expect(resolved.outputsGained).toEqual({ [SEEKER]: 1 });
    expect(resolved.stackUpdates).toEqual([{ id: "s0", quantity: 2 }]);
    expect(resolved.createdStacks).toEqual([{ itemId: SEEKER, quantity: 1 }]);
    expect(resolved.consumedTicks).toBe(seeker.durationTicks);
    expect(resolved.stopReason).toBeUndefined();
  });

  it("stops a numeric run exactly at its count, however long the window", () => {
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks * 10,
      snapshot: snapshot(stacks([FRAGMENT, 10]), { allowance: boundedRunAllowance(3, 0) }),
      recipe: seeker,
    });
    expect(resolved.resolved).toHaveLength(3);
    expect(resolved.awardedXp).toBe(75);
    expect(resolved.stopReason).toBe("run_completed");
    expect(resolved.consumedTicks).toBe(seeker.durationTicks * 3);
  });

  it("carries a run's earlier progress: a reconnect resolves only what is left", () => {
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks * 10,
      snapshot: snapshot(stacks([FRAGMENT, 10]), { allowance: boundedRunAllowance(3, 2) }),
      recipe: seeker,
    });
    expect(resolved.resolved).toHaveLength(1);
    expect(resolved.stopReason).toBe("run_completed");
  });

  it("runs Max until the Fragments run out, never a predicted total", () => {
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks * 50,
      snapshot: snapshot(stacks([FRAGMENT, 4])),
      recipe: seeker,
    });
    expect(resolved.resolved).toHaveLength(4);
    expect(total(resolved, SEEKER)).toBe(4);
    expect(resolved.deletedStackIds).toEqual(["s0"]);
    expect(resolved.stopReason).toBe("insufficient_inputs");
  });

  it("revalidates capacity after every cycle: Max stops when the next Seeker has nowhere to go", () => {
    // Three Fragments, one Seeker stack with room for one, no free slot: the
    // first cycle tops the stack up to five; the second would need a new slot
    // that the two remaining Fragments do not free, so it never starts.
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks * 5,
      snapshot: snapshot(stacks([FRAGMENT, 3], [SEEKER, 4]), { slotsAvailable: 0 }),
      recipe: seeker,
    });
    expect(resolved.resolved).toHaveLength(1);
    expect(resolved.stopReason).toBe("inventory_slots_full");
    expect(resolved.stackUpdates).toEqual(
      expect.arrayContaining([
        { id: "s0", quantity: 2 },
        { id: "s1", quantity: 5 },
      ]),
    );
    expect(resolved.createdStacks).toEqual([]);
  });

  it("honours Finish Current after the cycle on the Rig, which still pays", () => {
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks * 5,
      snapshot: snapshot(stacks([FRAGMENT, 5]), { finishCurrent: true }),
      recipe: seeker,
    });
    expect(resolved.resolved).toEqual([{ xpAwarded: 25 }]);
    expect(total(resolved, SEEKER)).toBe(1);
    expect(resolved.stopReason).toBe("finished_current");
  });

  it("consumes nothing for a cycle whose Fragment is gone, and says so", () => {
    // Unreachable while the reservation holds; proven so it can never invent
    // a Seeker.
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks * 2,
      snapshot: snapshot(stacks()),
      recipe: seeker,
    });
    expect(resolved.resolved).toEqual([]);
    expect(resolved.awardedXp).toBe(0);
    expect(resolved.stopReason).toBe("insufficient_inputs");
  });

  it("refuses a locked recipe without consuming anything", () => {
    // Authored balance pins the level as a literal; a test-only override widens it.
    const locked = { ...seeker, minimumLevel: 2 } as unknown as RuneworkingRecipeBalance;
    const resolved = resolveRuneworking({
      elapsedTicks: seeker.durationTicks,
      snapshot: snapshot(stacks([FRAGMENT, 2])),
      recipe: locked,
    });
    expect(resolved.resolved).toEqual([]);
    expect(resolved.stopReason).toBe("recipe_locked");
  });

  it("rejects a negative or fractional window", () => {
    expect(() =>
      resolveRuneworking({ elapsedTicks: -1, snapshot: snapshot(stacks()), recipe: seeker }),
    ).toThrow(RangeError);
    expect(() =>
      resolveRuneworking({ elapsedTicks: 1.5, snapshot: snapshot(stacks()), recipe: seeker }),
    ).toThrow(RangeError);
  });
});

describe("the Rig's copy", () => {
  const projection: RuneworkingRecipeProjection = {
    actionId: seeker.actionId,
    outputItemId: SEEKER,
    outputName: "Beginner Echo Seeker",
    outputQuantity: 1,
    outputStackLimit: 5,
    minimumLevel: 1,
    unlocked: true,
    durationTicks: 34,
    baseXp: 25,
    inputs: [{ itemId: FRAGMENT, name: "Rune Fragment", quantity: 1, carried: 3 }],
    inputsAvailable: true,
    affordableCycles: 3,
  };

  it("totals a numeric run exactly and describes Max per attunement", () => {
    expect(runeworkingRunSummary(projection, 3)).toBe(
      "3 attunements · 3 Rune Fragment → 3 Beginner Echo Seeker · 61.2 sec · 75 Runeworking XP",
    );
    expect(runeworkingRunSummary(projection, BOUNDED_RUN_MAX)).toContain(
      "runs until the next attunement cannot begin",
    );
  });

  it("treats a completed number, Finish Current and Max running dry as expected stops", () => {
    expect(runeworkingStopIsExpected("run_completed", 3)).toBe(true);
    expect(runeworkingStopIsExpected("finished_current", 3)).toBe(true);
    expect(runeworkingStopIsExpected("insufficient_inputs", BOUNDED_RUN_MAX)).toBe(true);
    expect(runeworkingStopIsExpected("insufficient_inputs", 3)).toBe(false);
    expect(runeworkingStopIsExpected("inventory_slots_full", BOUNDED_RUN_MAX)).toBe(false);
  });

  it("never speaks of failure, chance or byproducts", () => {
    const copy = [
      runeworkingStopMessage("run_completed", { cycles: 3 }),
      runeworkingStopMessage("finished_current", { cycles: 1 }),
      runeworkingStopMessage("inventory_slots_full", { cycles: 1 }),
      runeworkingErrorMessage("runeworking_locked", 0),
      runeworkingErrorMessage("runeworking_quantity_unavailable", 2),
      runeworkingRunSummary(projection, 1),
    ].join(" ");
    expect(copy).not.toMatch(/fail|chance|slag|byproduct|override/i);
  });
});
