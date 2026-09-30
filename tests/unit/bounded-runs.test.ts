import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  refiningRecipeForActionId,
  refiningRecipeIsDeterministic,
  refiningRecipes,
  type RefiningRecipeBalance,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MINIMUM_QUANTITY,
  BOUNDED_RUN_QUANTITY_CEILING,
  ITEM_IDS,
} from "@/game/config/foundations";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  BOUNDED_RUN_MAX,
  boundedRunAllowance,
  boundedRunProgress,
  boundedRunSelectionFromColumn,
  boundedRunSelectionToColumn,
  checkBoundedRunSelection,
  stepBoundedRunSelection,
} from "@/game/domain/bounded-run";
import type { StackState } from "@/game/domain/inventory";
import {
  refiningAffordableBatches,
  refiningAwardFacts,
  refiningRecipeUnlocked,
  refiningSuccessChanceBps,
  resolveRefining,
  type RefiningSnapshot,
} from "@/game/domain/refining";
import {
  BoundedRunSelectionSchema,
  StartPracticeRequestSchema,
  StartRefiningRequestSchema,
} from "@/game/schemas/gameplay";

const balance = getEffectiveGameBalance();
const recipe = (actionId: string) => refiningRecipeForActionId(actionId, balance)!;
const refinedFerrite = recipe(ACTION_IDS.refining);
const galvaferrite = recipe(ACTION_IDS.galvaferriteRefining);
const ferriteShaleSlag = recipe(ACTION_IDS.ferriteShaleSlagRefining);
const galvaniteSlag = recipe(ACTION_IDS.galvaniteSlagRefining);

/** A numeric run with `n` batches left, and a fresh Max run. */
const count = (n: number) => boundedRunAllowance(n, 0);
const max = boundedRunAllowance(BOUNDED_RUN_MAX, 0);

function stacks(...entries: [itemId: string, quantity: number][]): StackState<string>[] {
  return entries.map(([itemId, quantity], index) => ({ id: `s${index}`, itemId, quantity }));
}

function snapshot(
  existingStacks: StackState<string>[],
  overrides: Partial<RefiningSnapshot<string>> = {},
): RefiningSnapshot<string> {
  return {
    refiningLevel: 30,
    existingStacks,
    slotsAvailable: 8 - existingStacks.length,
    massAvailableGrams: 50_000,
    ...overrides,
  };
}

/** Rolls in order: `"success"`, or the index of the input a failure hands back. */
function scripted(outcomes: readonly ("success" | number)[]) {
  let rolled = 0;
  let chosen = 0;
  return {
    nextBasisPoints: () => (outcomes[rolled++] === "success" ? 0 : 9_999),
    nextUnit: () => {
      while (outcomes[chosen] === "success") chosen += 1;
      return ((outcomes[chosen++] as number) + 0.5) / 2;
    },
  };
}

/** Totals by item, whatever the stack split. */
function carriedAfter(
  start: StackState<string>[],
  resolved: ReturnType<typeof resolveRefining<string>>,
) {
  const totals: Record<string, number> = {};
  const updated = new Map(resolved.stackUpdates.map((update) => [update.id, update.quantity]));
  const deleted = new Set(resolved.deletedStackIds);
  for (const stack of start) {
    if (deleted.has(stack.id)) continue;
    totals[stack.itemId] = (totals[stack.itemId] ?? 0) + (updated.get(stack.id) ?? stack.quantity);
  }
  for (const created of resolved.createdStacks) {
    totals[created.itemId] = (totals[created.itemId] ?? 0) + created.quantity;
  }
  return totals;
}

const ORDINARY_REFINING_SHORTAGES = [
  "insufficient_inputs",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
];

