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
  boundedRunProgress,
  checkBoundedRunQuantity,
  stepBoundedRunQuantity,
} from "@/game/domain/bounded-run";
import type { StackState } from "@/game/domain/inventory";
import {
  refiningAwardFacts,
  refiningPreflightStopReason,
  refiningRecipeUnlocked,
  refiningRunMaximum,
  refiningSuccessChanceBps,
  resolveRefining,
  type RefiningSnapshot,
} from "@/game/domain/refining";
import { BoundedRunQuantitySchema, StartRefiningRequestSchema } from "@/game/schemas/gameplay";

const balance = getEffectiveGameBalance();
const recipe = (actionId: string) => refiningRecipeForActionId(actionId, balance)!;
const refinedFerrite = recipe(ACTION_IDS.refining);
const galvaferrite = recipe(ACTION_IDS.galvaferriteRefining);
const ferriteShaleSlag = recipe(ACTION_IDS.ferriteShaleSlagRefining);
const galvaniteSlag = recipe(ACTION_IDS.galvaniteSlagRefining);

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

/** A seeded roll stream, so a property run is reproducible. */
function seededRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  return { nextBasisPoints: () => Math.floor(next() * 10_000), nextUnit: next };
}

/**
 * One scripted outcome per attempt: `"success"`, or the index of the failure
 * branch that comes back. The script drives the real resolver, so a sequence is
 * reachable exactly when the resolver can play it out.
 */
type ScriptedOutcome = "success" | number;

function scriptedRandom(outcomes: readonly ScriptedOutcome[], failureBranches: number) {
  let rolled = 0;
  let chosen = 0;
  return {
    nextBasisPoints: () => (outcomes[rolled++] === "success" ? 0 : 9_999),
    nextUnit: () => {
      while (outcomes[chosen] === "success") chosen += 1;
      const branch = outcomes[chosen++] as number;
      return (branch + 0.5) / failureBranches;
    },
  };
}

function runScripted(
  start: RefiningSnapshot<string>,
  candidate: RefiningRecipeBalance,
  outcomes: readonly ScriptedOutcome[],
  attemptLimit: number,
) {
  return resolveRefining({
    elapsedTicks: candidate.attemptDurationTicks * (attemptLimit + 5),
    snapshot: start,
    balance,
    recipe: candidate,
    random: scriptedRandom(outcomes, refiningAwardFacts(balance, candidate).failureOutcomes.length),
    attemptLimit,
  });
}

/**
 * The longest outcome sequence the real resolver can play out, found by trying
 * every sequence — an independent check on `refiningRunMaximum`'s search.
 */
function longestScriptedRun(start: RefiningSnapshot<string>, candidate: RefiningRecipeBalance) {
  const failures = refiningAwardFacts(balance, candidate).failureOutcomes.length;
  const choices: ScriptedOutcome[] = [
    "success",
    ...Array.from({ length: failures }, (_, index) => index),
  ];
  const extend = (prefix: readonly ScriptedOutcome[]): number => {
    let longest = prefix.length;
    for (const choice of choices) {
      const next = [...prefix, choice];
      if (runScripted(start, candidate, next, next.length).attempts === next.length) {
        longest = Math.max(longest, extend(next));
      }
    }
    return longest;
  };
  return extend([]);
}

const ORDINARY_REFINING_SHORTAGES = [
  "insufficient_inputs",
  "inventory_slots_full",
  "carried_mass_capacity_reached",
];

