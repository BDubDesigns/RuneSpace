import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ITEM_IDS, LOCATION_IDS, PLANET_IDS } from "@/game/config/foundations";
import { BEGINNER_ECHO_TARGET_POOLS } from "@/game/content/echo-hunts";
import { getLocation, getLocationPlanetId, LOCATIONS } from "@/game/content/locations";
import {
  beginnerEchoRewardPlanets,
  beginnerEchoRewardTable,
  checkEchoClue,
  echoReadingDirections,
  echoRewardForDraw,
  echoScreenAxes,
  resolveEchoReading,
  rollEchoReward,
  selectEchoTarget,
  validateEchoHuntContent,
  type EchoRandom,
  type EchoReadingSnapshot,
} from "@/game/domain/echo-hunts";
import { resolveItemSources, type ItemSourceFacts } from "@/game/domain/item-sources";
import { axialToPixel } from "@/features/travel/local-map-layout";
import {
  echoClueVerdict,
  echoCompassDegrees,
  echoDirectionsCopy,
  echoRewardLostLine,
  echoWrongReadingLine,
} from "@/features/echo-hunts/echo-copy";

/**
 * Beginner Resonance Echo hunts (#393), the pure rules: the fixed pools, the
 * interim ordinary-only tables, directions on the flat-top map's own screen
 * axes, the read-only ruled-out check, and one reading's resolution — one Seeker
 * consumed, target chosen once, reward fitted after the Seeker is gone or lost.
 * Persistence, concurrency and offline resolution are proven against PostgreSQL
 * in tests/integration/echo-hunts.test.ts.
 */

const balance = getEffectiveGameBalance();
const beginner = balance.echoHunts.beginner;
const SEEKER = ITEM_IDS.beginnerEchoSeeker;

/** A random that returns the queued draws in order. */
function draws(...values: number[]): EchoRandom {
  const queue = [...values];
  return {
    nextInteger: (max) => {
      const value = queue.shift();
      if (value === undefined) throw new Error("No draw queued");
      expect(value).toBeLessThan(max);
      return value;
    },
  };
}

describe("the eight-way reading compass", () => {
  it.each([
    ["aligned", "north", 0],
    ["east", "north", 45],
    ["east", "aligned", 90],
    ["east", "south", 135],
    ["aligned", "south", 180],
    ["west", "south", 225],
    ["west", "aligned", 270],
    ["west", "north", 315],
  ] as const)("%s / %s points to %s degrees", (eastWest, northSouth, angle) => {
    expect(echoCompassDegrees(eastWest, northSouth)).toBe(angle);
  });
});

const noDraws: EchoRandom = {
  nextInteger: () => {
    throw new Error("Nothing may be drawn");
  },
};

function snapshot(
  currentLocationId: string,
  stacks: EchoReadingSnapshot["stacks"],
  options: { slots?: number; mass?: number; target?: string } = {},
): EchoReadingSnapshot {
  return {
    currentLocationId,
    stacks,
    slotsAvailable: options.slots ?? 10,
    massAvailableGrams: options.mass ?? 50_000,
    ...(options.target ? { hunt: { targetLocationId: options.target } } : {}),
  };
}

describe("the fixed Beginner pools", () => {
  it("are Skatboll's ten ordinary locations without Deep Jag, and all eight of Stillreach", () => {
    const skatboll = LOCATIONS.filter((l) => l.planetId === PLANET_IDS.skatboll).map((l) => l.id);
    const stillreach = LOCATIONS.filter((l) => l.planetId === PLANET_IDS.stillreach).map(
      (l) => l.id,
    );
    expect(BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll]).toHaveLength(10);
    expect(BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll]).not.toContain(LOCATION_IDS.deepJag);
    expect([...BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll]].sort()).toEqual(
      skatboll.filter((id) => id !== LOCATION_IDS.deepJag).sort(),
    );
    expect(BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach]).toHaveLength(8);
    expect([...BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach]].sort()).toEqual(
      [...stillreach].sort(),
    );
    expect(() => validateEchoHuntContent()).not.toThrow();
  });

  it("chooses uniformly by index and never outside the pool", () => {
    const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll];
    pool.forEach((locationId, index) => {
      expect(selectEchoTarget(pool, draws(index))).toBe(locationId);
    });
    expect(() => selectEchoTarget(pool, { nextInteger: () => pool.length })).toThrow(RangeError);
    expect(() => selectEchoTarget(pool, { nextInteger: () => -1 })).toThrow(RangeError);
  });
});

