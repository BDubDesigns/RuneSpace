import { z } from "zod";
import {
  ACTION_IDS,
  ITEM_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  type RepairTargetId,
  type SkillId,
} from "@/game/config/foundations";
import type { LevelThreshold } from "@/game/domain/progression";

const balanceSchema = z.object({
  progression: z.object({
    maximumLevel: z.literal(99),
    levelOneToTwoXp: z.literal(500),
    perLevelGrowthBps: z.literal(11_000),
  }),
  /**
   * Mining's genuinely global rules, plus the authored sources (#209).
   *
   * Everything that is true of Mining itself — the skill, and the Cutter's
   * charged speed multiplier — stays here. Everything that varies by what is
   * being mined moves into `sources`, so a second ore is one authored entry
   * rather than a second copy of the resolver.
   *
   * A source is identified by its own action ID, the same rule repair targets
   * already follow: `active_actions` deliberately carries no per-action
   * payload, so the action IS the durable identity of what is being mined
   * across refresh and lazy/offline resolution.
   */
  mining: z.object({
    skillId: z.literal(SKILL_IDS.mining),
    powerCellBoost: z.object({
      speedMultiplier: z.literal(2),
    }),
    sources: z.object({
      /** The Jag's Ferrite Shale — unchanged from the shipped values. */
      ferriteShale: z.object({
        actionId: z.literal(ACTION_IDS.ferriteShaleMining),
        itemId: z.literal(ITEM_IDS.ferriteShale),
        attemptDurationTicks: z.literal(10),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(30),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(15),
        yieldMinimum: z.literal(1),
        yieldMaximum: z.literal(2),
      }),
      /**
       * Deep Jag's Galvanite (#209). Harder ore: a longer attempt, a curve
       * that only reaches certainty at Mining 40 rather than 30, and more XP
       * for it. The starter Salvage Cutter is compatible and its charged
       * multiplier is the shared one above, so 15 ticks becomes 8 under the
       * existing whole-tick ceiling rule.
       */
      galvanite: z.object({
        actionId: z.literal(ACTION_IDS.galvaniteMining),
        itemId: z.literal(ITEM_IDS.galvanite),
        attemptDurationTicks: z.literal(15),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(40),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(25),
        yieldMinimum: z.literal(1),
        yieldMaximum: z.literal(2),
      }),
    }),
  }),
  /**
   * Refining's global rule plus its authored recipes (#209).
   *
   * Refining is still Refining: one skill, one console, one attempt loop. What
   * generalizes is the recipe — inputs, outputs, duration, curve, XP, and the
   * level it requires — so a second and third recipe are authored entries
   * rather than branches inside the resolver. This is deliberately NOT a
   * generic crafting engine.
   *
   * Each recipe carries its own action ID, for the same durable-identity
   * reason Mining sources do: the selected recipe survives refresh and
   * lazy/offline resolution without a new persistence column.
   *
   * `failure` is a two-case union rather than a free-form script, because the
   * approved recipes need exactly two behaviours: produce fixed authored
   * outputs, or hand back exactly one of the inputs.
   */
  refining: z.object({
    skillId: z.literal(SKILL_IDS.refining),
    recipes: z.object({
      /** The shipped Ferrite Shale recipe, unchanged. */
      refinedFerrite: z.object({
        actionId: z.literal(ACTION_IDS.refining),
        outputItemId: z.literal(ITEM_IDS.refinedFerrite),
        minimumLevel: z.literal(1),
        attemptDurationTicks: z.literal(7),
        successAtLevelOneBps: z.literal(4_000),
        guaranteedSuccessLevel: z.literal(20),
        successRangeBps: z.literal(6_000),
        successXp: z.literal(15),
        failureXp: z.literal(3),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.ferriteShale), quantity: z.literal(2) }),
        ]),
        outputQuantity: z.literal(1),
        failure: z.object({
          kind: z.literal("fixed_outputs"),
          outputs: z.tuple([
            z.object({ itemId: z.literal(ITEM_IDS.slag), quantity: z.literal(1) }),
          ]),
        }),
      }),
      /** 2 Galvanite -> 1 Galvanic Stock; a failed pour is 2 Slag. */
      galvanicStock: z.object({
        actionId: z.literal(ACTION_IDS.galvanicStockRefining),
        outputItemId: z.literal(ITEM_IDS.galvanicStock),
        minimumLevel: z.literal(5),
        attemptDurationTicks: z.literal(10),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(30),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(25),
        failureXp: z.literal(5),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvanite), quantity: z.literal(2) }),
        ]),
        outputQuantity: z.literal(1),
        failure: z.object({
          kind: z.literal("fixed_outputs"),
          outputs: z.tuple([
            z.object({ itemId: z.literal(ITEM_IDS.slag), quantity: z.literal(2) }),
          ]),
        }),
      }),
      /**
       * 1 Refined Ferrite + 1 Galvanic Stock -> 1 Galvaferrite. A failed alloy
       * hands back exactly one of the two inputs, chosen 50/50; the other is
       * lost.
       */
      galvaferrite: z.object({
        actionId: z.literal(ACTION_IDS.galvaferriteRefining),
        outputItemId: z.literal(ITEM_IDS.galvaferrite),
        minimumLevel: z.literal(8),
        attemptDurationTicks: z.literal(12),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(30),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(35),
        failureXp: z.literal(7),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(1) }),
          z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(1) }),
        ]),
        outputQuantity: z.literal(1),
        failure: z.object({ kind: z.literal("one_input_returned") }),
      }),
    }),
  }),
  /**
   * The genuinely global Welding rules: one skill, one attempt duration, one
   * XP award per completed increment, one resolution behavior. How much of a
   * particular thing there is to weld belongs to that repair target's spec
   * below, never here (#172).
   */
  welding: z.object({
    skillId: z.literal(SKILL_IDS.welding),
    attemptDurationTicks: z.literal(5),
    xpPerIncrement: z.literal(50),
    /**
     * Clean Pass (#190, generalized by #207) is a general Welding mechanic, not
     * a Practice feature: every Welding work unit — Practice welds, both
     * authored repairs, and every customer Work Order — rolls its opportunity
     * sections once, from this one cadence.
     *
     * The cadence is expressed as a rhythm rather than a fixed pair, because
     * Work Orders are 8 to 19 sections long and two opportunities on the
     * longest of them would have been the same mechanic stretched thin. One
     * opportunity per `sectionsPerOpportunity`, each rolled inside a
     * `windowLengthSections`-wide window starting at `windowStartSection` and
     * repeating on the same period — 2-4, 7-9, 12-14, and so on.
     *
     * `trailingOrdinarySections` is the invariant that makes a claim safe on
     * any length: the final window shifts left far enough that this many
     * ordinary sections always remain behind the last possible opportunity, so
     * a Clean Pass can never complete the work unit. `game/domain/clean-pass`
     * derives the windows; nothing re-derives them per job.
     *
     * The open window is deliberately not a value of its own: an opportunity
     * lasts exactly one ordinary Welding section.
     */
    cleanPass: z.object({
      minimumSectionsForOpportunity: z.literal(6),
      sectionsPerOpportunity: z.literal(5),
      windowStartSection: z.literal(2),
      windowLengthSections: z.literal(3),
      trailingOrdinarySections: z.literal(2),
      /** Server-only network grace; the client-visible window stays one section. */
      claimGraceMs: z.literal(1_000),
    }),
  }),
  /**
   * Repeatable Welding practice at Wade's Workbench (#190).
   *
   * Practice is genuine Welding — same skill, same section cadence, same Clean
   * Pass — at a reduced XP share, because nothing is actually being repaired.
   * The share is the balance rule; the per-section value is derived from it and
   * from the global Welding XP, never frozen as a second constant.
   */
  practiceWelding: z.object({
    actionId: z.literal(ACTION_IDS.practiceWelding),
    skillId: z.literal(SKILL_IDS.welding),
    sectionsPerWeld: z.literal(10),
    scrapPerWeld: z.literal(2),
    slagPerWeld: z.literal(2),
    xpShareBps: z.literal(2_000),
  }),
  /**
   * Per-repair-target recipes. Each target owns its own material requirement
   * and increment count so a second Welding job never rebalances the first.
   */
  repairTargets: z.object({
    cargoHold: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.cargoHold),
      actionId: z.literal(ACTION_IDS.cargoHoldWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(15) }),
        z.object({ itemId: z.literal(ITEM_IDS.slag), quantity: z.literal(6) }),
      ]),
      repairIncrements: z.literal(12),
    }),
    crewStop: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.crewStop),
      actionId: z.literal(ACTION_IDS.crewStopWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(20) }),
      ]),
      repairIncrements: z.literal(10),
    }),
    /**
     * Bracing the collapsed Deep Jag passage (#209). The first authored repair
     * whose recipe is not Refined Ferrite plus Slag, which is exactly why the
     * recipe became a list: a Power Cell requirement must not become a second
     * specialized column.
     */
    deepJagCaveIn: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.deepJagCaveIn),
      actionId: z.literal(ACTION_IDS.deepJagWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(25) }),
        z.object({ itemId: z.literal(ITEM_IDS.powerCell), quantity: z.literal(5) }),
      ]),
      repairIncrements: z.literal(15),
    }),
  }),
  cargoHold: z.object({
    capacitySlots: z.literal(32),
  }),
  /**
   * Work Orders (#190, made playable by #207) — the paying client jobs that
   * arrive through Wade's terminal.
   *
   * The authored pool itself is content (`game/content/work-orders`). What
   * belongs here is the small set of genuinely global rules every job obeys:
   * the Welding level client work requires, the board's shape, the XP share a
   * customer job pays, and the payout rule the authored Credit values are
   * validated against.
   */
  workOrders: z.object({
    actionId: z.literal(ACTION_IDS.workOrderWelding),
    skillId: z.literal(SKILL_IDS.welding),
    requiredWeldingLevel: z.literal(5),
    /** Distinct jobs the board posts at once. */
    postedSlots: z.literal(3),
    /**
     * A customer job pays 40% of the global Welding XP per section — twice
     * Practice's share because something real is being repaired, and well under
     * an authored story repair's full rate because a repeatable shop job should
     * not out-earn the authored work. Derived, never a second frozen constant.
     */
    xpShareBps: z.literal(4_000),
    /**
     * The one payout rule (#207). `rawPayout = base + sections × perSection +
     * materialReplacementValue × premium`, rounded up to the next
     * `roundUpToCredits`.
     *
     * The fixed base is intentional: it keeps a short job attractive on a
     * Credits-per-minute basis instead of every job collapsing to the same
     * perfectly-scaled rate. Replacement value is what the player would pay to
     * replace the material, derived from the merchant registry rather than
     * restated here — see `workOrderMaterialReplacementValue`.
     */
    payout: z.object({
      baseCredits: z.literal(25),
      creditsPerSection: z.literal(3),
      materialPremiumBps: z.literal(11_000),
      roundUpToCredits: z.literal(5),
    }),
  }),
  travel: z.object({
    actionId: z.literal(ACTION_IDS.travel),
    /** Approved initial adjacent walking duration (issue #40): 40 ticks / 24s. */
    adjacentWalkDurationTicks: z.literal(40),
    /**
     * Approved Crew Hauler ride duration (#172): 20 ticks / 12s for the whole
     * authored Holo Hollow <-> The Jag route, which walking covers in two
     * 40-tick legs through The Long Scramble. It is deliberately much faster
     * because the route is fixed, every ride is paid, and a ride offers no
     * Scavenge opportunity at all.
     */
    crewHaulerDurationTicks: z.literal(20),
    scavenge: z.object({
      opportunityStartMinTick: z.literal(3),
      opportunityStartMaxTick: z.literal(30),
      opportunityWindowTicks: z.literal(5),
      /** Server-only network grace; the client-visible window stays unchanged. */
      claimGraceMs: z.literal(1_000),
    }),
  }),
  items: z.object({
    ferriteShale: z.object({
      itemId: z.literal(ITEM_IDS.ferriteShale),
      massGrams: z.literal(100),
      stackLimit: z.literal(10),
    }),
    refinedFerrite: z.object({
      itemId: z.literal(ITEM_IDS.refinedFerrite),
      massGrams: z.literal(150),
      stackLimit: z.literal(5),
    }),
    slag: z.object({
      itemId: z.literal(ITEM_IDS.slag),
      massGrams: z.literal(150),
      stackLimit: z.literal(10),
    }),
    /**
     * Practice stock (#190). Fungible but non-stacking: `stackLimit: 1` is the
     * authored fact that makes one piece occupy one ordinary inventory slot, so
     * six of them is a real carrying decision rather than a rounding error.
     */
    scrapMetal: z.object({
      itemId: z.literal(ITEM_IDS.scrapMetal),
      massGrams: z.literal(300),
      stackLimit: z.literal(1),
    }),
    salvageCutter: z.object({
      itemId: z.literal(ITEM_IDS.salvageCutter),
      massGrams: z.literal(5_000),
      suitSlotId: z.literal("mining_tool"),
      maximumCharge: z.literal(10),
    }),
    powerCell: z.object({
      itemId: z.literal(ITEM_IDS.powerCell),
      massGrams: z.literal(500),
      stackLimit: z.literal(5),
    }),
    /**
     * Deep Jag Tier-2 materials (#209). Mass conserves through the approved
     * recipes on purpose: 2 x 400 g Galvanite makes one 800 g Galvanic Stock,
     * and that plus 150 g of Refined Ferrite makes one 950 g Galvaferrite.
     */
    galvanite: z.object({
      itemId: z.literal(ITEM_IDS.galvanite),
      massGrams: z.literal(400),
      stackLimit: z.literal(10),
    }),
    galvanicStock: z.object({
      itemId: z.literal(ITEM_IDS.galvanicStock),
      massGrams: z.literal(800),
      stackLimit: z.literal(5),
    }),
    galvaferrite: z.object({
      itemId: z.literal(ITEM_IDS.galvaferrite),
      massGrams: z.literal(950),
      stackLimit: z.literal(3),
    }),
    starterContainer: z.object({
      itemId: z.literal(ITEM_IDS.mykeaSchleppraum8),
      massGrams: z.literal(10_000),
      slotCapacity: z.literal(8),
    }),
  }),
  carrying: z.object({
    startingCapacityGrams: z.literal(50_000),
    containerSuitSlotIds: z.tuple([
      z.literal("container_attachment_1"),
      z.literal("container_attachment_2"),
    ]),
  }),
  /** Character-scoped currency (issue #159). Merchant prices are content. */
  credits: z.object({
    startingBalance: z.literal(10),
  }),
});

