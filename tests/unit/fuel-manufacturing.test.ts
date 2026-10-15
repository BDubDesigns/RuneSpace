import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fabricationRecipeForActionId,
  fabricationRecipes,
  getEffectiveGameBalance,
  getItemDefinition,
  refiningRecipeForActionId,
  refiningRecipes,
  tinkeringTargets,
  type FabricationRecipeBalance,
  type RolledRefiningRecipeBalance,
} from "@/game/config/balance";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS, MERCHANT_IDS } from "@/game/config/foundations";
import { ITEM_CATEGORY_BY_ITEM_ID } from "@/game/content/item-categories";
import { getItemPresentation, itemQuantityLabel } from "@/game/content/item-presentation";
import { getLocation, isActionAvailableAtLocation } from "@/game/content/locations";
import { BOUNDED_RUN_MAX, boundedRunAllowance } from "@/game/domain/bounded-run";
import {
  fabricationAffordableBatches,
  fabricationRecipeUnlocked,
  fabricationStartCheck,
  resolveFabrication,
  resolveFabricationWorkpieceNow,
  type FabricationRunSnapshot,
} from "@/game/domain/fabrication";
import type { StackState } from "@/game/domain/inventory";
import { buildItemReference, publicRecipes } from "@/game/domain/item-reference";
import { defaultItemReferenceRegistries } from "@/game/domain/item-reference";
import type { ManualOverrideState, OverrideRandom } from "@/game/domain/manual-override";
import { isItemTransferable } from "@/game/domain/player-trade";
import {
  refiningAffordableBatches,
  refiningAwardFacts,
  refiningPreflightStopReason,
  partitionFailureAwards,
  refiningRecipeUnlocked,
  refiningSuccessChanceBps,
  resolveRefining,
  type RefiningSnapshot,
} from "@/game/domain/refining";
import { buildWikiItemPage, type WikiItemLine } from "@/features/public-site/public-item-wiki";

/**
 * Issue #343 — fuel manufacturing: fabricating Empty Small Fuel Canisters and
 * refining Oil Shale into Full ones.
 *
 * Both recipes are authored entries on the existing Fabrication and Refining
 * engines, so what is proved here is the exact content, the one new failure
 * shape (a fixed-output failure whose outputs are RETURNED inputs, never Slag),
 * and that the shared resolvers settle it correctly: no duplicated or lost
 * material across repeated failures, retries and bounded runs.
 */

const balance = getEffectiveGameBalance();
const SHALE = ITEM_IDS.oilShale;
const EMPTY = ITEM_IDS.emptySmallFuelCanister;
const FULL = ITEM_IDS.fullSmallFuelCanister;
const STOCK = ITEM_IDS.galvanicStock;
const SLAG = ITEM_IDS.slag;

const fabricate = fabricationRecipeForActionId(
  ACTION_IDS.emptySmallFuelCanisterFabrication,
  balance,
)!;
const refine = refiningRecipeForActionId(
  ACTION_IDS.fullSmallFuelCanisterRefining,
  balance,
) as RolledRefiningRecipeBalance;
const max = boundedRunAllowance(BOUNDED_RUN_MAX, 0);
const count = (n: number) => boundedRunAllowance(n, 0);

function stacks(...entries: [itemId: string, quantity: number][]): StackState<string>[] {
  return entries.map(([itemId, quantity], index) => ({
    id: `s${index}`,
    itemId: itemId as StackState<string>["itemId"],
    quantity,
  }));
}

/** An inventory with the given carried stacks and 8 slots, 50 kg, unless overridden. */
function refiningSnapshot(
  carried: StackState<string>[],
  overrides: Partial<RefiningSnapshot<string>> = {},
): RefiningSnapshot<string> {
  return {
    refiningLevel: 8,
    existingStacks: carried,
    slotsAvailable: 8 - carried.length,
    massAvailableGrams: 50_000,
    ...overrides,
  };
}

/** Rolls that succeed (`true`) or fail (`false`), in order. */
function rolls(outcomes: readonly boolean[]) {
  let index = 0;
  const nextBasisPoints = vi.fn(() => (outcomes[index++] ? 0 : 9_999));
  return { nextBasisPoints, nextUnit: vi.fn(() => 0) };
}

function refineWith(input: {
  carried: StackState<string>[];
  outcomes: readonly boolean[];
  ticks: number;
  allowance?: ReturnType<typeof boundedRunAllowance>;
  level?: number;
  autoDiscardSlag?: boolean;
  snapshot?: Partial<RefiningSnapshot<string>>;
}) {
  const random = rolls(input.outcomes);
  const start = refiningSnapshot(input.carried, {
    refiningLevel: input.level ?? 8,
    ...input.snapshot,
  });
  const resolved = resolveRefining({
    elapsedTicks: input.ticks,
    snapshot: start,
    balance,
    recipe: refine,
    random,
    allowance: input.allowance ?? max,
    autoDiscardSlag: input.autoDiscardSlag ?? false,
  });
  return { resolved, random, start };
}