describe("the interim ordinary-only tables (Slice I)", () => {
  it("sum to exactly 100% with Rune Fragment at 30.2% on both planets", () => {
    expect(beginner.rewardWeightTotal).toBe(1_000);
    const percent = (planetId: string) =>
      Object.fromEntries(
        beginnerEchoRewardTable(planetId)!.map((entry) => [entry.itemId, entry.weight / 10]),
      );
    expect(percent(PLANET_IDS.skatboll)).toEqual({
      [ITEM_IDS.runeFragment]: 30.2,
      [ITEM_IDS.uncutQuartz]: 24,
      [ITEM_IDS.uncutTopaz]: 16,
      [ITEM_IDS.uncutSapphire]: 10,
      [ITEM_IDS.refinedFerrite]: 12,
      [ITEM_IDS.galvanicStock]: 5,
      [ITEM_IDS.runestone]: 2.8,
    });
    expect(percent(PLANET_IDS.stillreach)).toEqual({
      [ITEM_IDS.runeFragment]: 30.2,
      [ITEM_IDS.uncutQuartz]: 26,
      [ITEM_IDS.uncutTopaz]: 20,
      [ITEM_IDS.uncutSapphire]: 10,
      [ITEM_IDS.emptySmallFuelCanister]: 10,
      [ITEM_IDS.runestone]: 3.8,
    });
    for (const planetId of [PLANET_IDS.skatboll, PLANET_IDS.stillreach]) {
      const total = beginnerEchoRewardTable(planetId)!.reduce((sum, e) => sum + e.weight, 0);
      expect(total).toBe(1_000);
    }
  });

  it("maps every draw to exactly the span its weight owns, boundaries included", () => {
    for (const planetId of [PLANET_IDS.skatboll, PLANET_IDS.stillreach]) {
      const table = beginnerEchoRewardTable(planetId)!;
      const counts = new Map<string, number>();
      for (let draw = 0; draw < 1_000; draw += 1) {
        const itemId = echoRewardForDraw(table, draw);
        counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
      }
      for (const entry of table) expect(counts.get(entry.itemId)).toBe(entry.weight);
      expect(() => echoRewardForDraw(table, 1_000)).toThrow(RangeError);
    }
    const skatboll = beginnerEchoRewardTable(PLANET_IDS.skatboll)!;
    expect(echoRewardForDraw(skatboll, 0)).toBe(ITEM_IDS.runeFragment);
    expect(echoRewardForDraw(skatboll, 301)).toBe(ITEM_IDS.runeFragment);
    expect(echoRewardForDraw(skatboll, 302)).toBe(ITEM_IDS.uncutQuartz);
    expect(echoRewardForDraw(skatboll, 971)).toBe(ITEM_IDS.galvanicStock);
    expect(echoRewardForDraw(skatboll, 972)).toBe(ITEM_IDS.runestone);
    expect(echoRewardForDraw(skatboll, 999)).toBe(ITEM_IDS.runestone);
    expect(rollEchoReward(skatboll, draws(999))).toBe(ITEM_IDS.runestone);
  });

  it("ships no Legendary or unknown reward, and every reward is an ordinary item", () => {
    const itemIds = Object.values(beginner.rewardTables).flatMap((table) =>
      table.map((entry) => entry.itemId),
    );
    expect(itemIds.join(" ")).not.toMatch(/legendary|boots|gloves/i);
    for (const itemId of itemIds) expect(getItemDefinition(itemId)?.kind).toBe("stack");
  });

  it("names each planet's chance for an item, and only where the table has it", () => {
    expect(beginnerEchoRewardPlanets(ITEM_IDS.galvanicStock)).toEqual([
      { planetId: PLANET_IDS.skatboll, percent: 5 },
    ]);
    expect(beginnerEchoRewardPlanets(ITEM_IDS.runeFragment)).toEqual([
      { planetId: PLANET_IDS.skatboll, percent: 30.2 },
      { planetId: PLANET_IDS.stillreach, percent: 30.2 },
    ]);
    expect(beginnerEchoRewardPlanets(SEEKER)).toEqual([]);
  });
});

