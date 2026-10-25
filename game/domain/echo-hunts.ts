import {
  getEffectiveGameBalance,
  getItemDefinition,
  type EffectiveGameBalance,
} from "@/game/config/balance";
import type { ItemId, PlanetId } from "@/game/config/foundations";
import { BEGINNER_ECHO_TARGET_POOLS } from "@/game/content/echo-hunts";
import { getLocation, getLocationPlanetId, LOCATIONS } from "@/game/content/locations";
import type { StackState } from "@/game/domain/inventory";
import { getItemPresentation } from "@/game/content/item-presentation";
import {
  addStackExact,
  addUnique,
  carriedQuantity,
  removeStacks,
  workingInventory,
  workingInventoryDiff,
  type WorkingInventoryDiff,
} from "@/game/domain/working-inventory";

/**
 * Beginner Resonance Echo hunts (#393): the pure rules.
 *
 * A character has at most one active Beginner hunt per planet. Its hidden
 * target is chosen by the first reading taken on that planet while no hunt is
 * active, from the planet's fixed pool, and the reading is resolved against it
 * at once — so the first reading may find the Echo where the player stands.
 * A wrong reading reports, from the exact hex it was taken at, which way the
 * target lies on each screen axis of the flat-top map. A discovery ends the hunt
 * and rolls exactly one item from the planet's table (a Legendary at 1/500, #399);
 * the next reading on that planet starts a new hunt. Nothing here reads a clock, a database or a random source of its
 * own: the server supplies all three.
 */

export type EchoAxisDirection<Positive extends string, Negative extends string> =
  | Positive
  | Negative
  | "aligned";
export type EchoEastWest = EchoAxisDirection<"east", "west">;
export type EchoNorthSouth = EchoAxisDirection<"north", "south">;

export type EchoReadingDirections = { eastWest: EchoEastWest; northSouth: EchoNorthSouth };

type Axial = { q: number; r: number };

/**
 * A World Location's position on its planet's flat-top map, as two integers
 * that order exactly like the drawn screen axes. The map draws axial `(q, r)`
 * at x ∝ q and y ∝ r + q/2 with y growing downward
 * (`features/travel/local-map-layout.ts` `axialToPixel`), so `east` is q and
 * `south` is 2r + q — doubled to stay an integer. Directions compare these.
 */
export function echoScreenAxes(axial: Axial): { east: number; south: number } {
  return { east: axial.q, south: 2 * axial.r + axial.q };
}

function axialOf(locationId: string): Axial {
  const location = getLocation(locationId);
  if (!location) throw new Error(`Unknown World Location "${locationId}"`);
  return location.presentation.localMap.axial;
}

/** Which way `targetLocationId` lies from `sourceLocationId`, on each axis. */
export function echoReadingDirections(
  sourceLocationId: string,
  targetLocationId: string,
): EchoReadingDirections {
  const source = echoScreenAxes(axialOf(sourceLocationId));
  const target = echoScreenAxes(axialOf(targetLocationId));
  return {
    eastWest: target.east > source.east ? "east" : target.east < source.east ? "west" : "aligned",
    northSouth:
      target.south > source.south ? "south" : target.south < source.south ? "north" : "aligned",
  };
}

/** "northeast", "west", "south" — the compass words for a clue, for copy. */
export function echoDirectionWords(directions: EchoReadingDirections): string {
  const vertical = directions.northSouth === "aligned" ? "" : directions.northSouth;
  const horizontal = directions.eastWest === "aligned" ? "" : directions.eastWest;
  return `${vertical}${horizontal}` || "here";
}

export type EchoClueCheck = {
  /** True when the current hex contradicts the clue on the east/west axis. */
  eastWestConflict: boolean;
  /** True when the current hex contradicts the clue on the north/south axis. */
  northSouthConflict: boolean;
  ruledOut: boolean;
};

/**
 * Whether the hex the character stands on now is ruled out by the last wrong
 * reading on this planet. Read-only: a hex that satisfies both directions is
 * only "not ruled out", never "the Echo is here". The reading's own source hex
 * is always ruled out, because a reading there was wrong.
 */
export function checkEchoClue(input: {
  sourceLocationId: string;
  directions: EchoReadingDirections;
  currentLocationId: string;
}): EchoClueCheck {
  const source = echoScreenAxes(axialOf(input.sourceLocationId));
  const current = echoScreenAxes(axialOf(input.currentLocationId));
  const fits = (want: string, delta: number, positive: string, negative: string) =>
    want === positive ? delta > 0 : want === negative ? delta < 0 : delta === 0;
  const eastWestConflict = !fits(
    input.directions.eastWest,
    current.east - source.east,
    "east",
    "west",
  );
  const northSouthConflict = !fits(
    input.directions.northSouth,
    current.south - source.south,
    "south",
    "north",
  );
  return { eastWestConflict, northSouthConflict, ruledOut: eastWestConflict || northSouthConflict };
}

/** The planet's fixed Beginner pool, or undefined on a planet that has none. */
export function beginnerEchoTargetPool(planetId: string): readonly string[] | undefined {
  return BEGINNER_ECHO_TARGET_POOLS[planetId as PlanetId];
}