export type EffectiveGameBalance = z.infer<typeof balanceSchema>;

/**
 * The authoritative storage facts for every valid inventory item. The item
 * entries below are the single source of truth; callers must not reconstruct
 * stack limits or mass from stable IDs.
 */
export type ItemDefinition =
  | {
      itemId: string;
      kind: "stack";
      stackLimit: number;
      massGrams: number;
    }
  | {
      itemId: string;
      kind: "unique";
      massGrams: number;
    };

const defaults = balanceSchema.parse({
  progression: { maximumLevel: 99, levelOneToTwoXp: 500, perLevelGrowthBps: 11_000 },
  mining: {
    skillId: SKILL_IDS.mining,
    powerCellBoost: { speedMultiplier: 2 },
    sources: {
      ferriteShale: {
        actionId: ACTION_IDS.ferriteShaleMining,
        itemId: ITEM_IDS.ferriteShale,
        attemptDurationTicks: 10,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 30,
        successRangeBps: 6_500,
        successXp: 15,
        yieldMinimum: 1,
        yieldMaximum: 2,
      },
      galvanite: {
        actionId: ACTION_IDS.galvaniteMining,
        itemId: ITEM_IDS.galvanite,
        attemptDurationTicks: 15,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 40,
        successRangeBps: 6_500,
        successXp: 25,
        yieldMinimum: 1,
        yieldMaximum: 2,
      },
    },
  },
  refining: {
    skillId: SKILL_IDS.refining,
    recipes: {
      refinedFerrite: {
        actionId: ACTION_IDS.refining,
        outputItemId: ITEM_IDS.refinedFerrite,
        minimumLevel: 1,
        attemptDurationTicks: 7,
        successAtLevelOneBps: 4_000,
        guaranteedSuccessLevel: 20,
        successRangeBps: 6_000,
        successXp: 15,
        failureXp: 3,
        inputs: [{ itemId: ITEM_IDS.ferriteShale, quantity: 2 }],
        outputQuantity: 1,
        failure: { kind: "fixed_outputs", outputs: [{ itemId: ITEM_IDS.slag, quantity: 1 }] },
      },
      galvanicStock: {
        actionId: ACTION_IDS.galvanicStockRefining,
        outputItemId: ITEM_IDS.galvanicStock,
        minimumLevel: 5,
        attemptDurationTicks: 10,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 30,
        successRangeBps: 6_500,
        successXp: 25,
        failureXp: 5,
        inputs: [{ itemId: ITEM_IDS.galvanite, quantity: 2 }],
        outputQuantity: 1,
        failure: { kind: "fixed_outputs", outputs: [{ itemId: ITEM_IDS.slag, quantity: 2 }] },
      },
      galvaferrite: {
        actionId: ACTION_IDS.galvaferriteRefining,
        outputItemId: ITEM_IDS.galvaferrite,
        minimumLevel: 8,
        attemptDurationTicks: 12,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 30,
        successRangeBps: 6_500,
        successXp: 35,
        failureXp: 7,
        inputs: [
          { itemId: ITEM_IDS.refinedFerrite, quantity: 1 },
          { itemId: ITEM_IDS.galvanicStock, quantity: 1 },
        ],
        outputQuantity: 1,
        failure: { kind: "one_input_returned" },
      },
    },
  },
  welding: {
    skillId: SKILL_IDS.welding,
    attemptDurationTicks: 5,
    xpPerIncrement: 50,
    cleanPass: {
      minimumSectionsForOpportunity: 6,
      sectionsPerOpportunity: 5,
      windowStartSection: 2,
      windowLengthSections: 3,
      trailingOrdinarySections: 2,
      claimGraceMs: 1_000,
    },
  },
  practiceWelding: {
    actionId: ACTION_IDS.practiceWelding,
    skillId: SKILL_IDS.welding,
    sectionsPerWeld: 10,
    scrapPerWeld: 2,
    slagPerWeld: 2,
    xpShareBps: 2_000,
  },
  repairTargets: {
    cargoHold: {
      targetId: REPAIR_TARGET_IDS.cargoHold,
      actionId: ACTION_IDS.cargoHoldWelding,
      materials: [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 15 },
        { itemId: ITEM_IDS.slag, quantity: 6 },
      ],
      repairIncrements: 12,
    },
    crewStop: {
      targetId: REPAIR_TARGET_IDS.crewStop,
      actionId: ACTION_IDS.crewStopWelding,
      materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 20 }],
      repairIncrements: 10,
    },
    deepJagCaveIn: {
      targetId: REPAIR_TARGET_IDS.deepJagCaveIn,
      actionId: ACTION_IDS.deepJagWelding,
      materials: [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 25 },
        { itemId: ITEM_IDS.powerCell, quantity: 5 },
      ],
      repairIncrements: 15,
    },
  },
  cargoHold: {
    capacitySlots: 32,
  },
  workOrders: {
    actionId: ACTION_IDS.workOrderWelding,
    skillId: SKILL_IDS.welding,
    requiredWeldingLevel: 5,
    postedSlots: 3,
    xpShareBps: 4_000,
    payout: {
      baseCredits: 25,
      creditsPerSection: 3,
      materialPremiumBps: 11_000,
      roundUpToCredits: 5,
    },
  },
  travel: {
    actionId: ACTION_IDS.travel,
    adjacentWalkDurationTicks: 40,
    crewHaulerDurationTicks: 20,
    scavenge: {
      opportunityStartMinTick: 3,
      opportunityStartMaxTick: 30,
      opportunityWindowTicks: 5,
      claimGraceMs: 1_000,
    },
  },
  items: {
    ferriteShale: { itemId: ITEM_IDS.ferriteShale, massGrams: 100, stackLimit: 10 },
    refinedFerrite: { itemId: ITEM_IDS.refinedFerrite, massGrams: 150, stackLimit: 5 },
    slag: { itemId: ITEM_IDS.slag, massGrams: 150, stackLimit: 10 },
    scrapMetal: { itemId: ITEM_IDS.scrapMetal, massGrams: 300, stackLimit: 1 },
    salvageCutter: {
      itemId: ITEM_IDS.salvageCutter,
      massGrams: 5_000,
      suitSlotId: "mining_tool",
      maximumCharge: 10,
    },
    powerCell: { itemId: ITEM_IDS.powerCell, massGrams: 500, stackLimit: 5 },
    galvanite: { itemId: ITEM_IDS.galvanite, massGrams: 400, stackLimit: 10 },
    galvanicStock: { itemId: ITEM_IDS.galvanicStock, massGrams: 800, stackLimit: 5 },
    galvaferrite: { itemId: ITEM_IDS.galvaferrite, massGrams: 950, stackLimit: 3 },
    starterContainer: {
      itemId: ITEM_IDS.mykeaSchleppraum8,
      massGrams: 10_000,
      slotCapacity: 8,
    },
  },
  carrying: {
    startingCapacityGrams: 50_000,
    containerSuitSlotIds: ["container_attachment_1", "container_attachment_2"],
  },
  credits: { startingBalance: 10 },
});