describe("the shared bounded-run quantity rule", () => {
  it("defaults to one and never steps below one", () => {
    expect(BOUNDED_RUN_DEFAULT_QUANTITY).toBe(1);
    expect(BOUNDED_RUN_MINIMUM_QUANTITY).toBe(1);
    expect(stepBoundedRunQuantity(1, -1, 5)).toBe(1);
    expect(stepBoundedRunQuantity(3, -1, 5)).toBe(2);
  });

  it("never steps above the authoritative maximum", () => {
    expect(stepBoundedRunQuantity(4, 1, 5)).toBe(5);
    expect(stepBoundedRunQuantity(5, 1, 5)).toBe(5);
    // A selection left above a shrunken maximum steps back inside it.
    expect(stepBoundedRunQuantity(9, 1, 5)).toBe(5);
    // With nothing available the selector rests at one.
    expect(stepBoundedRunQuantity(1, 1, 0)).toBe(1);
  });

  it("accepts any whole quantity from one to the current maximum", () => {
    expect(checkBoundedRunQuantity(1, 5)).toEqual({ ok: true, quantity: 1 });
    expect(checkBoundedRunQuantity(5, 5)).toEqual({ ok: true, quantity: 5 });
  });

  it("refuses an excess quantity rather than reducing it", () => {
    expect(checkBoundedRunQuantity(6, 5)).toEqual({
      ok: false,
      reason: "exceeds_maximum",
      maximum: 5,
    });
    expect(checkBoundedRunQuantity(1, 0)).toEqual({ ok: false, reason: "unavailable", maximum: 0 });
  });

  it("refuses forged quantities outright", () => {
    for (const forged of [0, -1, 1.5, Number.NaN, BOUNDED_RUN_QUANTITY_CEILING + 1]) {
      expect(checkBoundedRunQuantity(forged, 5)).toMatchObject({
        ok: false,
        reason: "invalid_quantity",
      });
      expect(BoundedRunQuantitySchema.safeParse(forged).success).toBe(false);
    }
  });

  it("makes quantity part of the Start Refining request itself", () => {
    const characterId = "0e9f5b2a-4c1d-4e8a-9b6f-2d3c4e5f6a7b";
    const recipeActionId = ACTION_IDS.refining;
    expect(StartRefiningRequestSchema.safeParse({ characterId, recipeActionId }).success).toBe(
      false,
    );
    expect(
      StartRefiningRequestSchema.safeParse({ characterId, recipeActionId, quantity: 3 }).success,
    ).toBe(true);
  });

  it("reports selected, completed and remaining for the active-run line", () => {
    expect(boundedRunProgress(5, 2)).toEqual({ selected: 5, completed: 2, remaining: 3 });
    expect(boundedRunProgress(5, 7)).toEqual({ selected: 5, completed: 5, remaining: 0 });
  });
});

describe("bounded Refining runs", () => {
  it("attempts exactly the selected count and stops with run_completed", () => {
    const resolved = resolveRefining({
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 10])),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      attemptLimit: 3,
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
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 10]), {
        refiningLevel: 1,
      }),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => rolls[index++]! },
      attemptLimit: 3,
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
      elapsedTicks: 100,
      snapshot: snapshot([]),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      attemptLimit: 0,
    });
    expect(resolved.attempts).toBe(0);
    expect(resolved.stopReason).toBe("run_completed");
    expect(resolved.stackUpdates).toEqual([]);
  });

  it("keeps the existing stop reason when inputs run out before the selection", () => {
    const resolved = resolveRefining({
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 5])),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      attemptLimit: 10,
    });
    expect(resolved.attempts).toBe(2);
    expect(resolved.stopReason).toBe("insufficient_inputs");
  });

  it("keeps the existing stop reason when capacity runs out before the selection", () => {
    // Every slot taken, the only Refined Ferrite stack full: nothing fits.
    const resolved = resolveRefining({
      elapsedTicks: refinedFerrite.attemptDurationTicks * 50,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.refinedFerrite, 5]), {
        slotsAvailable: 0,
      }),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      attemptLimit: 3,
    });
    expect(resolved.attempts).toBe(0);
    expect(resolved.stopReason).toBe("inventory_slots_full");
  });

  it("rejects a negative or fractional attempt limit", () => {
    for (const attemptLimit of [-1, 1.5]) {
      expect(() =>
        resolveRefining({
          elapsedTicks: 0,
          snapshot: snapshot([]),
          balance,
          recipe: refinedFerrite,
          random: { nextBasisPoints: () => 0 },
          attemptLimit,
        }),
      ).toThrow(RangeError);
    }
  });
});

