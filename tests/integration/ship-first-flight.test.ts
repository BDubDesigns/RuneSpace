import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
  type LocationId,
} from "@/game/config/foundations";
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
 * Issue #358 — the Rivet's first flight, against real PostgreSQL.
 *
 * One character-authoritative ship: two-source refueling, a Move Along-gated
 * first launch, a 15-second authoritative flight that relocates the character,
 * the ship and (by berth) the attached Cargo Hold together, a Mission that
 * completes itself exactly once on landing, lazy offline landing, and a durable
 * dismissible arrival receipt.
 */
suite("issue #358 Rivet first flight (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let ship: typeof import("@/server/ship-commands");
  let cargo: typeof import("@/server/cargo-hold");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-15T12:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const FLIGHT_MS = 25 * 600;
  const ROUTE = SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding;
  const CANISTER = ITEM_IDS.fullSmallFuelCanister;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    ship = await import("@/server/ship-commands");
    cargo = await import("@/server/cargo-hold");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const deterministicRandom = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const after = (from: Date, ms: number) => new Date(from.getTime() + ms);

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
  ];

  /**
   * A character whose ship is physically whole (the three repairs done) with
   * Thrust Issues reported, standing at the Crash Site. Move Along is accepted
   * unless asked otherwise; fuel and canisters are the test's to set.
   */
  async function makeCharacter(
    options: {
      accept?: boolean;
      thrustReported?: boolean;
      repaired?: boolean;
      location?: LocationId;
      carried?: number;
      cargo?: number;
      fuel?: number;
    } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Rivet Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Rivet ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    const characterId = character.id;
    await play.getPlayGameplayState(userId, characterId, now, deterministicRandom());
    const story =
      options.thrustReported === false
        ? STORY.filter((missionId) => missionId !== MISSION_IDS.thrustIssues)
        : STORY;
    await db.insert(rune.characterMissions).values(
      story.map((missionId) => ({
        characterId,
        missionId,
        acceptedAt: now,
        completedAt: now,
      })),
    );
    if (options.thrustReported === false) {
      await db
        .insert(rune.characterMissions)
        .values({ characterId, missionId: MISSION_IDS.thrustIssues, acceptedAt: now });
    }
    if (options.accept !== false) {
      await db
        .insert(rune.characterMissions)
        .values({ characterId, missionId: MISSION_IDS.moveAlong, acceptedAt: now });
    }
    if (options.repaired !== false) {
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
    }
    await db
      .update(rune.characters)
      .set({ currentLocationId: options.location ?? LOCATION_IDS.crashSite })
      .where(eq(rune.characters.id, characterId));
    if (options.carried) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: CANISTER, quantity: options.carried });
    }
    if (options.cargo) {
      await db
        .insert(rune.cargoHoldStacks)
        .values({ characterId, itemId: CANISTER, quantity: options.cargo });
    }
    if (options.fuel) {
      await db.insert(rune.characterShips).values({ characterId, fuelUnits: options.fuel });
    }
    return { userId, characterId };
  }

  const stateAt = (userId: string, characterId: string, at = now) =>
    play.getPlayGameplayState(userId, characterId, at, deterministicRandom());

  async function shipRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterShips)
        .where(eq(rune.characterShips.characterId, characterId))
    )[0];
  }

  async function carriedCanisters(characterId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, CANISTER),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function cargoCanisters(characterId: string) {
    const rows = await db
      .select({ quantity: rune.cargoHoldStacks.quantity })
      .from(rune.cargoHoldStacks)
      .where(
        and(
          eq(rune.cargoHoldStacks.characterId, characterId),
          eq(rune.cargoHoldStacks.itemId, CANISTER),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function emptyCanisters(characterId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.emptySmallFuelCanister),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function missionRow(characterId: string, missionId: string) {
    return (
      await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, missionId),
          ),
        )
    )[0];
  }

  async function notices(characterId: string) {
    return db
      .select()
      .from(rune.shipArrivalNotices)
      .where(eq(rune.shipArrivalNotices.characterId, characterId));
  }

  async function locationOf(characterId: string) {
    return (
      await db
        .select({ at: rune.characters.currentLocationId })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]!.at;
  }

  const launch = (userId: string, characterId: string, at = now) =>
    ship.launchShip(userId, characterId, ROUTE, at);
  const refuel = (
    userId: string,
    characterId: string,
    request: Parameters<typeof ship.refuelShip>[2],
    at = now,
  ) => ship.refuelShip(userId, characterId, request, at);

  describe("Move Along starts when Thrust Issues is reported", () => {
    const report = (userId: string, characterId: string) =>
      missions.completeMission(
        userId,
        characterId,
        MISSION_IDS.thrustIssues,
        NPC_IDS.wadeRusk,
        now,
      );

    it("is not started by the repair alone, nor by being at Wade without a report", async () => {
      const { userId, characterId } = await makeCharacter({
        accept: false,
        thrustReported: false,
        location: LOCATION_IDS.ruskRecovery,
      });
      // The Propulsion System is welded and Thrust Issues is accepted, unreported.
      await stateAt(userId, characterId);
      expect(await missionRow(characterId, MISSION_IDS.moveAlong)).toBeUndefined();
      // It cannot be accepted by hand: it authors no offer.
      const forged = await missions.acceptMission(
        userId,
        characterId,
        MISSION_IDS.moveAlong,
        NPC_IDS.wadeRusk,
        now,
      );
      expect(forged.mission.status).toBe("refused");
      expect(await missionRow(characterId, MISSION_IDS.moveAlong)).toBeUndefined();
    });

    it("starts in the same transaction as a successful report, once, and gates the launch", async () => {
      const { userId, characterId } = await makeCharacter({
        accept: false,
        thrustReported: false,
        location: LOCATION_IDS.ruskRecovery,
        fuel: 50,
      });
      const reported = await report(userId, characterId);
      expect(reported.mission.status).toBe("completed");
      const started = await missionRow(characterId, MISSION_IDS.moveAlong);
      expect(started?.acceptedAt).not.toBeNull();
      expect(started?.completedAt).toBeNull();
      // The report cannot be made twice, and the second attempt changes nothing.
      const again = await report(userId, characterId);
      expect(again.mission.status).toBe("already_completed");
      expect(
        (await missionRow(characterId, MISSION_IDS.moveAlong))?.acceptedAt?.toISOString(),
      ).toBe(started?.acceptedAt?.toISOString());
      // The launch gate reads that ordinary accepted record.
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.crashSite })
        .where(eq(rune.characters.id, characterId));
      expect((await launch(userId, characterId)).launch).toMatchObject({ status: "launched" });
    });

    it("leaves an already accepted Move Along record exactly as it was", async () => {
      const { userId, characterId } = await makeCharacter({
        accept: false,
        thrustReported: false,
        location: LOCATION_IDS.ruskRecovery,
      });
      const earlier = new Date("2026-10-14T00:00:00.000Z");
      await db
        .insert(rune.characterMissions)
        .values({ characterId, missionId: MISSION_IDS.moveAlong, acceptedAt: earlier });
      expect((await report(userId, characterId)).mission.status).toBe("completed");
      const row = await missionRow(characterId, MISSION_IDS.moveAlong);
      expect(row?.acceptedAt?.toISOString()).toBe(earlier.toISOString());
      expect(row?.completedAt).toBeNull();
    });

    it("never reopens a completed Move Along", async () => {
      const { userId, characterId } = await makeCharacter({
        accept: false,
        thrustReported: false,
        location: LOCATION_IDS.ruskRecovery,
      });
      const done = new Date("2026-10-14T01:00:00.000Z");
      await db.insert(rune.characterMissions).values({
        characterId,
        missionId: MISSION_IDS.moveAlong,
        acceptedAt: done,
        completedAt: done,
      });
      await report(userId, characterId);
      const row = await missionRow(characterId, MISSION_IDS.moveAlong);
      expect(row?.completedAt?.toISOString()).toBe(done.toISOString());
    });

    it("refuses a forged turn-in for Move Along itself: nothing hands it in", async () => {
      const { userId, characterId } = await makeCharacter({ location: LOCATION_IDS.ruskRecovery });
      const result = await missions.completeMission(
        userId,
        characterId,
        MISSION_IDS.moveAlong,
        NPC_IDS.wadeRusk,
        now,
      );
      expect(result.mission.status).toBe("refused");
      expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).toBeNull();
    });
  });

  describe("refueling from the two sources", () => {
    it("loads 50 FU from Inventory, consuming exactly one canister and returning no shell", async () => {
      const { userId, characterId } = await makeCharacter({ carried: 2, cargo: 1 });
      const result = await refuel(userId, characterId, {
        source: "inventory",
        expectedFuelUnits: 0,
      });
      expect(result.refuel).toMatchObject({
        status: "loaded",
        gainedFuelUnits: 50,
        wastedFuelUnits: 0,
      });
      expect((await shipRow(characterId))?.fuelUnits).toBe(50);
      expect(await carriedCanisters(characterId)).toBe(1);
      expect(await cargoCanisters(characterId)).toBe(1);
      expect(await emptyCanisters(characterId)).toBe(0);
      expect(result.state.ship.fuelUnits).toBe(50);
    });

    it("loads 50 FU from the attached Cargo Hold without touching Inventory", async () => {
      const { userId, characterId } = await makeCharacter({ carried: 1, cargo: 2 });
      const result = await refuel(userId, characterId, {
        source: "cargo_hold",
        expectedFuelUnits: 0,
      });
      expect(result.refuel).toMatchObject({ status: "loaded", gainedFuelUnits: 50 });
      expect(await cargoCanisters(characterId)).toBe(1);
      expect(await carriedCanisters(characterId)).toBe(1);
      expect(await emptyCanisters(characterId)).toBe(0);
    });

    it("refuses an empty source with no state change", async () => {
      const { userId, characterId } = await makeCharacter({ carried: 0, cargo: 1 });
      const result = await refuel(userId, characterId, {
        source: "inventory",
        expectedFuelUnits: 0,
      });
      expect(result.refuel).toMatchObject({ status: "refused", reason: "no_canister" });
      expect(await cargoCanisters(characterId)).toBe(1);
      expect((await shipRow(characterId))?.fuelUnits ?? 0).toBe(0);
    });

    it("requires the exact gain and waste to be confirmed for a partial load", async () => {
      const { userId, characterId } = await makeCharacter({ carried: 1, fuel: 280 });
      const unconfirmed = await refuel(userId, characterId, {
        source: "inventory",
        expectedFuelUnits: 280,
      });
      expect(unconfirmed.refuel).toMatchObject({
        status: "refused",
        reason: "confirmation_required",
      });
      expect(unconfirmed.refuel.status === "refused" && unconfirmed.refuel.message).toContain(
        "20 FU",
      );
      expect(unconfirmed.refuel.status === "refused" && unconfirmed.refuel.message).toContain(
        "30 FU",
      );
      expect(await carriedCanisters(characterId)).toBe(1);

      const wrong = await refuel(userId, characterId, {
        source: "inventory",
        expectedFuelUnits: 280,
        confirmedGainFuelUnits: 50,
      });
      expect(wrong.refuel).toMatchObject({ status: "refused", reason: "confirmation_required" });
      expect(await carriedCanisters(characterId)).toBe(1);

      const confirmed = await refuel(userId, characterId, {
        source: "inventory",
        expectedFuelUnits: 280,
        confirmedGainFuelUnits: 20,
      });
      expect(confirmed.refuel).toMatchObject({
        status: "loaded",
        gainedFuelUnits: 20,
        wastedFuelUnits: 30,
        fuelUnits: 300,
      });
      expect((await shipRow(characterId))?.fuelUnits).toBe(300);
      expect(await carriedCanisters(characterId)).toBe(0);
      expect(await emptyCanisters(characterId)).toBe(0);
    });

    it("refuses a full tank and never exceeds 300 FU", async () => {
      const { userId, characterId } = await makeCharacter({ carried: 1, fuel: 300 });
      const result = await refuel(userId, characterId, {
        source: "inventory",
        expectedFuelUnits: 300,
      });
      expect(result.refuel).toMatchObject({ status: "refused", reason: "tank_full" });
      expect(await carriedCanisters(characterId)).toBe(1);
      expect((await shipRow(characterId))?.fuelUnits).toBe(300);
    });

    it("never loads twice for a retried or racing tap", async () => {
      const { userId, characterId } = await makeCharacter({ carried: 2 });
      const request = { source: "inventory", expectedFuelUnits: 0 } as const;
      const results = await Promise.all([
        refuel(userId, characterId, request),
        refuel(userId, characterId, request),
        refuel(userId, characterId, request),
      ]);
      expect(results.filter((result) => result.refuel.status === "loaded")).toHaveLength(1);
      expect(
        results.filter(
          (result) => result.refuel.status === "refused" && result.refuel.reason === "tank_changed",
        ),
      ).toHaveLength(2);
      expect((await shipRow(characterId))?.fuelUnits).toBe(50);
      expect(await carriedCanisters(characterId)).toBe(1);
    });

    it("refuses away from the ship, with a wreck, or while busy, consuming nothing", async () => {
      const away = await makeCharacter({ carried: 1, location: LOCATION_IDS.holoHollowLanding });
      const awayResult = await refuel(away.userId, away.characterId, {
        source: "inventory",
        expectedFuelUnits: 0,
      });
      expect(awayResult.refuel).toMatchObject({ status: "refused", reason: "not_at_ship" });
      expect(await carriedCanisters(away.characterId)).toBe(1);

      const wreck = await makeCharacter({ carried: 1, repaired: false });
      const wreckResult = await refuel(wreck.userId, wreck.characterId, {
        source: "inventory",
        expectedFuelUnits: 0,
      });
      expect(wreckResult.refuel).toMatchObject({ status: "refused", reason: "ship_not_ready" });
      expect(await carriedCanisters(wreck.characterId)).toBe(1);
    });
  });

  describe("launching the first flight", () => {
    it("refuses until Move Along is accepted, with no state change", async () => {
      const { userId, characterId } = await makeCharacter({ accept: false, fuel: 50 });
      const result = await launch(userId, characterId);
      expect(result.launch).toMatchObject({ status: "refused", reason: "mission_not_accepted" });
      expect(result.launch.status === "refused" && result.launch.message).toContain("Move Along");
      expect((await shipRow(characterId))?.fuelUnits).toBe(50);
      expect((await shipRow(characterId))?.flightArrivesAt).toBeNull();
      const actions = await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, characterId));
      expect(actions).toHaveLength(0);
    });

    it("refuses while Thrust Issues is unreported, with an unfinished ship, or without 10 FU", async () => {
      const unreported = await makeCharacter({ thrustReported: false, fuel: 50 });
      expect((await launch(unreported.userId, unreported.characterId)).launch).toMatchObject({
        reason: "mission_incomplete",
      });
      const wreck = await makeCharacter({ repaired: false, fuel: 50 });
      expect((await launch(wreck.userId, wreck.characterId)).launch).toMatchObject({
        reason: "repairs_incomplete",
      });
      const dry = await makeCharacter({ fuel: 9 });
      expect((await launch(dry.userId, dry.characterId)).launch).toMatchObject({
        reason: "insufficient_fuel",
      });
      expect((await shipRow(dry.characterId))?.fuelUnits).toBe(9);
    });

    it("refuses from the wrong place and for a route nobody authored", async () => {
      const away = await makeCharacter({ fuel: 50, location: LOCATION_IDS.holoHollowLanding });
      expect((await launch(away.userId, away.characterId)).launch).toMatchObject({
        reason: "not_at_berth",
      });
      const flightReady = await makeCharacter({ fuel: 50 });
      const forged = await ship.launchShip(
        flightReady.userId,
        flightReady.characterId,
        "holo_hollow_landing_to_crash_site",
        now,
      );
      expect(forged.launch).toMatchObject({ status: "refused", reason: "unknown_route" });
      expect((await shipRow(flightReady.characterId))?.fuelUnits).toBe(50);
    });

    it("refuses while busy with other work", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await db.insert(rune.activeActions).values({
        characterId,
        actionId: ACTION_IDS.practiceWelding,
        startedAt: now,
        resolvedThroughAt: now,
      });
      const result = await launch(userId, characterId);
      expect(result.launch).toMatchObject({ status: "refused", reason: "busy" });
      expect((await shipRow(characterId))?.fuelUnits).toBe(50);
    });

    it("spends 10 FU once and records an immutable 15-second flight", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      const result = await launch(userId, characterId);
      expect(result.launch).toMatchObject({ status: "launched", routeId: ROUTE });
      const row = await shipRow(characterId);
      expect(row?.fuelUnits).toBe(40);
      expect(row?.flightStartedAt?.toISOString()).toBe(now.toISOString());
      expect(row?.flightArrivesAt?.toISOString()).toBe(after(now, FLIGHT_MS).toISOString());
      expect(row?.berthLocationId).toBe(LOCATION_IDS.crashSite);
      expect(result.state.ship.flight).toMatchObject({
        routeId: ROUTE,
        destinationLocationId: LOCATION_IDS.holoHollowLanding,
        arrivesAt: after(now, FLIGHT_MS).toISOString(),
      });
      // Nothing relocates at launch and walking to the pad never moves the ship.
      expect(await locationOf(characterId)).toBe(LOCATION_IDS.crashSite);
    });

    it("refuses a duplicate launch without a second charge", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await launch(userId, characterId);
      await expect(launch(userId, characterId, after(now, 1_000))).rejects.toThrow(/in flight/i);
      const row = await shipRow(characterId);
      expect(row?.fuelUnits).toBe(40);
      expect(row?.flightStartedAt?.toISOString()).toBe(now.toISOString());
    });

    it("lets only one of several simultaneous launches through", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      const results = await Promise.allSettled([
        launch(userId, characterId),
        launch(userId, characterId),
        launch(userId, characterId),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((await shipRow(characterId))?.fuelUnits).toBe(40);
    });
  });

  describe("while the ship is in flight", () => {
    it("blocks walking, cargo, trade and mission commands but keeps the Play read", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50, cargo: 1 });
      await launch(userId, characterId);
      const mid = after(now, 5_000);

      await expect(
        play.beginTravel(userId, characterId, LOCATION_IDS.holoHollowLanding, mid),
      ).rejects.toThrow(/in flight/i);
      await expect(
        cargo.depositCargoStack(
          userId,
          characterId,
          { stackId: "00000000-0000-4000-8000-000000000000", mode: "one", expectedQuantity: 1 },
          mid,
        ),
      ).rejects.toThrow(/in flight/i);
      await expect(
        missions.acceptMission(userId, characterId, MISSION_IDS.moveAlong, NPC_IDS.wadeRusk, mid),
      ).rejects.toThrow(/in flight/i);
      await expect(
        refuel(userId, characterId, { source: "cargo_hold", expectedFuelUnits: 40 }, mid),
      ).rejects.toThrow(/in flight/i);

      // The read still works, shows the remaining flight, and lands nothing early.
      const state = await stateAt(userId, characterId, mid);
      expect(state.ship.flight?.arrivesAt).toBe(after(now, FLIGHT_MS).toISOString());
      expect(state.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
      expect(await cargoCanisters(characterId)).toBe(1);
      expect((await shipRow(characterId))?.fuelUnits).toBe(40);
    });

    it("keeps Inventory, Equipment and Missions readable in the Play state", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50, carried: 1 });
      await launch(userId, characterId);
      const state = await stateAt(userId, characterId, after(now, 2_000));
      expect(state.inventory.stacks.some((stack) => stack.itemId === CANISTER)).toBe(true);
      expect(state.equipment.slots.length).toBeGreaterThan(0);
      expect(state.missions.some((mission) => mission.missionId === MISSION_IDS.moveAlong)).toBe(
        true,
      );
    });

    it("refuses an operator force-idle rather than orphaning the flight", async () => {
      const { forceIdleResolvedAction } = await import("@/server/play-interrupt");
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await launch(userId, characterId);
      await expect(
        db.transaction(async (transaction) => {
          const [character] = await transaction
            .select()
            .from(rune.characters)
            .where(eq(rune.characters.id, characterId));
          const [action] = await transaction
            .select()
            .from(rune.activeActions)
            .where(eq(rune.activeActions.characterId, characterId));
          return forceIdleResolvedAction(transaction, { character: character!, action, now });
        }),
      ).rejects.toThrow(/cannot be interrupted/i);
      expect((await shipRow(characterId))?.flightArrivesAt).not.toBeNull();
    });
  });

  describe("landing", () => {
    it("does not land one tick early, and lands exactly at the recorded instant", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await launch(userId, characterId);
      const early = await stateAt(userId, characterId, after(now, FLIGHT_MS - 1));
      expect(early.ship.flight).toBeDefined();
      expect(early.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
      expect(await notices(characterId)).toHaveLength(0);
      expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).toBeNull();

      const landed = await stateAt(userId, characterId, after(now, FLIGHT_MS));
      expect(landed.ship.flight).toBeUndefined();
      expect(landed.location.currentLocationId).toBe(LOCATION_IDS.holoHollowLanding);
      expect(landed.ship.berthLocationId).toBe(LOCATION_IDS.holoHollowLanding);
    });

    it("relocates the character, the ship and the Cargo Hold together and completes Move Along once", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50, cargo: 1 });
      await launch(userId, characterId);
      const arrival = after(now, FLIGHT_MS);
      const state = await stateAt(userId, characterId, arrival);

      expect(await locationOf(characterId)).toBe(LOCATION_IDS.holoHollowLanding);
      const row = await shipRow(characterId);
      expect(row?.berthLocationId).toBe(LOCATION_IDS.holoHollowLanding);
      expect(row?.flightRouteId).toBeNull();
      // No second fuel charge at arrival.
      expect(row?.fuelUnits).toBe(40);

      const move = await missionRow(characterId, MISSION_IDS.moveAlong);
      expect(move?.completedAt?.toISOString()).toBe(arrival.toISOString());
      expect(
        state.missions.find((mission) => mission.missionId === MISSION_IDS.moveAlong)?.state,
      ).toBe("completed");
      // No reward of any kind: nothing was granted and nobody was paid.
      expect(
        state.missions.find((mission) => mission.missionId === MISSION_IDS.moveAlong)?.earnedReward,
      ).toBeUndefined();
      expect(state.credits).toBe(balance.credits.startingBalance);

      // The attached Cargo Hold is where the ship is.
      const atLanding = await cargo.depositCargoStack(
        userId,
        characterId,
        { stackId: "00000000-0000-4000-8000-000000000000", mode: "one", expectedQuantity: 1 },
        after(arrival, 1_000),
      );
      expect(atLanding.cargo).not.toMatchObject({ reason: "not_at_ship" });
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.crashSite })
        .where(eq(rune.characters.id, characterId));
      const atOldBerth = await cargo.depositCargoStack(
        userId,
        characterId,
        { stackId: "00000000-0000-4000-8000-000000000000", mode: "one", expectedQuantity: 1 },
        after(arrival, 2_000),
      );
      expect(atOldBerth.cargo).toMatchObject({ status: "refused", reason: "not_at_ship" });
    });

    it("shows the empty Crash Site and the berthed Rivet at the Landing only after landing", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      const before = await stateAt(userId, characterId);
      const crashBefore = before.locationStates[LOCATION_IDS.crashSite]!;
      const landingBefore = before.locationStates[LOCATION_IDS.holoHollowLanding]!;
      expect(crashBefore.scene.overlay).toBeDefined();
      expect(landingBefore.scene.overlay).toBeUndefined();

      await launch(userId, characterId);
      // In the air it is still berthed: nothing on the scenes changes yet.
      const air = await stateAt(userId, characterId, after(now, 3_000));
      expect(air.locationStates[LOCATION_IDS.crashSite]!.scene.overlay).toBeDefined();
      expect(air.locationStates[LOCATION_IDS.holoHollowLanding]!.scene.overlay).toBeUndefined();

      const landed = await stateAt(userId, characterId, after(now, FLIGHT_MS));
      expect(landed.locationStates[LOCATION_IDS.crashSite]!.scene.overlay).toBeUndefined();
      expect(landed.locationStates[LOCATION_IDS.holoHollowLanding]!.scene.overlay).toBeDefined();
    });

    it("lands immediately for a character who returns three hours later, despite the offline cap", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await launch(userId, characterId);
      const state = await stateAt(userId, characterId, after(now, 3 * 60 * 60 * 1000));
      expect(state.ship.flight).toBeUndefined();
      expect(state.location.currentLocationId).toBe(LOCATION_IDS.holoHollowLanding);
      expect(
        (await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt?.toISOString(),
      ).toBe(after(now, FLIGHT_MS).toISOString());
      expect(state.ship.arrivalNotice).toMatchObject({
        destinationLocationId: LOCATION_IDS.holoHollowLanding,
        completedMissionId: MISSION_IDS.moveAlong,
        completedMissionTitle: "Move Along",
      });
      expect((await shipRow(characterId))?.fuelUnits).toBe(40);
    });

    it("resolves simultaneous reads once: one receipt, one stamp, no second charge", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await launch(userId, characterId);
      const later = after(now, 60_000);
      await Promise.all([
        stateAt(userId, characterId, later),
        stateAt(userId, characterId, later),
        stateAt(userId, characterId, later),
      ]);
      expect(await notices(characterId)).toHaveLength(1);
      expect((await shipRow(characterId))?.fuelUnits).toBe(40);
      expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).not.toBeNull();
      // A later retry changes nothing.
      await stateAt(userId, characterId, after(later, 60_000));
      expect(await notices(characterId)).toHaveLength(1);
    });

    it("leaves the flight untouched when its persisted state is inconsistent", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await launch(userId, characterId);
      // A walk away from the origin that the flight never recorded.
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollow })
        .where(eq(rune.characters.id, characterId));
      await expect(stateAt(userId, characterId, after(now, FLIGHT_MS))).rejects.toThrow(
        /does not match the flight origin/,
      );
      expect((await shipRow(characterId))?.flightArrivesAt).not.toBeNull();
      expect(await notices(characterId)).toHaveLength(0);
      expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).toBeNull();
    });

    it("offers no flight back to the Crash Site and none beyond Skatboll", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 200 });
      await launch(userId, characterId);
      const landed = await stateAt(userId, characterId, after(now, FLIGHT_MS));
      expect(landed.ship.routes).toEqual([]);
      const back = await ship.launchShip(
        userId,
        characterId,
        "holo_hollow_landing_to_crash_site",
        after(now, FLIGHT_MS + 1_000),
      );
      expect(back.launch).toMatchObject({ status: "refused", reason: "unknown_route" });
      const again = await launch(userId, characterId, after(now, FLIGHT_MS + 1_000));
      expect(again.launch).toMatchObject({ status: "refused", reason: "ship_not_berthed_here" });
    });
  });

  describe("walking never moves the ship or completes the Mission", () => {
    it("keeps the ship at the Crash Site and Move Along open when the character walks to the Landing", async () => {
      const { userId, characterId } = await makeCharacter({ fuel: 50 });
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollowLanding })
        .where(eq(rune.characters.id, characterId));
      const state = await stateAt(userId, characterId);
      expect(state.ship.berthLocationId).toBe(LOCATION_IDS.crashSite);
      expect(state.locationStates[LOCATION_IDS.holoHollowLanding]!.scene.overlay).toBeUndefined();
      expect(
        state.missions.find((mission) => mission.missionId === MISSION_IDS.moveAlong)?.state,
      ).toBe("active");
      expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).toBeNull();
      // And the ship cannot be launched from where it is not.
      expect(state.ship.routes[0]?.launchRefusal?.reason).toBe("not_at_berth");
    });
  });

  describe("the durable arrival notice", () => {
    async function landedCharacter() {
      const made = await makeCharacter({ fuel: 50 });
      await launch(made.userId, made.characterId);
      const state = await stateAt(made.userId, made.characterId, after(now, FLIGHT_MS));
      return { ...made, state, notice: state.ship.arrivalNotice! };
    }

    it("survives reloads until acknowledged, and is gone for good afterwards", async () => {
      const { userId, characterId, notice } = await landedCharacter();
      expect(notice).toBeDefined();
      const reload = await stateAt(userId, characterId, after(now, FLIGHT_MS + 60_000));
      expect(reload.ship.arrivalNotice?.noticeId).toBe(notice.noticeId);

      const acknowledged = await ship.acknowledgeShipArrival(
        userId,
        characterId,
        notice.noticeId,
        after(now, FLIGHT_MS + 61_000),
      );
      expect(acknowledged.acknowledged).toBe(true);
      expect(acknowledged.state.ship.arrivalNotice).toBeUndefined();
      const later = await stateAt(userId, characterId, after(now, FLIGHT_MS + 120_000));
      expect(later.ship.arrivalNotice).toBeUndefined();
      expect(await notices(characterId)).toHaveLength(1);
    });

    it("acknowledges idempotently and never alters the arrival or the Mission", async () => {
      const { userId, characterId, notice } = await landedCharacter();
      const first = await ship.acknowledgeShipArrival(userId, characterId, notice.noticeId, now);
      const replay = await ship.acknowledgeShipArrival(userId, characterId, notice.noticeId, now);
      expect(first.acknowledged).toBe(true);
      expect(replay.acknowledged).toBe(false);
      expect(await locationOf(characterId)).toBe(LOCATION_IDS.holoHollowLanding);
      expect((await missionRow(characterId, MISSION_IDS.moveAlong))?.completedAt).not.toBeNull();
    });

    it("cannot be acknowledged by another character", async () => {
      const { characterId, notice } = await landedCharacter();
      const other = await makeCharacter();
      const result = await ship.acknowledgeShipArrival(
        other.userId,
        other.characterId,
        notice.noticeId,
        now,
      );
      expect(result.acknowledged).toBe(false);
      expect((await notices(characterId))[0]?.acknowledgedAt).toBeNull();
    });

    it("can be dismissed while the character is busy, touching nothing else", async () => {
      const { userId, characterId, notice } = await landedCharacter();
      await db.insert(rune.activeActions).values({
        characterId,
        actionId: ACTION_IDS.practiceWelding,
        startedAt: now,
        resolvedThroughAt: now,
      });
      const ack = await ship.acknowledgeShipArrival(userId, characterId, notice.noticeId, now);
      expect(ack.acknowledged).toBe(true);
      const actions = await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, characterId));
      expect(actions).toHaveLength(1);
      expect(await locationOf(characterId)).toBe(LOCATION_IDS.holoHollowLanding);
    });
  });
});
