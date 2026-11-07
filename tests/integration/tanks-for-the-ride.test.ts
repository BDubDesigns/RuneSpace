import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import type { RealtimeEnvelope } from "@/game/schemas/realtime";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #501 — Tanks for the Ride, against real PostgreSQL.
 *
 * Wade's long-range tank job is built on the character's own berthed Rivet
 * through the ordinary repair path. Its 32nd committed Welding section, and only
 * that one, completes the repair, stamps the Mission and raises that ship's tank
 * from 300 to 750 FU in one transaction, leaving current fuel untouched.
 */
suite("issue #501 Tanks for the Ride (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let missions: typeof import("@/server/missions");
  let repairs: typeof import("@/server/repair-commands");
  let ship: typeof import("@/server/ship-commands");
  let resolution: typeof import("@/server/action-resolution");
  let systemNotices: typeof import("@/server/system-notices");
  let repairCompletion: typeof import("@/server/repair-completion");
  let realtime: typeof import("@/server/realtime");
  const createdUsers: string[] = [];
  const now = new Date("2026-11-07T12:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const tank = getRepairTargetBalance(REPAIR_TARGET_IDS.rivetLongRangeTank, balance);
  const thresholds = standardSkillLevelThresholds(balance);
  const WELD_TICKS = balance.welding.attemptDurationTicks;
  const TARGET = REPAIR_TARGET_IDS.rivetLongRangeTank;
  const MISSION = MISSION_IDS.tanksForTheRide;
  const BASE = balance.ship.tankCapacityFuelUnits;
  const LONG = balance.ship.longRangeTankCapacityFuelUnits;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    progression = await import("@/server/progression");
    missions = await import("@/server/missions");
    repairs = await import("@/server/repair-commands");
    ship = await import("@/server/ship-commands");
    resolution = await import("@/server/action-resolution");
    systemNotices = await import("@/server/system-notices");
    repairCompletion = await import("@/server/repair-completion");
    realtime = await import("@/server/realtime");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const certain = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);

  const STORY = [
    MISSION_IDS.walkItOff,
    MISSION_IDS.cutYourTeeth,
    MISSION_IDS.wasteNot,
    MISSION_IDS.holdItTogether,
    MISSION_IDS.keepTheChange,
    MISSION_IDS.tenThousandHours,
    MISSION_IDS.returnTheFavor,
    MISSION_IDS.breakItDown,
    MISSION_IDS.braceYourself,
    MISSION_IDS.wheelBeRightBack,
    MISSION_IDS.thrustIssues,
    MISSION_IDS.moveAlong,
  ];

  async function grantLevel(characterId: string, level: number) {
    await db.transaction(async (transaction) => {
      await progression.grantCharacterSkillXp(transaction, {
        characterId,
        skillId: SKILL_IDS.welding,
        awardedXp: thresholds.find((threshold) => threshold.level === level)!.totalXp,
        thresholds,
      });
    });
  }

  async function move(characterId: string, locationId: LocationId) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  /**
   * A character whose Rivet has flown (Move Along done, every original repair
   * finished) and is parked at `berth`, with the character beside it.
   */
  async function makeCharacter(
    options: {
      welding?: number;
      berth?: LocationId;
      fuel?: number;
      capacity?: number;
      moveAlongDone?: boolean;
      at?: LocationId;
    } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Tank Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Tank ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    const characterId = character.id;
    await play.getPlayGameplayState(userId, characterId, now, certain());
    const done =
      options.moveAlongDone === false ? STORY.filter((id) => id !== MISSION_IDS.moveAlong) : STORY;
    await db
      .insert(rune.characterMissions)
      .values(
        done.map((id) => ({ characterId, missionId: id, acceptedAt: now, completedAt: now })),
      );
    if (options.moveAlongDone === false) {
      await db
        .insert(rune.characterMissions)
        .values({ characterId, missionId: MISSION_IDS.moveAlong, acceptedAt: now });
    }
    for (const targetId of [
      REPAIR_TARGET_IDS.cargoHold,
      REPAIR_TARGET_IDS.landingGear,
      REPAIR_TARGET_IDS.propulsionSystem,
    ]) {
      const recipe = getRepairTargetBalance(targetId, balance);
      await seedRepairTarget(db, rune, characterId, targetId, {
        materials: installedMaterials(recipe),
        weldingProgress: recipe.repairIncrements,
        completedAt: now,
        updatedAt: now,
      });
    }
    const berth = options.berth ?? LOCATION_IDS.holoHollowLanding;
    await db.insert(rune.characterShips).values({
      characterId,
      berthLocationId: berth,
      fuelUnits: options.fuel ?? 120,
      tankCapacityFuelUnits: options.capacity ?? BASE,
    });
    await move(characterId, options.at ?? berth);
    await grantLevel(characterId, options.welding ?? 16);
    return { userId, characterId };
  }

  async function give(characterId: string, itemId: string, quantity: number) {
    await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
  }

  async function carried(characterId: string, itemId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function weldingXp(characterId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
        ),
      );
    return row?.totalXp ?? 0;
  }

  async function missionRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, MISSION),
          ),
        )
    )[0];
  }

  async function tankRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, TARGET),
          ),
        )
    )[0];
  }

  async function shipRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterShips)
        .where(eq(rune.characterShips.characterId, characterId))
    )[0]!;
  }

  const stateAt = (userId: string, characterId: string, at = now) =>
    play.getPlayGameplayState(userId, characterId, at, certain());

  /** Accepts the Mission the way a player does: in person with Wade at Rusk Recovery. */
  async function accept(userId: string, characterId: string, restoreAt?: LocationId) {
    const where = (
      await db
        .select({ at: rune.characters.currentLocationId })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]!.at as LocationId;
    await move(characterId, LOCATION_IDS.ruskRecovery);
    const accepted = await missions.acceptMission(
      userId,
      characterId,
      MISSION,
      NPC_IDS.wadeRusk,
      now,
      certain(),
    );
    await move(characterId, restoreAt ?? where);
    return accepted;
  }

  const fullBill = installedMaterials(tank);
  async function giveBill(characterId: string) {
    for (const [itemId, quantity] of Object.entries(fullBill)) {
      await give(characterId, itemId, quantity);
    }
  }
  const contribute = (userId: string, characterId: string, expected = fullBill) =>
    repairs.contributeRepairMaterials(
      userId,
      characterId,
      { targetId: TARGET, expectedMaterials: expected },
      now,
      certain(),
    );
  const startWelding = (userId: string, characterId: string, at = now) =>
    repairs.startWelding(userId, characterId, TARGET, at, certain());

  async function readyToWeld(options: Parameters<typeof makeCharacter>[0] = {}) {
    const made = await makeCharacter(options);
    expect((await accept(made.userId, made.characterId)).mission.status).toBe("accepted");
    await giveBill(made.characterId);
    expect((await contribute(made.userId, made.characterId)).repair.status).toBe("committed");
    return made;
  }

  describe("the offer", () => {
    it("is refused below Welding 16", async () => {
      const { userId, characterId } = await makeCharacter({ welding: 15 });
      const refused = await accept(userId, characterId);
      expect(refused.mission.status).toBe("refused");
      expect(await missionRow(characterId)).toBeUndefined();
    });

    it("is refused while Move Along is only accepted, however far the ship has been flown", async () => {
      const { userId, characterId } = await makeCharacter({ moveAlongDone: false });
      const refused = await accept(userId, characterId);
      expect(refused.mission.status).toBe("refused");
      expect(await missionRow(characterId)).toBeUndefined();
    });

    it("is accepted once at Welding 16 after Move Along, and accepting opens no repair work early", async () => {
      const { userId, characterId } = await makeCharacter();
      const before = await stateAt(userId, characterId);
      expect(before.repairs[TARGET]?.repairAvailable).toBe(false);
      expect((await accept(userId, characterId)).mission.status).toBe("accepted");
      expect((await accept(userId, characterId)).mission.status).not.toBe("refused");
      const after = await stateAt(userId, characterId);
      expect(after.repairs[TARGET]).toMatchObject({ repairAvailable: true, complete: false });
      expect(after.ship.tankCapacityFuelUnits).toBe(BASE);
    });
  });

  describe("material contributions", () => {
    it("takes only the exact bill, in batches, and never spends a spare", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await give(characterId, ITEM_IDS.emptySmallFuelCanister, 2);
      await give(characterId, ITEM_IDS.mountingBracket, 5);
      const first = await contribute(userId, characterId, {
        [ITEM_IDS.emptySmallFuelCanister]: 2,
        [ITEM_IDS.mountingBracket]: 4,
      });
      expect(first.repair.status).toBe("committed");
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(1);
      expect((await tankRow(characterId))?.materials).toEqual({
        [ITEM_IDS.emptySmallFuelCanister]: 2,
        [ITEM_IDS.mountingBracket]: 4,
      });

      await give(characterId, ITEM_IDS.emptySmallFuelCanister, 4);
      await give(characterId, ITEM_IDS.galvaferrite, 4);
      await give(characterId, ITEM_IDS.galvanicWireSpool, 1);
      await give(characterId, ITEM_IDS.powerCell, 2);
      const second = await contribute(userId, characterId, {
        [ITEM_IDS.emptySmallFuelCanister]: 1,
        [ITEM_IDS.galvaferrite]: 4,
        [ITEM_IDS.galvanicWireSpool]: 1,
        [ITEM_IDS.powerCell]: 2,
      });
      expect(second.repair.status).toBe("committed");
      expect(await carried(characterId, ITEM_IDS.emptySmallFuelCanister)).toBe(3);
      expect((await tankRow(characterId))?.materials).toEqual(fullBill);

      // Nothing more is wanted, so a repeat takes nothing.
      const repeat = await contribute(userId, characterId, {});
      expect(repeat.repair.status).toBe("refused");
      expect(await carried(characterId, ITEM_IDS.emptySmallFuelCanister)).toBe(3);
    });

    it("never counts a Full canister as an Empty one", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await give(characterId, ITEM_IDS.fullSmallFuelCanister, 3);
      const refused = await contribute(userId, characterId, {});
      expect(refused.repair.status).toBe("refused");
      expect(await carried(characterId, ITEM_IDS.fullSmallFuelCanister)).toBe(3);
      expect(await tankRow(characterId)).toBeUndefined();
    });

    it("cannot be satisfied from the Cargo Hold", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await db.insert(rune.cargoHoldStacks).values({
        characterId,
        itemId: ITEM_IDS.mountingBracket,
        quantity: 4,
      });
      const refused = await contribute(userId, characterId, {});
      expect(refused.repair.status).toBe("refused");
      expect(await tankRow(characterId)).toBeUndefined();
    });

    it("refuses a stale expectation without consuming anything", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await give(characterId, ITEM_IDS.mountingBracket, 4);
      const refused = await contribute(userId, characterId, { [ITEM_IDS.mountingBracket]: 2 });
      expect(refused.repair).toMatchObject({ status: "refused", reason: "materials_changed" });
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(4);
    });
  });

  describe("the physical berth", () => {
    for (const berth of [LOCATION_IDS.holoHollowLanding, LOCATION_IDS.stillreachLandingStation]) {
      it(`builds the tank beside the Rivet at ${berth}`, async () => {
        const { userId, characterId } = await readyToWeld({ berth });
        const state = await stateAt(userId, characterId);
        expect(state.ship.berthLocationId).toBe(berth);
        expect(state.repairs[TARGET]).toMatchObject({ materialComplete: true });
        await startWelding(userId, characterId);
        const mid = await stateAt(userId, characterId, tick(now, 3 * WELD_TICKS));
        expect(mid.repairs[TARGET]?.weldingProgress).toBe(3);
      });
    }

    it("refuses work from anywhere but the Rivet's berth, including the Crash Site", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await give(characterId, ITEM_IDS.mountingBracket, 4);
      await move(characterId, LOCATION_IDS.crashSite);
      const refused = await contribute(userId, characterId, { [ITEM_IDS.mountingBracket]: 4 });
      expect(refused.repair).toMatchObject({ status: "refused", reason: "wrong_location" });
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(4);
      expect(await tankRow(characterId)).toBeUndefined();
    });

    it("loses nothing when the ship moves mid-job: the work follows the Rivet", async () => {
      const { userId, characterId } = await readyToWeld({ berth: LOCATION_IDS.holoHollowLanding });
      await startWelding(userId, characterId);
      await stateAt(userId, characterId, tick(now, 5 * WELD_TICKS));
      await repairs.stopWelding(userId, characterId, TARGET, tick(now, 5 * WELD_TICKS), certain());
      const stopped = await tankRow(characterId);
      expect(stopped?.weldingProgress).toBe(5);

      // The Rivet flies on its original tank to Stillreach, as the character does.
      const origin = tick(now, 6 * WELD_TICKS);
      await db
        .update(rune.characterShips)
        .set({ berthLocationId: LOCATION_IDS.stillreachLandingStation })
        .where(eq(rune.characterShips.characterId, characterId));
      await move(characterId, LOCATION_IDS.stillreachLandingStation);

      const resumed = await repairs.startWelding(userId, characterId, TARGET, origin, certain());
      expect(resumed.repairs[TARGET]).toMatchObject({ weldingProgress: 5, materialComplete: true });
      const later = await stateAt(userId, characterId, tick(origin, 2 * WELD_TICKS));
      expect(later.repairs[TARGET]?.weldingProgress).toBe(7);

      // And the old berth is now the wrong place.
      await repairs.stopWelding(
        userId,
        characterId,
        TARGET,
        tick(origin, 2 * WELD_TICKS),
        certain(),
      );
      await move(characterId, LOCATION_IDS.holoHollowLanding);
      const wrong = await repairs.startWelding(
        userId,
        characterId,
        TARGET,
        tick(origin, 3 * WELD_TICKS),
        certain(),
      );
      expect(wrong.weldingError).toBe("welding_unavailable_here");
    });

    it("refuses while the Rivet is in flight", async () => {
      const { userId, characterId } = await readyToWeld({ fuel: 130 });
      const launched = await ship.launchShip(
        userId,
        characterId,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        now,
      );
      expect(launched.launch.status).toBe("launched");
      // The command boundary itself refuses every repair command during a flight.
      await expect(contribute(userId, characterId, {})).rejects.toThrow(/in flight/i);
      await expect(startWelding(userId, characterId)).rejects.toThrow(/in flight/i);
      expect((await tankRow(characterId))?.weldingProgress).toBe(0);
    });

    it("refuses a contribution while the character is busy welding", async () => {
      const { userId, characterId } = await readyToWeld();
      await startWelding(userId, characterId);
      await give(characterId, ITEM_IDS.mountingBracket, 1);
      const refused = await contribute(userId, characterId, { [ITEM_IDS.mountingBracket]: 1 });
      expect(refused.repair).toMatchObject({ status: "refused", reason: "in_transit" });
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(1);
    });

    it("cannot depart in the middle of a weld, and the original flights still work between sessions", async () => {
      const { userId, characterId } = await readyToWeld({ fuel: 130 });
      await startWelding(userId, characterId);
      const refused = await ship.launchShip(
        userId,
        characterId,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        tick(now, WELD_TICKS),
      );
      expect(refused.launch.status).toBe("refused");

      await repairs.stopWelding(userId, characterId, TARGET, tick(now, WELD_TICKS), certain());
      const launched = await ship.launchShip(
        userId,
        characterId,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        tick(now, 2 * WELD_TICKS),
      );
      expect(launched.launch.status).toBe("launched");
      expect((await shipRow(characterId)).fuelUnits).toBe(10);
      expect((await shipRow(characterId)).tankCapacityFuelUnits).toBe(BASE);
    });
  });

  describe("the 32nd weld", () => {
    it("completes the repair, the Mission and the upgrade together, exactly once, for 1,600 base XP", async () => {
      const { userId, characterId } = await readyToWeld({ fuel: 120 });
      const before = await weldingXp(characterId);
      await startWelding(userId, characterId);

      const almost = await stateAt(userId, characterId, tick(now, 31 * WELD_TICKS));
      expect(almost.repairs[TARGET]).toMatchObject({ complete: false, weldingProgress: 31 });
      expect(almost.ship.tankCapacityFuelUnits).toBe(BASE);
      expect((await missionRow(characterId))?.completedAt).toBeNull();
      expect((await shipRow(characterId)).tankCapacityFuelUnits).toBe(BASE);

      const finishedAt = tick(now, 32 * WELD_TICKS);
      const done = await stateAt(userId, characterId, finishedAt);
      expect(done.repairs[TARGET]).toMatchObject({ complete: true, weldingProgress: 32 });
      expect(done.ship.tankCapacityFuelUnits).toBe(LONG);
      expect(done.ship.fuelUnits).toBe(120);
      expect(done.missions.find((entry) => entry.missionId === MISSION)?.state).toBe("completed");
      const mission = await missionRow(characterId);
      expect(mission?.completedAt).not.toBeNull();
      const row = await shipRow(characterId);
      expect(row).toMatchObject({ tankCapacityFuelUnits: LONG, fuelUnits: 120 });
      expect((await weldingXp(characterId)) - before).toBe(32 * balance.welding.xpPerIncrement);

      // Resolving again, even much later or repeatedly, changes and pays nothing more.
      const later = tick(finishedAt, 500);
      await stateAt(userId, characterId, later);
      await stateAt(userId, characterId, later);
      expect((await weldingXp(characterId)) - before).toBe(1600);
      expect((await missionRow(characterId))?.completedAt?.getTime()).toBe(
        mission?.completedAt?.getTime(),
      );
      expect((await shipRow(characterId)).tankCapacityFuelUnits).toBe(LONG);
      expect((await tankRow(characterId))?.completedAt).not.toBeNull();
    });

    it("lands while the player is away and the ship still gets its tank", async () => {
      const { userId, characterId } = await readyToWeld();
      await startWelding(userId, characterId);
      const state = await stateAt(userId, characterId, tick(now, 10 * 32 * WELD_TICKS));
      expect(state.repairs[TARGET]?.complete).toBe(true);
      expect(state.ship.tankCapacityFuelUnits).toBe(LONG);
      expect((await weldingXp(characterId)) - 0).toBeGreaterThanOrEqual(1600);
    });

    it("leaves other characters' ships at 300", async () => {
      const mine = await readyToWeld();
      const other = await makeCharacter();
      await startWelding(mine.userId, mine.characterId);
      await stateAt(mine.userId, mine.characterId, tick(now, 40 * WELD_TICKS));
      expect((await shipRow(mine.characterId)).tankCapacityFuelUnits).toBe(LONG);
      expect((await shipRow(other.characterId)).tankCapacityFuelUnits).toBe(BASE);
      expect((await stateAt(other.userId, other.characterId)).ship.tankCapacityFuelUnits).toBe(
        BASE,
      );
    });

    it("creates a ship row at the starting defaults when a legacy character somehow has none", async () => {
      const { userId, characterId } = await readyToWeld();
      await db.delete(rune.characterShips).where(eq(rune.characterShips.characterId, characterId));
      await move(characterId, LOCATION_IDS.crashSite);
      await startWelding(userId, characterId);
      await stateAt(userId, characterId, tick(now, 40 * WELD_TICKS));
      expect(await shipRow(characterId)).toMatchObject({
        berthLocationId: LOCATION_IDS.crashSite,
        fuelUnits: 0,
        tankCapacityFuelUnits: LONG,
      });
    });
  });

  describe("fuel capacity", () => {
    it("holds an unupgraded ship at 300 and an upgraded one at 750, never above", async () => {
      const base = await makeCharacter({ fuel: 300 });
      await give(base.characterId, ITEM_IDS.fullSmallFuelCanister, 1);
      const full = await ship.refuelShip(
        base.userId,
        base.characterId,
        { source: "inventory", expectedFuelUnits: 300 },
        now,
      );
      expect(full.refuel).toMatchObject({ status: "refused", reason: "tank_full" });

      const upgraded = await makeCharacter({ fuel: 700, capacity: LONG });
      await give(upgraded.characterId, ITEM_IDS.fullSmallFuelCanister, 2);
      const first = await ship.refuelShip(
        upgraded.userId,
        upgraded.characterId,
        { source: "inventory", expectedFuelUnits: 700 },
        now,
      );
      expect(first.refuel).toMatchObject({ status: "loaded", fuelUnits: 750 });
      const second = await ship.refuelShip(
        upgraded.userId,
        upgraded.characterId,
        { source: "inventory", expectedFuelUnits: 750 },
        now,
      );
      expect(second.refuel).toMatchObject({ status: "refused", reason: "tank_full" });
      expect((await shipRow(upgraded.characterId)).fuelUnits).toBe(750);
    });

    it("is guarded by the database itself", async () => {
      const { characterId } = await makeCharacter();
      const set = (values: Partial<typeof rune.characterShips.$inferInsert>) =>
        db
          .update(rune.characterShips)
          .set(values)
          .where(eq(rune.characterShips.characterId, characterId));
      await expect(set({ fuelUnits: BASE + 1 })).rejects.toThrow();
      await expect(set({ tankCapacityFuelUnits: 500 })).rejects.toThrow();
      await expect(set({ tankCapacityFuelUnits: LONG, fuelUnits: LONG + 1 })).rejects.toThrow();
      await set({ tankCapacityFuelUnits: LONG, fuelUnits: LONG });
      expect((await shipRow(characterId)).fuelUnits).toBe(LONG);
      // A smaller capacity can never strand more fuel than it holds.
      await expect(set({ tankCapacityFuelUnits: BASE })).rejects.toThrow();
    });
  });

  describe("the durable System notice (Chat → Whispers → System)", () => {
    const TITLE = "Tanks for the Ride — Complete!";
    const BODY =
      "Your Rivet's long-range tank installation is complete. Maximum fuel capacity increased from 300 to 750 FU. Current fuel unchanged.";

    async function noticeRows(characterId: string) {
      return db
        .select()
        .from(rune.recipeUnlockNotices)
        .where(eq(rune.recipeUnlockNotices.characterId, characterId))
        .orderBy(rune.recipeUnlockNotices.seq);
    }

    function listen(character: { id: string }) {
      const received: RealtimeEnvelope[] = [];
      return db
        .select({ playerAccountId: rune.characters.playerAccountId })
        .from(rune.characters)
        .where(eq(rune.characters.id, character.id))
        .then(([row]) => {
          const unsubscribe = realtime.getRealtimeFanout().subscribe({
            scope: { playerAccountId: row!.playerAccountId, characterId: character.id },
            deliver: (envelope) => received.push(envelope),
            close: () => undefined,
          });
          return { received, unsubscribe };
        });
    }

    it("writes nothing on sections 1–31, then exactly one unread notice on the 32nd", async () => {
      const { userId, characterId } = await readyToWeld({ fuel: 120 });
      await startWelding(userId, characterId);
      await stateAt(userId, characterId, tick(now, 31 * WELD_TICKS));
      expect(await noticeRows(characterId)).toEqual([]);
      expect((await systemNotices.readSystemNotices(userId, characterId)).unread).toBe(0);

      const xpBefore = await weldingXp(characterId);
      await stateAt(userId, characterId, tick(now, 32 * WELD_TICKS));
      const rows = await noticeRows(characterId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "mission_completion",
        missionId: MISSION,
        skillId: null,
        recipeActionIds: null,
        readAt: null,
      });
      const inbox = await systemNotices.readSystemNotices(userId, characterId);
      expect(inbox.unread).toBe(1);
      expect(inbox.notices).toEqual([
        {
          id: rows[0]!.id,
          seq: rows[0]!.seq,
          body: `${TITLE}\n${BODY}`,
          sentAt: rows[0]!.createdAt.toISOString(),
        },
      ]);
      // Nothing else is granted: XP is only the 32nd section's own, fuel and capacity as designed.
      expect((await weldingXp(characterId)) - xpBefore).toBe(balance.welding.xpPerIncrement);
      expect(await shipRow(characterId)).toMatchObject({
        tankCapacityFuelUnits: LONG,
        fuelUnits: 120,
      });
      expect((await missionRow(characterId))?.completedAt).not.toBeNull();
    });

    it("is not duplicated by repeated or concurrent resolution", async () => {
      const { userId, characterId } = await readyToWeld();
      await startWelding(userId, characterId);
      const at = tick(now, 32 * WELD_TICKS);
      await Promise.all([stateAt(userId, characterId, at), stateAt(userId, characterId, at)]);
      await stateAt(userId, characterId, tick(at, 600));
      await stateAt(userId, characterId, tick(at, 6000));
      expect(await noticeRows(characterId)).toHaveLength(1);
      expect((await systemNotices.readSystemNotices(userId, characterId)).unread).toBe(1);
    });

    it("cannot be written twice for one Mission, even by a direct replay", async () => {
      const { userId, characterId } = await readyToWeld();
      await startWelding(userId, characterId);
      await stateAt(userId, characterId, tick(now, 32 * WELD_TICKS));
      // The Mission is already complete, so a replayed completion stamps and writes nothing.
      await db.transaction((transaction) =>
        repairCompletion.commitRepairCompletion(transaction, {
          characterId,
          targetId: TARGET,
          completedAt: tick(now, 40 * WELD_TICKS),
        }),
      );
      expect(await noticeRows(characterId)).toHaveLength(1);
      // And the database itself refuses a second completion row for the same Mission.
      await expect(
        db.insert(rune.recipeUnlockNotices).values({
          characterId,
          kind: "mission_completion",
          missionId: MISSION,
        }),
      ).rejects.toThrow();
    });

    it("rolls back with the final weld: no notice, no capacity, no Mission", async () => {
      const { userId, characterId } = await readyToWeld();
      await seedRepairTarget(db, rune, characterId, TARGET, {
        materials: fullBill,
        weldingProgress: tank.repairIncrements - 1,
        updatedAt: now,
      });
      const stream = await listen({ id: characterId });
      try {
        await expect(
          resolution.withLockedOwnedCharacter(userId, characterId, async (transaction) => {
            await repairCompletion.commitRepairCompletion(transaction, {
              characterId,
              targetId: TARGET,
              completedAt: now,
            });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect(await noticeRows(characterId)).toEqual([]);
        expect((await shipRow(characterId)).tankCapacityFuelUnits).toBe(BASE);
        expect((await missionRow(characterId))?.completedAt).toBeNull();
        expect(stream.received.filter((envelope) => envelope.type === "system.notice")).toEqual([]);
      } finally {
        stream.unsubscribe();
      }
    });

    it("waits unread for a player who was away, and prompts open tabs once committed", async () => {
      const { userId, characterId } = await readyToWeld();
      await startWelding(userId, characterId);
      const stream = await listen({ id: characterId });
      try {
        // Nobody is connected until long after the 32nd weld landed.
        await stateAt(userId, characterId, tick(now, 20 * 32 * WELD_TICKS));
        expect(
          stream.received.filter((envelope) => envelope.type === "system.notice"),
        ).toHaveLength(1);
      } finally {
        stream.unsubscribe();
      }
      const inbox = await systemNotices.readSystemNotices(userId, characterId);
      expect(inbox.unread).toBe(1);
      expect(inbox.notices.at(-1)?.body).toContain(TITLE);
    });

    it("coexists with recipe notices: one seq order, correct unread counts and read receipts", async () => {
      const { userId, characterId } = await readyToWeld();
      const refiningLevel5 = thresholds.find((threshold) => threshold.level === 5)!.totalXp;
      const award = (xp: number) =>
        resolution.withLockedOwnedCharacter(userId, characterId, (transaction) =>
          progression.grantCharacterSkillXp(transaction, {
            characterId,
            skillId: SKILL_IDS.refining,
            awardedXp: xp,
            thresholds,
          }),
        );
      await award(refiningLevel5); // a recipe notice first
      await startWelding(userId, characterId);
      await stateAt(userId, characterId, tick(now, 32 * WELD_TICKS)); // then the tank notice
      const rows = await noticeRows(characterId);
      expect(rows.map((row) => row.kind)).toEqual(["recipe_unlock", "mission_completion"]);
      expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq);
      expect(rows[0]).toMatchObject({ skillId: SKILL_IDS.refining, level: 5 });

      let inbox = await systemNotices.readSystemNotices(userId, characterId);
      expect(inbox.unread).toBe(2);
      expect(inbox.notices.map((notice) => notice.seq)).toEqual(rows.map((row) => row.seq));
      expect(inbox.notices[0]!.body).toContain("Refining Level 5 reached.");
      expect(inbox.notices[1]!.body).toContain(TITLE);

      // Reading through the recipe notice leaves the newer tank notice unread.
      await systemNotices.markSystemNoticesRead(userId, characterId, { throughSeq: rows[0]!.seq });
      inbox = await systemNotices.readSystemNotices(userId, characterId);
      expect(inbox.unread).toBe(1);
      await systemNotices.markSystemNoticesRead(userId, characterId, { throughSeq: rows[1]!.seq });
      expect((await systemNotices.readSystemNotices(userId, characterId)).unread).toBe(0);
      // Read state is durable; a later recipe notice sorts after the tank notice.
      await award(thresholds.find((threshold) => threshold.level === 8)!.totalXp - refiningLevel5);
      const after = await noticeRows(characterId);
      expect(after.map((row) => row.kind)).toEqual([
        "recipe_unlock",
        "mission_completion",
        "recipe_unlock",
      ]);
      expect((await systemNotices.readSystemNotices(userId, characterId)).unread).toBe(1);
    });

    it("is private to the character whose ship was upgraded", async () => {
      const mine = await readyToWeld();
      const other = await makeCharacter();
      await startWelding(mine.userId, mine.characterId);
      await stateAt(mine.userId, mine.characterId, tick(now, 32 * WELD_TICKS));
      expect(await noticeRows(other.characterId)).toEqual([]);
      expect((await systemNotices.readSystemNotices(other.userId, other.characterId)).unread).toBe(
        0,
      );
    });
  });

  it("registers the welding action under the repair-target registry", () => {
    expect(tank.actionId).toBe(ACTION_IDS.rivetLongRangeTankWelding);
    expect(tank.repairIncrements).toBe(32);
  });
});