/** The sole effective-balance boundary until Issue #19 introduces approved overrides. */
export function getEffectiveGameBalance(): EffectiveGameBalance {
  return defaults;
}

/** One repair target's authoritative recipe. Never reconstruct these values. */
export type RepairTargetBalance =
  EffectiveGameBalance["repairTargets"][keyof EffectiveGameBalance["repairTargets"]];

/** One authored material requirement on a repair recipe (#209). */
export type RepairMaterialRequirement = RepairTargetBalance["materials"][number];

/** One authored Mining source (#209). */
export type MiningSourceBalance =
  EffectiveGameBalance["mining"]["sources"][keyof EffectiveGameBalance["mining"]["sources"]];

/** One authored Refining recipe (#209). */
export type RefiningRecipeBalance =
  EffectiveGameBalance["refining"]["recipes"][keyof EffectiveGameBalance["refining"]["recipes"]];

/** Every authored Mining source, in a stable authored order. */
export function miningSources(balance = getEffectiveGameBalance()): readonly MiningSourceBalance[] {
  return Object.values(balance.mining.sources);
}

/**
 * The authoritative facts for one Mining source, by its own action ID.
 *
 * Resolving from the action ID is what makes a lazily-resolved or offline
 * attempt award the right ore: the durable `active_actions` row already says
 * which source the character started on.
 */
