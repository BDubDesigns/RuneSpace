import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  PASSENGER_ROUTE_IDS,
  REPAIR_TARGET_IDS,
  SHIP_ROUTE_IDS,
  type LocationId,
} from "@/game/config/foundations";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  seedLegacyStarterCutter,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #404 — Milky Waymo's passenger shuttle, against real PostgreSQL.
 *
 * A confirmed 200 CR ticket carries one character between Holo Hollow Landing
 * and Stillreach Landing Station in 180 seconds, once, however it is retried or
 * raced, landing lazily and offline-safe. It moves the character and nothing
 * else: the Rivet, its berth and tank, and the Cargo Hold stay byte-for-byte
 * where they were left.
 */
suite("issue #404 Milky Waymo passenger shuttle (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let ship: typeof import("@/server/ship-commands");
  let passenger: typeof import("@/server/passenger-commands");
  let trades: typeof import("@/server/player-trades");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-21T19:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const FARE = 200;
  const JOURNEY_MS = 180_000;
  const RIVET_LEG_MS = 260_000;
  /** One whole 600 ms tick: a Rivet leg that is not a multiple of it lands on the next. */
  const LANDING_TICK_MS = 600;
  const HOLO = LOCATION_IDS.holoHollowLanding;
  const STILLREACH = LOCATION_IDS.stillreachLandingStation;
  const HOLO_DESK = LOCAL_PLACE_IDS.milkyWaymoHoloHollowLanding;
  const STILLREACH_DESK = LOCAL_PLACE_IDS.milkyWaymoStillreachLandingStation;
  const OUT = PASSENGER_ROUTE_IDS.holoHollowLandingToStillreachLandingStation;
  const BACK = PASSENGER_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    ship = await import("@/server/ship-commands");
    passenger = await import("@/server/passenger-commands");
    trades = await import("@/server/player-trades");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const random = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
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
   * A pilot with a whole, fuelled Rivet berthed at `berth` and standing at
   * `location`. With `arrivedAtStillreach` it has genuinely flown the Rivet there
   * once (the durable landing receipt the unlock reads), then been put back where
   * the test wants it, so unlock is proved from history rather than from position.
   */
  async function makePilot(
    options: {
      berth?: LocationId;
      location?: LocationId;
      credits?: number;
      fuel?: number;
      arrivedAtStillreach?: boolean;
    } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Waymo Passenger");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Rider ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    const characterId = character.id;
    await play.getPlayGameplayState(userId, characterId, now, random());
    await db
      .insert(rune.characterMissions)
      .values(
        STORY.map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      );
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
    await db
      .update(rune.characters)
      .set({ currentLocationId: HOLO, credits: 5_000 })
      .where(eq(rune.characters.id, characterId));
    await db
      .insert(rune.characterShips)
      .values({ characterId, berthLocationId: HOLO, fuelUnits: options.fuel ?? 300 });
    if (options.arrivedAtStillreach) {
      // The Rivet's 260 s leg is not a whole number of 600 ms ticks, so it lands on
      // the first read a tick past its arrival. The flight is flown in the recent
      // past so the ride that follows can begin at `now`.
      const flightStart = after(now, -(RIVET_LEG_MS + 10_000));
      await ship.launchShip(
        userId,
        characterId,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        flightStart,
      );
      await play.getPlayGameplayState(
        userId,
        characterId,
        after(flightStart, RIVET_LEG_MS + LANDING_TICK_MS),
        random(),
      );
    }
    // Where the test wants the ship and the character to be standing now.
    await db
      .update(rune.characterShips)
      .set({ berthLocationId: options.berth ?? HOLO, fuelUnits: options.fuel ?? 300 })
      .where(eq(rune.characterShips.characterId, characterId));
    await db
      .update(rune.characters)
      .set({
        currentLocationId: options.location ?? options.berth ?? HOLO,
        credits: options.credits ?? 5_000,
      })
      .where(eq(rune.characters.id, characterId));
    return { userId, characterId };
  }

  /** A pilot who may ride and stands at the Skatboll desk, with a Rivet and cargo to keep safe. */
  async function makeRider(
    options: { credits?: number; berth?: LocationId; location?: LocationId } = {},
  ) {
    const who = await makePilot({ ...options, arrivedAtStillreach: true });
    await seedBelongings(who.characterId);
    return who;
  }

  async function seedBelongings(characterId: string) {
    await db.insert(rune.cargoHoldStacks).values([
      { characterId, itemId: ITEM_IDS.oilShale, quantity: 7 },
      { characterId, itemId: ITEM_IDS.fullSmallFuelCanister, quantity: 2 },
    ]);
    await db.insert(rune.inventoryStacks).values({
      characterId,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 3,
    });
    await seedLegacyStarterCutter(db, rune, characterId);
  }

  const stateAt = (userId: string, characterId: string, at = now) =>
    play.getPlayGameplayState(userId, characterId, at, random());
  const book = (who: { userId: string; characterId: string }, localPlaceId = HOLO_DESK, at = now) =>
    passenger.bookPassage(who.userId, who.characterId, { localPlaceId }, at);

  async function characterRow(characterId: string) {
    return (await db.select().from(rune.characters).where(eq(rune.characters.id, characterId)))[0]!;
  }
  async function journeyRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterPassengerJourneys)
        .where(eq(rune.characterPassengerJourneys.characterId, characterId))
    )[0];
  }
  async function actionRows(characterId: string) {
    return db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characterId));
  }

  /**
   * Everything a character owns that a passenger journey must not touch: the
   * ship row, the Cargo Hold, carried Inventory, item instances, Equipment and
   * the ship's landing receipts.
   */
  async function ownedSnapshot(characterId: string) {
    const sortBy = <T extends Record<string, unknown>>(rows: T[], key: keyof T) =>
      [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    const [shipRow, cargoStacks, cargoItems, inventory, instances, equipped, notices] =
      await Promise.all([
        db
          .select()
          .from(rune.characterShips)
          .where(eq(rune.characterShips.characterId, characterId)),
        db
          .select()
          .from(rune.cargoHoldStacks)
          .where(eq(rune.cargoHoldStacks.characterId, characterId)),
        db
          .select()
          .from(rune.cargoHoldItemInstances)
          .where(eq(rune.cargoHoldItemInstances.characterId, characterId)),
        db
          .select()
          .from(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, characterId)),
        db.select().from(rune.itemInstances).where(eq(rune.itemInstances.characterId, characterId)),
        db.select().from(rune.equippedItems).where(eq(rune.equippedItems.characterId, characterId)),
        db
          .select()
          .from(rune.shipArrivalNotices)
          .where(eq(rune.shipArrivalNotices.characterId, characterId)),
      ]);
    return JSON.parse(
      JSON.stringify({
        ship: shipRow,
        cargoStacks: sortBy(cargoStacks, "id"),
        cargoItems: sortBy(cargoItems, "itemInstanceId"),
        inventory: sortBy(inventory, "id"),
        instances: sortBy(instances, "id"),
        equipped: sortBy(equipped, "suitSlotId"),
        notices: sortBy(notices, "id"),
      }),
    );
  }

  describe("unlock", () => {
    it("is locked before the first Rivet arrival at Stillreach, and refuses safely without a charge", async () => {
      const who = await makePilot();
      const state = await stateAt(who.userId, who.characterId);
      expect(state.passenger).toMatchObject({
        unlocked: false,
        fareCredits: FARE,
        durationMs: JOURNEY_MS,
      });

      const result = await book(who);
      expect(result.booking).toMatchObject({ status: "refused", reason: "service_locked" });
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
      expect(await journeyRow(who.characterId)).toBeUndefined();
      expect(await actionRows(who.characterId)).toEqual([]);
    });

    it("is not unlocked by merely standing at Stillreach, only by having flown there", async () => {
      const who = await makePilot({ berth: STILLREACH });
      const result = await book(who, STILLREACH_DESK);
      expect(result.booking).toMatchObject({ status: "refused", reason: "service_locked" });
    });

    it("unlocks on the Rivet's landing at Stillreach, and stays unlocked after flying home and dismissing the notice", async () => {
      const who = await makePilot();
      expect((await stateAt(who.userId, who.characterId)).passenger.unlocked).toBe(false);
      await ship.launchShip(
        who.userId,
        who.characterId,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        now,
      );
      const landedAt = after(now, RIVET_LEG_MS + LANDING_TICK_MS);
      const arrived = await stateAt(who.userId, who.characterId, landedAt);
      expect(arrived.location.currentLocationId).toBe(STILLREACH);
      expect(arrived.passenger.unlocked).toBe(true);

      // Home again, receipt dismissed: the unlock is history, not position.
      const homeAt = after(landedAt, 1_000);
      await ship.launchShip(
        who.userId,
        who.characterId,
        SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
        homeAt,
      );
      const homeLandedAt = after(homeAt, RIVET_LEG_MS + LANDING_TICK_MS);
      const home = await stateAt(who.userId, who.characterId, homeLandedAt);
      expect(home.location.currentLocationId).toBe(HOLO);
      await ship.acknowledgeShipArrival(
        who.userId,
        who.characterId,
        home.ship.arrivalNotice!.noticeId,
        after(homeLandedAt, 5),
      );
      const settled = await stateAt(who.userId, who.characterId, after(homeLandedAt, 10));
      expect(settled.ship.arrivalNotice).toBeUndefined();
      expect(settled.passenger.unlocked).toBe(true);
      expect((await book(who, HOLO_DESK, after(homeLandedAt, 20))).booking.status).toBe("booked");
    });

    it("is not unlocked by the first hop from the Crash Site alone", async () => {
      const who = await makePilot();
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.crashSite })
        .where(eq(rune.characters.id, who.characterId));
      await db
        .update(rune.characterShips)
        .set({ berthLocationId: LOCATION_IDS.crashSite })
        .where(eq(rune.characterShips.characterId, who.characterId));
      await ship.launchShip(
        who.userId,
        who.characterId,
        SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
        now,
      );
      const landed = await stateAt(who.userId, who.characterId, after(now, 15_000));
      expect(landed.location.currentLocationId).toBe(HOLO);
      expect(landed.passenger.unlocked).toBe(false);
    });
  });

  describe("booking", () => {
    it("charges exactly 200 CR and records one immutable 180-second journey, moving nobody yet", async () => {
      const who = await makeRider();
      const result = await book(who);
      expect(result.booking).toEqual({
        status: "booked",
        routeId: OUT,
        fareCredits: FARE,
        startedAt: now.toISOString(),
        arrivesAt: after(now, JOURNEY_MS).toISOString(),
      });
      const character = await characterRow(who.characterId);
      expect(character.credits).toBe(5_000 - FARE);
      expect(character.currentLocationId).toBe(HOLO);

      const row = await journeyRow(who.characterId);
      expect(row).toMatchObject({
        routeId: OUT,
        originLocationId: HOLO,
        destinationLocationId: STILLREACH,
        fareCredits: FARE,
        landedAt: null,
        acknowledgedAt: null,
      });
      expect(row!.startedAt.toISOString()).toBe(now.toISOString());
      expect(row!.arrivesAt.getTime() - row!.startedAt.getTime()).toBe(JOURNEY_MS);
      expect((await actionRows(who.characterId)).map((action) => action.actionId)).toEqual([
        ACTION_IDS.passengerTravel,
      ]);
      expect(result.state.passenger.journey).toMatchObject({
        routeId: OUT,
        destinationLocationId: STILLREACH,
        destinationName: "Stillreach Landing Station",
        startedAt: now.toISOString(),
        arrivesAt: after(now, JOURNEY_MS).toISOString(),
      });
      expect(result.state.credits).toBe(5_000 - FARE);
    });

    it("books the opposite direction from the Stillreach desk for the same fare and time", async () => {
      const who = await makeRider({ berth: STILLREACH, location: STILLREACH });
      const result = await book(who, STILLREACH_DESK);
      expect(result.booking).toMatchObject({ status: "booked", routeId: BACK, fareCredits: FARE });
      const row = await journeyRow(who.characterId);
      expect(row).toMatchObject({ originLocationId: STILLREACH, destinationLocationId: HOLO });
      expect(row!.arrivesAt.getTime() - row!.startedAt.getTime()).toBe(JOURNEY_MS);
      expect((await characterRow(who.characterId)).credits).toBe(5_000 - FARE);
    });

    it("is available wherever the Rivet is parked, in either direction", async () => {
      // Ship left behind at Stillreach, rider still at Skatboll; and the mirror image.
      const atSkatboll = await makeRider({ berth: STILLREACH, location: HOLO });
      expect((await book(atSkatboll)).booking.status).toBe("booked");
      const atStillreach = await makeRider({ berth: HOLO, location: STILLREACH });
      expect((await book(atStillreach, STILLREACH_DESK)).booking.status).toBe("booked");
    });

    it("charges exactly the balance when the character holds exactly 200 CR, and refuses 199", async () => {
      const exact = await makeRider({ credits: FARE });
      expect((await book(exact)).booking.status).toBe("booked");
      expect((await characterRow(exact.characterId)).credits).toBe(0);

      const short = await makeRider({ credits: FARE - 1 });
      const refused = await book(short);
      expect(refused.booking).toMatchObject({
        status: "refused",
        reason: "insufficient_credits",
        message:
          "Unfortunately, your available balance is insufficient. Please come back when you have rectified your financial troubles.",
      });
      expect((await characterRow(short.characterId)).credits).toBe(FARE - 1);
      expect(await journeyRow(short.characterId)).toBeUndefined();
      expect(await actionRows(short.characterId)).toEqual([]);
    });

    it("refuses a desk that is not the one at the character's own location, writing nothing", async () => {
      const who = await makeRider();
      const before = await ownedSnapshot(who.characterId);
      for (const localPlaceId of [
        STILLREACH_DESK,
        LOCAL_PLACE_IDS.lastLegTrading,
        LOCAL_PLACE_IDS.fedhexHoloHollowLanding,
        "no_such_place",
      ]) {
        expect((await book(who, localPlaceId)).booking).toMatchObject({
          status: "refused",
          reason: "not_at_check_in",
        });
      }
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
      expect(await journeyRow(who.characterId)).toBeUndefined();
      expect(await ownedSnapshot(who.characterId)).toEqual(before);
    });

    it("refuses from anywhere that is not a landing hub", async () => {
      const who = await makeRider({ location: LOCATION_IDS.holoHollow, berth: HOLO });
      expect((await book(who)).booking).toMatchObject({
        status: "refused",
        reason: "not_at_check_in",
      });
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
    });

    it("refuses while the character is busy walking, without disturbing the walk or the balance", async () => {
      const who = await makeRider();
      const walking = await play.beginTravel(
        who.userId,
        who.characterId,
        LOCATION_IDS.southAccessTrack,
        now,
        random(),
      );
      // The walk really began, so the refusal below is about being busy and nothing else.
      expect(walking.travelState).toBeDefined();
      const refused = await book(who, HOLO_DESK, after(now, 1_000));
      expect(refused.booking).toMatchObject({ status: "refused", reason: "busy" });
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
      expect((await actionRows(who.characterId)).map((action) => action.actionId)).toEqual([
        ACTION_IDS.travel,
      ]);
      expect(await journeyRow(who.characterId)).toBeUndefined();
    });

    it("refuses while the Rivet is in the air, writing nothing", async () => {
      const who = await makeRider();
      await ship.launchShip(
        who.userId,
        who.characterId,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        now,
      );
      await expect(book(who, HOLO_DESK, after(now, 5_000))).rejects.toThrow(/in flight/i);
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
      expect(await journeyRow(who.characterId)).toBeUndefined();
    });

    it("refuses a trade-engaged character before charging anything", async () => {
      const who = await makeRider();
      const other = await makePilot();
      await trades.createTradeRequest(
        who.userId,
        who.characterId,
        { characterId: other.characterId },
        now,
      );
      await expect(book(who, HOLO_DESK, after(now, 1_000))).rejects.toThrow(/trad/i);
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
      expect(await journeyRow(who.characterId)).toBeUndefined();
    });

    it("refuses a repeated confirmation during the journey without a second charge", async () => {
      const who = await makeRider();
      await book(who);
      await expect(book(who, HOLO_DESK, after(now, 2_000))).rejects.toThrow(
        /shuttle is under way/i,
      );
      await expect(book(who, STILLREACH_DESK, after(now, 3_000))).rejects.toThrow(/under way/i);
      expect((await characterRow(who.characterId)).credits).toBe(5_000 - FARE);
      expect((await journeyRow(who.characterId))!.startedAt.toISOString()).toBe(now.toISOString());
      expect(await actionRows(who.characterId)).toHaveLength(1);
    });

    it("lets only one of several simultaneous confirmations through, charging once", async () => {
      const who = await makeRider();
      const results = await Promise.allSettled([
        book(who),
        book(who),
        book(who),
        book(who),
        book(who),
      ]);
      const booked = results.filter(
        (result) => result.status === "fulfilled" && result.value.booking.status === "booked",
      );
      expect(booked).toHaveLength(1);
      expect((await characterRow(who.characterId)).credits).toBe(5_000 - FARE);
      expect(await actionRows(who.characterId)).toHaveLength(1);
    });

    it("never overspends when two requests race a balance that covers one fare", async () => {
      const who = await makeRider({ credits: FARE });
      await Promise.allSettled([book(who), book(who)]);
      expect((await characterRow(who.characterId)).credits).toBe(0);
    });

    it("rolls the whole booking back when the journey cannot be recorded", async () => {
      const who = await makeRider();
      // The row's own schedule check refuses a journey that arrives before it starts.
      await expect(
        db.insert(rune.characterPassengerJourneys).values({
          characterId: who.characterId,
          routeId: OUT,
          originLocationId: HOLO,
          destinationLocationId: STILLREACH,
          fareCredits: FARE,
          startedAt: now,
          arrivesAt: after(now, -1),
        }),
      ).rejects.toThrow();
      expect(await journeyRow(who.characterId)).toBeUndefined();
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
    });
  });

  describe("while the shuttle is under way", () => {
    it("blocks walking, ship commands, trade and cargo but keeps the Play read", async () => {
      const who = await makeRider();
      await book(who);
      const mid = after(now, 60_000);
      await expect(
        play.beginTravel(who.userId, who.characterId, LOCATION_IDS.southAccessTrack, mid),
      ).rejects.toThrow(/under way/i);
      await expect(
        ship.launchShip(
          who.userId,
          who.characterId,
          SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
          mid,
        ),
      ).rejects.toThrow(/under way/i);
      await expect(
        ship.refuelShip(
          who.userId,
          who.characterId,
          { source: "cargo_hold", expectedFuelUnits: 300 },
          mid,
        ),
      ).rejects.toThrow(/under way/i);
      const trade = await import("@/server/trade");
      await expect(
        trade.tradeWithMerchant(
          who.userId,
          who.characterId,
          {
            localPlaceId: LOCAL_PLACE_IDS.lastLegTrading,
            itemId: ITEM_IDS.fullSmallFuelCanister,
            direction: "buy",
            quantity: 1,
          },
          mid,
        ),
      ).rejects.toThrow(/under way/i);

      const other = await makePilot();
      await expect(
        trades.createTradeRequest(
          who.userId,
          who.characterId,
          { characterId: other.characterId },
          mid,
        ),
      ).resolves.toMatchObject({ status: "refused" });

      const state = await stateAt(who.userId, who.characterId, mid);
      expect(state.passenger.journey?.arrivesAt).toBe(after(now, JOURNEY_MS).toISOString());
      expect(state.location.currentLocationId).toBe(HOLO);
      expect(state.inventory.stacks.some((stack) => stack.itemId === ITEM_IDS.ferriteShale)).toBe(
        true,
      );
    });

    it("refuses an operator force-idle rather than stranding the passenger", async () => {
      const { forceIdleResolvedAction } = await import("@/server/play-interrupt");
      const who = await makeRider();
      await book(who);
      await expect(
        db.transaction(async (transaction) => {
          const [character] = await transaction
            .select()
            .from(rune.characters)
            .where(eq(rune.characters.id, who.characterId));
          const [action] = await transaction
            .select()
            .from(rune.activeActions)
            .where(eq(rune.activeActions.characterId, who.characterId));
          return forceIdleResolvedAction(transaction, { character: character!, action, now });
        }),
      ).rejects.toThrow(/cannot be interrupted/i);
      expect(await actionRows(who.characterId)).toHaveLength(1);
      expect((await journeyRow(who.characterId))!.landedAt).toBeNull();
    });
  });

  describe("landing", () => {
    it("does not land one millisecond early, and lands exactly at the recorded instant", async () => {
      const who = await makeRider();
      await book(who);
      const early = await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS - 1));
      expect(early.passenger.journey).toBeDefined();
      expect(early.location.currentLocationId).toBe(HOLO);
      expect(early.passenger.arrivalNotice).toBeUndefined();

      const landed = await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS));
      expect(landed.passenger.journey).toBeUndefined();
      expect(landed.location.currentLocationId).toBe(STILLREACH);
      expect(landed.passenger.arrivalNotice).toEqual({
        routeId: OUT,
        destinationLocationId: STILLREACH,
        destinationName: "Stillreach Landing Station",
        arrivedAt: after(now, JOURNEY_MS).toISOString(),
      });
      expect(await actionRows(who.characterId)).toEqual([]);
    });

    it("moves the character only: the Rivet, its tank and the Cargo Hold are byte-for-byte unchanged", async () => {
      const who = await makeRider({ berth: HOLO, location: HOLO });
      const before = await ownedSnapshot(who.characterId);
      expect(before.cargoStacks.length).toBeGreaterThan(0);
      expect(before.equipped.length).toBeGreaterThan(0);
      const creditsBefore = (await characterRow(who.characterId)).credits;

      await book(who);
      // Mid-journey nothing owned has moved either.
      await stateAt(who.userId, who.characterId, after(now, 90_000));
      expect(await ownedSnapshot(who.characterId)).toEqual(before);

      const landed = await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS));
      expect(landed.location.currentLocationId).toBe(STILLREACH);
      expect(await ownedSnapshot(who.characterId)).toEqual(before);
      // The ship is still berthed at Skatboll with its full tank and no flight on record.
      expect(landed.ship).toMatchObject({ berthLocationId: HOLO, fuelUnits: 300 });
      expect(landed.ship.flight).toBeUndefined();
      expect(await characterRow(who.characterId)).toMatchObject({
        credits: creditsBefore - FARE,
        currentLocationId: STILLREACH,
      });
      // Carried belongings and equipment follow the character.
      expect(landed.inventory.stacks.some((stack) => stack.itemId === ITEM_IDS.ferriteShale)).toBe(
        true,
      );
      expect(landed.cargoHold).toBeDefined();
    });

    it("leaves a parked Rivet where it was when the rider flies the other way", async () => {
      const who = await makeRider({ berth: HOLO, location: STILLREACH });
      const before = await ownedSnapshot(who.characterId);
      await book(who, STILLREACH_DESK);
      const landed = await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS));
      expect(landed.location.currentLocationId).toBe(HOLO);
      expect(await ownedSnapshot(who.characterId)).toEqual(before);
    });

    it("lands once, however many times it is reconciled afterwards", async () => {
      const who = await makeRider();
      await book(who);
      const first = await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS));
      const rowAfterFirst = await journeyRow(who.characterId);
      for (const extra of [1, 50, 5_000, 600_000]) {
        const again = await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS + extra));
        expect(again.location.currentLocationId).toBe(STILLREACH);
        expect(again.passenger.arrivalNotice).toEqual(first.passenger.arrivalNotice);
      }
      expect(await journeyRow(who.characterId)).toEqual(rowAfterFirst);
      expect((await characterRow(who.characterId)).credits).toBe(5_000 - FARE);
    });

    it("lands a rider who was offline for hours at the scheduled instant, not the late read", async () => {
      const who = await makeRider();
      await book(who);
      const lateRead = after(now, 6 * 3_600_000);
      const landed = await stateAt(who.userId, who.characterId, lateRead);
      expect(landed.location.currentLocationId).toBe(STILLREACH);
      expect(landed.passenger.arrivalNotice?.arrivedAt).toBe(after(now, JOURNEY_MS).toISOString());
      expect((await journeyRow(who.characterId))!.landedAt!.toISOString()).toBe(
        after(now, JOURNEY_MS).toISOString(),
      );
    });

    it("lands from the next command too, so a booking made after the due time proceeds from the destination", async () => {
      const who = await makeRider();
      await book(who);
      // The Skatboll desk is no longer this character's desk once the shuttle has landed.
      const late = await book(who, HOLO_DESK, after(now, JOURNEY_MS + 1_000));
      expect(late.booking).toMatchObject({ status: "refused", reason: "not_at_check_in" });
      expect((await characterRow(who.characterId)).currentLocationId).toBe(STILLREACH);
      expect((await characterRow(who.characterId)).credits).toBe(5_000 - FARE);
      // ...and the Stillreach desk now books the way home, a second fare for a second journey.
      const home = await book(who, STILLREACH_DESK, after(now, JOURNEY_MS + 2_000));
      expect(home.booking).toMatchObject({ status: "booked", routeId: BACK });
      expect((await characterRow(who.characterId)).credits).toBe(5_000 - 2 * FARE);
    });

    it("rolls a corrupt landing back, leaving the character and the journey where they were", async () => {
      const who = await makeRider();
      await book(who);
      // A journey whose recorded origin is not where the character stands cannot land.
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollow })
        .where(eq(rune.characters.id, who.characterId));
      await expect(stateAt(who.userId, who.characterId, after(now, JOURNEY_MS))).rejects.toThrow(
        /does not match the journey origin/i,
      );
      expect((await characterRow(who.characterId)).currentLocationId).toBe(LOCATION_IDS.holoHollow);
      expect((await journeyRow(who.characterId))!.landedAt).toBeNull();
      expect(await actionRows(who.characterId)).toHaveLength(1);
    });

    it("refuses to land an action that has no journey behind it", async () => {
      const who = await makeRider();
      await db.insert(rune.activeActions).values({
        characterId: who.characterId,
        actionId: ACTION_IDS.passengerTravel,
        startedAt: now,
        resolvedThroughAt: now,
      });
      await expect(stateAt(who.userId, who.characterId, after(now, 10_000))).rejects.toThrow(
        /no recorded journey/i,
      );
      expect((await characterRow(who.characterId)).currentLocationId).toBe(HOLO);
    });
  });

  describe("disembarking", () => {
    it("is acknowledgment only: it dismisses the notice and changes nothing else", async () => {
      const who = await makeRider();
      await book(who);
      const landed = await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS));
      expect(landed.passenger.arrivalNotice).toBeDefined();
      const before = await ownedSnapshot(who.characterId);
      const creditsBefore = (await characterRow(who.characterId)).credits;

      const first = await passenger.acknowledgePassengerArrival(
        who.userId,
        who.characterId,
        after(now, JOURNEY_MS + 5_000),
      );
      expect(first.acknowledged).toBe(true);
      expect(first.state.passenger.arrivalNotice).toBeUndefined();
      expect(first.state.location.currentLocationId).toBe(STILLREACH);
      expect(first.state.passenger.unlocked).toBe(true);
      // A replay or a second device finds nothing left to dismiss.
      const replay = await passenger.acknowledgePassengerArrival(
        who.userId,
        who.characterId,
        after(now, JOURNEY_MS + 6_000),
      );
      expect(replay.acknowledged).toBe(false);
      expect(await ownedSnapshot(who.characterId)).toEqual(before);
      expect((await characterRow(who.characterId)).credits).toBe(creditsBefore);
      expect((await journeyRow(who.characterId))!.acknowledgedAt!.toISOString()).toBe(
        after(now, JOURNEY_MS + 5_000).toISOString(),
      );
    });

    it("has nothing to dismiss mid-journey, and never lands the shuttle itself", async () => {
      const who = await makeRider();
      await book(who);
      const result = await passenger.acknowledgePassengerArrival(
        who.userId,
        who.characterId,
        after(now, 30_000),
      );
      expect(result.acknowledged).toBe(false);
      expect(result.state.passenger.journey).toBeDefined();
      // Even past the due time, dismissing is not a landing: only a reconciling read lands.
      const late = await passenger.acknowledgePassengerArrival(
        who.userId,
        who.characterId,
        after(now, 400_000),
      );
      expect(late.acknowledged).toBe(false);
      expect((await characterRow(who.characterId)).currentLocationId).toBe(HOLO);
      const landed = await stateAt(who.userId, who.characterId, after(now, 400_000));
      expect(landed.location.currentLocationId).toBe(STILLREACH);
    });

    it("lands without ever being dismissed: the arrival never depends on the notice", async () => {
      const who = await makeRider();
      await book(who);
      await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS));
      // Never acknowledged. A new booking from the destination replaces the stale receipt.
      const home = await book(who, STILLREACH_DESK, after(now, JOURNEY_MS + 1_000));
      expect(home.booking.status).toBe("booked");
      expect(home.state.passenger.arrivalNotice).toBeUndefined();
      expect(home.state.passenger.journey).toMatchObject({ routeId: BACK });
      expect((await journeyRow(who.characterId))!.acknowledgedAt).toBeNull();
    });

    it("keeps the arrival notice across sessions until it is dismissed", async () => {
      const who = await makeRider();
      await book(who);
      await stateAt(who.userId, who.characterId, after(now, JOURNEY_MS));
      for (const minutes of [1, 90, 24 * 60]) {
        const state = await stateAt(
          who.userId,
          who.characterId,
          after(now, JOURNEY_MS + minutes * 60_000),
        );
        expect(state.passenger.arrivalNotice?.destinationLocationId).toBe(STILLREACH);
      }
    });
  });

  describe("a round trip", () => {
    it("costs two fares, takes six minutes and leaves the Rivet where it started", async () => {
      const who = await makeRider();
      const before = await ownedSnapshot(who.characterId);
      await book(who);
      const outbound = after(now, JOURNEY_MS);
      await stateAt(who.userId, who.characterId, outbound);
      const returnAt = after(outbound, 1_000);
      await book(who, STILLREACH_DESK, returnAt);
      const home = await stateAt(who.userId, who.characterId, after(returnAt, JOURNEY_MS));
      expect(home.location.currentLocationId).toBe(HOLO);
      expect((await characterRow(who.characterId)).credits).toBe(5_000 - 2 * FARE);
      expect(await ownedSnapshot(who.characterId)).toEqual(before);
      expect(await actionRows(who.characterId)).toEqual([]);
    });

    it("keeps one journey row per character however often they ride", async () => {
      const who = await makeRider();
      let at = now;
      for (const desk of [HOLO_DESK, STILLREACH_DESK, HOLO_DESK]) {
        await book(who, desk, at);
        at = after(at, JOURNEY_MS + 1_000);
        await stateAt(who.userId, who.characterId, at);
      }
      const rows = await db
        .select()
        .from(rune.characterPassengerJourneys)
        .where(eq(rune.characterPassengerJourneys.characterId, who.characterId));
      expect(rows).toHaveLength(1);
    });
  });

  describe("Rivet flight is unaffected", () => {
    it("still flies, lands, charges fuel and relocates the ship exactly as before", async () => {
      const who = await makePilot({ fuel: 300 });
      await ship.launchShip(
        who.userId,
        who.characterId,
        SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
        now,
      );
      const landed = await stateAt(
        who.userId,
        who.characterId,
        after(now, RIVET_LEG_MS + LANDING_TICK_MS),
      );
      expect(landed.location.currentLocationId).toBe(STILLREACH);
      expect(landed.ship).toMatchObject({ berthLocationId: STILLREACH, fuelUnits: 180 });
      // A Rivet flight never touches the passenger journey or Credits.
      expect(await journeyRow(who.characterId)).toBeUndefined();
      expect((await characterRow(who.characterId)).credits).toBe(5_000);
    });

    it("refuses the Rivet's own launch while a passenger journey is in the air", async () => {
      const who = await makeRider();
      await book(who);
      await expect(
        ship.launchShip(
          who.userId,
          who.characterId,
          SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
          after(now, 1_000),
        ),
      ).rejects.toThrow(/under way/i);
      const row = (
        await db
          .select()
          .from(rune.characterShips)
          .where(and(eq(rune.characterShips.characterId, who.characterId)))
      )[0]!;
      expect(row.flightRouteId).toBeNull();
      expect(row.fuelUnits).toBe(300);
    });
  });

  describe("storage", () => {
    it("refuses a receipt dismissed before it landed, and a free or backwards journey", async () => {
      const who = await makeRider();
      const base = {
        characterId: who.characterId,
        routeId: OUT,
        originLocationId: HOLO,
        destinationLocationId: STILLREACH,
        startedAt: now,
        arrivesAt: after(now, JOURNEY_MS),
      };
      await expect(
        db
          .insert(rune.characterPassengerJourneys)
          .values({ ...base, fareCredits: FARE, acknowledgedAt: now }),
      ).rejects.toThrow();
      await expect(
        db.insert(rune.characterPassengerJourneys).values({ ...base, fareCredits: 0 }),
      ).rejects.toThrow();
      await expect(
        db
          .insert(rune.characterPassengerJourneys)
          .values({ ...base, fareCredits: FARE, destinationLocationId: HOLO }),
      ).rejects.toThrow();
    });
  });
});
