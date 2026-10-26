import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  refiningRecipeForActionId,
  refiningRecipes,
} from "@/game/config/balance";
import { ACTION_IDS, LOCAL_PLACE_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { getLocalPlace, getLocalPlacesForLocation } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { BOUNDED_RUN_MAX, boundedRunAllowance } from "@/game/domain/bounded-run";
import { refiningDurationMultiplier, resolveRefiningStation } from "@/game/domain/local-places";
import { refiningSuccessChanceBps, resolveRefining } from "@/game/domain/refining";
import { LocalPlaceDefinitionSchema } from "@/game/schemas/local-places";

describe("issue #381 Refiner-To-Go", () => {
  const REFINER = LOCAL_PLACE_IDS.stillreachRefinerToGo;
  const balance = getEffectiveGameBalance();
  const refiner = () => getLocalPlace(LOCAL_PLACE_IDS.stillreachRefinerToGo)!;

  it("is an open Local Place of the Landing Station beside the terminal, not a World Location", () => {
    expect(refiner().parentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
    expect(refiner().access).toEqual({ kind: "open" });
    expect(
      getLocalPlacesForLocation(LOCATION_IDS.stillreachLandingStation).map((p) => p.id),
    ).toEqual([
      LOCAL_PLACE_IDS.stillreachFuelTerminal,
      LOCAL_PLACE_IDS.stillreachRefinerToGo,
      LOCAL_PLACE_IDS.fedhexStillreachLandingStation,
      LOCAL_PLACE_IDS.milkyWaymoStillreachLandingStation,
    ]);
    expect(getLocation(refiner().id)).toBeUndefined();
    expect(refiner().merchantId).toBeUndefined();
    // Neither the landing ring nor the terminal hosts Refining as an activity.
    expect(getLocation(LOCATION_IDS.stillreachLandingStation)!.availableActionIds).toEqual([]);
    expect(getLocalPlace(LOCAL_PLACE_IDS.stillreachFuelTerminal)!.refiningStation).toBeUndefined();
  });

  it("binds the approved 4:1 scene at its real runtime size", () => {
    const { scene } = refiner().presentation;
    expect(scene).toMatchObject({
      asset: "/location-scenes/refiner-to-go.webp",
      width: 1536,
      height: 384,
    });
    expect(scene.width / scene.height).toBe(4);
    expect(scene.alt).toContain("REFINER-TO-GO");
  });

  it("authors exactly one multiplier of 3 and rejects a nonsense one", () => {
    expect(refiner().refiningStation).toEqual({ attemptDurationMultiplier: 3 });
    for (const attemptDurationMultiplier of [0, 1, 2.5, -3]) {
      expect(
        LocalPlaceDefinitionSchema.safeParse({
          ...refiner(),
          refiningStation: { attemptDurationMultiplier },
        }).success,
      ).toBe(false);
    }
  });

  it("derives the multiplier from the run's venue: 3x at the station, 1x everywhere else", () => {
    expect(refiningDurationMultiplier(LOCAL_PLACE_IDS.stillreachRefinerToGo)).toBe(3);
    expect(refiningDurationMultiplier(null)).toBe(1);
    expect(refiningDurationMultiplier(undefined)).toBe(1);
    expect(refiningDurationMultiplier(LOCAL_PLACE_IDS.stillreachFuelTerminal)).toBe(1);
    expect(refiningDurationMultiplier("no_such_place")).toBe(1);
  });

  it("resolves a station only from its own parent location", () => {
    const station = (locationId: string, localPlaceId: string) =>
      resolveRefiningStation({ locationId, localPlaceId })?.id;
    expect(
      station(LOCATION_IDS.stillreachLandingStation, LOCAL_PLACE_IDS.stillreachRefinerToGo),
    ).toBe(LOCAL_PLACE_IDS.stillreachRefinerToGo);
    expect(
      station(LOCATION_IDS.abandonedProcessingYard, LOCAL_PLACE_IDS.stillreachRefinerToGo),
    ).toBe(undefined);
    expect(station(LOCATION_IDS.windwardTrack, LOCAL_PLACE_IDS.stillreachRefinerToGo)).toBe(
      undefined,
    );
    // A place that hosts something else is not a station.
    expect(
      station(LOCATION_IDS.stillreachLandingStation, LOCAL_PLACE_IDS.stillreachFuelTerminal),
    ).toBe(undefined);
    expect(station(LOCATION_IDS.stillreachLandingStation, "nope")).toBe(undefined);
  });

  it("requires no Mission to operate", () => {
    expect(
      resolveRefiningStation({
        locationId: LOCATION_IDS.stillreachLandingStation,
        localPlaceId: LOCAL_PLACE_IDS.stillreachRefinerToGo,
        completedMissionIds: new Set(),
      }),
    ).toBeDefined();
  });

  describe("3x duration across every authored recipe", () => {
    // The issue's table of canonical -> Stillreach ticks, restated as literals so
    // a drift in either the recipe or the multiplier fails here.
    const table = [
      [ACTION_IDS.refining, 7, 21],
      [ACTION_IDS.galvanicStockRefining, 10, 30],
      [ACTION_IDS.galvaferriteRefining, 12, 36],
      [ACTION_IDS.ferriteShaleSlagRefining, 6, 18],
      [ACTION_IDS.galvaniteSlagRefining, 8, 24],
      [ACTION_IDS.fullSmallFuelCanisterRefining, 60, 180],
    ] as const;

    it("covers every authored recipe, and only those", () => {
      expect(
        refiningRecipes(balance)
          .map((recipe) => recipe.actionId)
          .sort(),
      ).toEqual(table.map(([actionId]) => actionId).sort());
    });

    for (const [actionId, base, stillreach] of table) {
      it(`${actionId}: ${base} ticks at the Yard, ${stillreach} at Refiner-To-Go`, () => {
        const recipe = refiningRecipeForActionId(actionId, balance)!;
        expect(recipe.attemptDurationTicks).toBe(base);
        const attempts = (elapsedTicks: number, attemptDurationMultiplier: number) =>
          resolveRefining({
            elapsedTicks,
            snapshot: {
              refiningLevel: 30,
              existingStacks: recipe.inputs.map((input, index) => ({
                id: `input-${index}`,
                itemId: input.itemId,
                quantity: input.quantity,
              })),
              slotsAvailable: 20,
              massAvailableGrams: 1_000_000,
            },
            balance,
            recipe,
            random: { nextBasisPoints: () => 0, nextUnit: () => 0 },
            allowance: boundedRunAllowance(1, 0),
            autoDiscardSlag: false,
            attemptDurationMultiplier,
          });
        expect(attempts(stillreach - 1, refiningDurationMultiplier(REFINER))).toMatchObject({
          attempts: 0,
          consumedTicks: 0,
        });
        const done = attempts(stillreach, refiningDurationMultiplier(REFINER));
        expect(done.attempts).toBe(1);
        expect(done.consumedTicks).toBe(stillreach);
        expect(done.resolvedAttempts[0]!.durationTicks).toBe(stillreach);
        // The Yard is untouched: the same attempt completes at the base duration.
        expect(attempts(base, 1).resolvedAttempts[0]!.durationTicks).toBe(base);
        // Same award at either rate: duration is the only thing that moved.
        expect(done.awardedXp).toBe(attempts(base, 1).awardedXp);
        expect(done.outputsGained).toEqual(attempts(base, 1).outputsGained);
      });
    }
  });

  it("scales only duration: the same attempt, chance and XP, and a 3x run needs 3x the time", () => {
    const fuel = refiningRecipes(balance).find((recipe) => recipe.attemptDurationTicks === 60)!;
    // Carried the way a player carries it: Oil Shale and canisters stack five to a slot.
    const carried = (batches: number) =>
      fuel.inputs.flatMap((input, index) =>
        Array.from({ length: input.quantity * batches }, (_, unit) => ({
          id: `s${index}-${unit}`,
          itemId: input.itemId,
          quantity: 1,
        })),
      );
    const run = (elapsedTicks: number, attemptDurationMultiplier?: number) =>
      resolveRefining({
        elapsedTicks,
        snapshot: {
          refiningLevel: 8,
          existingStacks: carried(2),
          slotsAvailable: 20,
          massAvailableGrams: 1_000_000,
        },
        balance,
        recipe: fuel,
        random: { nextBasisPoints: () => 0, nextUnit: () => 0 },
        allowance: boundedRunAllowance(BOUNDED_RUN_MAX, 0),
        autoDiscardSlag: false,
        ...(attemptDurationMultiplier ? { attemptDurationMultiplier } : {}),
      });

    // 1x: the Yard. A 179-tick window holds two 60-tick attempts, not three.
    expect(run(179).attempts).toBe(2);
    // 3x: the same window cannot finish even one 180-tick attempt.
    const early = run(179, 3);
    expect(early.attempts).toBe(0);
    expect(early.consumedTicks).toBe(0);
    // 180 ticks: exactly one attempt, with the same XP a 1x attempt pays.
    const onTime = run(180, 3);
    expect(onTime.attempts).toBe(1);
    expect(onTime.consumedTicks).toBe(180);
    expect(onTime.resolvedAttempts[0]!.durationTicks).toBe(180);
    expect(onTime.awardedXp).toBe(run(60).resolvedAttempts[0]!.xpAwarded);
    expect(onTime.awardedXp).toBe(100);
    // Each further attempt costs its own 180 ticks; no fractional runs.
    expect(run(359, 3).attempts).toBe(1);
    expect(run(360, 3).attempts).toBe(2);
    expect(refiningSuccessChanceBps(8, fuel)).toBe(5_068);
    expect(() => run(10, 0.5)).toThrow(RangeError);
  });
});