describe("the shared bounded-run selection rule", () => {
  it("defaults to one and never steps below one", () => {
    expect(BOUNDED_RUN_DEFAULT_QUANTITY).toBe(1);
    expect(BOUNDED_RUN_MINIMUM_QUANTITY).toBe(1);
    expect(stepBoundedRunSelection(1, -1, 5)).toBe(1);
    expect(stepBoundedRunSelection(3, -1, 5)).toBe(2);
  });

  it("never steps a number above what the inputs carried pay for", () => {
    expect(stepBoundedRunSelection(4, 1, 5)).toBe(5);
    expect(stepBoundedRunSelection(5, 1, 5)).toBe(5);
    // A number left above a shrunken count steps back inside it.
    expect(stepBoundedRunSelection(9, 1, 5)).toBe(5);
    // With nothing affordable the selector rests at one.
    expect(stepBoundedRunSelection(1, 1, 0)).toBe(1);
  });

  it("treats Max as its own choice: − leaves it for the largest number, + keeps it", () => {
    expect(stepBoundedRunSelection(BOUNDED_RUN_MAX, -1, 5)).toBe(5);
    expect(stepBoundedRunSelection(BOUNDED_RUN_MAX, 1, 5)).toBe(BOUNDED_RUN_MAX);
    // + never turns a number into Max.
    expect(stepBoundedRunSelection(5, 1, 5)).toBe(5);
  });

  it("accepts any whole number up to what the inputs pay for, and Max", () => {
    expect(checkBoundedRunSelection(1, 5)).toEqual({ ok: true, selection: 1 });
    expect(checkBoundedRunSelection(5, 5)).toEqual({ ok: true, selection: 5 });
    expect(checkBoundedRunSelection(BOUNDED_RUN_MAX, 1)).toEqual({
      ok: true,
      selection: BOUNDED_RUN_MAX,
    });
  });

  it("refuses a stale number rather than reducing it", () => {
    expect(checkBoundedRunSelection(6, 5)).toEqual({
      ok: false,
      reason: "exceeds_affordable",
      affordable: 5,
    });
    // Nothing affordable refuses a number and Max alike.
    for (const selection of [1, BOUNDED_RUN_MAX] as const) {
      expect(checkBoundedRunSelection(selection, 0)).toEqual({
        ok: false,
        reason: "unavailable",
        affordable: 0,
      });
    }
  });

  it("refuses forged selections outright", () => {
    for (const forged of [0, -1, 1.5, Number.NaN, BOUNDED_RUN_QUANTITY_CEILING + 1]) {
      expect(checkBoundedRunSelection(forged, 5)).toMatchObject({
        ok: false,
        reason: "invalid_quantity",
      });
      expect(BoundedRunSelectionSchema.safeParse(forged).success).toBe(false);
    }
    for (const forged of ["MAX", "all", "", null, "5"]) {
      expect(BoundedRunSelectionSchema.safeParse(forged).success).toBe(false);
    }
    expect(BoundedRunSelectionSchema.safeParse(BOUNDED_RUN_MAX).success).toBe(true);
  });

  it("makes the selection part of both Start requests", () => {
    const characterId = "0e9f5b2a-4c1d-4e8a-9b6f-2d3c4e5f6a7b";
    const recipeActionId = ACTION_IDS.refining;
    expect(StartRefiningRequestSchema.safeParse({ characterId, recipeActionId }).success).toBe(
      false,
    );
    for (const quantity of [3, BOUNDED_RUN_MAX]) {
      expect(
        StartRefiningRequestSchema.safeParse({ characterId, recipeActionId, quantity }).success,
      ).toBe(true);
      expect(StartPracticeRequestSchema.safeParse({ characterId, quantity }).success).toBe(true);
    }
  });

  it("allows a number what is left of it, and Max only the internal safety ceiling", () => {
    expect(boundedRunAllowance(5, 2)).toEqual({ remaining: 3, exhaustedReason: "run_completed" });
    expect(boundedRunAllowance(5, 7)).toEqual({ remaining: 0, exhaustedReason: "run_completed" });
    expect(boundedRunAllowance(BOUNDED_RUN_MAX, 3)).toEqual({
      remaining: BOUNDED_RUN_QUANTITY_CEILING - 3,
      exhaustedReason: "run_safety_limit",
    });
  });

  it("stores Max as a distinct durable mode, not as a number", () => {
    expect(boundedRunSelectionToColumn(BOUNDED_RUN_MAX)).toBeNull();
    expect(boundedRunSelectionToColumn(4)).toBe(4);
    expect(boundedRunSelectionFromColumn(null)).toBe(BOUNDED_RUN_MAX);
    expect(boundedRunSelectionFromColumn(4)).toBe(4);
  });

  it("reports progress with a denominator only for a number", () => {
    expect(boundedRunProgress(5, 2)).toEqual({
      mode: "count",
      selected: 5,
      completed: 2,
      remaining: 3,
    });
    expect(boundedRunProgress(5, 7)).toEqual({
      mode: "count",
      selected: 5,
      completed: 5,
      remaining: 0,
    });
    expect(boundedRunProgress(BOUNDED_RUN_MAX, 3)).toEqual({ mode: "max", completed: 3 });
  });
});