describe("directions on the flat-top map", () => {
  it("order exactly like the drawn screen axes for every pair on a planet", () => {
    for (const source of LOCATIONS) {
      for (const target of LOCATIONS) {
        if (source.planetId !== target.planetId || source.id === target.id) continue;
        const a = axialToPixel(source.presentation.localMap.axial);
        const b = axialToPixel(target.presentation.localMap.axial);
        const directions = echoReadingDirections(source.id, target.id);
        const dx = Math.abs(b.x - a.x) < 1e-6 ? 0 : b.x - a.x;
        const dy = Math.abs(b.y - a.y) < 1e-6 ? 0 : b.y - a.y;
        expect(directions.eastWest).toBe(dx > 0 ? "east" : dx < 0 ? "west" : "aligned");
        expect(directions.northSouth).toBe(dy > 0 ? "south" : dy < 0 ? "north" : "aligned");
        expect(directions.eastWest === "aligned" && directions.northSouth === "aligned").toBe(
          false,
        );
      }
    }
  });

  it("reads concrete Stillreach clues", () => {
    // Landing Station (0,0); Hilltop Workshop (2,-1) is due east of it on screen.
    expect(echoScreenAxes({ q: 2, r: -1 })).toEqual({ east: 2, south: 0 });
    expect(
      echoReadingDirections(LOCATION_IDS.stillreachLandingStation, LOCATION_IDS.hilltopWorkshop),
    ).toEqual({ eastWest: "east", northSouth: "aligned" });
    expect(echoReadingDirections(LOCATION_IDS.harmonicWorkings, LOCATION_IDS.theLowHum)).toEqual({
      eastWest: "east",
      northSouth: "north",
    });
  });
});