export function miningSourceForActionId(
  actionId: string,
  balance = getEffectiveGameBalance(),
): MiningSourceBalance | undefined {
  return miningSources(balance).find((source) => source.actionId === actionId);
}

/** Every Mining action ID the source registry authors. */
export function miningActionIds(balance = getEffectiveGameBalance()): readonly string[] {
  return miningSources(balance).map((source) => source.actionId);
}

/** Every authored Refining recipe, in a stable authored order. */
export function refiningRecipes(
  balance = getEffectiveGameBalance(),
): readonly RefiningRecipeBalance[] {
  return Object.values(balance.refining.recipes);
}

/**
 * The authoritative recipe currently being refined, by its own action ID.
 *
 * Same durable-identity rule as Mining sources: the recipe the player selected
 * survives refresh and lazy/offline resolution because the active action IS
 * the selection.
 */
export function refiningRecipeForActionId(
  actionId: string,
  balance = getEffectiveGameBalance(),
): RefiningRecipeBalance | undefined {
  return refiningRecipes(balance).find((recipe) => recipe.actionId === actionId);
}

/** Every Refining action ID the recipe registry authors. */
export function refiningActionIds(balance = getEffectiveGameBalance()): readonly string[] {
  return refiningRecipes(balance).map((recipe) => recipe.actionId);
}