describe("numeric Refining runs", () => {
  it("attempts exactly the selected count and stops with run_completed", () => {
    const resolved = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 10])),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: count(3),
    });
    expect(resolved.attempts).toBe(3);
    expect(resolved.stopReason).toBe("run_completed");
    expect(resolved.consumedTicks).toBe(3 * refinedFerrite.attemptDurationTicks);
    expect(resolved.inputsConsumed).toEqual({ [ITEM_IDS.ferriteShale]: 6 });
  });

  it("counts a failed attempt toward the selection exactly like a success", () => {
    const rolls = [0, 9_999, 9_999, 0];
    let index = 0;
    const resolved = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 10]), {
        refiningLevel: 1,
      }),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => rolls[index++]! },
      allowance: count(3),
    });
    expect(resolved.attempts).toBe(3);
    expect(resolved.successes).toBe(1);
    expect(resolved.failures).toBe(2);
    // Per-attempt XP is exactly the shipped values: 15 on success, 3 on failure.
    expect(resolved.awardedXp).toBe(15 + 3 + 3);
    expect(resolved.outputsGained).toEqual({
      [ITEM_IDS.refinedFerrite]: 1,
      [ITEM_IDS.slag]: 2,
    });
    expect(resolved.stopReason).toBe("run_completed");
  });

  it("an exhausted selection writes nothing and reports completion, not a shortage", () => {
    const resolved = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: 100,
      snapshot: snapshot([]),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: count(0),
    });
    expect(resolved.attempts).toBe(0);
    expect(resolved.stopReason).toBe("run_completed");
    expect(resolved.stackUpdates).toEqual([]);
  });

  it("keeps the existing stop reason when inputs run out before the selection", () => {
    const resolved = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 5])),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: count(10),
    });
    expect(resolved.attempts).toBe(2);
    expect(resolved.stopReason).toBe("insufficient_inputs");
  });

  it("keeps the existing stop reason when capacity runs out before the selection", () => {
    // Every slot taken, the only Refined Ferrite stack full: nothing fits.
    const resolved = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.refinedFerrite, 5]), {
        slotsAvailable: 0,
      }),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: count(3),
    });
    expect(resolved.attempts).toBe(0);
    expect(resolved.stopReason).toBe("inventory_slots_full");
  });

  it("rejects a negative or fractional allowance", () => {
    for (const remaining of [-1, 1.5]) {
      expect(() =>
        resolveRefining({
          autoDiscardSlag: false,
          elapsedTicks: 0,
          snapshot: snapshot([]),
          balance,
          recipe: refinedFerrite,
          random: { nextBasisPoints: () => 0 },
          allowance: { remaining, exhaustedReason: "run_completed" },
        }),
      ).toThrow(RangeError);
    }
  });
});