describe("the read-only ruled-out check", () => {
  const clue = (source: string, target: string) => ({
    sourceLocationId: source,
    directions: echoReadingDirections(source, target),
  });

  it("always rules out the reading's own hex, and never rules out the real target", () => {
    for (const source of LOCATIONS) {
      for (const target of LOCATIONS) {
        if (source.planetId !== target.planetId || source.id === target.id) continue;
        const reading = clue(source.id, target.id);
        expect(checkEchoClue({ ...reading, currentLocationId: source.id }).ruledOut).toBe(true);
        expect(checkEchoClue({ ...reading, currentLocationId: target.id }).ruledOut).toBe(false);
      }
    }
  });

  it("names the axis that conflicts", () => {
    // A clue of due east from the Landing Station.
    const reading = clue(LOCATION_IDS.stillreachLandingStation, LOCATION_IDS.hilltopWorkshop);
    // The Quarry (1,1) is east but south: only the north–south axis conflicts.
    expect(
      checkEchoClue({ ...reading, currentLocationId: LOCATION_IDS.prospectingQuarry }),
    ).toEqual({ eastWestConflict: false, northSouthConflict: true, ruledOut: true });
    // The Low Hum (3,-2) is east and north of the station.
    expect(checkEchoClue({ ...reading, currentLocationId: LOCATION_IDS.theLowHum }).ruledOut).toBe(
      true,
    );
    // The Dry Seam (3,0): x 3, y 3 — south. Windward Track (1,0): x 1, y 1 — south too.
    expect(
      checkEchoClue({ ...reading, currentLocationId: LOCATION_IDS.windwardTrack }),
    ).toMatchObject({ eastWestConflict: false, northSouthConflict: true });
  });

  it("explains a ruled-out hex by axis, and never promises the Echo", () => {
    const check = { eastWestConflict: true, northSouthConflict: false, ruledOut: true };
    expect(echoClueVerdict(check, "east", "north", "Crash Site")).toBe(
      "This location is ruled out by your last reading: the Echo is east of Crash Site.",
    );
    expect(
      echoClueVerdict(
        { eastWestConflict: true, northSouthConflict: true, ruledOut: true },
        "aligned",
        "south",
        "The Jag",
      ),
    ).toBe(
      "This location is ruled out by your last reading: the Echo is neither east nor west of The Jag, and the Echo is south of The Jag.",
    );
    const fits = { eastWestConflict: false, northSouthConflict: false, ruledOut: false };
    expect(echoClueVerdict(fits, "east", "north", "x")).toBe(
      "This location is not ruled out by your last reading.",
    );
  });

  it("words directions and results as the approved copy", () => {
    expect(echoDirectionsCopy("west", "north")).toBe("northwest");
    expect(echoDirectionsCopy("aligned", "south")).toBe("due south");
    expect(echoDirectionsCopy("east", "aligned")).toBe("due east");
    expect(echoWrongReadingLine("west", "north")).toBe(
      "A faint resonance pulls toward the northwest. The Echo is not here.",
    );
    expect(echoWrongReadingLine("aligned", "north")).toBe(
      "A faint resonance pulls due north. The Echo is not here.",
    );
    expect(echoRewardLostLine(ITEM_IDS.runestone)).toMatch(
      /slipped back into RuneSpace — not enough Inventory space\.$/,
    );
  });
});

