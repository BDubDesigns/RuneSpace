#!/usr/bin/env node

// Issue #186 — early-game economy measurement.
//
// Read-only. It changes no balance value and touches no database: it imports the
// authoritative balance config, content, and domain resolvers and reports what
// they already say, so `docs/audits/issue-186-early-game-economy.md` can be
// re-derived instead of trusted.
//
// Where a number depends on RNG it is measured by driving the real resolver
// (`resolveFerriteShaleMining`, `resolveRefining`, `resolvePracticeWelding`)
// with a seeded generator over many trials, rather than by re-implementing the
// rule here. Only arithmetic the resolvers do not own — travel path lengths,
// merchant totals, Clean Pass time savings — is computed in this file.
//
//   node --experimental-strip-types scripts/economy-audit-186.mjs
//   node --experimental-strip-types scripts/economy-audit-186.mjs --trials 20000

import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The game modules use the `@/` path alias and extensionless relative imports,
// both of which the TypeScript build resolves and bare Node does not. Mapping
// them here is what lets this script read the real modules instead of a copy.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = specifier.startsWith("@/")
      ? pathToFileURL(path.join(ROOT, specifier.slice(2))).href
      : specifier;
    try {
      return nextResolve(mapped, context);
    } catch (error) {
      if (mapped.endsWith(".ts")) throw error;
      return nextResolve(`${mapped}.ts`, context);
    }
  },
});

const { getEffectiveGameBalance, standardSkillLevelThresholds, practiceSectionXp } = await import(
  "@/game/config/balance"
);
const { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS } = await import("@/game/config/foundations");
const { miningSuccessChanceBps, resolveFerriteShaleMining } = await import("@/game/domain/mining");
const { refiningSuccessChanceBps, resolveRefining } = await import("@/game/domain/refining");
const { resolvePracticeWelding, UNSTARTED_PRACTICE } = await import(
  "@/game/domain/practice-welding"
);
const { LOCATIONS } = await import("@/game/content/locations");
const { MERCHANTS } = await import("@/game/content/merchants");
const { TRANSPORT_ROUTES } = await import("@/game/content/transport-routes");
const { SCAVENGE_OUTCOMES, SCAVENGE_TOTAL_WEIGHT_BPS } = await import("@/game/content/scavenge");

const balance = getEffectiveGameBalance();

const trialsArgumentIndex = process.argv.indexOf("--trials");
const TRIALS =
  trialsArgumentIndex === -1 ? 5_000 : Number.parseInt(process.argv[trialsArgumentIndex + 1], 10);
if (!Number.isInteger(TRIALS) || TRIALS < 1)
  throw new RangeError("--trials must be a positive integer");

/** A small deterministic generator, so every run of this script reports the same numbers. */
function seededRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  return { nextBasisPoints: () => Math.floor(next() * 10_000), nextUnit: next };
}

const seconds = (ticks) => (ticks * GAME_TICK_MS) / 1_000;
const round = (value, places = 2) => Number(value.toFixed(places));
const perHour = (credits, secondsSpent) => round((credits / secondsSpent) * 3_600, 0);

// ---------------------------------------------------------------------------
// Merchant prices, read straight out of content.
// ---------------------------------------------------------------------------

/** Credits the player receives per unit sold to this merchant, or undefined. */
function sellPrice(merchantId, itemId) {
  return MERCHANTS.find((merchant) => merchant.id === merchantId)?.prices.find(
    (price) => price.itemId === itemId,
  )?.buyPrice;
}

/** Credits the player pays per unit bought from this merchant, or undefined. */
function buyPrice(merchantId, itemId) {
  return MERCHANTS.find((merchant) => merchant.id === merchantId)?.prices.find(
    (price) => price.itemId === itemId,
  )?.sellPrice;
}

const BIX = "bix_weller_shop";
const WADE = "wade_rusk_yard";
const PRICES = {
  shale: sellPrice(BIX, ITEM_IDS.ferriteShale),
  refinedFerrite: sellPrice(BIX, ITEM_IDS.refinedFerrite),
  slag: sellPrice(BIX, ITEM_IDS.slag),
  powerCellSell: sellPrice(BIX, ITEM_IDS.powerCell),
  powerCellBuy: buyPrice(BIX, ITEM_IDS.powerCell),
  scrapBuy: buyPrice(WADE, ITEM_IDS.scrapMetal),
};