/** Every authored repair target's recipe, in a stable order. */
export function repairTargetBalances(
  balance = getEffectiveGameBalance(),
): readonly RepairTargetBalance[] {
  return Object.values(balance.repairTargets);
}

/**
 * The authoritative recipe for one repair target. Every Welding rule that is
 * specific to a target (materials, increments, its action identity) is read
 * through here so no caller can hardcode a second copy.
 */
export function getRepairTargetBalance(
  targetId: RepairTargetId,
  balance = getEffectiveGameBalance(),
): RepairTargetBalance {
  const target = repairTargetBalances(balance).find((entry) => entry.targetId === targetId);
  if (!target) throw new Error(`Unknown repair target "${targetId}"`);
  return target;
}

/** Resolve a repair target from the action currently being performed. */
export function repairTargetForActionId(
  actionId: string,
  balance = getEffectiveGameBalance(),
): RepairTargetId | undefined {
  return repairTargetBalances(balance).find((target) => target.actionId === actionId)?.targetId;
}

/**
 * The XP one completed Practice Welding section awards.
 *
 * Derived from the global Welding XP and the authored Practice share, so the
 * balance rule stays a share of normal rather than a second frozen constant
 * that could silently drift from the Welding value it is a share of (#190).
 *
 * The share is 20% — 10 XP of the global 50 — after the #191 playtest pass.
 * Practice is the only thing it reduces: authored repairs, and the Work Orders
 * to come, pay full Welding XP per increment.
 */
