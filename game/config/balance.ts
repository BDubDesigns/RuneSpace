import { z } from "zod";
import {
  ACTION_IDS,
  ITEM_IDS,
  PLANET_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
  SKILL_IDS,
  type RepairTargetId,
  type ShipRouteId,
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
        requiredMiningLevel: z.literal(1),
        lowYield: z.null(),
        secondaryFinds: z.tuple([
          z.object({
            itemId: z.literal(ITEM_IDS.uncutQuartz),
            oneIn: z.literal(40),
            announce: z.literal(false),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.uncutTopaz),
            oneIn: z.literal(60),
            announce: z.literal(true),
          }),
          // Rune Fragment (#367): appended, so the gems' absolute chances are untouched.
          z.object({
            itemId: z.literal(ITEM_IDS.runeFragment),
            oneIn: z.literal(25),
            announce: z.literal(false),
          }),
        ]),
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
        requiredMiningLevel: z.literal(1),
        lowYield: z.null(),
        secondaryFinds: z.tuple([
          z.object({
            itemId: z.literal(ITEM_IDS.uncutTopaz),
            oneIn: z.literal(35),
            announce: z.literal(false),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.uncutSapphire),
            oneIn: z.literal(55),
            announce: z.literal(true),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.runeFragment),
            oneIn: z.literal(8),
            announce: z.literal(false),
          }),
        ]),
      }),
      /**
       * Skatboll's Oil Shale at The South Cut (#342). The first source with a
       * personal Mining level gate, a three-way full-success yield and a
       * low-yield outcome instead of a dead miss.
       *
       * The success curve is anchored at Mining 1 like every other source and
       * only the ACCESS gate is level 5, so Mining 5 is 40.30% (35% + 4 of 49
       * steps of the 65-point climb to a guaranteed Mining 50), not 35%.
       * `yieldMinimum`/`yieldMaximum` are the full-success range, drawn
       * uniformly over 2, 3 and 4. `lowYield` is what a roll that misses the
       * success chance still earns: exactly that many ore and that much XP, and
       * never a Secondary Find.
       */
      oilShale: z.object({
        actionId: z.literal(ACTION_IDS.oilShaleMining),
        itemId: z.literal(ITEM_IDS.oilShale),
        attemptDurationTicks: z.literal(100),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(50),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(100),
        yieldMinimum: z.literal(2),
        yieldMaximum: z.literal(4),
        requiredMiningLevel: z.literal(5),
        lowYield: z.object({ quantity: z.literal(1), xp: z.literal(20) }),
        secondaryFinds: z.tuple([
          z.object({
            itemId: z.literal(ITEM_IDS.uncutSapphire),
            oneIn: z.literal(20),
            announce: z.literal(false),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.motherlodeSlab),
            oneIn: z.literal(100),
            announce: z.literal(true),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.runeFragment),
            oneIn: z.literal(6),
            announce: z.literal(false),
          }),
        ]),
      }),
      /**
       * Stillreach's Stone at the Prospecting Quarry (#379). A fast, level-1
       * prospecting cut: 33 ticks (19.8 s) because 20.0 s cannot be expressed in
       * whole 0.6-second ticks. A miss is a dead miss (`lowYield: null`) with no
       * Stone, no find and no XP, unlike The South Cut. The Secondary Find table is
       * one 600-outcome roll (see `secondaryFindRollSize`): 150 Rune Fragment, 100
       * Uncut Quartz, 50 Uncut Topaz, 3 Boulder and 297 none.
       */
      stone: z.object({
        actionId: z.literal(ACTION_IDS.stoneMining),
        itemId: z.literal(ITEM_IDS.stone),
        attemptDurationTicks: z.literal(33),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(30),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(45),
        yieldMinimum: z.literal(1),
        yieldMaximum: z.literal(2),
        requiredMiningLevel: z.literal(1),
        lowYield: z.null(),
        secondaryFinds: z.tuple([
          z.object({
            itemId: z.literal(ITEM_IDS.runeFragment),
            oneIn: z.literal(4),
            announce: z.literal(false),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.uncutQuartz),
            oneIn: z.literal(6),
            announce: z.literal(false),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.uncutTopaz),
            oneIn: z.literal(12),
            announce: z.literal(false),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.boulder),
            oneIn: z.literal(200),
            announce: z.literal(true),
          }),
        ]),
      }),
      /**
       * Harmonic Workings' Rune Fragment Mining (#383): Stillreach's dedicated
       * Mining-8 Rune Fragment source. The primary is the Fragment itself, 1 or 2
       * uniformly, and a success earns 130 XP whichever is drawn. Its one
       * find-roll is 40 outcomes: 5 intact Runestone (1/8, silent, +130 XP when kept),
       * 2 Uncut Sapphire (1/20, a RARE FIND line only when awarded) and 33 none.
       * The curve is anchored at Mining 1 and is certain by Mining 40, so Mining 8
       * is 46.66%. A miss awards nothing.
       */
      harmonicMining: z.object({
        actionId: z.literal(ACTION_IDS.harmonicMining),
        itemId: z.literal(ITEM_IDS.runeFragment),
        attemptDurationTicks: z.literal(75),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(40),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(130),
        yieldMinimum: z.literal(1),
        yieldMaximum: z.literal(2),
        requiredMiningLevel: z.literal(8),
        lowYield: z.null(),
        secondaryFinds: z.tuple([
          z.object({
            itemId: z.literal(ITEM_IDS.runestone),
            oneIn: z.literal(8),
            announce: z.literal(false),
          }),
          z.object({
            itemId: z.literal(ITEM_IDS.uncutSapphire),
            oneIn: z.literal(20),
            announce: z.literal(true),
          }),
        ]),
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
   * `failure` is a small union rather than a free-form script, because the
   * approved recipes need exactly three behaviours: produce fixed authored
   * outputs, hand back exactly one of the inputs, or — for a deterministic
   * recipe (#229) — have no failure path at all. A deterministic recipe
   * authors no success curve and never consults the random source.
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
      /**
       * Deliberate Slag (#229): 2 Ferrite Shale -> 1 Slag at Refining 5.
       * Utility processing, not training — it mirrors the Refined Ferrite
       * failure output and pays that failure's XP, and it is gated at Refining 5
       * so the opening Cargo Hold arc still teaches Slag as a byproduct rather
       * than something to manufacture.
       */
      ferriteShaleSlag: z.object({
        actionId: z.literal(ACTION_IDS.ferriteShaleSlagRefining),
        outputItemId: z.literal(ITEM_IDS.slag),
        minimumLevel: z.literal(5),
        attemptDurationTicks: z.literal(6),
        successXp: z.literal(3),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.ferriteShale), quantity: z.literal(2) }),
        ]),
        outputQuantity: z.literal(1),
        failure: z.object({ kind: z.literal("none") }),
      }),
      /** Deliberate Slag (#229): 2 Galvanite -> 2 Slag at Refining 5. */
      galvaniteSlag: z.object({
        actionId: z.literal(ACTION_IDS.galvaniteSlagRefining),
        outputItemId: z.literal(ITEM_IDS.slag),
        minimumLevel: z.literal(5),
        attemptDurationTicks: z.literal(8),
        successXp: z.literal(5),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvanite), quantity: z.literal(2) }),
        ]),
        outputQuantity: z.literal(2),
        failure: z.object({ kind: z.literal("none") }),
      }),
      /**
       * Fuel manufacturing (#343): 10 Oil Shale + 1 Empty Small Fuel Canister ->
       * 1 Full Small Fuel Canister at Refining 8, on the Galvanic Stock /
       * Galvaferrite curve (35% at Refining 1, guaranteed at 30; 50.68% at 8 —
       * the level-8 unlock does not reset the interpolation).
       *
       * A failure is an ordinary `fixed_outputs` branch whose outputs are two
       * RETURNED inputs, never Slag: exactly 5 of the 10 Oil Shale and the
       * Empty Small Fuel Canister come back, and the other 5 shale are lost.
       * Neither returned item is a byproduct, so Auto-discard Slag can never
       * discard them and their room gates the attempt like a success output.
       */
      smallFuelCanister: z.object({
        actionId: z.literal(ACTION_IDS.fullSmallFuelCanisterRefining),
        outputItemId: z.literal(ITEM_IDS.fullSmallFuelCanister),
        minimumLevel: z.literal(8),
        attemptDurationTicks: z.literal(60),
        successAtLevelOneBps: z.literal(3_500),
        guaranteedSuccessLevel: z.literal(30),
        successRangeBps: z.literal(6_500),
        successXp: z.literal(100),
        failureXp: z.literal(20),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.oilShale), quantity: z.literal(10) }),
          z.object({ itemId: z.literal(ITEM_IDS.emptySmallFuelCanister), quantity: z.literal(1) }),
        ]),
        outputQuantity: z.literal(1),
        failure: z.object({
          kind: z.literal("fixed_outputs"),
          outputs: z.tuple([
            z.object({ itemId: z.literal(ITEM_IDS.oilShale), quantity: z.literal(5) }),
            z.object({
              itemId: z.literal(ITEM_IDS.emptySmallFuelCanister),
              quantity: z.literal(1),
            }),
          ]),
        }),
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
    /**
     * Site stash mounts (#284). Same-tier mounts share one recipe, so the two
     * Tier 2 sites are two entries with identical authored numbers rather than
     * a hidden shared constant. Six or more sections keeps Clean Pass
     * available on every mount.
     */
    siteStashTheJag: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.siteStashTheJag),
      actionId: z.literal(ACTION_IDS.siteStashTheJagWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(6) }),
        z.object({ itemId: z.literal(ITEM_IDS.slag), quantity: z.literal(3) }),
      ]),
      repairIncrements: z.literal(6),
    }),
    siteStashRuskRecovery: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.siteStashRuskRecovery),
      actionId: z.literal(ACTION_IDS.siteStashRuskRecoveryWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(3) }),
        z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(2) }),
      ]),
      repairIncrements: z.literal(10),
    }),
    siteStashProcessingYard: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.siteStashProcessingYard),
      actionId: z.literal(ACTION_IDS.siteStashProcessingYardWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(3) }),
        z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(2) }),
      ]),
      repairIncrements: z.literal(10),
    }),
    siteStashDeepJag: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.siteStashDeepJag),
      actionId: z.literal(ACTION_IDS.siteStashDeepJagWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.galvaferrite), quantity: z.literal(2) }),
        z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(2) }),
        z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(1) }),
      ]),
      repairIncrements: z.literal(15),
    }),
    /**
     * Curly's storage mount at HH B&B (#292). Deliberately the same Tier-1
     * job as The Jag's mount — same materials, same six sections — authored as
     * its own entry under the same no-hidden-shared-constant rule.
     */
    curlyStashMount: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.curlyStashMount),
      actionId: z.literal(ACTION_IDS.curlyStashMountWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(6) }),
        z.object({ itemId: z.literal(ITEM_IDS.slag), quantity: z.literal(3) }),
      ]),
      repairIncrements: z.literal(6),
    }),
    /**
     * The ship's Landing Gear at the Crash Site (#322): the Galvanic-tier step
     * between the Ferrite-tier Cargo Hold and the future Propulsion work. It
     * consumes finished components rather than raw stock, so the same recipe
     * serves a character who fabricated them and one who traded for them.
     */
    landingGear: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.landingGear),
      actionId: z.literal(ACTION_IDS.landingGearWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.wheelAssembly), quantity: z.literal(2) }),
        z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(2) }),
        z.object({ itemId: z.literal(ITEM_IDS.galvanicWireSpool), quantity: z.literal(1) }),
      ]),
      repairIncrements: z.literal(12),
    }),
    /**
     * The ship's Propulsion System at the Crash Site (#330): the Galvaferrite-tier
     * capstone after the Cargo Hold and Landing Gear. Like the Landing Gear it
     * consumes finished components. The two Drive Mounts embed four Galvaferrite
     * and two Wire Spools, so a self-produced project is 5 Galvaferrite, 3 Wire
     * Spools and 2 Mounting Brackets in total, but the repair itself consumes
     * only what is listed here.
     */
    propulsion: z.object({
      targetId: z.literal(REPAIR_TARGET_IDS.propulsionSystem),
      actionId: z.literal(ACTION_IDS.propulsionWelding),
      materials: z.tuple([
        z.object({ itemId: z.literal(ITEM_IDS.driveMount), quantity: z.literal(2) }),
        z.object({ itemId: z.literal(ITEM_IDS.galvaferrite), quantity: z.literal(1) }),
        z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(2) }),
        z.object({ itemId: z.literal(ITEM_IDS.galvanicWireSpool), quantity: z.literal(1) }),
      ]),
      repairIncrements: z.literal(16),
    }),
  }),
  cargoHold: z.object({
    capacitySlots: z.literal(32),
  }),
  /**
   * Tier-1 Fabrication (#232): turning processed stock into discrete items at
   * Rusk Recovery's Fabrication Station.
   *
   * Fabrication is its own authored recipe boundary, deliberately not a
   * generic crafting engine and not a Refining variant: a recipe is inputs, one
   * authored output batch, a duration, and base XP. Baseline Fabrication never
   * fails; the only failure path is a Manual Override bust the player chose to
   * risk. Each recipe carries its own action ID for the durable-identity reason
   * Refining recipes do.
   */
  fabrication: z.object({
    skillId: z.literal(SKILL_IDS.fabrication),
    recipes: z.object({
      /** Installation hardware: 2 Refined Ferrite -> 1 Mounting Bracket. */
      mountingBracket: z.object({
        actionId: z.literal(ACTION_IDS.mountingBracketFabrication),
        outputItemId: z.literal(ITEM_IDS.mountingBracket),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(1),
        durationTicks: z.literal(12),
        baseXp: z.literal(25),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(2) }),
        ]),
      }),
      /**
       * Direct Scrap: 2 Refined Ferrite -> 1 Scrap Metal. A utility recipe so
       * nobody has to fabricate a finished item and dismantle it just to get
       * Scrap — not intended as training. It is not a Tinkering target.
       */
      scrapMetal: z.object({
        actionId: z.literal(ACTION_IDS.scrapMetalFabrication),
        outputItemId: z.literal(ITEM_IDS.scrapMetal),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(1),
        durationTicks: z.literal(10),
        baseXp: z.literal(10),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(2) }),
        ]),
      }),
      /** A crude +3-slot container: 1 Mounting Bracket + 2 Scrap Metal + 3 Refined Ferrite. */
      scrapBox: z.object({
        actionId: z.literal(ACTION_IDS.scrapBoxFabrication),
        outputItemId: z.literal(ITEM_IDS.scrapBox),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(1),
        durationTicks: z.literal(36),
        baseXp: z.literal(81),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(1) }),
          z.object({ itemId: z.literal(ITEM_IDS.scrapMetal), quantity: z.literal(2) }),
          z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(3) }),
        ]),
      }),
      /**
       * Another ordinary Salvage Cutter: 5 Refined Ferrite + 1 Power Cell. The
       * Cell is a construction component, not stored charge — the new Cutter
       * starts at the Cutter's ordinary uncharged state.
       */
      salvageCutter: z.object({
        actionId: z.literal(ACTION_IDS.salvageCutterFabrication),
        outputItemId: z.literal(ITEM_IDS.salvageCutter),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(1),
        durationTicks: z.literal(20),
        baseXp: z.literal(65),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(5) }),
          z.object({ itemId: z.literal(ITEM_IDS.powerCell), quantity: z.literal(1) }),
        ]),
      }),
      /**
       * Fabrication 5 direct Scrap (#233): 1 Galvanic Stock -> 2 Scrap Metal.
       * The Galvanic-tier counterpart of the Refined Ferrite recipe above — a
       * utility recipe, not training, and not a Tinkering target.
       */
      galvanicScrap: z.object({
        actionId: z.literal(ACTION_IDS.galvanicScrapFabrication),
        outputItemId: z.literal(ITEM_IDS.scrapMetal),
        outputQuantity: z.literal(2),
        minimumLevel: z.literal(5),
        durationTicks: z.literal(14),
        baseXp: z.literal(15),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(1) }),
        ]),
      }),
      /**
       * 1 Galvanic Stock -> 1 Galvanic Wire Spool (#233). The station supplies
       * the winding core, insulation and terminals, so nothing else is an input.
       */
      galvanicWireSpool: z.object({
        actionId: z.literal(ACTION_IDS.galvanicWireSpoolFabrication),
        outputItemId: z.literal(ITEM_IDS.galvanicWireSpool),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(5),
        durationTicks: z.literal(24),
        baseXp: z.literal(45),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(1) }),
        ]),
      }),
      /**
       * 1 Galvanic Stock -> 2 Power Cells (#233): one authored two-output
       * batch. The station charges them as part of the cycle, so they are
       * ordinary usable Power Cells — there is no uncharged Cell and no
       * charging step. A run's size counts these batches.
       */
      powerCells: z.object({
        actionId: z.literal(ACTION_IDS.powerCellFabrication),
        outputItemId: z.literal(ITEM_IDS.powerCell),
        outputQuantity: z.literal(2),
        minimumLevel: z.literal(5),
        durationTicks: z.literal(30),
        baseXp: z.literal(75),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(1) }),
        ]),
      }),
      /**
       * The Loadsteel Cutter (#233): a separate Mining tool, not an upgrade of
       * the Salvage Cutter. Its Power Cell commissions the tool and is not
       * stored charge — a new Loadsteel Cutter comes off the machine at 0.
       */
      loadsteelCutter: z.object({
        actionId: z.literal(ACTION_IDS.loadsteelCutterFabrication),
        outputItemId: z.literal(ITEM_IDS.loadsteelCutter),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(5),
        durationTicks: z.literal(45),
        baseXp: z.literal(180),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvaferrite), quantity: z.literal(2) }),
          z.object({ itemId: z.literal(ITEM_IDS.galvanicWireSpool), quantity: z.literal(1) }),
          z.object({ itemId: z.literal(ITEM_IDS.powerCell), quantity: z.literal(1) }),
        ]),
      }),
      /**
       * The Landing Gear's wheel (#322): mostly structural Refined Ferrite with
       * one Galvanic Stock and a Mounting Bracket. Its 1,550 g is exactly the
       * three 150 g Ferrite, the 800 g Stock and the 300 g Bracket it is made of.
       */
      wheelAssembly: z.object({
        actionId: z.literal(ACTION_IDS.wheelAssemblyFabrication),
        outputItemId: z.literal(ITEM_IDS.wheelAssembly),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(5),
        durationTicks: z.literal(36),
        baseXp: z.literal(100),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), quantity: z.literal(3) }),
          z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(1) }),
          z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(1) }),
        ]),
      }),
      /**
       * The Propulsion System's mounting interface (#330): a Fabrication 8
       * Galvaferrite recipe. Its 2,900 g is exactly the two 950 g Galvaferrite and
       * the 1,000 g Wire Spool it is made of.
       */
      driveMount: z.object({
        actionId: z.literal(ACTION_IDS.driveMountFabrication),
        outputItemId: z.literal(ITEM_IDS.driveMount),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(8),
        durationTicks: z.literal(48),
        baseXp: z.literal(200),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvaferrite), quantity: z.literal(2) }),
          z.object({ itemId: z.literal(ITEM_IDS.galvanicWireSpool), quantity: z.literal(1) }),
        ]),
      }),
      /** The Fabrication 8 capstone (#233): an advanced +6-slot container attachment. */
      freightHarness: z.object({
        actionId: z.literal(ACTION_IDS.freightHarnessFabrication),
        outputItemId: z.literal(ITEM_IDS.freightHarness),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(8),
        durationTicks: z.literal(60),
        baseXp: z.literal(270),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvaferrite), quantity: z.literal(4) }),
          z.object({ itemId: z.literal(ITEM_IDS.mountingBracket), quantity: z.literal(2) }),
        ]),
      }),
      /**
       * Fuel packaging (#343): 1 Galvanic Stock -> 1 Empty Small Fuel Canister at
       * Fabrication 8. The station supplies the valve and fittings, so nothing
       * else is an input, and one Stock is one canister, not two. Its 30 ticks
       * and 75 base XP deliberately match the Power Cell recipe. It is a direct
       * packaging recipe and not a Tinkering target.
       */
      emptySmallFuelCanister: z.object({
        actionId: z.literal(ACTION_IDS.emptySmallFuelCanisterFabrication),
        outputItemId: z.literal(ITEM_IDS.emptySmallFuelCanister),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(8),
        durationTicks: z.literal(30),
        baseXp: z.literal(75),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), quantity: z.literal(1) }),
        ]),
      }),
    }),
    /**
     * Manual Override (#232): the optional per-workpiece push-your-luck layer.
     * An Override workpiece starts at a Load rolled uniformly from the initial
     * range; each push rolls the next Load strictly in the announced Trend's
     * direction, and a Feed within `safeRange` of it compounds the XP
     * multiplier (exactly on it compounds by more). A miss busts the workpiece.
     */
    manualOverride: z.object({
      loadMinimum: z.literal(1),
      loadMaximum: z.literal(10),
      initialLoadMinimum: z.literal(2),
      initialLoadMaximum: z.literal(9),
      safeRange: z.literal(2),
      maximumPushes: z.literal(5),
      safePushMultiplierBps: z.literal(12_000),
      exactPushMultiplierBps: z.literal(13_000),
    }),
  }),
  /**
   * Tinkering (#232): dismantling one complete authored Fabrication output
   * batch at the Fabrication Station for Fabrication XP and Scrap Metal.
   *
   * Every value is derived from the target's own Fabrication recipe through
   * these universal rules — there are no per-item exceptions: the recipe's
   * base XP, twice its duration, and one Scrap per `inputUnitsPerScrap`
   * immediate recipe-input units, rounded up. A target names the recipe it
   * dismantles and carries its own action ID.
   */
  tinkering: z.object({
    skillId: z.literal(SKILL_IDS.fabrication),
    durationMultiplier: z.literal(2),
    inputUnitsPerScrap: z.literal(2),
    recoveredItemId: z.literal(ITEM_IDS.scrapMetal),
    targets: z.object({
      mountingBracket: z.object({
        actionId: z.literal(ACTION_IDS.mountingBracketTinkering),
        recipeActionId: z.literal(ACTION_IDS.mountingBracketFabrication),
      }),
      scrapBox: z.object({
        actionId: z.literal(ACTION_IDS.scrapBoxTinkering),
        recipeActionId: z.literal(ACTION_IDS.scrapBoxFabrication),
      }),
      salvageCutter: z.object({
        actionId: z.literal(ACTION_IDS.salvageCutterTinkering),
        recipeActionId: z.literal(ACTION_IDS.salvageCutterFabrication),
      }),
      // Fabrication 5 and 8 (#233). Every value still derives from the recipe;
      // the Power Cell target dismantles its whole two-Cell batch.
      galvanicWireSpool: z.object({
        actionId: z.literal(ACTION_IDS.galvanicWireSpoolTinkering),
        recipeActionId: z.literal(ACTION_IDS.galvanicWireSpoolFabrication),
      }),
      powerCells: z.object({
        actionId: z.literal(ACTION_IDS.powerCellTinkering),
        recipeActionId: z.literal(ACTION_IDS.powerCellFabrication),
      }),
      loadsteelCutter: z.object({
        actionId: z.literal(ACTION_IDS.loadsteelCutterTinkering),
        recipeActionId: z.literal(ACTION_IDS.loadsteelCutterFabrication),
      }),
      // Ordinary derived Tinkering (#322); the Wheel Assembly has no exception.
      wheelAssembly: z.object({
        actionId: z.literal(ACTION_IDS.wheelAssemblyTinkering),
        recipeActionId: z.literal(ACTION_IDS.wheelAssemblyFabrication),
      }),
      // Ordinary derived Tinkering (#330); the Drive Mount has no exception.
      driveMount: z.object({
        actionId: z.literal(ACTION_IDS.driveMountTinkering),
        recipeActionId: z.literal(ACTION_IDS.driveMountFabrication),
      }),
      freightHarness: z.object({
        actionId: z.literal(ACTION_IDS.freightHarnessTinkering),
        recipeActionId: z.literal(ACTION_IDS.freightHarnessFabrication),
      }),
    }),
  }),
  /**
   * Runeworking (#391): attuning rune material at the Wise Old Enby's Resonance
   * Rig on Hilltop Workshop.
   *
   * Its own authored recipe boundary, like Fabrication and deliberately not a
   * Refining variant: a recipe is inputs, one authored output batch, a duration
   * and base XP, and it never fails — there is no chance, Manual Override,
   * minigame or byproduct. Each recipe carries its own action ID for the
   * durable-identity reason every recipe does. The Beginner Echo Seeker is the
   * one shipped recipe: one Rune Fragment in, one Seeker out (200 g either way).
   */
  runeworking: z.object({
    skillId: z.literal(SKILL_IDS.runeworking),
    recipes: z.object({
      beginnerEchoSeeker: z.object({
        actionId: z.literal(ACTION_IDS.beginnerEchoSeekerRuneworking),
        outputItemId: z.literal(ITEM_IDS.beginnerEchoSeeker),
        outputQuantity: z.literal(1),
        minimumLevel: z.literal(1),
        durationTicks: z.literal(34),
        baseXp: z.literal(25),
        inputs: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.runeFragment), quantity: z.literal(1) }),
        ]),
      }),
    }),
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
    /**
     * ForceSales' daily full-board refresh (#217): one manual refresh per
     * RuneSpace Pacific reset date, once the board is unlocked and the
     * character has reached this Refining level. A per-job `requiredRefiningLevel`
     * (`game/content/work-orders`) is what actually gates the new jobs
     * themselves; this is the separate, smaller gate on the refresh feature.
     */
    refresh: z.object({
      requiredRefiningLevel: z.literal(5),
    }),
  }),
  /**
   * Milky Waymo passenger shuttle (#404): one fare, one duration, both
   * directions. Authored in real seconds because, like a Rivet flight, a journey
   * is scheduled by its recorded absolute arrival instant, never a tick count.
   */
  passengerTravel: z.object({
    actionId: z.literal(ACTION_IDS.passengerTravel),
    fareCredits: z.literal(200),
    durationSeconds: z.literal(180),
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
  /**
   * The Rivet Utility Shuttle (#358). The tank holds 300 Fuel Units and every
   * character's ship starts empty. Which routes exist is content
   * (`game/content/ship-routes`); what each costs and how long it takes is here.
   * A flight's duration is authored in real seconds (#375): the approved 260-second
   * interplanetary leg is not a whole number of 600 ms ticks, and a flight is
   * scheduled by its recorded absolute arrival instant rather than by counting
   * ticks, so the first flight's 15 seconds (formerly 25 ticks) is unchanged.
   */
  ship: z.object({
    actionId: z.literal(ACTION_IDS.shipFlight),
    tankCapacityFuelUnits: z.literal(300),
    startingFuelUnits: z.literal(0),
    flights: z.object({
      [SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding]: z.object({
        fuelCostFuelUnits: z.literal(10),
        durationSeconds: z.literal(15),
      }),
      // Holo Hollow Landing <-> Stillreach Landing Station (#375): 120 FU and
      // 4 minutes 20 seconds each way, no extra fee.
      [SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation]: z.object({
        fuelCostFuelUnits: z.literal(120),
        durationSeconds: z.literal(260),
      }),
      [SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding]: z.object({
        fuelCostFuelUnits: z.literal(120),
        durationSeconds: z.literal(260),
      }),
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
     * Practice stock (#190). Fungible, stacking to three (#230, ahead of
     * Fabrication): six pieces still take two ordinary inventory slots, so
     * carrying Scrap stays a real decision. Consuming Scrap frees a slot only
     * when it empties a stack — see `resolvePracticeWelding`.
     */
    scrapMetal: z.object({
      itemId: z.literal(ITEM_IDS.scrapMetal),
      massGrams: z.literal(300),
      stackLimit: z.literal(3),
    }),
    /**
     * The starter Mining tool. Its `equipment` block (#233) is the one home of
     * everything that makes it a Mining tool — see `EquipmentDefinition`. At
     * 1.00× duration, and charged it takes the global Power Cell speed rule:
     * a charged Salvage Cutter is faster attempts.
     */
    salvageCutter: z.object({
      itemId: z.literal(ITEM_IDS.salvageCutter),
      massGrams: z.literal(5_000),
      equipment: z.object({
        kind: z.literal("mining_tool"),
        requiredMiningLevel: z.literal(1),
        maximumCharge: z.literal(10),
        baseDurationMultiplierBps: z.literal(10_000),
        chargedEffect: z.object({ kind: z.literal("speed") }),
      }),
    }),
    /**
     * The Fabrication 5 Mining tool (#233). A permanent 0.8× base duration,
     * charged or not, is its speed. Charged, it does not take the Power Cell
     * speed rule; instead each successful charged attempt adds one ore to the
     * source's ordinary yield — a charged Loadsteel Cutter is more ore per
     * success. Same ten charges per Cell as the Salvage Cutter.
     */
    loadsteelCutter: z.object({
      itemId: z.literal(ITEM_IDS.loadsteelCutter),
      massGrams: z.literal(8_000),
      equipment: z.object({
        kind: z.literal("mining_tool"),
        requiredMiningLevel: z.literal(5),
        maximumCharge: z.literal(10),
        baseDurationMultiplierBps: z.literal(8_000),
        chargedEffect: z.object({ kind: z.literal("extra_yield"), units: z.literal(1) }),
      }),
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
      equipment: z.object({ kind: z.literal("container"), slotCapacity: z.literal(8) }),
    }),
    /**
     * Tier-1 Fabrication outputs (#232). The Bracket's 300 g is exactly its
     * two 150 g Refined Ferrite. The Scrap Box is a crude, overbuilt container
     * attachment: half the MYKEA's mass for a little under half its storage,
     * using the existing container slots rather than a new one.
     */
    mountingBracket: z.object({
      itemId: z.literal(ITEM_IDS.mountingBracket),
      massGrams: z.literal(300),
      stackLimit: z.literal(5),
    }),
    scrapBox: z.object({
      itemId: z.literal(ITEM_IDS.scrapBox),
      massGrams: z.literal(5_000),
      equipment: z.object({ kind: z.literal("container"), slotCapacity: z.literal(3) }),
    }),
    /**
     * Fabrication 5 and 8 outputs (#233). The Wire Spool's 1 kg is its 800 g of
     * Galvanic Stock plus the station's own winding and insulation, and it
     * stacks only three deep, so bulk wire stays heavy. The Freight Harness is
     * an advanced container, not a carry-capacity upgrade: its 9 kg is carried
     * like any other equipment.
     */
    galvanicWireSpool: z.object({
      itemId: z.literal(ITEM_IDS.galvanicWireSpool),
      massGrams: z.literal(1_000),
      stackLimit: z.literal(3),
    }),
    /**
     * The Wheel Assembly (#322): 1,550 g, conserved through its authored inputs,
     * and two to a stack so the Landing Gear's whole wheel requirement is one
     * carried stack with no Mission-specific inventory behaviour.
     */
    wheelAssembly: z.object({
      itemId: z.literal(ITEM_IDS.wheelAssembly),
      massGrams: z.literal(1_550),
      stackLimit: z.literal(2),
    }),
    /**
     * The Drive Mount (#330): 2,900 g, conserved through its authored inputs, and
     * two to a stack so the Propulsion System's whole mount requirement is one
     * carried stack with no Mission-specific inventory behaviour.
     */
    driveMount: z.object({
      itemId: z.literal(ITEM_IDS.driveMount),
      massGrams: z.literal(2_900),
      stackLimit: z.literal(2),
    }),
    freightHarness: z.object({
      itemId: z.literal(ITEM_IDS.freightHarness),
      massGrams: z.literal(9_000),
      equipment: z.object({ kind: z.literal("container"), slotCapacity: z.literal(6) }),
    }),
    /**
     * Mining Secondary Finds (#308): rough gemstones. Each owns the one bonus
     * Mining XP it is worth wherever a source's table awards it, so the same
     * Topaz is worth the same at The Jag and at Deep Jag and no source restates
     * it. Two to a stack keeps a few specimens a real carrying decision.
     */
    uncutQuartz: z.object({
      itemId: z.literal(ITEM_IDS.uncutQuartz),
      massGrams: z.literal(100),
      stackLimit: z.literal(2),
      secondaryFindMiningXp: z.literal(10),
    }),
    uncutTopaz: z.object({
      itemId: z.literal(ITEM_IDS.uncutTopaz),
      massGrams: z.literal(100),
      stackLimit: z.literal(2),
      secondaryFindMiningXp: z.literal(20),
    }),
    uncutSapphire: z.object({
      itemId: z.literal(ITEM_IDS.uncutSapphire),
      massGrams: z.literal(100),
      stackLimit: z.literal(2),
      secondaryFindMiningXp: z.literal(30),
    }),
    /**
     * Skatboll Oil Shale (#342): 600 g a piece, five to a stack, so a full
     * stack is 3 kg and the slot count is the real limit. The Motherlode Slab is
     * one unbroken 12 kg specimen: it never stacks, and it owns its +150 Mining
     * XP exactly as every other find owns its own.
     */
    oilShale: z.object({
      itemId: z.literal(ITEM_IDS.oilShale),
      massGrams: z.literal(600),
      stackLimit: z.literal(5),
    }),
    motherlodeSlab: z.object({
      itemId: z.literal(ITEM_IDS.motherlodeSlab),
      massGrams: z.literal(12_000),
      stackLimit: z.literal(1),
      secondaryFindMiningXp: z.literal(150),
    }),
    /**
     * Fuel manufacturing (#343). The empty shell is exactly the 800 g Galvanic
     * Stock it is fabricated from and stacks five deep. The full canister is
     * 6,000 g — its shell plus 5.2 kg of fuel — and stacks two deep, so a pair
     * is a real carrying decision. The 800 g that 10 Oil Shale (6,000 g) plus
     * the shell (800 g) lose on success is process waste, not an inventory item.
     *
     * `fuelUnits` is the content the full canister carries: loading one into the
     * Rivet's tank adds this many Fuel Units (#358).
     */
    emptySmallFuelCanister: z.object({
      itemId: z.literal(ITEM_IDS.emptySmallFuelCanister),
      massGrams: z.literal(800),
      stackLimit: z.literal(5),
    }),
    fullSmallFuelCanister: z.object({
      itemId: z.literal(ITEM_IDS.fullSmallFuelCanister),
      massGrams: z.literal(6_000),
      stackLimit: z.literal(2),
      fuelUnits: z.literal(50),
    }),
    /**
     * Rune materials (#367). A Rune Fragment is a 200 g Mining Secondary Find that
     * owns its +20 Mining XP like every other find. The intact Runestone is
     * exactly five Fragments' mass (1,000 g) and breaks apart into them, so the
     * conversion conserves mass (`runeMaterials.breakApart`).
     */
    runeFragment: z.object({
      itemId: z.literal(ITEM_IDS.runeFragment),
      massGrams: z.literal(200),
      stackLimit: z.literal(10),
      secondaryFindMiningXp: z.literal(20),
    }),
    /**
     * The intact Runestone (#383) is a Mining Secondary Find at Harmonic Workings,
     * so it authors its find XP explicitly: 130, paid once when it is actually kept
     * in carried Inventory (owner correction, October 22). That bonus belongs to the
     * find, not to using or breaking apart a Runestone, and no +20 Fragment bonus
     * is implied.
     */
    runestone: z.object({
      itemId: z.literal(ITEM_IDS.runestone),
      massGrams: z.literal(1_000),
      stackLimit: z.literal(5),
      secondaryFindMiningXp: z.literal(130),
    }),
    /**
     * The Beginner Echo Seeker (#391): a Rune Fragment attuned at the Resonance
     * Rig, so it keeps the Fragment's 200 g. Five to a stack.
     */
    beginnerEchoSeeker: z.object({
      itemId: z.literal(ITEM_IDS.beginnerEchoSeeker),
      massGrams: z.literal(200),
      stackLimit: z.literal(5),
    }),
    /**
     * The Legendary miner's set (#399), the rarest Beginner Echo prizes. Unique,
     * nonstackable equipment: each find is its own item instance. Equipped, each
     * piece is worth one effective Mining level for success chance only, from its
     * `wearable` equipment block — see `EquipmentDefinition`.
     */
    minersBoots: z.object({
      itemId: z.literal(ITEM_IDS.minersBoots),
      massGrams: z.literal(2_000),
      equipment: z.object({
        kind: z.literal("wearable"),
        slot: z.literal("feet"),
        miningSuccessLevelBonus: z.literal(1),
      }),
    }),
    minersGloves: z.object({
      itemId: z.literal(ITEM_IDS.minersGloves),
      massGrams: z.literal(1_000),
      equipment: z.object({
        kind: z.literal("wearable"),
        slot: z.literal("hands"),
        miningSuccessLevelBonus: z.literal(1),
      }),
    }),
    /**
     * The Wise Old Enby's research-job loan items (#406). Each is one unique,
     * nonstackable ordinary Inventory item: it takes a real slot and its real
     * mass (the packet is a substantial 2 kg), and nothing is exempt from
     * carrying capacity. Whether an item is a loan is the job registry's
     * (`game/content/research-jobs`), not a flag here.
     */
    sealedResearchPacket: z.object({
      itemId: z.literal(ITEM_IDS.sealedResearchPacket),
      massGrams: z.literal(2_000),
    }),
    geologicalSampleCase: z.object({
      itemId: z.literal(ITEM_IDS.geologicalSampleCase),
      massGrams: z.literal(100),
    }),
    resonanceSampler: z.object({
      itemId: z.literal(ITEM_IDS.resonanceSampler),
      massGrams: z.literal(100),
    }),
    /**
     * Stillreach Stone (#379): 1 kg a piece, five to a stack, so a full stack is
     * 5 kg and the slot count is the real limit. The Boulder is one unbroken 5 kg
     * specimen: it never stacks, and it owns its +150 Mining XP like every other
     * find. Nothing breaks it down, buys it or converts it into Stone.
     */
    stone: z.object({
      itemId: z.literal(ITEM_IDS.stone),
      massGrams: z.literal(1_000),
      stackLimit: z.literal(5),
    }),
    boulder: z.object({
      itemId: z.literal(ITEM_IDS.boulder),
      massGrams: z.literal(5_000),
      stackLimit: z.literal(1),
      secondaryFindMiningXp: z.literal(150),
    }),
  }),
  /**
   * Rune materials (#367). Break Apart is the one Inventory conversion: one intact
   * Runestone becomes exactly five Rune Fragments (1,000 g either way), with no
   * tool, location, timer or XP. The same item IDs author the Mining finds and
   * stack facts, so the conversion owns only the ratio.
   */
  runeMaterials: z.object({
    breakApart: z.object({
      inputItemId: z.literal(ITEM_IDS.runestone),
      outputItemId: z.literal(ITEM_IDS.runeFragment),
      outputQuantity: z.literal(5),
    }),
  }),
  /**
   * The Wise Old Enby's repeatable research jobs (#406). Field actions are whole
   * game ticks (8 ticks = 4.8 s at the 600 ms tick), the authoritative duration;
   * any seconds copy is derived from it. The two Credits jobs pay no XP, and the
   * Calibration teleport pays neither Credits nor XP.
   */
  researchJobs: z.object({
    surfaceSampleActionId: z.literal(ACTION_IDS.researchSurfaceSample),
    surfaceSampleDurationTicks: z.literal(8),
    resonanceRecordingActionId: z.literal(ACTION_IDS.researchResonanceRecording),
    resonanceRecordingDurationTicks: z.literal(8),
    courierRewardCredits: z.literal(25),
    surveyRewardCredits: z.literal(75),
  }),
  /**
   * Beginner Resonance Echo hunts (#393): reading a Beginner Echo Seeker from
   * Inventory. One stationary reading takes 8 ticks (4.8 s) and consumes exactly
   * one Seeker, found or not. A wrong reading pays nothing; a discovery pays the
   * fixed 50 Runeworking XP and rolls exactly one ordinary item from the
   * current planet's table.
   *
   * Each table is integer weights out of `rewardWeightTotal` (per mille). The
   * approved full tables reserve 0.2% for a Legendary that is not shipped yet
   * (Slice J); until then that 0.2 point sits on Rune Fragment (30.2%), so each
   * table is a complete ordinary-only roll. Where each planet's hidden targets
   * may be is content (`game/content/echo-hunts`), not balance.
   */
  echoHunts: z.object({
    beginner: z.object({
      readingActionId: z.literal(ACTION_IDS.beginnerEchoReading),
      seekerItemId: z.literal(ITEM_IDS.beginnerEchoSeeker),
      readingDurationTicks: z.literal(8),
      seekersPerReading: z.literal(1),
      discoveryXp: z.literal(50),
      rewardWeightTotal: z.literal(1_000),
      rewardTables: z.object({
        [PLANET_IDS.skatboll]: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.runeFragment), weight: z.literal(300) }),
          z.object({ itemId: z.literal(ITEM_IDS.uncutQuartz), weight: z.literal(240) }),
          z.object({ itemId: z.literal(ITEM_IDS.uncutTopaz), weight: z.literal(160) }),
          z.object({ itemId: z.literal(ITEM_IDS.uncutSapphire), weight: z.literal(100) }),
          z.object({ itemId: z.literal(ITEM_IDS.refinedFerrite), weight: z.literal(120) }),
          z.object({ itemId: z.literal(ITEM_IDS.galvanicStock), weight: z.literal(50) }),
          z.object({ itemId: z.literal(ITEM_IDS.runestone), weight: z.literal(28) }),
          z.object({ itemId: z.literal(ITEM_IDS.minersBoots), weight: z.literal(2) }),
        ]),
        [PLANET_IDS.stillreach]: z.tuple([
          z.object({ itemId: z.literal(ITEM_IDS.runeFragment), weight: z.literal(300) }),
          z.object({ itemId: z.literal(ITEM_IDS.uncutQuartz), weight: z.literal(260) }),
          z.object({ itemId: z.literal(ITEM_IDS.uncutTopaz), weight: z.literal(200) }),
          z.object({ itemId: z.literal(ITEM_IDS.uncutSapphire), weight: z.literal(100) }),
          z.object({
            itemId: z.literal(ITEM_IDS.emptySmallFuelCanister),
            weight: z.literal(100),
          }),
          z.object({ itemId: z.literal(ITEM_IDS.runestone), weight: z.literal(38) }),
          z.object({ itemId: z.literal(ITEM_IDS.minersGloves), weight: z.literal(2) }),
        ]),
      }),
    }),
  }),
  carrying: z.object({
    startingCapacityGrams: z.literal(50_000),
    /**
     * The suit's authored equipment slots: one Mining-tool gear slot and two
     * container attachments. An item's equipment kind decides which of them
     * it fits (`getEquipmentDefinition`); no item names a slot of its own.
     */
    miningToolSuitSlotId: z.literal("mining_tool"),
    containerSuitSlotIds: z.tuple([
      z.literal("container_attachment_1"),
      z.literal("container_attachment_2"),
    ]),
    /** The suit's hands and feet gear slots (#399): one wearable of each. */
    handsSuitSlotId: z.literal("hands"),
    feetSuitSlotId: z.literal("feet"),
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
        requiredMiningLevel: 1,
        lowYield: null,
        secondaryFinds: [
          { itemId: ITEM_IDS.uncutQuartz, oneIn: 40, announce: false },
          { itemId: ITEM_IDS.uncutTopaz, oneIn: 60, announce: true },
          { itemId: ITEM_IDS.runeFragment, oneIn: 25, announce: false },
        ],
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
        requiredMiningLevel: 1,
        lowYield: null,
        secondaryFinds: [
          { itemId: ITEM_IDS.uncutTopaz, oneIn: 35, announce: false },
          { itemId: ITEM_IDS.uncutSapphire, oneIn: 55, announce: true },
          { itemId: ITEM_IDS.runeFragment, oneIn: 8, announce: false },
        ],
      },
      oilShale: {
        actionId: ACTION_IDS.oilShaleMining,
        itemId: ITEM_IDS.oilShale,
        attemptDurationTicks: 100,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 50,
        successRangeBps: 6_500,
        successXp: 100,
        yieldMinimum: 2,
        yieldMaximum: 4,
        requiredMiningLevel: 5,
        lowYield: { quantity: 1, xp: 20 },
        secondaryFinds: [
          { itemId: ITEM_IDS.uncutSapphire, oneIn: 20, announce: false },
          { itemId: ITEM_IDS.motherlodeSlab, oneIn: 100, announce: true },
          { itemId: ITEM_IDS.runeFragment, oneIn: 6, announce: false },
        ],
      },
      stone: {
        actionId: ACTION_IDS.stoneMining,
        itemId: ITEM_IDS.stone,
        attemptDurationTicks: 33,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 30,
        successRangeBps: 6_500,
        successXp: 45,
        yieldMinimum: 1,
        yieldMaximum: 2,
        requiredMiningLevel: 1,
        lowYield: null,
        secondaryFinds: [
          { itemId: ITEM_IDS.runeFragment, oneIn: 4, announce: false },
          { itemId: ITEM_IDS.uncutQuartz, oneIn: 6, announce: false },
          { itemId: ITEM_IDS.uncutTopaz, oneIn: 12, announce: false },
          { itemId: ITEM_IDS.boulder, oneIn: 200, announce: true },
        ],
      },
      harmonicMining: {
        actionId: ACTION_IDS.harmonicMining,
        itemId: ITEM_IDS.runeFragment,
        attemptDurationTicks: 75,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 40,
        successRangeBps: 6_500,
        successXp: 130,
        yieldMinimum: 1,
        yieldMaximum: 2,
        requiredMiningLevel: 8,
        lowYield: null,
        secondaryFinds: [
          { itemId: ITEM_IDS.runestone, oneIn: 8, announce: false },
          { itemId: ITEM_IDS.uncutSapphire, oneIn: 20, announce: true },
        ],
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
      ferriteShaleSlag: {
        actionId: ACTION_IDS.ferriteShaleSlagRefining,
        outputItemId: ITEM_IDS.slag,
        minimumLevel: 5,
        attemptDurationTicks: 6,
        successXp: 3,
        inputs: [{ itemId: ITEM_IDS.ferriteShale, quantity: 2 }],
        outputQuantity: 1,
        failure: { kind: "none" },
      },
      galvaniteSlag: {
        actionId: ACTION_IDS.galvaniteSlagRefining,
        outputItemId: ITEM_IDS.slag,
        minimumLevel: 5,
        attemptDurationTicks: 8,
        successXp: 5,
        inputs: [{ itemId: ITEM_IDS.galvanite, quantity: 2 }],
        outputQuantity: 2,
        failure: { kind: "none" },
      },
      smallFuelCanister: {
        actionId: ACTION_IDS.fullSmallFuelCanisterRefining,
        outputItemId: ITEM_IDS.fullSmallFuelCanister,
        minimumLevel: 8,
        attemptDurationTicks: 60,
        successAtLevelOneBps: 3_500,
        guaranteedSuccessLevel: 30,
        successRangeBps: 6_500,
        successXp: 100,
        failureXp: 20,
        inputs: [
          { itemId: ITEM_IDS.oilShale, quantity: 10 },
          { itemId: ITEM_IDS.emptySmallFuelCanister, quantity: 1 },
        ],
        outputQuantity: 1,
        failure: {
          kind: "fixed_outputs",
          outputs: [
            { itemId: ITEM_IDS.oilShale, quantity: 5 },
            { itemId: ITEM_IDS.emptySmallFuelCanister, quantity: 1 },
          ],
        },
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
    siteStashTheJag: {
      targetId: REPAIR_TARGET_IDS.siteStashTheJag,
      actionId: ACTION_IDS.siteStashTheJagWelding,
      materials: [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 6 },
        { itemId: ITEM_IDS.slag, quantity: 3 },
      ],
      repairIncrements: 6,
    },
    siteStashRuskRecovery: {
      targetId: REPAIR_TARGET_IDS.siteStashRuskRecovery,
      actionId: ACTION_IDS.siteStashRuskRecoveryWelding,
      materials: [
        { itemId: ITEM_IDS.galvanicStock, quantity: 3 },
        { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
      ],
      repairIncrements: 10,
    },
    siteStashProcessingYard: {
      targetId: REPAIR_TARGET_IDS.siteStashProcessingYard,
      actionId: ACTION_IDS.siteStashProcessingYardWelding,
      materials: [
        { itemId: ITEM_IDS.galvanicStock, quantity: 3 },
        { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
      ],
      repairIncrements: 10,
    },
    siteStashDeepJag: {
      targetId: REPAIR_TARGET_IDS.siteStashDeepJag,
      actionId: ACTION_IDS.siteStashDeepJagWelding,
      materials: [
        { itemId: ITEM_IDS.galvaferrite, quantity: 2 },
        { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
        { itemId: ITEM_IDS.galvanicStock, quantity: 1 },
      ],
      repairIncrements: 15,
    },
    curlyStashMount: {
      targetId: REPAIR_TARGET_IDS.curlyStashMount,
      actionId: ACTION_IDS.curlyStashMountWelding,
      materials: [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 6 },
        { itemId: ITEM_IDS.slag, quantity: 3 },
      ],
      repairIncrements: 6,
    },
    landingGear: {
      targetId: REPAIR_TARGET_IDS.landingGear,
      actionId: ACTION_IDS.landingGearWelding,
      materials: [
        { itemId: ITEM_IDS.wheelAssembly, quantity: 2 },
        { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
        { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
      ],
      repairIncrements: 12,
    },
    propulsion: {
      targetId: REPAIR_TARGET_IDS.propulsionSystem,
      actionId: ACTION_IDS.propulsionWelding,
      materials: [
        { itemId: ITEM_IDS.driveMount, quantity: 2 },
        { itemId: ITEM_IDS.galvaferrite, quantity: 1 },
        { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
        { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
      ],
      repairIncrements: 16,
    },
  },
  cargoHold: {
    capacitySlots: 32,
  },
  fabrication: {
    skillId: SKILL_IDS.fabrication,
    recipes: {
      mountingBracket: {
        actionId: ACTION_IDS.mountingBracketFabrication,
        outputItemId: ITEM_IDS.mountingBracket,
        outputQuantity: 1,
        minimumLevel: 1,
        durationTicks: 12,
        baseXp: 25,
        inputs: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 2 }],
      },
      scrapMetal: {
        actionId: ACTION_IDS.scrapMetalFabrication,
        outputItemId: ITEM_IDS.scrapMetal,
        outputQuantity: 1,
        minimumLevel: 1,
        durationTicks: 10,
        baseXp: 10,
        inputs: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 2 }],
      },
      scrapBox: {
        actionId: ACTION_IDS.scrapBoxFabrication,
        outputItemId: ITEM_IDS.scrapBox,
        outputQuantity: 1,
        minimumLevel: 1,
        durationTicks: 36,
        baseXp: 81,
        inputs: [
          { itemId: ITEM_IDS.mountingBracket, quantity: 1 },
          { itemId: ITEM_IDS.scrapMetal, quantity: 2 },
          { itemId: ITEM_IDS.refinedFerrite, quantity: 3 },
        ],
      },
      salvageCutter: {
        actionId: ACTION_IDS.salvageCutterFabrication,
        outputItemId: ITEM_IDS.salvageCutter,
        outputQuantity: 1,
        minimumLevel: 1,
        durationTicks: 20,
        baseXp: 65,
        inputs: [
          { itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
          { itemId: ITEM_IDS.powerCell, quantity: 1 },
        ],
      },
      galvanicScrap: {
        actionId: ACTION_IDS.galvanicScrapFabrication,
        outputItemId: ITEM_IDS.scrapMetal,
        outputQuantity: 2,
        minimumLevel: 5,
        durationTicks: 14,
        baseXp: 15,
        inputs: [{ itemId: ITEM_IDS.galvanicStock, quantity: 1 }],
      },
      galvanicWireSpool: {
        actionId: ACTION_IDS.galvanicWireSpoolFabrication,
        outputItemId: ITEM_IDS.galvanicWireSpool,
        outputQuantity: 1,
        minimumLevel: 5,
        durationTicks: 24,
        baseXp: 45,
        inputs: [{ itemId: ITEM_IDS.galvanicStock, quantity: 1 }],
      },
      powerCells: {
        actionId: ACTION_IDS.powerCellFabrication,
        outputItemId: ITEM_IDS.powerCell,
        outputQuantity: 2,
        minimumLevel: 5,
        durationTicks: 30,
        baseXp: 75,
        inputs: [{ itemId: ITEM_IDS.galvanicStock, quantity: 1 }],
      },
      loadsteelCutter: {
        actionId: ACTION_IDS.loadsteelCutterFabrication,
        outputItemId: ITEM_IDS.loadsteelCutter,
        outputQuantity: 1,
        minimumLevel: 5,
        durationTicks: 45,
        baseXp: 180,
        inputs: [
          { itemId: ITEM_IDS.galvaferrite, quantity: 2 },
          { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
          { itemId: ITEM_IDS.powerCell, quantity: 1 },
        ],
      },
      wheelAssembly: {
        actionId: ACTION_IDS.wheelAssemblyFabrication,
        outputItemId: ITEM_IDS.wheelAssembly,
        outputQuantity: 1,
        minimumLevel: 5,
        durationTicks: 36,
        baseXp: 100,
        inputs: [
          { itemId: ITEM_IDS.refinedFerrite, quantity: 3 },
          { itemId: ITEM_IDS.galvanicStock, quantity: 1 },
          { itemId: ITEM_IDS.mountingBracket, quantity: 1 },
        ],
      },
      driveMount: {
        actionId: ACTION_IDS.driveMountFabrication,
        outputItemId: ITEM_IDS.driveMount,
        outputQuantity: 1,
        minimumLevel: 8,
        durationTicks: 48,
        baseXp: 200,
        inputs: [
          { itemId: ITEM_IDS.galvaferrite, quantity: 2 },
          { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
        ],
      },
      freightHarness: {
        actionId: ACTION_IDS.freightHarnessFabrication,
        outputItemId: ITEM_IDS.freightHarness,
        outputQuantity: 1,
        minimumLevel: 8,
        durationTicks: 60,
        baseXp: 270,
        inputs: [
          { itemId: ITEM_IDS.galvaferrite, quantity: 4 },
          { itemId: ITEM_IDS.mountingBracket, quantity: 2 },
        ],
      },
      emptySmallFuelCanister: {
        actionId: ACTION_IDS.emptySmallFuelCanisterFabrication,
        outputItemId: ITEM_IDS.emptySmallFuelCanister,
        outputQuantity: 1,
        minimumLevel: 8,
        durationTicks: 30,
        baseXp: 75,
        inputs: [{ itemId: ITEM_IDS.galvanicStock, quantity: 1 }],
      },
    },
    manualOverride: {
      loadMinimum: 1,
      loadMaximum: 10,
      initialLoadMinimum: 2,
      initialLoadMaximum: 9,
      safeRange: 2,
      maximumPushes: 5,
      safePushMultiplierBps: 12_000,
      exactPushMultiplierBps: 13_000,
    },
  },
  tinkering: {
    skillId: SKILL_IDS.fabrication,
    durationMultiplier: 2,
    inputUnitsPerScrap: 2,
    recoveredItemId: ITEM_IDS.scrapMetal,
    targets: {
      mountingBracket: {
        actionId: ACTION_IDS.mountingBracketTinkering,
        recipeActionId: ACTION_IDS.mountingBracketFabrication,
      },
      scrapBox: {
        actionId: ACTION_IDS.scrapBoxTinkering,
        recipeActionId: ACTION_IDS.scrapBoxFabrication,
      },
      salvageCutter: {
        actionId: ACTION_IDS.salvageCutterTinkering,
        recipeActionId: ACTION_IDS.salvageCutterFabrication,
      },
      galvanicWireSpool: {
        actionId: ACTION_IDS.galvanicWireSpoolTinkering,
        recipeActionId: ACTION_IDS.galvanicWireSpoolFabrication,
      },
      powerCells: {
        actionId: ACTION_IDS.powerCellTinkering,
        recipeActionId: ACTION_IDS.powerCellFabrication,
      },
      loadsteelCutter: {
        actionId: ACTION_IDS.loadsteelCutterTinkering,
        recipeActionId: ACTION_IDS.loadsteelCutterFabrication,
      },
      wheelAssembly: {
        actionId: ACTION_IDS.wheelAssemblyTinkering,
        recipeActionId: ACTION_IDS.wheelAssemblyFabrication,
      },
      driveMount: {
        actionId: ACTION_IDS.driveMountTinkering,
        recipeActionId: ACTION_IDS.driveMountFabrication,
      },
      freightHarness: {
        actionId: ACTION_IDS.freightHarnessTinkering,
        recipeActionId: ACTION_IDS.freightHarnessFabrication,
      },
    },
  },
  runeworking: {
    skillId: SKILL_IDS.runeworking,
    recipes: {
      beginnerEchoSeeker: {
        actionId: ACTION_IDS.beginnerEchoSeekerRuneworking,
        outputItemId: ITEM_IDS.beginnerEchoSeeker,
        outputQuantity: 1,
        minimumLevel: 1,
        durationTicks: 34,
        baseXp: 25,
        inputs: [{ itemId: ITEM_IDS.runeFragment, quantity: 1 }],
      },
    },
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
    refresh: {
      requiredRefiningLevel: 5,
    },
  },
  ship: {
    actionId: ACTION_IDS.shipFlight,
    tankCapacityFuelUnits: 300,
    startingFuelUnits: 0,
    flights: {
      [SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding]: {
        fuelCostFuelUnits: 10,
        durationSeconds: 15,
      },
      [SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation]: {
        fuelCostFuelUnits: 120,
        durationSeconds: 260,
      },
      [SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding]: {
        fuelCostFuelUnits: 120,
        durationSeconds: 260,
      },
    },
  },
  passengerTravel: {
    actionId: ACTION_IDS.passengerTravel,
    fareCredits: 200,
    durationSeconds: 180,
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
    scrapMetal: { itemId: ITEM_IDS.scrapMetal, massGrams: 300, stackLimit: 3 },
    salvageCutter: {
      itemId: ITEM_IDS.salvageCutter,
      massGrams: 5_000,
      equipment: {
        kind: "mining_tool",
        requiredMiningLevel: 1,
        maximumCharge: 10,
        baseDurationMultiplierBps: 10_000,
        chargedEffect: { kind: "speed" },
      },
    },
    loadsteelCutter: {
      itemId: ITEM_IDS.loadsteelCutter,
      massGrams: 8_000,
      equipment: {
        kind: "mining_tool",
        requiredMiningLevel: 5,
        maximumCharge: 10,
        baseDurationMultiplierBps: 8_000,
        chargedEffect: { kind: "extra_yield", units: 1 },
      },
    },
    powerCell: { itemId: ITEM_IDS.powerCell, massGrams: 500, stackLimit: 5 },
    galvanite: { itemId: ITEM_IDS.galvanite, massGrams: 400, stackLimit: 10 },
    galvanicStock: { itemId: ITEM_IDS.galvanicStock, massGrams: 800, stackLimit: 5 },
    galvaferrite: { itemId: ITEM_IDS.galvaferrite, massGrams: 950, stackLimit: 3 },
    starterContainer: {
      itemId: ITEM_IDS.mykeaSchleppraum8,
      massGrams: 10_000,
      equipment: { kind: "container", slotCapacity: 8 },
    },
    mountingBracket: { itemId: ITEM_IDS.mountingBracket, massGrams: 300, stackLimit: 5 },
    scrapBox: {
      itemId: ITEM_IDS.scrapBox,
      massGrams: 5_000,
      equipment: { kind: "container", slotCapacity: 3 },
    },
    galvanicWireSpool: { itemId: ITEM_IDS.galvanicWireSpool, massGrams: 1_000, stackLimit: 3 },
    wheelAssembly: { itemId: ITEM_IDS.wheelAssembly, massGrams: 1_550, stackLimit: 2 },
    driveMount: { itemId: ITEM_IDS.driveMount, massGrams: 2_900, stackLimit: 2 },
    freightHarness: {
      itemId: ITEM_IDS.freightHarness,
      massGrams: 9_000,
      equipment: { kind: "container", slotCapacity: 6 },
    },
    uncutQuartz: {
      itemId: ITEM_IDS.uncutQuartz,
      massGrams: 100,
      stackLimit: 2,
      secondaryFindMiningXp: 10,
    },
    uncutTopaz: {
      itemId: ITEM_IDS.uncutTopaz,
      massGrams: 100,
      stackLimit: 2,
      secondaryFindMiningXp: 20,
    },
    uncutSapphire: {
      itemId: ITEM_IDS.uncutSapphire,
      massGrams: 100,
      stackLimit: 2,
      secondaryFindMiningXp: 30,
    },
    oilShale: { itemId: ITEM_IDS.oilShale, massGrams: 600, stackLimit: 5 },
    motherlodeSlab: {
      itemId: ITEM_IDS.motherlodeSlab,
      massGrams: 12_000,
      stackLimit: 1,
      secondaryFindMiningXp: 150,
    },
    emptySmallFuelCanister: {
      itemId: ITEM_IDS.emptySmallFuelCanister,
      massGrams: 800,
      stackLimit: 5,
    },
    fullSmallFuelCanister: {
      itemId: ITEM_IDS.fullSmallFuelCanister,
      massGrams: 6_000,
      stackLimit: 2,
      fuelUnits: 50,
    },
    runeFragment: {
      itemId: ITEM_IDS.runeFragment,
      massGrams: 200,
      stackLimit: 10,
      secondaryFindMiningXp: 20,
    },
    runestone: {
      itemId: ITEM_IDS.runestone,
      massGrams: 1_000,
      stackLimit: 5,
      secondaryFindMiningXp: 130,
    },
    beginnerEchoSeeker: { itemId: ITEM_IDS.beginnerEchoSeeker, massGrams: 200, stackLimit: 5 },
    minersBoots: {
      itemId: ITEM_IDS.minersBoots,
      massGrams: 2_000,
      equipment: { kind: "wearable", slot: "feet", miningSuccessLevelBonus: 1 },
    },
    minersGloves: {
      itemId: ITEM_IDS.minersGloves,
      massGrams: 1_000,
      equipment: { kind: "wearable", slot: "hands", miningSuccessLevelBonus: 1 },
    },
    sealedResearchPacket: { itemId: ITEM_IDS.sealedResearchPacket, massGrams: 2_000 },
    geologicalSampleCase: { itemId: ITEM_IDS.geologicalSampleCase, massGrams: 100 },
    resonanceSampler: { itemId: ITEM_IDS.resonanceSampler, massGrams: 100 },
    stone: { itemId: ITEM_IDS.stone, massGrams: 1_000, stackLimit: 5 },
    boulder: {
      itemId: ITEM_IDS.boulder,
      massGrams: 5_000,
      stackLimit: 1,
      secondaryFindMiningXp: 150,
    },
  },
  runeMaterials: {
    breakApart: {
      inputItemId: ITEM_IDS.runestone,
      outputItemId: ITEM_IDS.runeFragment,
      outputQuantity: 5,
    },
  },
  researchJobs: {
    surfaceSampleActionId: ACTION_IDS.researchSurfaceSample,
    surfaceSampleDurationTicks: 8,
    resonanceRecordingActionId: ACTION_IDS.researchResonanceRecording,
    resonanceRecordingDurationTicks: 8,
    courierRewardCredits: 25,
    surveyRewardCredits: 75,
  },
  echoHunts: {
    beginner: {
      readingActionId: ACTION_IDS.beginnerEchoReading,
      seekerItemId: ITEM_IDS.beginnerEchoSeeker,
      readingDurationTicks: 8,
      seekersPerReading: 1,
      discoveryXp: 50,
      rewardWeightTotal: 1_000,
      rewardTables: {
        [PLANET_IDS.skatboll]: [
          { itemId: ITEM_IDS.runeFragment, weight: 300 },
          { itemId: ITEM_IDS.uncutQuartz, weight: 240 },
          { itemId: ITEM_IDS.uncutTopaz, weight: 160 },
          { itemId: ITEM_IDS.uncutSapphire, weight: 100 },
          { itemId: ITEM_IDS.refinedFerrite, weight: 120 },
          { itemId: ITEM_IDS.galvanicStock, weight: 50 },
          { itemId: ITEM_IDS.runestone, weight: 28 },
          // Legendary (#399): 2/1000 = 0.2% = 1/500, one prize per planet.
          { itemId: ITEM_IDS.minersBoots, weight: 2 },
        ],
        [PLANET_IDS.stillreach]: [
          { itemId: ITEM_IDS.runeFragment, weight: 300 },
          { itemId: ITEM_IDS.uncutQuartz, weight: 260 },
          { itemId: ITEM_IDS.uncutTopaz, weight: 200 },
          { itemId: ITEM_IDS.uncutSapphire, weight: 100 },
          { itemId: ITEM_IDS.emptySmallFuelCanister, weight: 100 },
          { itemId: ITEM_IDS.runestone, weight: 38 },
          { itemId: ITEM_IDS.minersGloves, weight: 2 },
        ],
      },
    },
  },
  carrying: {
    startingCapacityGrams: 50_000,
    miningToolSuitSlotId: "mining_tool",
    containerSuitSlotIds: ["container_attachment_1", "container_attachment_2"],
    handsSuitSlotId: "hands",
    feetSuitSlotId: "feet",
  },
  credits: { startingBalance: 10 },
});

/** The sole effective-balance boundary until Issue #19 introduces approved overrides. */
export function getEffectiveGameBalance(): EffectiveGameBalance {
  return defaults;
}

/** One flight route's approved cost and duration (#358). */
export type ShipFlightBalance = EffectiveGameBalance["ship"]["flights"][ShipRouteId];

/** The authoritative cost and duration of one authored flight route. */
export function getShipFlightBalance(
  routeId: ShipRouteId,
  balance = getEffectiveGameBalance(),
): ShipFlightBalance {
  const flight = (balance.ship.flights as Readonly<Record<string, ShipFlightBalance | undefined>>)[
    routeId
  ];
  if (!flight) throw new Error(`Ship route "${routeId}" has no approved cost and duration.`);
  return flight;
}

/** One repair target's authoritative recipe. Never reconstruct these values. */
export type RepairTargetBalance =
  EffectiveGameBalance["repairTargets"][keyof EffectiveGameBalance["repairTargets"]];

/** One authored material requirement on a repair recipe (#209). */
export type RepairMaterialRequirement = RepairTargetBalance["materials"][number];

/**
 * One authored Mining source (#209). Its Secondary Find table (#308) is typed
 * as the general list it is, not as today's two-entry literals: a source may
 * author any number of finds, including none, and resolution treats them alike.
 */
export type MiningSourceBalance = {
  [Key in keyof EffectiveGameBalance["mining"]["sources"]]: Omit<
    EffectiveGameBalance["mining"]["sources"][Key],
    "secondaryFinds"
  > & { secondaryFinds: readonly MiningSecondaryFindBalance[] };
}[keyof EffectiveGameBalance["mining"]["sources"]];

/**
 * One authored Secondary Find on a Mining source (#308): a bonus item a
 * successful extraction can turn up beside the source's ordinary ore.
 *
 * `oneIn` is the entry's ABSOLUTE chance per successful extraction (1 / oneIn).
 * A source's entries are one mutually exclusive table — one roll, at most one
 * find — so they never combine into a pair. `announce` is authored per entry:
 * whether finding it posts a public System line to General.
 */
export type MiningSecondaryFindBalance = {
  readonly itemId: string;
  readonly oneIn: number;
  readonly announce: boolean;
};

/** One authored Refining recipe (#209). */
export type RefiningRecipeBalance =
  EffectiveGameBalance["refining"]["recipes"][keyof EffectiveGameBalance["refining"]["recipes"]];

/** A Refining recipe that rolls for success and authors a failure path. */
export type RolledRefiningRecipeBalance = Exclude<
  RefiningRecipeBalance,
  { failure: { kind: "none" } }
>;

/**
 * Whether a recipe always produces its output (#229). A deterministic recipe
 * authors no success curve and no failure XP, and never consults the random
 * source.
 */
export function refiningRecipeIsDeterministic(
  recipe: RefiningRecipeBalance,
): recipe is Exclude<RefiningRecipeBalance, RolledRefiningRecipeBalance> {
  return recipe.failure.kind === "none";
}

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

/** One authored Fabrication recipe (#232). */
export type FabricationRecipeBalance =
  EffectiveGameBalance["fabrication"]["recipes"][keyof EffectiveGameBalance["fabrication"]["recipes"]];

/** Every authored Fabrication recipe, in a stable authored order. */
export function fabricationRecipes(
  balance = getEffectiveGameBalance(),
): readonly FabricationRecipeBalance[] {
  return Object.values(balance.fabrication.recipes);
}

/**
 * The authoritative recipe on the machine, by its own action ID — the same
 * durable-identity rule Refining recipes follow, so a refreshed or lazily
 * resolved workpiece is always the recipe the player actually started.
 */
export function fabricationRecipeForActionId(
  actionId: string,
  balance = getEffectiveGameBalance(),
): FabricationRecipeBalance | undefined {
  return fabricationRecipes(balance).find((recipe) => recipe.actionId === actionId);
}

/** Every Fabrication action ID the recipe registry authors. */
export function fabricationActionIds(balance = getEffectiveGameBalance()): readonly string[] {
  return fabricationRecipes(balance).map((recipe) => recipe.actionId);
}

/** One authored Runeworking recipe (#391). */
export type RuneworkingRecipeBalance =
  EffectiveGameBalance["runeworking"]["recipes"][keyof EffectiveGameBalance["runeworking"]["recipes"]];

/** Every authored Runeworking recipe, in a stable authored order. */
export function runeworkingRecipes(
  balance = getEffectiveGameBalance(),
): readonly RuneworkingRecipeBalance[] {
  return Object.values(balance.runeworking.recipes);
}

/**
 * The authoritative recipe on the Resonance Rig, by its own action ID — the
 * durable-identity rule every recipe follows, so a refreshed or lazily resolved
 * cycle is always the recipe the player actually started.
 */
export function runeworkingRecipeForActionId(
  actionId: string,
  balance = getEffectiveGameBalance(),
): RuneworkingRecipeBalance | undefined {
  return runeworkingRecipes(balance).find((recipe) => recipe.actionId === actionId);
}

/** Every Runeworking action ID the recipe registry authors. */
export function runeworkingActionIds(balance = getEffectiveGameBalance()): readonly string[] {
  return runeworkingRecipes(balance).map((recipe) => recipe.actionId);
}

/**
 * One Tinkering target, resolved against the Fabrication recipe it dismantles
 * (#232). Everything but the action identity is that recipe's.
 */
export type TinkeringTargetBalance = {
  actionId: string;
  recipe: FabricationRecipeBalance;
};

/** Every authored Tinkering target, in a stable authored order. */
export function tinkeringTargets(
  balance = getEffectiveGameBalance(),
): readonly TinkeringTargetBalance[] {
  return Object.values(balance.tinkering.targets).map((target) => {
    const recipe = fabricationRecipeForActionId(target.recipeActionId, balance);
    if (!recipe) throw new Error(`Tinkering target ${target.actionId} names no Fabrication recipe`);
    return { actionId: target.actionId, recipe };
  });
}

/** The Tinkering target a durable action or committed cycle names. */
export function tinkeringTargetForActionId(
  actionId: string,
  balance = getEffectiveGameBalance(),
): TinkeringTargetBalance | undefined {
  return tinkeringTargets(balance).find((target) => target.actionId === actionId);
}

/** Every Tinkering action ID the target registry authors. */
export function tinkeringActionIds(balance = getEffectiveGameBalance()): readonly string[] {
  return tinkeringTargets(balance).map((target) => target.actionId);
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

/**
 * Every authored inventory item definition, in authored order. The one place a
 * consumer that must cover the WHOLE catalog (the operator ADD ITEM picker)
 * enumerates items, so a newly authored item appears without a second list.
 */
export function inventoryItemDefinitions(
  balance = getEffectiveGameBalance(),
): readonly ItemDefinition[] {
  return Object.values(balance.items).flatMap((item) => {
    const definition = getItemDefinition(item.itemId, balance);
    return definition ? [definition] : [];
  });
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
  // A standard skill on the shared curve (#232): no special hidden state.
  [SKILL_IDS.fabrication]: standardSkillLevelThresholds,
  // A standard skill on the shared curve (#391): Level 2 at the usual 500 XP.
  [SKILL_IDS.runeworking]: standardSkillLevelThresholds,
} as const satisfies Partial<Record<SkillId, () => readonly LevelThreshold[]>>;

/** The approved level-curve source for a skill, or undefined when none exists. */
export function skillLevelThresholds(skillId: string): readonly LevelThreshold[] | undefined {
  return skillLevelCurves[skillId as SkillId]?.();
}

/**
 * One item's authored equipment facts (#233): the canonical equipment-definition
 * boundary. Every generic equipment and Mining consumer — slot compatibility,
 * container capacity, the equipped Mining tool's requirement, charge and
 * effects — resolves an item through here rather than naming an item ID.
 *
 * Deliberately two closed kinds, each with a small fixed set of authored facts,
 * because that is what the game has: Mining tools and container attachments.
 * It is not an item-effect scripting language; a new kind of effect is a
 * deliberate extension of the kind that has it.
 */
export type MiningToolDefinition = {
  kind: "mining_tool";
  itemId: string;
  assignmentKind: "gear";
  /** The suit slots this tool may occupy — the one Mining-tool slot. */
  suitSlotIds: readonly string[];
  /** The Mining level required to equip and to use this tool. */
  requiredMiningLevel: number;
  /** Charge a loaded Power Cell gives, and the most the tool can hold. */
  maximumCharge: number;
  /** Permanent multiplier on a source's attempt duration, charged or not. */
  baseDurationMultiplierBps: number;
  /** What a loaded Power Cell does for this tool, one charge per attempt. */
  chargedEffect: MiningToolChargedEffect;
};

/**
 * A Mining tool's charged identity (#233), deliberately a closed choice: a
 * charged attempt is either faster, under the one global Power Cell speed
 * multiplier, or yields extra ore on success. Never both.
 */
export type MiningToolChargedEffect =
  | { kind: "speed" }
  | {
      kind: "extra_yield";
      /** Ore added to a successful charged attempt's ordinarily resolved yield. */
      units: number;
    };

export type ContainerDefinition = {
  kind: "container";
  itemId: string;
  assignmentKind: "container";
  /** Either container attachment slot. */
  suitSlotIds: readonly string[];
  /** Inventory slots this container contributes while equipped. */
  slotCapacity: number;
};

/**
 * Hands and feet gear (#399). Each worn piece adds its authored bonus to the
 * Mining level used for SUCCESS CHANCE only: never the character's actual level,
 * never a gate, a duration, XP or a yield.
 */
export type WearableDefinition = {
  kind: "wearable";
  itemId: string;
  assignmentKind: "gear";
  /** The one suit slot this piece fits: hands or feet. */
  suitSlotIds: readonly string[];
  miningSuccessLevelBonus: number;
};

export type EquipmentDefinition = MiningToolDefinition | ContainerDefinition | WearableDefinition;

/**
 * The equipment definition an item authors, or undefined for an item that is
 * not equipment. The compatible slots follow from the kind and the suit's own
 * authored slots, so no item restates a slot ID.
 */
export function getEquipmentDefinition(
  itemId: string,
  balance = getEffectiveGameBalance(),
): EquipmentDefinition | undefined {
  const item = Object.values(balance.items).find((candidate) => candidate.itemId === itemId);
  if (!item || !("equipment" in item)) return undefined;
  const { equipment } = item;
  if (equipment.kind === "mining_tool") {
    return {
      ...equipment,
      itemId,
      assignmentKind: "gear",
      suitSlotIds: [balance.carrying.miningToolSuitSlotId],
    };
  }
  if (equipment.kind === "wearable") {
    return {
      kind: "wearable",
      itemId,
      assignmentKind: "gear",
      suitSlotIds: [
        equipment.slot === "hands"
          ? balance.carrying.handsSuitSlotId
          : balance.carrying.feetSuitSlotId,
      ],
      miningSuccessLevelBonus: equipment.miningSuccessLevelBonus,
    };
  }
  return {
    ...equipment,
    itemId,
    assignmentKind: "container",
    suitSlotIds: balance.carrying.containerSuitSlotIds,
  };
}

/** The Mining-tool definition an item authors, or undefined for anything else. */
export function getMiningToolDefinition(
  itemId: string,
  balance = getEffectiveGameBalance(),
): MiningToolDefinition | undefined {
  const definition = getEquipmentDefinition(itemId, balance);
  return definition?.kind === "mining_tool" ? definition : undefined;
}

/** Every authored equipment definition, in authored item order. */
export function equipmentDefinitions(
  balance = getEffectiveGameBalance(),
): readonly EquipmentDefinition[] {
  return Object.values(balance.items).flatMap((item) => {
    const definition = getEquipmentDefinition(item.itemId, balance);
    return definition ? [definition] : [];
  });
}

/**
 * The charge capacity an item definition authors, or undefined when the item
 * has no charge state at all. Charge belongs to Mining tools (#233); readers
 * must consult this instead of assuming every unique item carries charge
 * semantics, or that every chargeable item is a Salvage Cutter.
 */
export function getItemMaximumCharge(
  itemId: string,
  balance = getEffectiveGameBalance(),
): number | undefined {
  return getMiningToolDefinition(itemId, balance)?.maximumCharge;
}