/** Carried totals by item after a resolution, whatever the stack split. */
function carriedAfter(
  start: readonly StackState<string>[],
  resolved: ReturnType<typeof resolveRefining<string>>,
) {
  const totals: Record<string, number> = {};
  const updated = new Map(resolved.stackUpdates.map((update) => [update.id, update.quantity]));
  const deleted = new Set(resolved.deletedStackIds);
  for (const stack of start) {
    if (deleted.has(stack.id)) continue;
    const quantity = updated.get(stack.id) ?? stack.quantity;
    totals[stack.itemId] = (totals[stack.itemId] ?? 0) + quantity;
  }
  for (const created of resolved.createdStacks) {
    totals[created.itemId] = (totals[created.itemId] ?? 0) + created.quantity;
  }
  return Object.fromEntries(Object.entries(totals).filter(([, quantity]) => quantity > 0));
}

/** Every resulting stack, to prove no stack ever exceeds its limit. */
function stacksAfter(
  start: readonly StackState<string>[],
  resolved: ReturnType<typeof resolveRefining<string>>,
) {
  const updated = new Map(resolved.stackUpdates.map((update) => [update.id, update.quantity]));
  const deleted = new Set(resolved.deletedStackIds);
  return [
    ...start
      .filter((stack) => !deleted.has(stack.id))
      .map((stack) => ({
        itemId: stack.itemId,
        quantity: updated.get(stack.id) ?? stack.quantity,
      })),
    ...resolved.createdStacks,
  ].filter((stack) => stack.quantity > 0);
}

function lineText(line: WikiItemLine): string {
  return line.map((segment) => (typeof segment === "string" ? segment : segment.text)).join("");
}