export function practiceSectionXp(balance = getEffectiveGameBalance()): number {
  return Math.floor((balance.welding.xpPerIncrement * balance.practiceWelding.xpShareBps) / 10_000);
}

/**
 * The XP one completed Work Order Welding section awards.
 *
 * The same derivation as Practice, from the same global Welding XP, at the
 * authored customer-work share — 40%, so 20 XP of the global 50. Keeping both
 * as shares is what stops the three Welding activities from drifting into
 * three unrelated numbers that nobody can compare (#207).
 */
export function workOrderSectionXp(balance = getEffectiveGameBalance()): number {
  return Math.floor((balance.welding.xpPerIncrement * balance.workOrders.xpShareBps) / 10_000);
}

/** Every welding action ID the repair-target registry authorizes. */
export function weldingActionIds(balance = getEffectiveGameBalance()): readonly string[] {
  return repairTargetBalances(balance).map((target) => target.actionId);
}

/**
 * Every action that resolves on the global Welding section cadence (#207).
 *
 * Three different things weld — an authored repair target, a Practice weld at
 * Wade's bench, and a customer Work Order. They differ in what is being fixed
 * and what it pays; they do not differ in how a section is timed. This is the
 * one list of "ticks like Welding", so the generic live-action projection and
 * the shared boundary scheduler that reconciles each section cannot learn about
 * one kind and silently omit another.
 *
 * Deliberately NOT `weldingActionIds`, whose contract is specifically the
 * repair-target registry and which several callers rely on meaning exactly
 * that.
 */
