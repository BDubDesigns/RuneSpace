import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
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
 * Issue #375 — the repeatable interplanetary Rivet leg and Last Leg Trading's
 * Stillreach terminal, against real PostgreSQL.
 *
 * One physical ship flies one character and its own Cargo Hold between Holo
 * Hollow Landing and Stillreach Landing Station for exactly 120 FU and 260
 * seconds each way, landing lazily and once, never back at the Crash Site and
 * never replaying Move Along. The terminal is the same merchant as Toll's
 * counter, so the two share one per-character daily allowance.
 */
suite("issue #375 Stillreach flight and terminal (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let ship: typeof import("@/server/ship-commands");
  let trade: typeof import("@/server/trade");
  const createdUsers: string[] = [];
  // Midday Pacific.
  const now = new Date("2026-10-21T19:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const LEG_MS = 260_000;
  const OUT = SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation;
  const BACK = SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding;
  const FULL = ITEM_IDS.fullSmallFuelCanister;
  const EMPTY = ITEM_IDS.emptySmallFuelCanister;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    ship = await import("@/server/ship-commands");
    trade = await import("@/server/trade");
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
    MISSION_IDS.moveAlong,
  ];

  /**
   * A character past the first flight: the whole ship repaired, Thrust Issues
   * reported, Move Along completed, ship and character at Holo Hollow Landing.
   */
  async function makePilot(
    options: {
      fuel?: number;
      berth?: LocationId;
      location?: LocationId;
      credits?: number;
      thrustReported?: boolean;
    } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Stillreach Pilot");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Pilot ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    const characterId = character.id;
    await play.getPlayGameplayState(userId, characterId, now, deterministicRandom());
    const story =
      options.thrustReported === false
        ? STORY.filter((id) => id !== MISSION_IDS.thrustIssues && id !== MISSION_IDS.moveAlong)
        : STORY;
    await db
      .insert(rune.characterMissions)
      .values(
        story.map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      );
    if (options.thrustReported === false) {
      await db
        .insert(rune.characterMissions)
        .values({ characterId, missionId: MISSION_IDS.thrustIssues, acceptedAt: now });
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
    await db
      .update(rune.characters)
      .set({ currentLocationId: options.location ?? berth, credits: options.credits ?? 5000 })
      .where(eq(rune.characters.id, characterId));
    await db
      .insert(rune.characterShips)
      .values({ characterId, berthLocationId: berth, fuelUnits: options.fuel ?? 300 });
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
    )[0]!;
  }

  async function locationOf(characterId: string) {
    return (
      await db
        .select({ at: rune.characters.currentLocationId })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]!.at;
  }

  async function notices(characterId: string) {
    return db
      .select()
      .from(rune.shipArrivalNotices)
      .where(eq(rune.shipArrivalNotices.characterId, characterId));
  }

  async function cargoRows(characterId: string) {
    return db
      .select({ itemId: rune.cargoHoldStacks.itemId, quantity: rune.cargoHoldStacks.quantity })
      .from(rune.cargoHoldStacks)
      .where(eq(rune.cargoHoldStacks.characterId, characterId));
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

  async function shipFlightActions(characterId: string) {
    return db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characterId));
  }

  /** A command that refuses either by result or by throwing; both must write nothing. */
  async function refusedOrThrown(run: () => Promise<{ trade?: { status: string } }>) {
    try {
      const result = await run();
      return result.trade?.status === "refused";
    } catch {
      return true;
    }
  }

  describe("launch", () => {
    it("refuses 119 FU without writing anything, and launches 120 FU to land with 0", async () => {
      const { userId, characterId } = await makePilot({ fuel: 119 });
      const refused = await ship.launchShip(userId, characterId, OUT, now);
      expect(refused.launch).toMatchObject({ status: "refused", reason: "insufficient_fuel" });
      expect(refused.launch.status === "refused" && refused.launch.message).toBe(
        "The tank needs at least 120 FU to launch.",
      );
      const untouched = await shipRow(characterId);
      expect(untouched.fuelUnits).toBe(119);
      expect(untouched.flightRouteId).toBeNull();
      expect(await shipFlightActions(characterId)).toEqual([]);

      await db
        .update(rune.characterShips)
        .set({ fuelUnits: 120 })
        .where(eq(rune.characterShips.characterId, characterId));
      const launched = await ship.launchShip(userId, characterId, OUT, now);
      expect(launched.launch).toMatchObject({
        status: "launched",
        routeId: OUT,
        arrivesAt: after(now, LEG_MS).toISOString(),
      });
      const row = await shipRow(characterId);
      expect(row.fuelUnits).toBe(0);
      expect(row.flightOriginLocationId).toBe(LOCATION_IDS.holoHollowLanding);
      expect(row.flightDestinationLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
      expect(row.flightArrivesAt!.getTime() - row.flightStartedAt!.getTime()).toBe(LEG_MS);
    });

    it("projects the return warning before launch, and never blocks on it", async () => {
      const { userId, characterId } = await makePilot({ fuel: 200 });
      const state = await stateAt(userId, characterId);
      const route = state.ship.routes.find((entry) => entry.routeId === OUT)!;
      expect(route.fuelCostFuelUnits).toBe(120);
      expect(route.durationMs).toBe(LEG_MS);
      expect(route.returnFuelWarning).toEqual({
        fuelAfterArrival: 80,
        returnFuelCostFuelUnits: 120,
      });
      expect(route.launchRefusal).toBeUndefined();

      const full = await makePilot({ fuel: 300 });
      const fullRoute = (await stateAt(full.userId, full.characterId)).ship.routes[0]!;
      expect(fullRoute.returnFuelWarning).toBeUndefined();
    });

    it("charges exactly once under concurrent taps", async () => {
      const { userId, characterId } = await makePilot({ fuel: 300 });
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => ship.launchShip(userId, characterId, OUT, now)),
      );
      const launched = results.filter(
        (result) => result.status === "fulfilled" && result.value.launch.status === "launched",
      );
      expect(launched).toHaveLength(1);
      expect((await shipRow(characterId)).fuelUnits).toBe(180);
      expect(await shipFlightActions(characterId)).toHaveLength(1);
    });

    it("refuses forged routes, a ship parked elsewhere, an unreported Thrust Issues and a busy character", async () => {
      // The return leg from a ship parked on Skatboll is not a route from here.
      const skatboll = await makePilot();
      expect(
        (await ship.launchShip(skatboll.userId, skatboll.characterId, BACK, now)).launch,
      ).toMatchObject({
        status: "refused",
        reason: "ship_not_berthed_here",
      });
      expect(
        (await ship.launchShip(skatboll.userId, skatboll.characterId, "skatboll_to_anywhere", now))
          .launch,
      ).toMatchObject({ status: "refused", reason: "unknown_route" });

      // Standing at the Landing, ship still at the Crash Site.
      const parked = await makePilot({
        berth: LOCATION_IDS.crashSite,
        location: LOCATION_IDS.holoHollowLanding,
      });
      expect(
        (await ship.launchShip(parked.userId, parked.characterId, OUT, now)).launch,
      ).toMatchObject({
        status: "refused",
        reason: "ship_not_berthed_here",
      });

      // Ship at the Landing, character walked off.
      const walked = await makePilot({ location: LOCATION_IDS.holoHollow });
      expect(
        (await ship.launchShip(walked.userId, walked.characterId, OUT, now)).launch,
      ).toMatchObject({
        status: "refused",
        reason: "not_at_berth",
      });

      const unreported = await makePilot({ thrustReported: false });
      expect(
        (await ship.launchShip(unreported.userId, unreported.characterId, OUT, now)).launch,
      ).toMatchObject({ status: "refused", reason: "mission_incomplete" });

      for (const who of [skatboll, parked, walked, unreported]) {
        expect((await shipRow(who.characterId)).flightRouteId).toBeNull();
        expect((await shipRow(who.characterId)).fuelUnits).toBe(300);
      }
    });
  });

  describe("the leg out and back", () => {
    it("moves one character, the same ship and the intact Cargo Hold there and back for exactly 240 FU", async () => {
      const { userId, characterId } = await makePilot({ fuel: 300 });
      await db.insert(rune.cargoHoldStacks).values([
        { characterId, itemId: ITEM_IDS.oilShale, quantity: 7 },
        { characterId, itemId: FULL, quantity: 2 },
      ]);
      const cargoBefore = (await cargoRows(characterId)).sort((a, b) =>
        a.itemId.localeCompare(b.itemId),
      );

      await ship.launchShip(userId, characterId, OUT, now);
      // Mid-flight the read resumes the flight; nothing has landed and walking is refused.
      const mid = await stateAt(userId, characterId, after(now, 130_000));
      expect(mid.ship.flight).toMatchObject({
        routeId: OUT,
        arrivesAt: after(now, LEG_MS).toISOString(),
      });
      expect(await locationOf(characterId)).toBe(LOCATION_IDS.holoHollowLanding);
      await expect(
        play.beginTravel(userId, characterId, LOCATION_IDS.holoHollow, after(now, 130_000)),
      ).rejects.toThrow(/in flight/i);
      expect(
        await refusedOrThrown(() =>
          trade.tradeWithMerchant(
            userId,
            characterId,
            {
              localPlaceId: LOCAL_PLACE_IDS.lastLegTrading,
              itemId: FULL,
              direction: "buy",
              quantity: 1,
            },
            after(now, 130_000),
          ),
        ),
      ).toBe(true);

      // Exactly at the scheduled instant the server may still be inside its last tick;
      // it never lands before it, and lands at the next read after it.
      const early = await stateAt(userId, characterId, after(now, LEG_MS - 1));
      expect(early.ship.flight).toBeDefined();
      const landed = await stateAt(userId, characterId, after(now, LEG_MS + 600));
      expect(landed.ship.flight).toBeUndefined();
      expect(landed.location.currentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
      expect(landed.ship.berthLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
      expect(landed.ship.fuelUnits).toBe(180);
      expect(landed.ship.arrivalNotice).toMatchObject({
        routeId: OUT,
        destinationLocationId: LOCATION_IDS.stillreachLandingStation,
        arrivedAt: after(now, LEG_MS).toISOString(),
      });
      // No Mission completes on this landing.
      expect(landed.ship.arrivalNotice?.completedMissionId).toBeUndefined();
      expect(
        (await cargoRows(characterId)).sort((a, b) => a.itemId.localeCompare(b.itemId)),
      ).toEqual(cargoBefore);
      expect(landed.ship.routes.map((route) => route.routeId)).toEqual([BACK]);

      // Fly home.
      const home = after(now, LEG_MS + 60_000);
      expect((await ship.launchShip(userId, characterId, BACK, home)).launch).toMatchObject({
        status: "launched",
      });
      const back = await stateAt(userId, characterId, after(home, LEG_MS + 600));
      expect(back.location.currentLocationId).toBe(LOCATION_IDS.holoHollowLanding);
      expect(back.ship.berthLocationId).toBe(LOCATION_IDS.holoHollowLanding);
      expect(back.ship.fuelUnits).toBe(60);
      expect(300 - back.ship.fuelUnits).toBe(240);
      expect(
        (await cargoRows(characterId)).sort((a, b) => a.itemId.localeCompare(b.itemId)),
      ).toEqual(cargoBefore);
      // Two receipts, one per real landing, and Move Along untouched.
      const receipts = await notices(characterId);
      expect(receipts.map((notice) => notice.routeId).sort()).toEqual([BACK, OUT].sort());
      expect(receipts.every((notice) => notice.completedMissionId === null)).toBe(true);
      const moveAlong = await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, MISSION_IDS.moveAlong),
          ),
        );
      expect(moveAlong[0]!.completedAt!.toISOString()).toBe(now.toISOString());
    });

    it("lands once, promptly, for a player who returns hours later, however many reads race it", async () => {
      const { userId, characterId } = await makePilot({ fuel: 300 });
      await ship.launchShip(userId, characterId, OUT, now);
      const hoursLater = after(now, 5 * 60 * 60 * 1000);
      await Promise.allSettled(
        Array.from({ length: 4 }, () => stateAt(userId, characterId, hoursLater)),
      );
      const state = await stateAt(userId, characterId, hoursLater);
      expect(state.location.currentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
      expect(state.ship.flight).toBeUndefined();
      expect(await notices(characterId)).toHaveLength(1);
      expect((await shipRow(characterId)).fuelUnits).toBe(180);
    });

    it("leaves the ship in the ring while the character walks Stillreach, and refuses a walk off-world", async () => {
      const { userId, characterId } = await makePilot({
        berth: LOCATION_IDS.stillreachLandingStation,
        location: LOCATION_IDS.stillreachLandingStation,
      });
      const started = await play.beginTravel(userId, characterId, LOCATION_IDS.windwardTrack, now);
      expect(started.travelState).toBeDefined();
      const arrived = await stateAt(userId, characterId, after(now, 60_000));
      expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.windwardTrack);
      expect(arrived.ship.berthLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
      // Away from the ship nothing launches or trades.
      expect(
        (await ship.launchShip(userId, characterId, BACK, after(now, 61_000))).launch,
      ).toMatchObject({
        status: "refused",
        reason: "not_at_berth",
      });
      expect(
        await refusedOrThrown(() =>
          trade.tradeWithMerchant(
            userId,
            characterId,
            { itemId: FULL, direction: "buy", quantity: 1 },
            after(now, 61_000),
          ),
        ),
      ).toBe(true);
      // A forged walk to another planet is refused, and moves nobody.
      const forged = await play.beginTravel(
        userId,
        characterId,
        LOCATION_IDS.holoHollowLanding,
        after(now, 62_000),
      );
      expect(forged.travelError).toBe("not_adjacent");
      expect(forged.travelState).toBeUndefined();
      expect(await locationOf(characterId)).toBe(LOCATION_IDS.windwardTrack);
    });
  });

  describe("Last Leg Trading's Stillreach terminal", () => {
    const atTerminal = (
      who: { userId: string; characterId: string },
      direction: "buy" | "sell",
      itemId: string,
      quantity: number,
      at = now,
    ) => trade.tradeWithMerchant(who.userId, who.characterId, { itemId, direction, quantity }, at);
    const atCounter = (
      who: { userId: string; characterId: string },
      direction: "buy" | "sell",
      itemId: string,
      quantity: number,
      at = now,
    ) =>
      trade.tradeWithMerchant(
        who.userId,
        who.characterId,
        { localPlaceId: LOCAL_PLACE_IDS.lastLegTrading, itemId, direction, quantity },
        at,
      );

    async function stillreachTrader(options: { thrustReported?: boolean; credits?: number } = {}) {
      return makePilot({
        berth: LOCATION_IDS.stillreachLandingStation,
        location: LOCATION_IDS.stillreachLandingStation,
        ...options,
      });
    }

    it("buys and sells at exactly 225/160, 40/25 and 6 CR, and does not sell Oil Shale", async () => {
      const who = await stillreachTrader({ credits: 1000 });
      expect((await atTerminal(who, "buy", FULL, 2)).trade).toMatchObject({
        status: "traded",
        totalCredits: 450,
        credits: 550,
      });
      expect((await atTerminal(who, "buy", EMPTY, 1)).trade).toMatchObject({
        status: "traded",
        totalCredits: 40,
        credits: 510,
      });
      expect((await atTerminal(who, "sell", FULL, 1)).trade).toMatchObject({
        status: "traded",
        totalCredits: 160,
        credits: 670,
      });
      expect((await atTerminal(who, "sell", EMPTY, 1)).trade).toMatchObject({
        status: "traded",
        totalCredits: 25,
        credits: 695,
      });
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId: who.characterId, itemId: ITEM_IDS.oilShale, quantity: 5 });
      expect((await atTerminal(who, "sell", ITEM_IDS.oilShale, 5)).trade).toMatchObject({
        status: "traded",
        totalCredits: 30,
        credits: 725,
      });
      expect((await atTerminal(who, "buy", ITEM_IDS.oilShale, 1)).trade).toMatchObject({
        status: "refused",
        reason: "not_traded",
      });
      expect(await carried(who.characterId, FULL)).toBe(1);
    });

    it("stays locked, both ways, until this character has turned in Thrust Issues", async () => {
      const who = await stillreachTrader({ thrustReported: false });
      for (const direction of ["buy", "sell"] as const) {
        expect((await atTerminal(who, direction, FULL, 1)).trade).toMatchObject({
          status: "refused",
          reason: "merchant_locked",
        });
      }
      expect(await carried(who.characterId, FULL)).toBe(0);
    });

    it("shares one daily allowance per item with Toll's counter, across both planets", async () => {
      const who = await stillreachTrader({ credits: 10_000 });
      // Three Full canisters at the terminal...
      expect((await atTerminal(who, "buy", FULL, 3)).trade).toMatchObject({ status: "traded" });
      // ...selling back never restores the allowance...
      expect((await atTerminal(who, "sell", FULL, 3)).trade).toMatchObject({ status: "traded" });
      // ...so only two remain, at either venue.
      expect((await atTerminal(who, "buy", FULL, 3)).trade).toMatchObject({
        status: "refused",
        reason: "daily_limit",
      });
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollowLanding })
        .where(eq(rune.characters.id, who.characterId));
      expect((await atCounter(who, "buy", FULL, 2)).trade).toMatchObject({ status: "traded" });
      expect((await atCounter(who, "buy", FULL, 1)).trade).toMatchObject({
        status: "refused",
        reason: "daily_limit",
      });
      // Empty canisters have their own five, untouched.
      expect((await atCounter(who, "buy", EMPTY, 5)).trade).toMatchObject({ status: "traded" });
      const state = await stateAt(who.userId, who.characterId);
      expect(state.merchantDailyPurchases.last_leg_trading?.[FULL]).toMatchObject({
        limit: 5,
        remaining: 0,
      });
      // The next Pacific day restores both.
      const tomorrow = after(now, 24 * 60 * 60 * 1000);
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.stillreachLandingStation })
        .where(eq(rune.characters.id, who.characterId));
      expect((await atTerminal(who, "buy", FULL, 1, tomorrow)).trade).toMatchObject({
        status: "traded",
      });
      expect(
        (await stateAt(who.userId, who.characterId, tomorrow)).merchantDailyPurchases
          .last_leg_trading?.[FULL],
      ).toMatchObject({ limit: 5, remaining: 4 });
    });

    it("never lets concurrent purchases at the two venues exceed the shared cap", async () => {
      const who = await stillreachTrader({ credits: 10_000 });
      // The character can only stand in one place; races are of the same command.
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => atTerminal(who, "buy", FULL, 2)),
      );
      const traded = results.filter(
        (result) => result.status === "fulfilled" && result.value.trade.status === "traded",
      );
      expect(traded).toHaveLength(2);
      expect(await carried(who.characterId, FULL)).toBe(4);
      const ledger = await db
        .select()
        .from(rune.characterMerchantDailyPurchases)
        .where(eq(rune.characterMerchantDailyPurchases.characterId, who.characterId));
      expect(ledger.map((row) => [row.merchantId, row.itemId, row.quantityPurchased])).toEqual([
        ["last_leg_trading", FULL, 4],
      ]);
    });

    it("is not reachable from the Landing Station's neighbours or from Skatboll without the counter", async () => {
      const who = await makePilot({
        berth: LOCATION_IDS.stillreachLandingStation,
        location: LOCATION_IDS.windwardTrack,
      });
      expect((await atTerminal(who, "buy", FULL, 1)).trade).toMatchObject({
        status: "refused",
        reason: "no_merchant",
      });
      // At Holo Hollow Landing itself (not in the shop) there is no location merchant.
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollowLanding })
        .where(eq(rune.characters.id, who.characterId));
      expect((await atTerminal(who, "buy", FULL, 1)).trade).toMatchObject({
        status: "refused",
        reason: "no_merchant",
      });
    });
  });
});