describe("the two canister items", () => {
  it("authors the exact mass, stack cap and Fuel Units", () => {
    expect(getItemDefinition(EMPTY, balance)).toEqual({
      itemId: EMPTY,
      kind: "stack",
      stackLimit: 5,
      massGrams: 800,
    });
    expect(getItemDefinition(FULL, balance)).toEqual({
      itemId: FULL,
      kind: "stack",
      stackLimit: 2,
      massGrams: 6_000,
    });
    expect(balance.items.fullSmallFuelCanister.fuelUnits).toBe(50);
    expect(ITEM_IDS.emptySmallFuelCanister).toBe("empty_small_fuel_canister");
    expect(ITEM_IDS.fullSmallFuelCanister).toBe("full_small_fuel_canister");
  });

  it("accounts for mass: shell plus 5.2 kg of fuel, 800 g of process waste on success", () => {
    const inputGrams =
      10 * getItemDefinition(SHALE, balance)!.massGrams +
      getItemDefinition(EMPTY, balance)!.massGrams;
    expect(inputGrams).toBe(6_800);
    expect(getItemDefinition(FULL, balance)!.massGrams).toBe(6_000);
    expect(inputGrams - getItemDefinition(FULL, balance)!.massGrams).toBe(800);
    // Failure: 3,000 g of shale is lost; 3,000 g of shale and the 800 g shell come back.
    expect(5 * getItemDefinition(SHALE, balance)!.massGrams).toBe(3_000);
  });

  it("presents each with its approved art, plural name and category", () => {
    const empty = getItemPresentation(EMPTY)!;
    const full = getItemPresentation(FULL)!;
    expect(empty).toMatchObject({
      displayName: "Empty Small Fuel Canister",
      pluralName: "Empty Small Fuel Canisters",
      artworkSrc: "/item-art/empty-small-fuel-canister.webp",
    });
    expect(full).toMatchObject({
      displayName: "Full Small Fuel Canister",
      pluralName: "Full Small Fuel Canisters",
      artworkSrc: "/item-art/full-small-fuel-canister.webp",
    });
    // The fill state is the physical red cap and bar, never a baked label.
    expect(empty.accessibleDescription).toMatch(/no red hardware/);
    expect(full.accessibleDescription).toMatch(/red valve cap/);
    expect(full.accessibleDescription).toMatch(/red vertical locking bar/);
    // The content is said from the authored value, not restated.
    expect(full.description).toContain(
      `${balance.items.fullSmallFuelCanister.fuelUnits} Fuel Units`,
    );
    expect(itemQuantityLabel(FULL, 2, FULL)).toBe("2 Full Small Fuel Canisters");
    expect(itemQuantityLabel(EMPTY, 1, EMPTY)).toBe("1 Empty Small Fuel Canister");
    expect(ITEM_CATEGORY_BY_ITEM_ID[EMPTY]).toBe("components-and-supplies");
    expect(ITEM_CATEGORY_BY_ITEM_ID[FULL]).toBe("components-and-supplies");
  });

  it("keeps the approved masters and 640x640 lossless-WebP derivatives", () => {
    for (const name of ["empty-small-fuel-canister", "full-small-fuel-canister"]) {
      const master = `assets/item-art/${name}.png`;
      expect(existsSync(master)).toBe(true);
      const png = readFileSync(master);
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(1254);
      expect(png.readUInt32BE(20)).toBe(1254);

      const webp = readFileSync(`public/item-art/${name}.webp`);
      expect(webp.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(webp.subarray(8, 12).toString("latin1")).toBe("WEBP");
      // VP8L (lossless): 14-bit width-1 and height-1 straight after the signature byte.
      expect(webp.subarray(12, 16).toString("latin1")).toBe("VP8L");
      const bits = webp.readUInt32LE(21);
      expect(1 + (bits & 0x3fff)).toBe(640);
      expect(1 + ((bits >> 14) & 0x3fff)).toBe(640);
      // The alpha-used flag: these are transparent cut-outs.
      expect((bits >> 28) & 1).toBe(1);
    }
  });

  it("is an ordinary tradable, stashable stack sold only by Last Leg Trading", () => {
    expect(isItemTransferable(EMPTY)).toBe(true);
    expect(isItemTransferable(FULL)).toBe(true);
    const registries = defaultItemReferenceRegistries();
    for (const itemId of [EMPTY, FULL]) {
      const sources = buildItemReference(itemId, registries)!.sources.map((source) => source.kind);
      expect(sources).toContain("player_trade");
      // Last Leg Trading (#357) is the one merchant, and its prices live in the
      // merchant registry rather than here.
      expect(
        buildItemReference(itemId, registries)!
          .sources.filter((source) => source.kind === "merchant")
          .map((source) => (source as { merchantId: string }).merchantId),
      ).toEqual([MERCHANT_IDS.lastLegTrading]);
    }
  });
});

describe("Recipe A — Fabrication 8: 1 Galvanic Stock → 1 Empty Small Fuel Canister", () => {
  it("is exactly the approved recipe", () => {
    expect(fabricate).toEqual({
      actionId: ACTION_IDS.emptySmallFuelCanisterFabrication,
      outputItemId: EMPTY,
      outputQuantity: 1,
      minimumLevel: 8,
      durationTicks: 30,
      baseXp: 75,
      inputs: [{ itemId: STOCK, quantity: 1 }],
    });
  });

  it("matches the Power Cell recipe's duration and XP deliberately", () => {
    const cells = fabricationRecipeForActionId(ACTION_IDS.powerCellFabrication, balance)!;
    expect(fabricate.durationTicks).toBe(cells.durationTicks);
    expect(fabricate.baseXp).toBe(cells.baseXp);
    // One Stock is one canister, never two.
    expect(fabricate.outputQuantity).toBe(1);
  });

  it("is served by the one Rusk Recovery Fabrication Station and nowhere else", () => {
    expect(getLocation(LOCATION_IDS.ruskRecovery)!.availableActionIds).toContain(
      fabricate.actionId,
    );
    expect(isActionAvailableAtLocation(LOCATION_IDS.ruskRecovery, fabricate.actionId)).toBe(true);
    expect(
      isActionAvailableAtLocation(LOCATION_IDS.abandonedProcessingYard, fabricate.actionId),
    ).toBe(false);
    expect(
      fabricationRecipes(balance).filter((r) => r.actionId === fabricate.actionId),
    ).toHaveLength(1);
  });

  it("is gated by personal Fabrication 8 and nothing else", () => {
    const oneBatch = stacks([STOCK, 1]);
    const snapshot = (level: number): FabricationRunSnapshot => ({
      fabricationLevel: level,
      stacks: oneBatch,
      slotsAvailable: 7,
      massAvailableGrams: 50_000,
      allowance: count(1),
      finishCurrent: false,
      overrideEnabled: false,
    });
    expect(fabricationRecipeUnlocked(7, fabricate)).toBe(false);
    expect(fabricationRecipeUnlocked(8, fabricate)).toBe(true);
    expect(fabricationStartCheck(snapshot(7), fabricate)).toEqual({
      ok: false,
      reason: "recipe_locked",
    });
    expect(fabricationStartCheck(snapshot(8), fabricate)).toMatchObject({ ok: true });
    expect(fabricationAffordableBatches({ fabricationLevel: 7, stacks: oneBatch }, fabricate)).toBe(
      0,
    );
    // Asks nothing of Refining: the snapshot has no Refining level to consult.
    expect(Object.keys(fabricate)).not.toContain("refiningLevel");
  });

  it("settles a batch as 1 Stock in, 1 canister out, 75 XP, in 30 ticks", () => {
    const base: FabricationRunSnapshot = {
      fabricationLevel: 8,
      stacks: stacks([STOCK, 3]),
      slotsAvailable: 7,
      massAvailableGrams: 50_000,
      allowance: count(3),
      finishCurrent: false,
      overrideEnabled: false,
    };
    const lowest: OverrideRandom = { nextInt: () => 0 };
    const early = resolveFabrication({
      elapsedTicks: 29,
      snapshot: base,
      recipe: fabricate,
      random: lowest,
    });
    expect(early).toMatchObject({ consumedTicks: 0, resolved: [], awardedXp: 0 });

    const run = resolveFabrication({
      elapsedTicks: 90,
      snapshot: base,
      recipe: fabricate,
      random: lowest,
    });
    // Ordinary Fabrication never randomly fails: three batches, three canisters.
    expect(run.resolved).toHaveLength(3);
    expect(run.inputsConsumed).toEqual({ [STOCK]: 3 });
    expect(run.outputsGained).toEqual({ [EMPTY]: 3 });
    expect(run.awardedXp).toBe(225);
    expect(run.stopReason).toBe("run_completed");
  });

  it("keeps Manual Override's player-chosen risk: a locked push pays its multiplier, a bust nothing", () => {
    const base: FabricationRunSnapshot = {
      fabricationLevel: 8,
      stacks: stacks([STOCK, 1]),
      slotsAvailable: 7,
      massAvailableGrams: 50_000,
      allowance: max,
      finishCurrent: false,
      overrideEnabled: false,
    };
    const override: ManualOverrideState = {
      load: 5,
      trend: "higher",
      safePushes: 1,
      exactPushes: 0,
      locked: true,
    };
    const lowest: OverrideRandom = { nextInt: () => 0 };
    const locked = resolveFabrication({
      elapsedTicks: fabricate.durationTicks,
      snapshot: { ...base, override },
      recipe: fabricate,
      random: lowest,
    });
    expect(locked.awardedXp).toBe(Math.floor((75 * 12_000) / 10_000));
    expect(locked.outputsGained).toEqual({ [EMPTY]: 1 });

    const bust = resolveFabricationWorkpieceNow({
      snapshot: { ...base, override: { ...override, locked: false } },
      recipe: fabricate,
      result: "bust",
      bust: { feed: 1, load: 9 },
      random: lowest,
    });
    expect(bust.awardedXp).toBe(0);
    expect(bust.outputsGained).toEqual({});
    expect(bust.inputsConsumed).toEqual({ [STOCK]: 1 });
  });

  it("judges room after the Stock leaves, and refuses when the canister has nowhere to go", () => {
    // A single Stock frees its own slot for the canister, even with none left.
    expect(
      fabricationStartCheck(
        {
          fabricationLevel: 8,
          stacks: stacks([STOCK, 1]),
          slotsAvailable: 0,
          massAvailableGrams: 0,
        },
        fabricate,
      ),
    ).toMatchObject({ ok: true });
    // A partly used Stock stack frees nothing, and no canister stack has room.
    expect(
      fabricationStartCheck(
        {
          fabricationLevel: 8,
          stacks: stacks([STOCK, 3]),
          slotsAvailable: 0,
          massAvailableGrams: 50_000,
        },
        fabricate,
      ),
    ).toEqual({ ok: false, reason: "inventory_slots_full" });
    // Unless a carried canister stack has room: it stacks to five.
    expect(
      fabricationStartCheck(
        {
          fabricationLevel: 8,
          stacks: stacks([STOCK, 3], [EMPTY, 4]),
          slotsAvailable: 0,
          massAvailableGrams: 50_000,
        },
        fabricate,
      ),
    ).toMatchObject({ ok: true });
    expect(
      fabricationStartCheck(
        {
          fabricationLevel: 8,
          stacks: stacks([STOCK, 3], [EMPTY, 5]),
          slotsAvailable: 0,
          massAvailableGrams: 50_000,
        },
        fabricate,
      ),
    ).toEqual({ ok: false, reason: "inventory_slots_full" });
  });

  it("is a direct packaging recipe, not a Tinkering target", () => {
    expect(
      tinkeringTargets(balance).some((target) => target.recipe.actionId === fabricate.actionId),
    ).toBe(false);
  });

  it("leaves every earlier Fabrication recipe exactly as authored", () => {
    const others = fabricationRecipes(balance).filter(
      (recipe: FabricationRecipeBalance) => recipe.actionId !== fabricate.actionId,
    );
    expect(others).toHaveLength(11);
    const harness = fabricationRecipeForActionId(ACTION_IDS.freightHarnessFabrication, balance)!;
    expect(harness).toMatchObject({ minimumLevel: 8, durationTicks: 60, baseXp: 270 });
    const cells = fabricationRecipeForActionId(ACTION_IDS.powerCellFabrication, balance)!;
    expect(cells).toMatchObject({ outputQuantity: 2, durationTicks: 30, baseXp: 75 });
  });
});

describe("Recipe B — Refining 8: 10 Oil Shale + 1 Empty canister → 1 Full canister", () => {
  it("is exactly the approved recipe", () => {
    expect(refine).toEqual({
      actionId: ACTION_IDS.fullSmallFuelCanisterRefining,
      outputItemId: FULL,
      minimumLevel: 8,
      attemptDurationTicks: 60,
      successAtLevelOneBps: 3_500,
      guaranteedSuccessLevel: 30,
      successRangeBps: 6_500,
      successXp: 100,
      failureXp: 20,
      inputs: [
        { itemId: SHALE, quantity: 10 },
        { itemId: EMPTY, quantity: 1 },
      ],
      outputQuantity: 1,
      failure: {
        kind: "fixed_outputs",
        outputs: [
          { itemId: SHALE, quantity: 5 },
          { itemId: EMPTY, quantity: 1 },
        ],
      },
    });
  });

  it("uses the Galvanic Stock / Galvaferrite curve: 35% at 1, 50.68% at 8, guaranteed at 30", () => {
    expect(refiningSuccessChanceBps(1, refine)).toBe(3_500);
    // The level-8 unlock does not reset the interpolation: 3,500 + floor(7 × 6,500 / 29).
    expect(refiningSuccessChanceBps(8, refine)).toBe(5_068);
    expect(refiningSuccessChanceBps(30, refine)).toBe(10_000);
    expect(refiningSuccessChanceBps(99, refine)).toBe(10_000);
    const galvaferrite = refiningRecipeForActionId(
      ACTION_IDS.galvaferriteRefining,
      balance,
    ) as RolledRefiningRecipeBalance;
    for (let level = 1; level <= 40; level += 1) {
      expect(refiningSuccessChanceBps(level, refine)).toBe(
        refiningSuccessChanceBps(level, galvaferrite),
      );
    }
    let previous = 0;
    for (let level = 8; level <= 30; level += 1) {
      const chance = refiningSuccessChanceBps(level, refine);
      expect(chance).toBeGreaterThan(previous);
      previous = chance;
    }
  });

  it("is gated by personal Refining 8 however many ingredients are carried", () => {
    const carried = stacks([SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    expect(refiningRecipeUnlocked(7, refine)).toBe(false);
    expect(refiningRecipeUnlocked(8, refine)).toBe(true);
    expect(
      refiningAffordableBatches({ refiningLevel: 7, existingStacks: carried }, balance, refine),
    ).toBe(0);
    expect(
      refiningAffordableBatches({ refiningLevel: 8, existingStacks: carried }, balance, refine),
    ).toBe(1);
  });

  it("counts batches by the scarcer ingredient", () => {
    const affordable = (shale: number, empties: number) =>
      refiningAffordableBatches(
        {
          refiningLevel: 8,
          existingStacks: stacks(
            ...(Array.from({ length: Math.ceil(shale / 5) }, (_, index) => [
              SHALE,
              Math.min(5, shale - index * 5),
            ]) as [string, number][]),
            ...(empties > 0 ? ([[EMPTY, empties]] as [string, number][]) : []),
          ),
        },
        balance,
        refine,
      );
    expect(affordable(25, 3)).toBe(2);
    expect(affordable(40, 1)).toBe(1);
    expect(affordable(9, 5)).toBe(0);
    expect(affordable(10, 0)).toBe(0);
  });

  it("authors two distinct required inputs and a failure that returns them, never Slag", () => {
    const facts = refiningAwardFacts(balance, refine);
    expect(facts.inputs).toEqual([
      { itemId: SHALE, stackLimit: 5, massGrams: 600, quantity: 10 },
      { itemId: EMPTY, stackLimit: 5, massGrams: 800, quantity: 1 },
    ]);
    expect(facts.successOutputs).toEqual([
      { itemId: FULL, stackLimit: 2, massGrams: 6_000, quantity: 1, byproduct: false },
    ]);
    // One failure branch of two RETURNED inputs, neither of them a byproduct, so
    // Auto-discard Slag has nothing to discard and their room gates the attempt.
    expect(facts.failureOutcomes).toEqual([
      [
        { itemId: SHALE, stackLimit: 5, massGrams: 600, quantity: 5, byproduct: false },
        { itemId: EMPTY, stackLimit: 5, massGrams: 800, quantity: 1, byproduct: false },
      ],
    ]);
    expect(refine.failure.kind).toBe("fixed_outputs");
    expect(JSON.stringify(refine.failure)).not.toContain(SLAG);
  });

  it("resolves a success: 10 shale + the canister in, one Full canister out, 100 XP", () => {
    const carried = stacks([SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    const { resolved } = refineWith({ carried, outcomes: [true], ticks: 60 });
    expect(resolved).toMatchObject({
      attempts: 1,
      successes: 1,
      failures: 0,
      consumedTicks: 60,
      awardedXp: 100,
      inputsConsumed: { [SHALE]: 10, [EMPTY]: 1 },
      outputsGained: { [FULL]: 1 },
      outputsDiscarded: {},
      stopReason: "insufficient_inputs",
    });
    expect(carriedAfter(carried, resolved)).toEqual({ [FULL]: 1 });
    expect(resolved.resolvedAttempts[0]).toMatchObject({
      success: true,
      thresholdBasisPoints: 5_068,
      xpAwarded: 100,
      durationTicks: 60,
    });
  });

  it("resolves a failure: exactly 5 shale and the same canister come back, 20 XP, no Slag", () => {
    const carried = stacks([SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    const { resolved } = refineWith({ carried, outcomes: [false], ticks: 60 });
    expect(resolved).toMatchObject({
      attempts: 1,
      successes: 0,
      failures: 1,
      awardedXp: 20,
      outputsGained: { [SHALE]: 5, [EMPTY]: 1 },
      outputsDiscarded: {},
    });
    expect(resolved.outputsGained[FULL]).toBeUndefined();
    expect(resolved.outputsGained[SLAG]).toBeUndefined();
    // Net: 3,000 g of shale lost, nothing else, and the shell is carried again.
    expect(carriedAfter(carried, resolved)).toEqual({ [SHALE]: 5, [EMPTY]: 1 });
    const attempt = resolved.resolvedAttempts[0]!;
    expect(attempt).toMatchObject({ success: false, xpAwarded: 20, durationTicks: 60 });
    expect(attempt.consumed).toEqual([
      { itemId: SHALE, quantity: 10 },
      { itemId: EMPTY, quantity: 1 },
    ]);
    expect(attempt.awarded).toEqual([
      { itemId: SHALE, quantity: 5 },
      { itemId: EMPTY, quantity: 1 },
    ]);
    expect(attempt.discarded).toBeUndefined();
  });

  it("takes the full 60 ticks whether it succeeds or fails, and resolves nothing early", () => {
    const carried = stacks([SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    const early = refineWith({ carried, outcomes: [true], ticks: 59 });
    expect(early.resolved).toMatchObject({ attempts: 0, consumedTicks: 0, awardedXp: 0 });
    expect(early.resolved.inputsConsumed).toEqual({});
    expect(early.random.nextBasisPoints).not.toHaveBeenCalled();
    // 119 ticks is one attempt and 59 ticks of progress that is never rounded up.
    const one = refineWith({ carried, outcomes: [false], ticks: 119 });
    expect(one.resolved).toMatchObject({ attempts: 1, consumedTicks: 60 });
  });

  it("rolls strictly below the threshold: 50.67% succeeds, 50.68% fails at level 8", () => {
    const carried = stacks([SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    const at = (roll: number, level = 8) => {
      const resolved = resolveRefining({
        elapsedTicks: 60,
        snapshot: refiningSnapshot(carried, { refiningLevel: level }),
        balance,
        recipe: refine,
        random: { nextBasisPoints: () => roll },
        allowance: count(1),
        autoDiscardSlag: false,
      });
      return resolved.successes === 1;
    };
    expect(at(5_067)).toBe(true);
    expect(at(5_068)).toBe(false);
    expect(at(9_999, 30)).toBe(true);
    expect(at(0, 8)).toBe(true);
  });

  it("is guaranteed at Refining 30: every attempt of a long run succeeds", () => {
    const carried = stacks(...(Array.from({ length: 6 }, () => [SHALE, 5]) as [string, number][]), [
      EMPTY,
      3,
    ]);
    const { resolved } = refineWith({
      carried,
      outcomes: [],
      ticks: 60 * 5,
      level: 30,
      // Every roll is the worst possible one.
      allowance: max,
    });
    // `outcomes` is empty so `rolls` reports a failing 9,999 — still a success.
    expect(resolved.successes).toBe(3);
    expect(resolved.failures).toBe(0);
    expect(resolved.awardedXp).toBe(300);
  });

  it("settles repeated failures inside one window with the same shell and shale returned", () => {
    // 15 shale: failure 1 → 10 left; failure 2 → 5 left; attempt 3 cannot start.
    const carried = stacks([SHALE, 5], [SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    const { resolved } = refineWith({ carried, outcomes: [false, false, false], ticks: 60 * 10 });
    expect(resolved).toMatchObject({
      attempts: 2,
      failures: 2,
      successes: 0,
      awardedXp: 40,
      consumedTicks: 120,
      stopReason: "insufficient_inputs",
    });
    expect(carriedAfter(carried, resolved)).toEqual({ [SHALE]: 5, [EMPTY]: 1 });
    // Gross use exceeds what was ever carried at once, which is the point:
    // the returned shell was spent again, not conjured.
    expect(resolved.inputsConsumed).toEqual({ [SHALE]: 20, [EMPTY]: 2 });
    expect(resolved.outputsGained).toEqual({ [SHALE]: 10, [EMPTY]: 2 });
    expect(stacksAfter(carried, resolved).every((stack) => stack.quantity <= 5)).toBe(true);
  });

  it("lets a retry succeed after a failure with the returned shell", () => {
    const carried = stacks([SHALE, 5], [SHALE, 5], [SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    const { resolved } = refineWith({ carried, outcomes: [false, true], ticks: 60 * 10 });
    expect(resolved).toMatchObject({
      attempts: 2,
      failures: 1,
      successes: 1,
      awardedXp: 120,
      stopReason: "insufficient_inputs",
    });
    // 20 − 5 lost − 10 spent = 5 shale; the one shell went into the one canister.
    expect(carriedAfter(carried, resolved)).toEqual({ [SHALE]: 5, [FULL]: 1 });
    expect(resolved.resolvedAttempts.map((attempt) => attempt.success)).toEqual([false, true]);
  });

  it("never produces more canisters than shells: two shells cap a Max run at two", () => {
    const carried = stacks(...(Array.from({ length: 8 }, () => [SHALE, 5]) as [string, number][]), [
      EMPTY,
      2,
    ]);
    const { resolved } = refineWith({
      carried,
      outcomes: [true, true, true, true],
      ticks: 60 * 10,
      level: 30,
    });
    expect(resolved).toMatchObject({
      attempts: 2,
      successes: 2,
      stopReason: "insufficient_inputs",
    });
    expect(carriedAfter(carried, resolved)).toEqual({ [SHALE]: 20, [FULL]: 2 });
  });

  it("stacks Full canisters two to a stack and never over a limit", () => {
    const carried = stacks(...(Array.from({ length: 6 }, () => [SHALE, 5]) as [string, number][]), [
      EMPTY,
      3,
    ]);
    const { resolved } = refineWith({
      carried,
      outcomes: [true, true, true],
      ticks: 60 * 3,
      level: 30,
    });
    expect(resolved.successes).toBe(3);
    const full = stacksAfter(carried, resolved)
      .filter((stack) => stack.itemId === FULL)
      .map((stack) => stack.quantity)
      .sort();
    expect(full).toEqual([1, 2]);
  });

  it("counts a failed attempt toward a numbered run exactly like a success", () => {
    const carried = stacks(...(Array.from({ length: 6 }, () => [SHALE, 5]) as [string, number][]), [
      EMPTY,
      1,
    ]);
    const { resolved } = refineWith({
      carried,
      outcomes: [false, false, false],
      ticks: 60 * 10,
      allowance: count(2),
    });
    expect(resolved).toMatchObject({ attempts: 2, failures: 2, stopReason: "run_completed" });
    expect(carriedAfter(carried, resolved)).toEqual({ [SHALE]: 20, [EMPTY]: 1 });
  });

  it("keeps Auto-discard Slag away from a returned canister and returned shale", () => {
    const carried = stacks([SHALE, 5], [SHALE, 5], [EMPTY, 1]);
    const { resolved } = refineWith({
      carried,
      outcomes: [false],
      ticks: 60,
      autoDiscardSlag: true,
    });
    expect(resolved.outputsDiscarded).toEqual({});
    expect(resolved.resolvedAttempts[0]!.discarded).toBeUndefined();
    expect(carriedAfter(carried, resolved)).toEqual({ [SHALE]: 5, [EMPTY]: 1 });
  });

  it("starts and finishes from a completely full inventory at the mass ceiling", () => {
    // Every slot used and no mass left: the inputs are consumed first, and
    // what comes back or is made is never more than they free.
    const carried = stacks(
      [SHALE, 5],
      [SHALE, 5],
      [EMPTY, 1],
      [ITEM_IDS.scrapMetal, 1],
      [ITEM_IDS.scrapMetal, 1],
      [ITEM_IDS.scrapMetal, 1],
      [ITEM_IDS.scrapMetal, 1],
      [ITEM_IDS.scrapMetal, 1],
    );
    const tight = { slotsAvailable: 0, massAvailableGrams: 0 };
    expect(refiningPreflightStopReason(refiningSnapshot(carried, tight), balance, refine)).toBe(
      undefined,
    );
    for (const outcome of [true, false]) {
      const { resolved } = refineWith({
        carried,
        outcomes: [outcome],
        ticks: 60,
        snapshot: tight,
      });
      expect(resolved.attempts).toBe(1);
      expect(resolved.stopReason).toBe("insufficient_inputs");
      const after = carriedAfter(carried, resolved);
      expect(after[outcome ? FULL : EMPTY]).toBe(1);
    }
  });

  it("refuses a missing ingredient without rolling, consuming or paying XP", () => {
    const cases: Array<[string, StackState<string>[]]> = [
      ["no canister", stacks([SHALE, 5], [SHALE, 5])],
      ["9 shale", stacks([SHALE, 5], [SHALE, 4], [EMPTY, 1])],
      ["no shale", stacks([EMPTY, 3])],
    ];
    for (const [label, carried] of cases) {
      const { resolved, random } = refineWith({ carried, outcomes: [true], ticks: 600 });
      expect(resolved, label).toMatchObject({
        attempts: 0,
        awardedXp: 0,
        inputsConsumed: {},
        outputsGained: {},
        stopReason: "insufficient_inputs",
      });
      expect(random.nextBasisPoints, label).not.toHaveBeenCalled();
      expect(resolved.stackUpdates, label).toEqual([]);
      expect(resolved.deletedStackIds, label).toEqual([]);
      expect(resolved.createdStacks, label).toEqual([]);
    }
  });

  it("never consumes a Full canister as an ingredient anywhere: no Fuel Unit use yet", () => {
    for (const recipe of refiningRecipes(balance)) {
      expect(recipe.inputs.map((input) => input.itemId)).not.toContain(FULL);
    }
    for (const recipe of fabricationRecipes(balance)) {
      expect(recipe.inputs.map((input) => input.itemId)).not.toContain(FULL);
    }
    // And no recipe turns a Full canister back into an Empty one.
    expect(
      fabricationRecipes(balance).filter((recipe) => recipe.outputItemId === EMPTY),
    ).toHaveLength(1);
  });

  it("leaves every earlier Refining recipe exactly as authored", () => {
    const galvaferrite = refiningRecipeForActionId(ACTION_IDS.galvaferriteRefining, balance)!;
    expect(galvaferrite).toMatchObject({
      minimumLevel: 8,
      attemptDurationTicks: 12,
      successXp: 35,
      failureXp: 7,
      failure: { kind: "one_input_returned" },
    });
    expect(refiningRecipes(balance)).toHaveLength(6);
  });
});

describe("the one rule for a failure's returned and produced awards", () => {
  it("splits by the inputs taken, never by item ID", () => {
    const awards = [
      { itemId: SHALE, quantity: 5 },
      { itemId: SLAG, quantity: 1 },
      { itemId: EMPTY, quantity: 1 },
    ];
    expect(partitionFailureAwards([SHALE, EMPTY], awards)).toEqual({
      returned: [
        { itemId: SHALE, quantity: 5 },
        { itemId: EMPTY, quantity: 1 },
      ],
      produced: [{ itemId: SLAG, quantity: 1 }],
    });
    // The same Slag is returned when Slag was an input.
    expect(partitionFailureAwards([SLAG], awards).returned).toEqual([
      { itemId: SLAG, quantity: 1 },
    ]);
    expect(partitionFailureAwards([], awards).returned).toEqual([]);
  });
});

describe("how the public reference words the new recipes", () => {
  const registries = defaultItemReferenceRegistries();

  it("records the failure as returned inputs, not as something produced", () => {
    const recipe = publicRecipes(registries).find(
      (candidate) => candidate.actionId === ACTION_IDS.fullSmallFuelCanisterRefining,
    )!;
    expect(recipe).toMatchObject({
      kind: "refine",
      failure: {
        kind: "fixed_outputs",
        outputs: [],
        returned: [
          { itemId: SHALE, quantity: 5 },
          { itemId: EMPTY, quantity: 1 },
        ],
      },
    });
  });

  it("leaves the Slag-producing failures worded as production", () => {
    const ferrite = publicRecipes(registries).find(
      (candidate) => candidate.actionId === ACTION_IDS.refining,
    )!;
    expect(ferrite).toMatchObject({
      failure: { kind: "fixed_outputs", outputs: [{ itemId: SLAG, quantity: 1 }] },
    });
    expect((ferrite as { failure?: { returned?: unknown } }).failure?.returned).toBeUndefined();
  });

  it("does not list returned shale or canisters as a recipe's byproducts", () => {
    for (const itemId of [SHALE, EMPTY]) {
      expect(buildItemReference(itemId, registries)!.byproducts).toEqual([]);
    }
    // Slag's byproduct sources are unchanged.
    expect(
      buildItemReference(SLAG, registries)!.byproducts.map((entry) => entry.recipeActionId),
    ).toEqual([ACTION_IDS.refining, ACTION_IDS.galvanicStockRefining]);
  });

  it("says a failed attempt returns the ingredients and loses the rest", () => {
    const page = buildWikiItemPage(FULL)!;
    const facts = page.recipes[0]!.facts.map(lineText);
    expect(facts[0]).toBe("Requires Refining 8");
    const failure = facts.find((fact) => fact.startsWith("Can fail"))!;
    expect(failure).toContain("returns 5 Oil Shale and 1 Empty Small Fuel Canister");
    expect(failure).toContain("the rest of the ingredients are lost");
    expect(failure).not.toMatch(/produces|Slag/);
    expect(page.recipes[0]!.inputs.map(lineText)).toEqual([
      "10 Oil Shale",
      "1 Empty Small Fuel Canister",
    ]);
    expect(page.recipes[0]!.yields).toBe("Makes 1 Full Small Fuel Canister");
  });

  it("gives the Empty canister a Fabrication source and a Refining use", () => {
    const page = buildWikiItemPage(EMPTY)!;
    expect(page.recipes[0]!.heading).toBe("Fabrication");
    expect(page.recipes[0]!.facts.map(lineText)[0]).toBe("Requires Fabrication 8");
    expect(page.recipes[0]!.inputs.map(lineText)).toEqual(["1 Galvanic Stock"]);
    const uses = page.usedIn.flatMap((group) => group.lines).map(lineText);
    expect(uses.some((line) => line.includes("Full Small Fuel Canister"))).toBe(true);
  });
});