describe("Max Refining runs: until blocked, from the real results", () => {
  // Four Refined Ferrite and four Galvanic Stock pay for four pours, with room
  // to spare. At Refining 8 a pour can fail and hand one input back.
  const alloyStart = stacks([ITEM_IDS.refinedFerrite, 4], [ITEM_IDS.galvanicStock, 4]);
  const alloy = snapshot(alloyStart, { refiningLevel: 8 });
  const runAlloy = (outcomes: readonly ("success" | number)[]) =>
    resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: galvaferrite.attemptDurationTicks * 50,
      snapshot: alloy,
      balance,
      recipe: galvaferrite,
      random: scripted(outcomes),
      allowance: max,
    });

  it("the affordable count is what the inputs pay for, not a prediction", () => {
    expect(refiningAffordableBatches(alloy, balance, galvaferrite)).toBe(4);
    // Twenty of each is twenty pours — not the 39 a chain of failures could reach.
    expect(
      refiningAffordableBatches(
        snapshot(
          stacks(
            ...Array.from({ length: 4 }, () => [ITEM_IDS.refinedFerrite, 5] as [string, number]),
            ...Array.from({ length: 4 }, () => [ITEM_IDS.galvanicStock, 5] as [string, number]),
          ),
          { refiningLevel: 8 },
        ),
        balance,
        galvaferrite,
      ),
    ).toBe(20);
  });

  it("successes consume both inputs, so all-success stops at the inputs carried", () => {
    const ran = runAlloy(["success", "success", "success", "success", "success"]);
    expect(ran.attempts).toBe(4);
    expect(ran.successes).toBe(4);
    expect(ran.stopReason).toBe("insufficient_inputs");
    expect(carriedAfter(alloyStart, ran)).toEqual({ [ITEM_IDS.galvaferrite]: 4 });
  });

  it("a failure's returned input is used naturally, extending the run", () => {
    // Each failure alternates which input comes back, so each spends only one
    // unit and the run keeps going on what the real results left.
    const ran = runAlloy([0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(ran.attempts).toBe(7);
    expect(ran.failures).toBe(7);
    expect(ran.stopReason).toBe("insufficient_inputs");
    expect(carriedAfter(alloyStart, ran)).toEqual({ [ITEM_IDS.refinedFerrite]: 1 });
  });

  it("the same start runs a different number of attempts under different rolls", () => {
    const sequences: ("success" | number)[][] = [
      ["success", "success", "success", "success"],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [0, 0, 0, 0, 0],
      ["success", 1, "success", 0, 1, 0],
    ];
    const totals = sequences.map((outcomes) => runAlloy(outcomes).attempts);
    // All successes, alternating returns, always the same return, a mix.
    expect(totals).toEqual([4, 7, 4, 5]);
  });

  it("never reports run_completed: it ends with the ordinary reason", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      let state = seed;
      const next = () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
      };
      const ran = resolveRefining({
        autoDiscardSlag: false,
        elapsedTicks: galvaferrite.attemptDurationTicks * 50,
        snapshot: alloy,
        balance,
        recipe: galvaferrite,
        random: { nextBasisPoints: () => Math.floor(next() * 10_000), nextUnit: next },
        allowance: max,
      });
      expect(ORDINARY_REFINING_SHORTAGES).toContain(ran.stopReason);
      expect(ran.attempts).toBeGreaterThanOrEqual(4);
    }
  });

  it("at certain success runs until its real inputs are spent", () => {
    const ran = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 7])),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 9_999 },
      allowance: max,
    });
    expect(refiningSuccessChanceBps(30, refinedFerrite)).toBe(10_000);
    expect(ran.attempts).toBe(8);
    expect(ran.successes).toBe(8);
    expect(ran.stopReason).toBe("insufficient_inputs");
  });

  it("at certain success runs until its real capacity is spent", () => {
    // The Refined Ferrite stack has room for two and no slot is free: two
    // batches fill it, and the third has nowhere to go.
    const ran = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(
        stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.refinedFerrite, 3], [ITEM_IDS.slag, 5]),
        { slotsAvailable: 0 },
      ),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: max,
    });
    expect(ran.attempts).toBe(2);
    expect(ran.stopReason).toBe("inventory_slots_full");
  });

  it("runs each deliberate Slag recipe until its real inputs are spent", () => {
    for (const [candidate, input] of [
      [ferriteShaleSlag, ITEM_IDS.ferriteShale],
      [galvaniteSlag, ITEM_IDS.galvanite],
    ] as const) {
      const ran = resolveRefining({
        autoDiscardSlag: false,
        elapsedTicks: candidate.attemptDurationTicks * 50,
        snapshot: snapshot(stacks([input, 10], [input, 7]), { refiningLevel: 5 }),
        balance,
        recipe: candidate,
        random: { nextBasisPoints: () => 9_999, nextUnit: () => 0.99 },
        allowance: max,
      });
      expect(ran.attempts).toBe(8);
      expect(ran.failures).toBe(0);
      expect(ran.stopReason).toBe("insufficient_inputs");
    }
  });

  it("stops at the internal safety ceiling with its own reason, never as completion", () => {
    // Plenty of Shale: only the guard can end these.
    const plenty = snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 10]));
    const nearly = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: plenty,
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: boundedRunAllowance(BOUNDED_RUN_MAX, BOUNDED_RUN_QUANTITY_CEILING - 2),
    });
    expect(nearly.attempts).toBe(2);
    expect(nearly.stopReason).toBe("run_safety_limit");
    const reached = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: plenty,
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: boundedRunAllowance(BOUNDED_RUN_MAX, BOUNDED_RUN_QUANTITY_CEILING),
    });
    expect(reached.attempts).toBe(0);
    expect(reached.stopReason).toBe("run_safety_limit");
    expect(reached.stackUpdates).toEqual([]);
  });
});

describe("the Refining affordable batch count", () => {
  it("is whole batches of the recipe's inputs", () => {
    const at = (quantity: number) =>
      refiningAffordableBatches(
        snapshot(stacks([ITEM_IDS.ferriteShale, quantity])),
        balance,
        refinedFerrite,
      );
    expect(at(10)).toBe(5);
    expect(at(9)).toBe(4);
    expect(at(1)).toBe(0);
  });

  it("is zero for a recipe the character's level does not unlock", () => {
    expect(
      refiningAffordableBatches(
        snapshot(stacks([ITEM_IDS.ferriteShale, 10]), { refiningLevel: 4 }),
        balance,
        ferriteShaleSlag,
      ),
    ).toBe(0);
  });

  it("is bounded by the scarcer input of a two-input recipe", () => {
    expect(
      refiningAffordableBatches(
        snapshot(stacks([ITEM_IDS.refinedFerrite, 5], [ITEM_IDS.galvanicStock, 2]), {
          refiningLevel: 8,
        }),
        balance,
        galvaferrite,
      ),
    ).toBe(2);
  });

  it("does not fall as the Refining level rises", () => {
    const inventory = stacks([ITEM_IDS.refinedFerrite, 5], [ITEM_IDS.galvanicStock, 5]);
    const counts = [8, 12, 20, 30, 99].map((refiningLevel) =>
      refiningAffordableBatches(snapshot(inventory, { refiningLevel }), balance, galvaferrite),
    );
    expect(new Set(counts)).toEqual(new Set([5]));
  });
});