describe("the Refining run maximum", () => {
  it("is limited by inputs: whole batches of the recipe's inputs", () => {
    expect(
      refiningRunMaximum(snapshot(stacks([ITEM_IDS.ferriteShale, 10])), balance, refinedFerrite),
    ).toBe(5);
    expect(
      refiningRunMaximum(snapshot(stacks([ITEM_IDS.ferriteShale, 9])), balance, refinedFerrite),
    ).toBe(4);
    expect(
      refiningRunMaximum(snapshot(stacks([ITEM_IDS.ferriteShale, 1])), balance, refinedFerrite),
    ).toBe(0);
  });

  it("is zero for a recipe the character's level does not unlock", () => {
    expect(
      refiningRunMaximum(
        snapshot(stacks([ITEM_IDS.ferriteShale, 10]), { refiningLevel: 4 }),
        balance,
        ferriteShaleSlag,
      ),
    ).toBe(0);
  });

  it("is limited by capacity through the ordinary preflight", () => {
    // No free slot and no stack to top up: the first attempt would need a new
    // slot for its output, and taking two of four Shale empties nothing.
    const blocked = snapshot(stacks([ITEM_IDS.ferriteShale, 4]), { slotsAvailable: 0 });
    expect(refiningRunMaximum(blocked, balance, refinedFerrite)).toBe(0);
    expect(refiningPreflightStopReason(blocked, balance, refinedFerrite)).toBe(
      "inventory_slots_full",
    );
    // Two Shale in their own stack free that slot for the output: one batch.
    const freeing = snapshot(stacks([ITEM_IDS.ferriteShale, 2]), { slotsAvailable: 0 });
    expect(refiningRunMaximum(freeing, balance, refinedFerrite)).toBe(1);
  });

  it("is limited by carried mass through the ordinary preflight", () => {
    // Galvanite -> Slag loses 500 g per batch, so mass only ever frees up; a
    // character with no spare mass can still start, because the inputs leave.
    const heavy = snapshot(stacks([ITEM_IDS.galvanite, 4]), { massAvailableGrams: 0 });
    expect(refiningRunMaximum(heavy, balance, galvaniteSlag)).toBe(2);
  });

  describe("is the longest reachable run, not the shortest guaranteed one", () => {
    // No free slot, and ten Shale in one stack, so no batch frees a slot until
    // the last. Refined Ferrite has room for two more and Slag for two more,
    // and every preflight needs room for both. Two successes (or two failures)
    // in a row leave no room for the next; alternating reaches three.
    const tight = snapshot(
      stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.refinedFerrite, 3], [ITEM_IDS.slag, 8]),
      { refiningLevel: 8, slotsAvailable: 0 },
    );

    it("selects the longest path the outcomes allow", () => {
      expect(refiningRunMaximum(tight, balance, refinedFerrite)).toBe(3);
      expect(longestScriptedRun(tight, refinedFerrite)).toBe(3);
    });

    it("a favorable sequence reaches the selected Max and completes", () => {
      const ran = runScripted(tight, refinedFerrite, ["success", 0, "success"], 3);
      expect(ran.attempts).toBe(3);
      expect(ran.successes).toBe(2);
      expect(ran.failures).toBe(1);
      expect(ran.stopReason).toBe("run_completed");
    });

    it("an unfavorable sequence stops early with the ordinary reason", () => {
      for (const outcomes of [
        ["success", "success"],
        [0, 0],
      ] satisfies ScriptedOutcome[][]) {
        const ran = runScripted(tight, refinedFerrite, outcomes, 3);
        expect(ran.attempts).toBe(2);
        expect(ran.stopReason).toBe("inventory_slots_full");
        // Nothing beyond what the two real attempts produced is awarded.
        expect(ran.resolvedAttempts).toHaveLength(2);
      }
    });
  });

  it("matches an exhaustive search of real outcome sequences", () => {
    // Tight inventories where success and failure outputs compete for slots.
    // The oracle tries every sequence, so the fixtures keep runs short.
    const cases: [RefiningRecipeBalance, StackState<string>[]][] = [
      [refinedFerrite, stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 7])],
      [
        refinedFerrite,
        stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.refinedFerrite, 4], [ITEM_IDS.slag, 9]),
      ],
      [
        refinedFerrite,
        stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.refinedFerrite, 3], [ITEM_IDS.slag, 8]),
      ],
      [
        galvaferrite,
        stacks(
          [ITEM_IDS.refinedFerrite, 3],
          [ITEM_IDS.galvanicStock, 2],
          [ITEM_IDS.galvaferrite, 2],
        ),
      ],
      [
        galvaferrite,
        stacks(
          [ITEM_IDS.refinedFerrite, 2],
          [ITEM_IDS.refinedFerrite, 1],
          [ITEM_IDS.galvanicStock, 3],
          [ITEM_IDS.galvaferrite, 3],
        ),
      ],
    ];
    let cutShort = false;
    for (const [candidate, existing] of cases) {
      for (const tight of [0, 1, 2]) {
        const start = snapshot(existing, { refiningLevel: 8, slotsAvailable: tight });
        const maximum = refiningRunMaximum(start, balance, candidate);
        expect(maximum).toBe(longestScriptedRun(start, candidate));

        // Any real run of Max attempts at most Max, and a run cut short by its
        // own rolls keeps the ordinary reason rather than completing.
        for (let seed = 1; seed <= 40; seed += 1) {
          const resolved = resolveRefining({
            elapsedTicks: candidate.attemptDurationTicks * (maximum + 5),
            snapshot: start,
            balance,
            recipe: candidate,
            random: seededRandom(seed),
            attemptLimit: maximum,
          });
          expect(resolved.attempts).toBeLessThanOrEqual(maximum);
          if (resolved.attempts === maximum) {
            expect(resolved.stopReason).toBe("run_completed");
          } else {
            cutShort = true;
            expect(ORDINARY_REFINING_SHORTAGES).toContain(resolved.stopReason);
          }
        }
      }
    }
    // The fixtures include inventories where real rolls end a run of Max early.
    expect(cutShort).toBe(true);
  });

  it("stays fast when a long rolled run could interleave outcomes many ways", () => {
    // Keyed on stack order, these took seconds (#229 review): every
    // success/failure interleaving was a distinct state. The same inventory is
    // the same state however it was reached.
    const cases: [RefiningRecipeBalance, string, number, number][] = [
      [refinedFerrite, ITEM_IDS.ferriteShale, 14, 1],
      [recipe(ACTION_IDS.galvanicStockRefining), ITEM_IDS.galvanite, 12, 5],
    ];
    for (const [candidate, input, stackCount, level] of cases) {
      const full = snapshot(
        stacks(...Array.from({ length: stackCount }, (): [string, number] => [input, 10])),
        { refiningLevel: level, slotsAvailable: 16 - stackCount, massAvailableGrams: 100_000 },
      );
      const started = performance.now();
      const maximum = refiningRunMaximum(full, balance, candidate);
      expect(performance.now() - started).toBeLessThan(500);
      // Enough room for any mix of outputs: inputs are the only bound.
      expect(maximum).toBe((stackCount * 10) / 2);
    }
  });

  it("explores only the success branch once success is guaranteed", () => {
    // Every attempt's preflight still requires a failure's Slag to fit, but at
    // Refining 99 no failure can actually happen, so the Slag it would have
    // left behind must not lower the maximum. The real run does all five.
    const tight = snapshot(
      stacks(
        [ITEM_IDS.galvanite, 10],
        [ITEM_IDS.galvaferrite, 3],
        [ITEM_IDS.slag, 5],
        [ITEM_IDS.refinedFerrite, 3],
      ),
      { refiningLevel: 99, slotsAvailable: 1, massAvailableGrams: 3_000 },
    );
    const galvanicStock = recipe(ACTION_IDS.galvanicStockRefining);
    expect(refiningRunMaximum(tight, balance, galvanicStock)).toBe(5);
    const ran = resolveRefining({
      elapsedTicks: galvanicStock.attemptDurationTicks * 20,
      snapshot: tight,
      balance,
      recipe: galvanicStock,
      random: { nextBasisPoints: () => 9_999 },
      attemptLimit: 5,
    });
    expect(ran.attempts).toBe(5);
    expect(ran.stopReason).toBe("run_completed");
    // Where failure is possible, all successes still reach five, so Max stays
    // five — but failures fill the Slag stack and can end that run early.
    const rolled = { ...tight, refiningLevel: 5 };
    expect(refiningRunMaximum(rolled, balance, galvanicStock)).toBe(5);
    expect(longestScriptedRun(rolled, galvanicStock)).toBe(5);
    const unlucky = runScripted(rolled, galvanicStock, [0, 0, 0, 0, 0], 5);
    expect(unlucky.attempts).toBeLessThan(5);
    expect(ORDINARY_REFINING_SHORTAGES).toContain(unlucky.stopReason);
  });

  it("is the plain supportable count once success is certain", () => {
    // Refining 30 is certain success for Refined Ferrite: no failure is
    // explored, so with room for the output Max is just whole batches of
    // carried Shale, and any rolls complete it.
    const certain = snapshot(stacks([ITEM_IDS.ferriteShale, 10], [ITEM_IDS.ferriteShale, 7]), {
      refiningLevel: 30,
    });
    expect(refiningSuccessChanceBps(30, refinedFerrite)).toBe(10_000);
    expect(refiningRunMaximum(certain, balance, refinedFerrite)).toBe(8);
    for (let seed = 1; seed <= 10; seed += 1) {
      const ran = resolveRefining({
        elapsedTicks: refinedFerrite.attemptDurationTicks * 20,
        snapshot: certain,
        balance,
        recipe: refinedFerrite,
        random: seededRandom(seed),
        attemptLimit: 8,
      });
      expect(ran.attempts).toBe(8);
      expect(ran.stopReason).toBe("run_completed");
    }
  });

  it("is deterministic for the deliberate Slag recipes, and every run of Max completes", () => {
    const cases: [RefiningRecipeBalance, string, number][] = [
      [ferriteShaleSlag, ITEM_IDS.ferriteShale, 8],
      [galvaniteSlag, ITEM_IDS.galvanite, 8],
    ];
    for (const [candidate, input, expected] of cases) {
      const start = snapshot(stacks([input, 10], [input, 7]), { refiningLevel: 5 });
      expect(refiningRunMaximum(start, balance, candidate)).toBe(expected);
      for (let seed = 1; seed <= 10; seed += 1) {
        const ran = resolveRefining({
          elapsedTicks: candidate.attemptDurationTicks * 20,
          snapshot: start,
          balance,
          recipe: candidate,
          random: seededRandom(seed),
          attemptLimit: expected,
        });
        expect(ran.attempts).toBe(expected);
        expect(ran.failures).toBe(0);
        expect(ran.stopReason).toBe("run_completed");
      }
    }
  });

  it("stays cheap enough to project on every refresh, even for the alloy", () => {
    // Fourteen slots of the alloy's inputs, with room to spare.
    const full = snapshot(
      stacks(
        ...Array.from({ length: 8 }, (_, index): [string, number] =>
          index % 2 === 0 ? [ITEM_IDS.refinedFerrite, 5] : [ITEM_IDS.galvanicStock, 5],
        ),
      ),
      { refiningLevel: 8, slotsAvailable: 8, massAvailableGrams: 100_000 },
    );
    const started = performance.now();
    const maximum = refiningRunMaximum(full, balance, galvaferrite);
    const elapsed = performance.now() - started;
    // A failed pour hands one input back, so it spends one unit, not two. The
    // longest reachable run is nearly all failures: 40 units, 39 attempts.
    expect(maximum).toBe(39);
    expect(elapsed).toBeLessThan(500);
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
        attemptLimit: 4,
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
      elapsedTicks: refinedFerrite.attemptDurationTicks,
      snapshot: snapshot(stacks([ITEM_IDS.ferriteShale, 2])),
      balance,
      recipe: refinedFerrite,
      random: { nextBasisPoints: () => 0 },
      attemptLimit: 1,
    });
    expect(resolved.resolvedAttempts[0]!.deterministic).toBeUndefined();
  });
});