export function weldingCadenceActionIds(balance = getEffectiveGameBalance()): readonly string[] {
  return [
    ...weldingActionIds(balance),
    balance.practiceWelding.actionId,
    balance.workOrders.actionId,
  ];
}

/** Returns the authoritative inventory representation for a valid item ID. */
export function getItemDefinition(
  itemId: string,
  balance = getEffectiveGameBalance(),
): ItemDefinition | undefined {
  const item = Object.values(balance.items).find((candidate) => candidate.itemId === itemId);
  if (!item) return undefined;
  if ("stackLimit" in item) {
    return {
      itemId: item.itemId,
      kind: "stack",
      stackLimit: item.stackLimit,
      massGrams: item.massGrams,
    };
  }
  return { itemId: item.itemId, kind: "unique", massGrams: item.massGrams };
}

export function standardSkillLevelThresholds(
  balance = getEffectiveGameBalance(),
): readonly LevelThreshold[] {
  const thresholds: LevelThreshold[] = [{ level: 1, totalXp: 0 }];
  let requirement: number = balance.progression.levelOneToTwoXp;
  let totalXp = 0;
  for (let level = 2; level <= balance.progression.maximumLevel; level += 1) {
    totalXp += requirement;
    thresholds.push({ level, totalXp });
    requirement = Math.floor((requirement * balance.progression.perLevelGrowthBps) / 10_000);
  }
  return thresholds;
}

/** @deprecated Use standardSkillLevelThresholds — retained as a shim for callers that referenced miningLevelThresholds directly. */
export const miningLevelThresholds = standardSkillLevelThresholds;

/**
 * Authoritative level-curve sources per stable skill ID — the single place
 * that decides which skills have an approved progression curve. A skill
 * without an entry has no approved curve and is never presented in
 * progression surfaces. Adding a future skill curve is one entry here; the
 * callers (Mining state, location population, character profiles) need no
 * per-skill conditionals. Factories are invoked per call so future approved
 * balance overrides (Issue #19) stay live.
 */
const skillLevelCurves = {
  [SKILL_IDS.mining]: standardSkillLevelThresholds,
  [SKILL_IDS.refining]: standardSkillLevelThresholds,
  [SKILL_IDS.welding]: standardSkillLevelThresholds,
} as const satisfies Partial<Record<SkillId, () => readonly LevelThreshold[]>>;

/** The approved level-curve source for a skill, or undefined when none exists. */
export function skillLevelThresholds(skillId: string): readonly LevelThreshold[] | undefined {
  return skillLevelCurves[skillId as SkillId]?.();
}

/**
 * The charge capacity an item definition authors, or undefined when the item
 * has no charge state at all. Charge is currently authored only on the
 * Salvage Cutter; readers must consult this instead of assuming every unique
 * item carries charge semantics.
 */
export function getItemMaximumCharge(itemId: string): number | undefined {
  const item = Object.values(defaults.items).find((candidate) => candidate.itemId === itemId);
  if (!item) return undefined;
  return "maximumCharge" in item ? item.maximumCharge : undefined;
}