export type BeginnerEchoRewardEntry = { itemId: string; weight: number };

export function beginnerEchoRewardTable(
  planetId: string,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): readonly BeginnerEchoRewardEntry[] | undefined {
  return (
    balance.echoHunts.beginner.rewardTables as Readonly<
      Record<string, readonly BeginnerEchoRewardEntry[]>
    >
  )[planetId];
}

/** Each planet whose Beginner Echo table names `itemId`, with its chance per discovery (#393). */
export function beginnerEchoRewardPlanets(
  itemId: string,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): readonly { planetId: string; percent: number }[] {
  const { rewardTables, rewardWeightTotal } = balance.echoHunts.beginner;
  return Object.entries(
    rewardTables as Readonly<Record<string, readonly BeginnerEchoRewardEntry[]>>,
  ).flatMap(([planetId, table]) => {
    const weight = table.find((entry) => entry.itemId === itemId)?.weight;
    return weight ? [{ planetId, percent: (weight * 100) / rewardWeightTotal }] : [];
  });
}

/** A uniform integer in [0, exclusiveMaximum), from the server's random source. */
export type EchoRandom = { nextInteger(exclusiveMaximum: number): number };

function drawIndex(random: EchoRandom, exclusiveMaximum: number): number {
  const drawn = random.nextInteger(exclusiveMaximum);
  if (!Number.isInteger(drawn) || drawn < 0 || drawn >= exclusiveMaximum) {
    throw new RangeError(`Random draw ${drawn} is outside [0, ${exclusiveMaximum})`);
  }
  return drawn;
}

/** One uniformly chosen location of the pool. */
export function selectEchoTarget(pool: readonly string[], random: EchoRandom): string {
  return pool[drawIndex(random, pool.length)]!;
}

/**
 * The item a roll of `draw` in [0, total) lands on: entries own consecutive
 * spans of their weight, in authored order.
 */
export function echoRewardForDraw(table: readonly BeginnerEchoRewardEntry[], draw: number): string {
  let upper = 0;
  for (const entry of table) {
    upper += entry.weight;
    if (draw < upper) return entry.itemId;
  }
  throw new RangeError(`Echo reward draw ${draw} is outside the table`);
}

export function rollEchoReward(
  table: readonly BeginnerEchoRewardEntry[],
  random: EchoRandom,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): string {
  return echoRewardForDraw(table, drawIndex(random, balance.echoHunts.beginner.rewardWeightTotal));
}

/** The planet's active hunt as the resolver needs it. Never sent to a client. */
export type ActiveEchoHunt = { targetLocationId: string };

export type EchoReadingSnapshot = {
  currentLocationId: string;
  stacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
  /** The current planet's active Beginner hunt, if one is running. */
  hunt?: ActiveEchoHunt;
};

export type EchoReadingOutcome =
  | ({
      kind: "wrong";
      planetId: string;
      sourceLocationId: string;
      /** Set when this reading started the hunt it was resolved against. */
      startedTargetLocationId?: string;
      directions: EchoReadingDirections;
    } & WorkingInventoryDiff)
  | ({
      kind: "found";
      planetId: string;
      sourceLocationId: string;
      rewardItemId: string;
      /** True when the reward went into carried Inventory. */
      rewardKept: boolean;
      /**
       * True when a Legendary that did not fit was sent to the FedHex mailbox
       * instead (#399). Never true for an ordinary item, which is lost.
       */
      rewardMailed: boolean;
      /** Why the reward did not fit; set whenever the reward was not carried (mailed or lost). */
      lostReason?: "slots" | "mass";
      xpAwarded: number;
    } & WorkingInventoryDiff)
  /**
   * Reachable only if the Seeker the reading reserved were taken anyway: nothing
   * is consumed, chosen or paid, and the reading simply ends.
   */
  | { kind: "no_seeker" }
  /** Read where no Beginner hunt exists; the start command refuses this first. */
  | { kind: "no_hunt_here" };

/**
 * Resolve one completed reading. Exactly one Seeker is consumed whether or not
 * the Echo is here. A discovery rolls exactly one item from the current
 * planet's table and keeps it only if it fits the inventory left AFTER the Seeker
 * is gone — partial stacks, a freed slot and the freed mass all count. It never
 * rerolls: an ordinary item that does not fit is lost, a Legendary that does not
 * fit is mailed through FedHex instead (#399), and the discovery still pays its
 * fixed XP either way.
 */