describe("the deliberate Slag recipes (#229)", () => {
  const slagRecipes: readonly RefiningRecipeBalance[] = [ferriteShaleSlag, galvaniteSlag];

  it("authors the exact settled values", () => {
    expect(ferriteShaleSlag).toMatchObject({
      outputItemId: ITEM_IDS.slag,
      outputQuantity: 1,
      minimumLevel: 5,
      attemptDurationTicks: 6,
      successXp: 3,
      inputs: [{ itemId: ITEM_IDS.ferriteShale, quantity: 2 }],
    });
    expect(galvaniteSlag).toMatchObject({
      outputItemId: ITEM_IDS.slag,
      outputQuantity: 2,
      minimumLevel: 5,
      attemptDurationTicks: 8,
      successXp: 5,
      inputs: [{ itemId: ITEM_IDS.galvanite, quantity: 2 }],
    });
    // 6 ticks is 3.6 seconds and 8 ticks is 4.8 seconds on the 600 ms tick.
    expect(ferriteShaleSlag.attemptDurationTicks * 600).toBe(3_600);
    expect(galvaniteSlag.attemptDurationTicks * 600).toBe(4_800);
  });

  it("are the only deterministic recipes; every productive recipe still rolls", () => {
    expect(
      refiningRecipes(balance)
        .filter((candidate) => refiningRecipeIsDeterministic(candidate))
        .map((candidate) => candidate.actionId),
    ).toEqual([ACTION_IDS.ferriteShaleSlagRefining, ACTION_IDS.galvaniteSlagRefining]);
  });

  it("unlock only at Refining 5", () => {
    for (const candidate of slagRecipes) {
      expect(refiningRecipeUnlocked(4, candidate)).toBe(false);
      expect(refiningRecipeUnlocked(5, candidate)).toBe(true);
    }
  });

  it("have no failure outcome and a certain success at every level", () => {
    for (const candidate of slagRecipes) {
      expect(refiningAwardFacts(balance, candidate).failureOutcomes).toEqual([]);
      for (const level of [5, 6, 30, 99]) {
        expect(refiningSuccessChanceBps(level, candidate)).toBe(10_000);
      }
    }
  });

  it("never consult the random source and always produce their Slag", () => {
    const cases = [
      { candidate: ferriteShaleSlag, input: ITEM_IDS.ferriteShale, slagPerBatch: 1, xp: 3 },
      { candidate: galvaniteSlag, input: ITEM_IDS.galvanite, slagPerBatch: 2, xp: 5 },
    ];
    for (const { candidate, input, slagPerBatch, xp } of cases) {
      let rolled = 0;
      const resolved = resolveRefining({
        autoDiscardSlag: false,
        elapsedTicks: candidate.attemptDurationTicks * 4,
        snapshot: snapshot(stacks([input, 10]), { refiningLevel: 5 }),
        balance,
        recipe: candidate,
        random: {
          nextBasisPoints: () => {
            rolled += 1;
            return 9_999;
          },
          nextUnit: () => {
            rolled += 1;
            return 0.99;
          },
        },
        allowance: count(4),
      });
      expect(rolled).toBe(0);
      expect(resolved.successes).toBe(4);
      expect(resolved.failures).toBe(0);
      expect(resolved.inputsConsumed).toEqual({ [input]: 8 });
      expect(resolved.outputsGained).toEqual({ [ITEM_IDS.slag]: 4 * slagPerBatch });
      expect(resolved.awardedXp).toBe(4 * xp);
      expect(resolved.consumedTicks).toBe(4 * candidate.attemptDurationTicks);
      expect(resolved.resolvedAttempts.every((attempt) => attempt.deterministic)).toBe(true);
      expect(resolved.stopReason).toBe("run_completed");
    }
  });

  it("leave a rolled recipe's attempts unmarked", () => {
    const resolved = resolveRefining({
      autoDiscardSlag: false,
      elapsedTicks: refinedFerrite.attemptDurationTicks,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 2])),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      allowance: count(1),
    });
    expect(resolved.resolvedAttempts[0]!.deterministic).toBeUndefined();
  });
});