// ---------------------------------------------------------------------------
// Travel, derived from the authored adjacency rather than asserted.
// ---------------------------------------------------------------------------

/** Shortest walking distance in legs, breadth-first over the authored map. */
function walkingLegs(fromLocationId, toLocationId) {
  const queue = [[fromLocationId, 0]];
  const seen = new Set([fromLocationId]);
  while (queue.length > 0) {
    const [locationId, legs] = queue.shift();
    if (locationId === toLocationId) return legs;
    const location = LOCATIONS.find((candidate) => candidate.id === locationId);
    for (const next of location?.adjacentLocationIds ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([next, legs + 1]);
    }
  }
  throw new Error(`No walking path from ${fromLocationId} to ${toLocationId}`);
}

const walkLegSeconds = seconds(balance.travel.adjacentWalkDurationTicks);
const walkSeconds = (from, to) => walkingLegs(from, to) * walkLegSeconds;

const HAULER = TRANSPORT_ROUTES[0];
const haulerSeconds = seconds(balance.travel.crewHaulerDurationTicks);

/** Expected Credits from one claimed Scavenge opportunity, valued at Bix's buyback. */
function scavengeExpectedCredits() {
  const value = {
    [ITEM_IDS.ferriteShale]: PRICES.shale,
    [ITEM_IDS.refinedFerrite]: PRICES.refinedFerrite,
    [ITEM_IDS.powerCell]: PRICES.powerCellSell,
  };
  return SCAVENGE_OUTCOMES.reduce((total, outcome) => {
    if (!outcome.itemId) return total;
    const probability = outcome.weightBps / SCAVENGE_TOTAL_WEIGHT_BPS;
    return total + probability * outcome.quantity * (value[outcome.itemId] ?? 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// Mining, measured through the authoritative resolver.
// ---------------------------------------------------------------------------

const STARTER_SLOTS = balance.items.starterContainer.slotCapacity;
// A mining-capable loadout carries the container and the Cutter it needs.
const MINING_MASS_AVAILABLE =
  balance.carrying.startingCapacityGrams -
  balance.items.starterContainer.massGrams -
  balance.items.salvageCutter.massGrams;

/**
 * Drive one mining run to its capacity stop and report what it took.
 * `slotsForShale` is how many of the carried slots the run may fill.
 */
function measureMiningRun(miningLevel, { slotsForShale = STARTER_SLOTS, cutterCharge = 0 } = {}) {
  let ticks = 0;
  let shale = 0;
  let xp = 0;
  let boostedAttempts = 0;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const result = resolveFerriteShaleMining({
      // Far more than any run needs, so the run always ends on its capacity stop.
      elapsedTicks: 1_000_000,
      snapshot: {
        miningLevel,
        hasCompatibleTool: true,
        cutterCharge,
        existingStacks: [],
        slotsAvailable: slotsForShale,
        massAvailableGrams: MINING_MASS_AVAILABLE,
      },
      balance,
      random: seededRandom(trial * 2_654_435_761 + 1),
    });
    ticks += result.consumedTicks;
    xp += result.awardedXp;
    shale += result.createdStacks.reduce((sum, stack) => sum + stack.quantity, 0);
    boostedAttempts += result.attempts.filter((attempt) => attempt.boosted).length;
  }
  return {
    miningLevel,
    successChance: miningSuccessChanceBps(miningLevel, balance) / 10_000,
    shale: shale / TRIALS,
    seconds: seconds(ticks / TRIALS),
    miningXp: xp / TRIALS,
    boostedAttempts: boostedAttempts / TRIALS,
  };
}

// ---------------------------------------------------------------------------
// Refining, measured through the authoritative resolver.
// ---------------------------------------------------------------------------

/**
 * Refine a carried load of shale to exhaustion. `slotsFree` is the headroom left
 * after the shale stacks; Refining needs at least one free slot to place its
 * first output, which is why a completely full load cannot be refined at all.
 */
function measureRefiningRun(refiningLevel, shaleStacks, slotsFree) {
  let ticks = 0;
  let refined = 0;
  let slag = 0;
  let consumed = 0;
  let blocked = 0;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const result = resolveRefining({
      elapsedTicks: 1_000_000,
      snapshot: {
        refiningLevel,
        existingStacks: shaleStacks.map((quantity, index) => ({
          id: `shale-${index}`,
          itemId: ITEM_IDS.ferriteShale,
          quantity,
        })),
        slotsAvailable: slotsFree,
        massAvailableGrams:
          MINING_MASS_AVAILABLE -
          shaleStacks.reduce((sum, quantity) => sum + quantity, 0) *
            balance.items.ferriteShale.massGrams,
      },
      balance,
      random: seededRandom(trial * 40_503 + 7),
    });
    if (result.attempts === 0) blocked += 1;
    ticks += result.consumedTicks;
    refined += result.ferriteGained;
    slag += result.slagGained;
    consumed += result.shaleConsumed;
  }
  return {
    refiningLevel,
    successChance: refiningSuccessChanceBps(refiningLevel, balance) / 10_000,
    blockedShare: blocked / TRIALS,
    shaleConsumed: consumed / TRIALS,
    refinedFerrite: refined / TRIALS,
    slag: slag / TRIALS,
    seconds: seconds(ticks / TRIALS),
    credits: (refined * PRICES.refinedFerrite + slag * PRICES.slag) / TRIALS,
  };
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const out = (line = "") => process.stdout.write(`${line}\n`);
const table = (headers, rows) => {
  out(`| ${headers.join(" | ")} |`);
  out(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) out(`| ${row.join(" | ")} |`);
  out();
};

out("# Issue #186 — early-game economy measurements");
out();
out(`Trials per RNG-dependent figure: ${TRIALS}. Tick: ${GAME_TICK_MS} ms.`);
out();

out("## Merchant prices (Credits per unit)");
out();
table(
  ["Item", "Bix pays player", "Player pays Bix", "Player pays Wade"],
  [
    ["Ferrite Shale", PRICES.shale, "—", "—"],
    ["Refined Ferrite", PRICES.refinedFerrite, "—", "—"],
    ["Slag", PRICES.slag, "—", "—"],
    ["Power Cell", PRICES.powerCellSell, PRICES.powerCellBuy, "—"],
    ["Scrap Metal", "—", "—", PRICES.scrapBuy],
  ],
);

out("## Skill level reachability");
out();
out(
  "Mining pays XP only on a success; Refining pays on both outcomes. Times below are pure " +
    "action time at that skill's own level, ignoring travel and capacity stops.",
);
out();
const levelRows = [];
for (const level of [5, 10, 15, 20, 25, 30]) {
  const totalXp = standardSkillLevelThresholds(balance).find(
    (threshold) => threshold.level === level,
  ).totalXp;
  const miningChance = miningSuccessChanceBps(level, balance) / 10_000;
  const miningXpPerSecond =
    (miningChance * balance.mining.successXp) / seconds(balance.mining.attemptDurationTicks);
  const refiningChance = refiningSuccessChanceBps(Math.min(level, 20), balance) / 10_000;
  const refiningXpPerSecond =
    (refiningChance * balance.refining.successXp +
      (1 - refiningChance) * balance.refining.failureXp) /
    seconds(balance.refining.attemptDurationTicks);
  levelRows.push([
    level,
    totalXp,
    `${round(totalXp / miningXpPerSecond / 3_600, 1)} h`,
    level <= 20 ? `${round(totalXp / refiningXpPerSecond / 3_600, 1)} h` : "—",
  ]);
}
table(
  ["Level", "Total XP", "Mining hours at that level's rate", "Refining hours at that level's rate"],
  levelRows,
);

out("## Carrying capacity");
out();
table(
  ["Fact", "Value"],
  [
    ["Carry mass ceiling", `${balance.carrying.startingCapacityGrams} g`],
    ["Starter container slots", STARTER_SLOTS],
    ["Mass free with container + Cutter equipped", `${MINING_MASS_AVAILABLE} g`],
    ["Ferrite Shale per slot", balance.items.ferriteShale.stackLimit],
    ["Max carried Ferrite Shale", STARTER_SLOTS * balance.items.ferriteShale.stackLimit],
    [
      "Mass that load uses",
      `${STARTER_SLOTS * balance.items.ferriteShale.stackLimit * balance.items.ferriteShale.massGrams} g`,
    ],
  ],
);

out("## Travel");
out();
const legRows = [
  ["The Jag → Holo Hollow (Bix)", LOCATION_IDS.theJag, LOCATION_IDS.holoHollow],
  [
    "The Jag → Abandoned Processing Yard",
    LOCATION_IDS.theJag,
    LOCATION_IDS.abandonedProcessingYard,
  ],
  [
    "Abandoned Processing Yard → Holo Hollow",
    LOCATION_IDS.abandonedProcessingYard,
    LOCATION_IDS.holoHollow,
  ],
  ["Holo Hollow → Rusk Recovery (Wade)", LOCATION_IDS.holoHollow, LOCATION_IDS.ruskRecovery],
  [
    "Holo Hollow → DeWhat? Emergency Power Annex",
    LOCATION_IDS.holoHollow,
    LOCATION_IDS.emergencyPowerAnnex,
  ],
];
table(
  ["Route", "Walking legs", "Walking seconds"],
  legRows.map(([label, from, to]) => [
    label,
    walkingLegs(from, to),
    round(walkSeconds(from, to), 1),
  ]),
);
out(
  `Crew Hauler: ${HAULER.originLocationId} → ${HAULER.destinationLocationId}, ` +
    `${haulerSeconds} s, ${HAULER.fareCredits} Credits, unlocked by completing \`${HAULER.unlockMissionId}\`. ` +
    `One-way: ${TRANSPORT_ROUTES.length} authored route(s).`,
);
out();
out(
  `Expected Scavenge value per claimed walking leg: ${round(scavengeExpectedCredits())} Credits ` +
    `(walking only; a ride offers none).`,
);
out();

out("## Mining throughput (full 8-slot load of 80 Shale, unboosted)");
out();
const MINING_LEVELS = [1, 3, 5, 10, 15, 20, 25, 30];
const miningRuns = MINING_LEVELS.map((level) => measureMiningRun(level));
table(
  ["Mining level", "Success chance", "Shale mined", "Mining seconds", "Shale/min", "Gross Credits"],
  miningRuns.map((run) => [
    run.miningLevel,
    `${round(run.successChance * 100, 1)}%`,
    round(run.shale, 1),
    round(run.seconds, 1),
    round((run.shale / run.seconds) * 60, 1),
    round(run.shale * PRICES.shale, 1),
  ]),
);

out("## Raw-Shale selling loop, by route");
out();
const jagToHollow = walkSeconds(LOCATION_IDS.theJag, LOCATION_IDS.holoHollow);
const rawLoopRows = miningRuns.map((run) => {
  const gross = run.shale * PRICES.shale;
  const walkBoth = run.seconds + jagToHollow * 2;
  // The authored ride runs Holo Hollow → The Jag, so it is the outbound leg of a
  // sell loop; the return to the merchant is always the walk.
  const haulerLoop = run.seconds + jagToHollow + haulerSeconds;
  const scavengePerLeg = scavengeExpectedCredits();
  return [
    run.miningLevel,
    perHour(gross, walkBoth),
    perHour(gross + scavengePerLeg * 2, walkBoth),
    perHour(gross - HAULER.fareCredits, haulerLoop),
    perHour(gross - HAULER.fareCredits + scavengePerLeg, haulerLoop),
  ];
});
table(
  [
    "Mining level",
    "Walk both ways (Cr/h)",
    "Walk + Scavenge (Cr/h)",
    "Ride out, walk back (Cr/h)",
    "Ride + Scavenge (Cr/h)",
  ],
  rawLoopRows,
);

out("## Power Cell boost");
out();
const cellCharges = balance.items.salvageCutter.maximumCharge;
table(
  [
    "Mining level",
    "Seconds saved by one Cell",
    "Shale that time yields",
    "Credits created",
    "vs sell (3 Cr)",
    "vs buy (8 Cr)",
  ],
  MINING_LEVELS.map((level) => {
    const normal = seconds(balance.mining.attemptDurationTicks);
    const boosted = seconds(
      Math.max(
        1,
        Math.ceil(
          balance.mining.attemptDurationTicks / balance.mining.powerCellBoost.speedMultiplier,
        ),
      ),
    );
    const saved = (normal - boosted) * cellCharges;
    const chance = miningSuccessChanceBps(level, balance) / 10_000;
    const shalePerSecond =
      (chance * (balance.mining.yieldMinimum + balance.mining.yieldMaximum)) / 2 / normal;
    const credits = saved * shalePerSecond * PRICES.shale;
    return [
      level,
      round(saved, 1),
      round(saved * shalePerSecond, 2),
      round(credits),
      round(credits - PRICES.powerCellSell),
      round(credits - PRICES.powerCellBuy),
    ];
  }),
);
out(
  `One Power Cell fills the Cutter to ${cellCharges} charges; one charge is spent per boosted ` +
    `attempt, success or failure. The Annex issues 5 free Cells per character per Pacific day.`,
);
out();

out("## Refining");
out();
out("### How much of a carried load can actually be refined (Refining 1, measured)");
out();
out(
  "Refining refuses to roll unless BOTH of its mutually exclusive outputs can be placed, " +
    "so a load that leaves too few free slots stalls or never starts.",
);
out();
const shaleStackLimit = balance.items.ferriteShale.stackLimit;
const refineSweepRows = [];
for (let stacks = 1; stacks <= STARTER_SLOTS; stacks += 1) {
  const load = Array.from({ length: stacks }, () => shaleStackLimit);
  const run = measureRefiningRun(1, load, STARTER_SLOTS - stacks);
  refineSweepRows.push([
    stacks * shaleStackLimit,
    stacks,
    STARTER_SLOTS - stacks,
    round(run.shaleConsumed, 1),
    round(run.seconds, 1),
  ]);
}
table(
  ["Shale carried", "Stacks", "Free slots", "Shale actually refined", "Refining seconds"],
  refineSweepRows,
);

// The largest carried load that still refines to exhaustion, measured above.
const REFINE_STACKS = STARTER_SLOTS - 2;
const refineLoad = Array.from({ length: REFINE_STACKS }, () => shaleStackLimit);
const refineLoadShale = REFINE_STACKS * shaleStackLimit;
const REFINING_LEVELS = [1, 3, 5, 10, 15, 20];
const refiningRuns = REFINING_LEVELS.map((level) =>
  measureRefiningRun(level, refineLoad, STARTER_SLOTS - REFINE_STACKS),
);

out(`### Refining a ${refineLoadShale}-Shale load (the largest that fully refines)`);
out();
const rawValueOfRefineLoad = refineLoadShale * PRICES.shale;
table(
  [
    "Refining level",
    "Success chance",
    "Refined Ferrite",
    "Slag",
    "Refining seconds",
    "Credits if refined",
    "Credits if sold raw",
    "Uplift",
    "Credits per 2 Shale",
  ],
  refiningRuns.map((run) => [
    run.refiningLevel,
    `${round(run.successChance * 100, 1)}%`,
    round(run.refinedFerrite, 1),
    round(run.slag, 1),
    round(run.seconds, 1),
    round(run.credits, 1),
    rawValueOfRefineLoad,
    `${round(((run.credits - rawValueOfRefineLoad) / rawValueOfRefineLoad) * 100, 1)}%`,
    round((run.credits / run.shaleConsumed) * balance.refining.inputFerriteShale, 2),
  ]),
);
out(
  `For comparison, ${balance.refining.inputFerriteShale} Shale sold raw is ` +
    `${balance.refining.inputFerriteShale * PRICES.shale} Credits, so an attempt is value-positive ` +
    `whenever its expected output beats that.`,
);
out();

out("### Whole-loop comparison");
out();
out(
  `Raw loop: mine ${STARTER_SLOTS * shaleStackLimit} Shale at The Jag, walk to Bix, walk back. ` +
    `Refine loop: mine ${refineLoadShale} Shale, walk to the Abandoned Processing Yard, refine, ` +
    `walk to Bix, walk back to The Jag.`,
);
out();
const miningRefineLoads = MINING_LEVELS.map((level) =>
  measureMiningRun(level, { slotsForShale: REFINE_STACKS }),
);
const rawLoopSeconds = (mine) => mine.seconds + jagToHollow * 2;
const refineLoopSeconds = (mine, refine) =>
  mine.seconds +
  refine.seconds +
  walkSeconds(LOCATION_IDS.theJag, LOCATION_IDS.abandonedProcessingYard) +
  walkSeconds(LOCATION_IDS.abandonedProcessingYard, LOCATION_IDS.holoHollow) +
  jagToHollow;
table(
  [
    "Mining level",
    "Raw sell (Cr/h)",
    ...REFINING_LEVELS.map((level) => `Refine @ R${level} (Cr/h)`),
  ],
  miningRuns.map((mine, index) => [
    mine.miningLevel,
    perHour(mine.shale * PRICES.shale, rawLoopSeconds(mine)),
    ...refiningRuns.map((refine) =>
      perHour(refine.credits, refineLoopSeconds(miningRefineLoads[index], refine)),
    ),
  ]),
);

out("## Welding levels and Practice Welding");
out();
const thresholds = standardSkillLevelThresholds(balance);
const weldingFive = thresholds.find(
  (threshold) => threshold.level === balance.workOrders.requiredWeldingLevel,
).totalXp;
const sectionXp = practiceSectionXp(balance);
const sectionSeconds = seconds(balance.welding.attemptDurationTicks);

const practiceWeld = (() => {
  const result = resolvePracticeWelding({
    elapsedTicks: 1_000_000,
    snapshot: {
      practice: UNSTARTED_PRACTICE,
      scrapAvailable: balance.practiceWelding.scrapPerWeld,
      slagStackQuantities: [],
      slotsAvailable: STARTER_SLOTS,
      massAvailableGrams: MINING_MASS_AVAILABLE,
      autoDiscardSlag: false,
    },
    random: seededRandom(99),
    balance,
  });
  const weld = result.resolvedWelds[0];
  return {
    sections: weld.sections,
    scrap: weld.scrapConsumed,
    slag: weld.slagKept,
    xp: weld.xpGained,
    seconds: seconds(result.consumedTicks),
  };
})();
const weldSeconds = balance.practiceWelding.sectionsPerWeld * sectionSeconds;
const weldScrapCost = practiceWeld.scrap * PRICES.scrapBuy;
const weldSlagValue = practiceWeld.slag * PRICES.slag;

table(
  ["Fact", "Value"],
  [
    ["Welding XP for level " + balance.workOrders.requiredWeldingLevel, weldingFive],
    ["Sections per Practice weld", balance.practiceWelding.sectionsPerWeld],
    ["Section duration", `${sectionSeconds} s`],
    ["Practice XP per section", `${sectionXp} (of ${balance.welding.xpPerIncrement} full)`],
    ["Measured XP per completed weld", practiceWeld.xp],
    ["Scrap consumed per weld (at start)", practiceWeld.scrap],
    ["Slag produced per weld (at completion)", practiceWeld.slag],
    ["Scrap cost per weld", `${weldScrapCost} Cr`],
    ["Slag resale per weld", `${weldSlagValue} Cr`],
    ["Net material cost per weld", `${weldScrapCost - weldSlagValue} Cr`],
    ["Weld elapsed, 0 Clean Pass claims", `${weldSeconds} s`],
    ["Weld elapsed, 1 claim", `${weldSeconds - sectionSeconds} s`],
    ["Weld elapsed, 2 claims", `${weldSeconds - sectionSeconds * 2} s`],
  ],
);

out("### Cost of reaching the Work Order Welding requirement");
out();
const cargoHold = balance.repairTargets.cargoHold;
const crewStop = balance.repairTargets.crewStop;
// Mission XP literals are content, not balance; they are cited in the report.
const MAIN_PATH_XP = cargoHold.repairIncrements * balance.welding.xpPerIncrement + 100 + 300;
const OPTIONAL_XP = crewStop.repairIncrements * balance.welding.xpPerIncrement + 250;
const MISSION_FREE_SCRAP = 6;

function weldingFiveCost(startingXp) {
  const remaining = Math.max(0, weldingFive - startingXp);
  const welds = Math.ceil(remaining / practiceWeld.xp);
  const scrap = welds * practiceWeld.scrap;
  return {
    startingXp,
    remaining,
    welds,
    scrap,
    scrapCredits: scrap * PRICES.scrapBuy,
    slagCredits: welds * practiceWeld.slag * PRICES.slag,
    netCredits: scrap * PRICES.scrapBuy - welds * practiceWeld.slag * PRICES.slag,
    secondsNoClaims: welds * weldSeconds,
    secondsTwoClaims: welds * (weldSeconds - sectionSeconds * 2),
  };
}
const mainPath = weldingFiveCost(MAIN_PATH_XP);
const optionalPath = weldingFiveCost(MAIN_PATH_XP + OPTIONAL_XP);
table(
  [
    "Progression case",
    "Welding XP at 10,000 Hours complete",
    "XP remaining",
    "Practice welds",
    "Scrap needed",
    "Free Scrap left",
    "Scrap cost (Cr)",
    "Slag resale (Cr)",
    "Net cost (Cr)",
    "Active weld time, 0 claims",
    "Active weld time, 2 claims",
  ],
  [
    ["Main path only", ...formatCost(mainPath)],
    ["Main path + Out of the Weather", ...formatCost(optionalPath)],
  ],
);
function formatCost(cost) {
  return [
    cost.startingXp,
    cost.remaining,
    cost.welds,
    cost.scrap,
    // The Mission's free Scrap is consumed by the three welds the Mission itself asks for.
    Math.max(0, MISSION_FREE_SCRAP - 3 * practiceWeld.scrap),
    cost.scrapCredits,
    cost.slagCredits,
    cost.netCredits,
    `${round(cost.secondsNoClaims / 60, 1)} min`,
    `${round(cost.secondsTwoClaims / 60, 1)} min`,
  ];
}
out(
  `The optional branch's own material bill is ${crewStop.refinedFerriteRequired} Refined Ferrite ` +
    `(${crewStop.refinedFerriteRequired * PRICES.refinedFerrite} Cr of merchant value). The mandatory ` +
    `Cargo Hold costs ${cargoHold.refinedFerriteRequired} Refined Ferrite + ${cargoHold.slagRequired} Slag ` +
    `(${cargoHold.refinedFerriteRequired * PRICES.refinedFerrite + cargoHold.slagRequired * PRICES.slag} Cr).`,
);
out();

out("## Work Order parametric model");
out();
out(
  "P = Credit payout, M = Refined Ferrite consumed, S = genuine Welding sections, " +
    "c = Clean Pass sections claimed (0-2).",
);
out();
out(`- Material opportunity cost = M x ${PRICES.refinedFerrite} Cr`);
out(`- Active Welding time = (S - c) x ${sectionSeconds} s`);
out(
  `- Welding XP earned = S x ${balance.welding.xpPerIncrement} (full rate, not Practice's ${sectionXp})`,
);
out(`- Net Credit gain = P - ${PRICES.refinedFerrite}M`);
out(`- Effective labor rate = (P - ${PRICES.refinedFerrite}M) / ((S - c) x ${sectionSeconds} s)`);
out(`- Break-even payout floor = P > ${PRICES.refinedFerrite}M`);
out();
out("### Illustrative scenarios (examples for a product decision, not recommendations)");
out();
const scenarioRows = [];
for (const M of [4, 6, 10]) {
  for (const S of [6, 10, 16]) {
    const floor = M * PRICES.refinedFerrite;
    for (const premium of [1.25, 1.5, 2]) {
      const P = Math.round(floor * premium);
      const timeNoClaims = S * sectionSeconds;
      const timeTwoClaims = Math.max(sectionSeconds, (S - 2) * sectionSeconds);
      scenarioRows.push([
        M,
        S,
        P,
        floor,
        P - floor,
        `${round((premium - 1) * 100, 0)}%`,
        S * balance.welding.xpPerIncrement,
        `${round(timeNoClaims, 0)} s`,
        perHour(P - floor, timeNoClaims),
        perHour(P - floor, timeTwoClaims),
      ]);
    }
  }
}
table(
  [
    "M",
    "S",
    "P",
    "Material cost",
    "Net gain",
    "Labor premium",
    "Welding XP",
    "Weld time (0 claims)",
    "Labor Cr/h (0 claims)",
    "Labor Cr/h (2 claims)",
  ],
  scenarioRows,
);

out("### Full-cycle view: producing the material is the real cost");
out();
out(
  "The marginal rate above answers 'weld this Ferrite or sell it'. It is not the loop rate, " +
    "because the player must first mine and refine M units. The production time below is measured " +
    "from the refine loop at Mining 10 / Refining 10.",
);
out();
const productionLoadMine = measureMiningRun(10, { slotsForShale: REFINE_STACKS });
const productionRefine = measureRefiningRun(10, refineLoad, STARTER_SLOTS - REFINE_STACKS);
const productionLoopSeconds = refineLoopSeconds(productionLoadMine, productionRefine);
const secondsPerRefinedFerrite = productionLoopSeconds / productionRefine.refinedFerrite;
out(
  `One refine loop takes ${round(productionLoopSeconds, 0)} s and yields ` +
    `${round(productionRefine.refinedFerrite, 1)} Refined Ferrite, i.e. ` +
    `${round(secondsPerRefinedFerrite, 1)} s per unit.`,
);
out();
const fullCycleRows = [];
for (const M of [4, 6, 10]) {
  for (const S of [6, 10, 16]) {
    const floor = M * PRICES.refinedFerrite;
    for (const premium of [1.25, 1.5, 2]) {
      const P = Math.round(floor * premium);
      const cycleSeconds = M * secondsPerRefinedFerrite + S * sectionSeconds;
      fullCycleRows.push([
        M,
        S,
        P,
        `${round(M * secondsPerRefinedFerrite, 0)} s`,
        `${round(cycleSeconds, 0)} s`,
        perHour(P, cycleSeconds),
        perHour(floor, M * secondsPerRefinedFerrite),
      ]);
    }
  }
}
table(
  [
    "M",
    "S",
    "P",
    "Time to produce M",
    "Full cycle time",
    "Work Order Cr/h (full cycle)",
    "Selling that Ferrite instead (Cr/h)",
  ],
  fullCycleRows,
);

out("### Benchmarks the model is measured against");
out();
const benchmarkMineTen = measureMiningRun(10);
const benchmarkMineThirty = measureMiningRun(30);
const benchmarkRefineLoadTen = measureMiningRun(10, { slotsForShale: REFINE_STACKS });
const benchmarkRefineLoadThirty = measureMiningRun(30, { slotsForShale: REFINE_STACKS });
const benchmarkRefineTen = measureRefiningRun(10, refineLoad, STARTER_SLOTS - REFINE_STACKS);
const benchmarkRefineTwenty = measureRefiningRun(20, refineLoad, STARTER_SLOTS - REFINE_STACKS);
table(
  ["Repeatable loop", "Credits/hour"],
  [
    [
      "Mining 10, raw sell, walk both ways",
      perHour(benchmarkMineTen.shale * PRICES.shale, rawLoopSeconds(benchmarkMineTen)),
    ],
    [
      "Mining 30, raw sell, walk both ways",
      perHour(benchmarkMineThirty.shale * PRICES.shale, rawLoopSeconds(benchmarkMineThirty)),
    ],
    [
      "Mining 10 + Refining 10, sell refined",
      perHour(
        benchmarkRefineTen.credits,
        refineLoopSeconds(benchmarkRefineLoadTen, benchmarkRefineTen),
      ),
    ],
    [
      "Mining 30 + Refining 20, sell refined",
      perHour(
        benchmarkRefineTwenty.credits,
        refineLoopSeconds(benchmarkRefineLoadThirty, benchmarkRefineTwenty),
      ),
    ],
    [
      "Practice Welding (net cost, earns nothing)",
      `-${perHour(weldScrapCost - weldSlagValue, weldSeconds)}`,
    ],
  ],
);