export function resolveEchoReading(input: {
  snapshot: EchoReadingSnapshot;
  random: EchoRandom;
  balance?: EffectiveGameBalance;
}): EchoReadingOutcome {
  const balance = input.balance ?? getEffectiveGameBalance();
  const beginner = balance.echoHunts.beginner;
  const { snapshot } = input;
  const planetId = getLocationPlanetId(snapshot.currentLocationId);
  const pool = planetId ? beginnerEchoTargetPool(planetId) : undefined;
  const table = planetId ? beginnerEchoRewardTable(planetId, balance) : undefined;
  if (!planetId || !pool || !table) return { kind: "no_hunt_here" };

  const consumed = removeStacks(
    workingInventory(snapshot),
    [{ itemId: beginner.seekerItemId, quantity: beginner.seekersPerReading }],
    balance,
  );
  if (!consumed.ok) return { kind: "no_seeker" };

  const startedTargetLocationId = snapshot.hunt ? undefined : selectEchoTarget(pool, input.random);
  const targetLocationId = snapshot.hunt?.targetLocationId ?? startedTargetLocationId!;

  if (targetLocationId !== snapshot.currentLocationId) {
    return {
      kind: "wrong",
      planetId,
      sourceLocationId: snapshot.currentLocationId,
      ...(startedTargetLocationId ? { startedTargetLocationId } : {}),
      directions: echoReadingDirections(snapshot.currentLocationId, targetLocationId),
      ...workingInventoryDiff(snapshot.stacks, consumed.inventory),
    };
  }

  const rewardItemId = rollEchoReward(table, input.random, balance);
  // A Legendary is unique equipment: one authoritative instance, never a stack.
  const added =
    getItemDefinition(rewardItemId, balance)?.kind === "unique"
      ? addUnique(consumed.inventory, rewardItemId as ItemId, balance)
      : addStackExact(consumed.inventory, rewardItemId as ItemId, 1, balance);
  const mailed = !added.ok && isLegendaryEchoReward(rewardItemId);
  return {
    kind: "found",
    planetId,
    sourceLocationId: snapshot.currentLocationId,
    rewardItemId,
    rewardKept: added.ok,
    rewardMailed: mailed,
    ...(added.ok ? {} : { lostReason: added.reason }),
    xpAwarded: beginner.discoveryXp,
    ...workingInventoryDiff(snapshot.stacks, added.ok ? added.inventory : consumed.inventory),
  };
}

/** The Legendary announcement's copy: the character's name, never the account's. */
export function legendaryFindAnnouncementBody(input: {
  characterName: string;
  itemName: string;
  planetName: string;
}): string {
  return `${input.characterName} uncovered Legendary ${input.itemName} from a Resonance Echo on ${input.planetName}!`;
}

/** Whether a reward is a Legendary item: the one kind FedHex recovers instead of losing (#399). */
export function isLegendaryEchoReward(itemId: string): boolean {
  return getItemPresentation(itemId)?.rarity === "legendary";
}

/** A reading may begin only while a Seeker is carried. */
export function canBeginEchoReading(
  stacks: readonly StackState<string>[],
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): boolean {
  const beginner = balance.echoHunts.beginner;
  return (
    carriedQuantity(
      workingInventory({ stacks, slotsAvailable: 0, massAvailableGrams: 0 }),
      beginner.seekerItemId,
    ) >= beginner.seekersPerReading
  );
}

/**
 * Module-load validation: each pool is real World Locations of its own planet
 * with no repeats (the exact members, Deep Jag's absence included, are pinned by
 * tests), each planet with a pool has a table
 * and vice versa, every reward is an authored stackable item or a Legendary
 * unique item, and every table sums to exactly its declared total.
 */
export function validateEchoHuntContent(
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): void {
  const beginner = balance.echoHunts.beginner;
  const tables = beginner.rewardTables as Readonly<
    Record<string, readonly BeginnerEchoRewardEntry[]>
  >;
  const poolPlanets = Object.keys(BEGINNER_ECHO_TARGET_POOLS).sort();
  if (poolPlanets.join() !== Object.keys(tables).sort().join()) {
    throw new Error("Every planet with a Beginner Echo pool needs a reward table, and vice versa");
  }
  for (const [planetId, pool] of Object.entries(BEGINNER_ECHO_TARGET_POOLS)) {
    if (pool.length === 0 || new Set(pool).size !== pool.length) {
      throw new Error(`The ${planetId} Beginner Echo pool must be non-empty with no repeats`);
    }
    for (const locationId of pool) {
      if (!LOCATIONS.some((location) => location.id === locationId)) {
        throw new Error(`Beginner Echo target "${locationId}" is not a World Location`);
      }
      if (getLocationPlanetId(locationId) !== planetId) {
        throw new Error(`Beginner Echo target "${locationId}" is not on ${planetId}`);
      }
    }
    const table = tables[planetId]!;
    let total = 0;
    for (const entry of table) {
      if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
        throw new Error(`${planetId} Echo reward weights must be positive integers`);
      }
      const kind = getItemDefinition(entry.itemId, balance)?.kind;
      // An ordinary prize is stackable; the one other shape is a Legendary unique (#399).
      if (kind !== "stack" && !(kind === "unique" && isLegendaryEchoReward(entry.itemId))) {
        throw new Error(
          `${planetId} Echo reward "${entry.itemId}" must be a stackable item or a Legendary unique item`,
        );
      }
      total += entry.weight;
    }
    if (total !== beginner.rewardWeightTotal) {
      throw new Error(`${planetId} Echo reward weights sum to ${total}, not 100%`);
    }
  }
  if (getItemDefinition(beginner.seekerItemId, balance)?.kind !== "stack") {
    throw new Error("The Beginner Echo Seeker must be a stackable item");
  }
}