describe("resolving one reading", () => {
  const seekers = (quantity: number, id = "s1") => ({ id, itemId: SEEKER, quantity });

  it("starts a hunt on the first reading and may find the Echo where the player stands", () => {
    const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach];
    const here = pool.indexOf(LOCATION_IDS.hilltopWorkshop);
    const outcome = resolveEchoReading({
      snapshot: snapshot(LOCATION_IDS.hilltopWorkshop, [seekers(3)]),
      random: draws(here, 0),
    });
    expect(outcome).toMatchObject({
      kind: "found",
      planetId: PLANET_IDS.stillreach,
      rewardItemId: ITEM_IDS.runeFragment,
      rewardKept: true,
      xpAwarded: 50,
      stackUpdates: [{ id: "s1", quantity: 2 }],
      createdStacks: [{ itemId: ITEM_IDS.runeFragment, quantity: 1 }],
    });
  });

  it("is wrong elsewhere: one Seeker consumed, directions from the source hex, no roll", () => {
    const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach];
    const outcome = resolveEchoReading({
      snapshot: snapshot(LOCATION_IDS.stillreachLandingStation, [seekers(1)]),
      random: draws(pool.indexOf(LOCATION_IDS.hilltopWorkshop)),
    });
    expect(outcome).toEqual({
      kind: "wrong",
      planetId: PLANET_IDS.stillreach,
      sourceLocationId: LOCATION_IDS.stillreachLandingStation,
      startedTargetLocationId: LOCATION_IDS.hilltopWorkshop,
      directions: { eastWest: "east", northSouth: "aligned" },
      stackUpdates: [],
      deletedStackIds: ["s1"],
      createdStacks: [],
    });
  });

  it("reads against the active hunt without choosing a new target", () => {
    const outcome = resolveEchoReading({
      snapshot: snapshot(LOCATION_IDS.crashSite, [seekers(2)], { target: LOCATION_IDS.theJag }),
      random: noDraws,
    });
    expect(outcome.kind).toBe("wrong");
    expect(outcome).not.toHaveProperty("startedTargetLocationId");
  });

  it("loses only the rolled item when it will not fit, by slots or by mass", () => {
    // Full slots: the Seeker stack stays (3 → 2), so no slot frees.
    const slots = resolveEchoReading({
      snapshot: snapshot(LOCATION_IDS.theJag, [seekers(3)], {
        slots: 0,
        target: LOCATION_IDS.theJag,
      }),
      random: draws(0),
    });
    expect(slots).toMatchObject({
      kind: "found",
      rewardItemId: ITEM_IDS.runeFragment,
      rewardKept: false,
      lostReason: "slots",
      xpAwarded: 50,
      stackUpdates: [{ id: "s1", quantity: 2 }],
      createdStacks: [],
    });
    // An intact Runestone (1 kg) against 200 g freed by the Seeker: mass refuses.
    const mass = resolveEchoReading({
      snapshot: snapshot(LOCATION_IDS.theJag, [seekers(3)], {
        slots: 5,
        mass: 0,
        target: LOCATION_IDS.theJag,
      }),
      random: draws(999),
    });
    expect(mass).toMatchObject({ rewardItemId: ITEM_IDS.runestone, lostReason: "mass" });
  });

  it("fits the reward into what the Seeker freed: its slot, its mass, a partial stack", () => {
    // The last Seeker frees its slot and 200 g, exactly a Fragment's.
    const freed = resolveEchoReading({
      snapshot: snapshot(LOCATION_IDS.theJag, [seekers(1)], {
        slots: 0,
        mass: 0,
        target: LOCATION_IDS.theJag,
      }),
      random: draws(0),
    });
    expect(freed).toMatchObject({
      rewardKept: true,
      deletedStackIds: ["s1"],
      createdStacks: [{ itemId: ITEM_IDS.runeFragment, quantity: 1 }],
    });
    // A part-full Fragment stack takes it with no slot at all.
    const partial = resolveEchoReading({
      snapshot: snapshot(
        LOCATION_IDS.theJag,
        [seekers(3), { id: "f1", itemId: ITEM_IDS.runeFragment, quantity: 4 }],
        { slots: 0, mass: 0, target: LOCATION_IDS.theJag },
      ),
      random: draws(0),
    });
    expect(partial).toMatchObject({
      rewardKept: true,
      stackUpdates: expect.arrayContaining([
        { id: "s1", quantity: 2 },
        { id: "f1", quantity: 5 },
      ]),
      createdStacks: [],
    });
  });

  it("consumes, chooses and pays nothing without a Seeker", () => {
    expect(
      resolveEchoReading({
        snapshot: snapshot(LOCATION_IDS.theJag, []),
        random: noDraws,
      }),
    ).toEqual({ kind: "no_seeker" });
  });
});

describe("Sources for Echo loot", () => {
  const facts = (resonanceRigUnlocked: boolean): ItemSourceFacts => ({
    skillLevels: {},
    acceptedMissionIds: new Set(),
    completedMissionIds: new Set(),
    fabricationStationUnlocked: false,
    resonanceRigUnlocked,
    locationStates: {},
  });

  it("lists a Resonance Echo once the Rig is the character's, never before", () => {
    const echo = (unlocked: boolean) =>
      resolveItemSources(ITEM_IDS.uncutSapphire, facts(unlocked)).filter(
        (source) => source.kind === "echo_hunt",
      );
    expect(echo(false)).toEqual([]);
    expect(echo(true)).toEqual([
      {
        kind: "echo_hunt",
        planetIds: [PLANET_IDS.skatboll, PLANET_IDS.stillreach],
        access: { state: "available" },
      },
    ]);
    expect(
      resolveItemSources(SEEKER, facts(true)).some((source) => source.kind === "echo_hunt"),
    ).toBe(false);
  });
});

it("keeps every pool location on the planet that owns it", () => {
  for (const [planetId, pool] of Object.entries(BEGINNER_ECHO_TARGET_POOLS)) {
    for (const locationId of pool) {
      expect(getLocation(locationId)).toBeDefined();
      expect(getLocationPlanetId(locationId)).toBe(planetId);
    }
  }
});
