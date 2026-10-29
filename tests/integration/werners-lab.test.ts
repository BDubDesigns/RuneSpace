import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  PLANET_IDS,
} from "@/game/config/foundations";
import { BEGINNER_ECHO_TARGET_POOLS } from "@/game/content/echo-hunts";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #429 — Werner's Lab against real PostgreSQL.
 *
 * What only the database proves: that Werner's Stone line is the same
 * per-character, per-Pacific-day ledger as every other limited line (twelve
 * bought, the thirteenth refused, selling back restoring nothing, the next
 * Pacific date fresh, concurrent requests never past twelve); that a refusal for
 * Credits, room or place spends none of it; that the uncut gems are bought at
 * 8, 18 and 35 and never sold; that walking works to and from the lab and
 * nowhere else; and that a Beginner Echo hunt can be started at, hidden in and
 * discovered at the lab while a hunt persisted before this release keeps the
 * target it already had. No migration backs any of it: every assertion runs on
 * the existing schema.
 */
suite("issue #429 Werner's Lab (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let trade: typeof import("@/server/trade");
  let echo: typeof import("@/server/echo-hunt-commands");
  let travelCommands: typeof import("@/server/travel-commands");
  const createdUsers: string[] = [];
  const deterministicRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

  // 11:00 PDT on 2026-09-12; the Pacific date turns at 07:00Z on the 13th.
  const today = new Date("2026-09-12T18:00:00.000Z");
  const lastMinuteToday = new Date("2026-09-13T06:59:59.000Z");
  const tomorrow = new Date("2026-09-13T07:00:00.000Z");
  const lab = LOCATION_IDS.wernersLab;
  const STONE = ITEM_IDS.stone;
  const beginner = getEffectiveGameBalance().echoHunts.beginner;
  const readingMs = beginner.readingDurationTicks * GAME_TICK_MS;
  const SEEKER = ITEM_IDS.beginnerEchoSeeker;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    trade = await import("@/server/trade");
    echo = await import("@/server/echo-hunt-commands");
    travelCommands = await import("@/server/travel-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A brand-new character who has completed and accepted nothing at all. */
  async function makeCharacter(options?: { credits?: number; locationId?: string }) {
    const userId = await createTestUser(db, authSchema, "Werner Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Lab ${userId.slice(0, 8)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, today, deterministicRandom);
    await db
      .update(rune.characters)
      .set({ credits: options?.credits ?? 1_000, currentLocationId: options?.locationId ?? lab })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  function tradeWithWerner(
    userId: string,
    characterId: string,
    itemId: string,
    direction: "buy" | "sell",
    quantity: number,
    now = today,
  ) {
    return trade.tradeWithMerchant(userId, characterId, { itemId, direction, quantity }, now);
  }

  async function creditsOf(characterId: string) {
    const rows = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return rows[0]?.credits;
  }

  async function carried(characterId: string, itemId: string) {
    const rows = await db
      .select()
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.reduce((total, row) => total + row.quantity, 0);
  }

  async function give(characterId: string, itemId: string, quantity: number) {
    await db.insert(rune.inventoryStacks).values({
      characterId,
      itemId,
      quantity,
      createdAt: today,
      updatedAt: today,
    });
  }

  async function ledgerRows(characterId: string) {
    return db
      .select()
      .from(rune.characterMerchantDailyPurchases)
      .where(eq(rune.characterMerchantDailyPurchases.characterId, characterId));
  }

  describe("Stone retail and the daily allowance", () => {
    it("trades immediately for a character with no Mission and no conversation: 5 Credits in, 2 out", async () => {
      const { userId, characterId } = await makeCharacter({ credits: 100 });

      const bought = await tradeWithWerner(userId, characterId, STONE, "buy", 3);
      expect(bought.trade).toMatchObject({ status: "traded", quantity: 3, totalCredits: 15 });
      expect(await creditsOf(characterId)).toBe(85);
      expect(await carried(characterId, STONE)).toBe(3);

      const sold = await tradeWithWerner(userId, characterId, STONE, "sell", 2);
      expect(sold.trade).toMatchObject({ status: "traded", quantity: 2, totalCredits: 4 });
      expect(await creditsOf(characterId)).toBe(89);
      expect(await carried(characterId, STONE)).toBe(1);
    });

    it("sells exactly twelve in a Pacific day, the twelfth being the last, and refuses the thirteenth", async () => {
      const { userId, characterId } = await makeCharacter();

      for (const quantity of [5, 4, 2]) {
        const result = await tradeWithWerner(userId, characterId, STONE, "buy", quantity);
        expect(result.trade).toMatchObject({ status: "traded", quantity });
      }
      // Eleven bought: exactly one more is still allowed.
      const twelfth = await tradeWithWerner(userId, characterId, STONE, "buy", 1);
      expect(twelfth.trade).toMatchObject({ status: "traded", quantity: 1 });
      expect(await carried(characterId, STONE)).toBe(12);

      const thirteenth = await tradeWithWerner(userId, characterId, STONE, "buy", 1);
      expect(thirteenth.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
      expect(await carried(characterId, STONE)).toBe(12);
      expect(await creditsOf(characterId)).toBe(1_000 - 12 * 5);
      expect(thirteenth.state.merchantDailyPurchases[MERCHANT_IDS.wernerLab]?.[STONE]).toEqual({
        limit: 12,
        purchased: 12,
        remaining: 0,
      });
    });

    it("refuses a thirteen-Stone request outright, consuming none of the allowance", async () => {
      const { userId, characterId } = await makeCharacter();
      const tooMany = await tradeWithWerner(userId, characterId, STONE, "buy", 13);
      expect(tooMany.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
      expect(await ledgerRows(characterId)).toHaveLength(0);
      expect(await creditsOf(characterId)).toBe(1_000);
      const exact = await tradeWithWerner(userId, characterId, STONE, "buy", 12);
      expect(exact.trade).toMatchObject({ status: "traded", quantity: 12 });
    });

    it("does not restore the allowance when Stone is sold back at 2 Credits", async () => {
      const { userId, characterId } = await makeCharacter();
      await tradeWithWerner(userId, characterId, STONE, "buy", 12);

      const sold = await tradeWithWerner(userId, characterId, STONE, "sell", 12);
      expect(sold.trade).toMatchObject({ status: "traded", quantity: 12, totalCredits: 24 });
      expect(await carried(characterId, STONE)).toBe(0);
      // The round trip nets a loss of 36 Credits, and the day's allowance stays spent.
      expect(await creditsOf(characterId)).toBe(1_000 - 60 + 24);

      const again = await tradeWithWerner(userId, characterId, STONE, "buy", 1);
      expect(again.trade).toMatchObject({ status: "refused", reason: "daily_limit" });
      expect((await ledgerRows(characterId))[0]?.quantityPurchased).toBe(12);
    });

    it("limits units bought from Werner, not units owned", async () => {
      const { userId, characterId } = await makeCharacter();
      await give(characterId, STONE, 5);
      const result = await tradeWithWerner(userId, characterId, STONE, "buy", 12);
      expect(result.trade).toMatchObject({ status: "traded", quantity: 12 });
      expect(await carried(characterId, STONE)).toBe(17);
    });

    it("rolls over on the next canonical Pacific game day, without clearing anything", async () => {
      const { userId, characterId } = await makeCharacter();
      await tradeWithWerner(userId, characterId, STONE, "buy", 12);

      // One second before Pacific midnight it is still the same day.
      const lateToday = await tradeWithWerner(
        userId,
        characterId,
        STONE,
        "buy",
        1,
        lastMinuteToday,
      );
      expect(lateToday.trade).toMatchObject({ status: "refused", reason: "daily_limit" });

      const nextDay = await tradeWithWerner(userId, characterId, STONE, "buy", 12, tomorrow);
      expect(nextDay.trade).toMatchObject({ status: "traded", quantity: 12 });
      const rows = await ledgerRows(characterId);
      expect(rows.map((row) => [row.resetDate, row.quantityPurchased]).sort()).toEqual([
        ["2026-09-12", 12],
        ["2026-09-13", 12],
      ]);
      expect(rows.every((row) => row.merchantId === MERCHANT_IDS.wernerLab)).toBe(true);
    });

    it("never exceeds twelve under concurrent single-unit and multi-unit requests", async () => {
      const single = await makeCharacter();
      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          tradeWithWerner(single.userId, single.characterId, STONE, "buy", 1),
        ),
      );
      expect(results.filter((r) => r.trade.status === "traded")).toHaveLength(12);
      for (const refused of results.filter((r) => r.trade.status === "refused")) {
        expect(refused.trade).toMatchObject({ reason: "daily_limit" });
      }
      expect(await carried(single.characterId, STONE)).toBe(12);
      expect(await creditsOf(single.characterId)).toBe(1_000 - 12 * 5);
      expect((await ledgerRows(single.characterId))[0]?.quantityPurchased).toBe(12);

      const multi = await makeCharacter();
      const batches = await Promise.all([
        tradeWithWerner(multi.userId, multi.characterId, STONE, "buy", 5),
        tradeWithWerner(multi.userId, multi.characterId, STONE, "buy", 5),
        tradeWithWerner(multi.userId, multi.characterId, STONE, "buy", 5),
      ]);
      expect(batches.filter((r) => r.trade.status === "traded")).toHaveLength(2);
      expect(await carried(multi.characterId, STONE)).toBe(10);
      expect((await ledgerRows(multi.characterId))[0]?.quantityPurchased).toBe(10);
    });

    it("spends no allowance on a purchase refused for Credits or for room", async () => {
      const broke = await makeCharacter({ credits: 4 });
      const refusedForFunds = await tradeWithWerner(
        broke.userId,
        broke.characterId,
        STONE,
        "buy",
        1,
      );
      expect(refusedForFunds.trade).toMatchObject({
        status: "refused",
        reason: "insufficient_credits",
      });
      expect(await ledgerRows(broke.characterId)).toHaveLength(0);
      expect(await creditsOf(broke.characterId)).toBe(4);

      // 59 Credits pays for eleven Stone but not the twelfth.
      const short = await makeCharacter({ credits: 59 });
      const partlyShort = await tradeWithWerner(short.userId, short.characterId, STONE, "buy", 12);
      expect(partlyShort.trade).toMatchObject({
        status: "refused",
        reason: "insufficient_credits",
      });
      expect(await ledgerRows(short.characterId)).toHaveLength(0);

      const packed = await makeCharacter();
      const state = await play.getPlayGameplayState(
        packed.userId,
        packed.characterId,
        today,
        deterministicRandom,
      );
      for (let index = 0; index < state.inventory.slotsAvailable; index += 1) {
        await give(packed.characterId, ITEM_IDS.slag, 10);
      }
      const full = await tradeWithWerner(packed.userId, packed.characterId, STONE, "buy", 1);
      expect(full.trade.status === "refused" && full.trade.reason).toMatch(/slots|mass/);
      expect(await ledgerRows(packed.characterId)).toHaveLength(0);
      expect(full.state.merchantDailyPurchases[MERCHANT_IDS.wernerLab]?.[STONE]?.remaining).toBe(
        12,
      );
    });

    it("keeps each character's allowance to that character and Bix's ledger to Bix", async () => {
      const first = await makeCharacter();
      const second = await makeCharacter();
      await tradeWithWerner(first.userId, first.characterId, STONE, "buy", 12);
      const other = await tradeWithWerner(second.userId, second.characterId, STONE, "buy", 12);
      expect(other.trade).toMatchObject({ status: "traded", quantity: 12 });
      expect(Object.keys(other.state.merchantDailyPurchases)).toContain(MERCHANT_IDS.wernerLab);
      expect(other.state.merchantDailyPurchases[MERCHANT_IDS.wernerLab]).toEqual({
        [STONE]: { limit: 12, purchased: 12, remaining: 0 },
      });
    });
  });

  describe("uncut gem buybacks", () => {
    it.each([
      [ITEM_IDS.uncutQuartz, 8],
      [ITEM_IDS.uncutTopaz, 18],
      [ITEM_IDS.uncutSapphire, 35],
    ])("pays the player %s at %i Credits each and never sells one", async (itemId, price) => {
      const { userId, characterId } = await makeCharacter({ credits: 0 });
      await give(characterId, itemId, 3);

      const sold = await tradeWithWerner(userId, characterId, itemId, "sell", 3);
      expect(sold.trade).toMatchObject({ status: "traded", quantity: 3, totalCredits: price * 3 });
      expect(await creditsOf(characterId)).toBe(price * 3);
      expect(await carried(characterId, itemId)).toBe(0);

      const retail = await tradeWithWerner(userId, characterId, itemId, "buy", 1);
      expect(retail.trade).toMatchObject({ status: "refused", reason: "not_traded" });
      expect(await carried(characterId, itemId)).toBe(0);
      expect(await creditsOf(characterId)).toBe(price * 3);
    });

    it("refuses to sell more than is carried and anything Werner does not buy", async () => {
      const { userId, characterId } = await makeCharacter({ credits: 0 });
      await give(characterId, ITEM_IDS.uncutQuartz, 1);
      const tooMany = await tradeWithWerner(userId, characterId, ITEM_IDS.uncutQuartz, "sell", 2);
      expect(tooMany.trade).toMatchObject({ status: "refused", reason: "insufficient_items" });
      expect(await carried(characterId, ITEM_IDS.uncutQuartz)).toBe(1);

      await give(characterId, ITEM_IDS.slag, 2);
      const slag = await tradeWithWerner(userId, characterId, ITEM_IDS.slag, "sell", 1);
      expect(slag.trade).toMatchObject({ status: "refused", reason: "not_traded" });
    });

    it("buys Stone back from a character who bought none from him, with no allowance recorded", async () => {
      const { userId, characterId } = await makeCharacter({ credits: 0 });
      await give(characterId, STONE, 4);
      const sold = await tradeWithWerner(userId, characterId, STONE, "sell", 4);
      expect(sold.trade).toMatchObject({ status: "traded", totalCredits: 8 });
      expect(await ledgerRows(characterId)).toHaveLength(0);
    });
  });

  describe("where Werner trades", () => {
    it("trades only while standing at the lab, with nobody to trade with at either neighbour", async () => {
      const { userId, characterId } = await makeCharacter({
        locationId: LOCATION_IDS.prospectingQuarry,
      });
      for (const locationId of [
        LOCATION_IDS.prospectingQuarry,
        LOCATION_IDS.harmonicWorkings,
        LOCATION_IDS.theSurveyLine,
      ]) {
        await move(characterId, locationId);
        const away = await tradeWithWerner(userId, characterId, STONE, "buy", 1);
        expect(away.trade, locationId).toMatchObject({ status: "refused", reason: "no_merchant" });
      }
      expect(await ledgerRows(characterId)).toHaveLength(0);
      await move(characterId, lab);
      const here = await tradeWithWerner(userId, characterId, STONE, "buy", 1);
      expect(here.trade).toMatchObject({ status: "traded" });
    });

    it("exposes Werner's allowance in the projected state before any purchase", async () => {
      const { userId, characterId } = await makeCharacter();
      const state = await play.getPlayGameplayState(
        userId,
        characterId,
        today,
        deterministicRandom,
      );
      expect(state.merchantDailyPurchases[MERCHANT_IDS.wernerLab]).toEqual({
        [STONE]: { limit: 12, purchased: 0, remaining: 12 },
      });
    });
  });

  describe("walking to and from the lab", () => {
    // Every Stillreach leg is the one 40-tick walk (24 seconds).
    const WALK_TICKS = 40;
    const tick = (n: number) => new Date(today.getTime() + n * GAME_TICK_MS);

    it("walks Quarry -> Werner's Lab -> Harmonic Workings and back, in ordinary legs", async () => {
      const { userId, characterId } = await makeCharacter({
        locationId: LOCATION_IDS.prospectingQuarry,
      });
      let elapsed = 0;
      for (const destination of [
        lab,
        LOCATION_IDS.harmonicWorkings,
        lab,
        LOCATION_IDS.prospectingQuarry,
      ]) {
        const begun = await play.beginTravel(userId, characterId, destination, tick(elapsed));
        expect(begun.travelError, destination).toBeUndefined();
        const startedMs = new Date(begun.travelState!.startedAt).getTime();
        const arrivesMs = new Date(begun.travelState!.arrivesAt).getTime();
        expect(arrivesMs - startedMs).toBe(24_000);
        elapsed += WALK_TICKS + 1;
        const arrived = await play.getPlayGameplayState(userId, characterId, tick(elapsed));
        expect(arrived.location.currentLocationId).toBe(destination);
        expect(arrived.travelState).toBeUndefined();
      }
    });

    it("turns back a walk toward the lab to its origin, with no halfway place", async () => {
      const { userId, characterId } = await makeCharacter({
        locationId: LOCATION_IDS.harmonicWorkings,
      });
      await play.beginTravel(userId, characterId, lab, tick(0));
      const turned = await travelCommands.turnBackTravel(userId, characterId, tick(WALK_TICKS / 2));
      expect(turned.travelState).toBeUndefined();
      expect(turned.location.currentLocationId).toBe(LOCATION_IDS.harmonicWorkings);
    });

    it("refuses a walk between the lab and The Survey Line in either direction", async () => {
      const { userId, characterId } = await makeCharacter();
      const out = await play.beginTravel(userId, characterId, LOCATION_IDS.theSurveyLine, tick(0));
      expect(out.travelError).toBe("not_adjacent");
      // A route that skips a leg is refused too: the Landing Station is not adjacent.
      const skip = await play.beginTravel(
        userId,
        characterId,
        LOCATION_IDS.stillreachLandingStation,
        tick(1),
      );
      expect(skip.travelError).toBe("not_adjacent");

      await move(characterId, LOCATION_IDS.theSurveyLine);
      const inward = await play.beginTravel(userId, characterId, lab, tick(2));
      expect(inward.travelError).toBe("not_adjacent");
    });

    it("refuses a walk from Skatboll to the lab", async () => {
      const { userId, characterId } = await makeCharacter({ locationId: LOCATION_IDS.crashSite });
      const forged = await play.beginTravel(userId, characterId, lab, tick(0));
      expect(forged.travelError).toBe("not_adjacent");
    });
  });

  describe("Beginner Echo hunts with Werner's Lab as the ninth target", () => {
    const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach];
    const rolls = (...values: number[]) => {
      const queue = [...values];
      return {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
        nextInteger: (max: number) => {
          const value = queue.shift();
          if (value === undefined) throw new Error("Unexpected random draw");
          if (value >= max) throw new Error(`Draw ${value} outside ${max}`);
          return value;
        },
      };
    };

    async function hunts(characterId: string) {
      return db
        .select()
        .from(rune.characterEchoHunts)
        .where(eq(rune.characterEchoHunts.characterId, characterId));
    }

    async function plantHunt(characterId: string, targetLocationId: string) {
      await db.insert(rune.characterEchoHunts).values({
        characterId,
        planetId: PLANET_IDS.stillreach,
        tier: "beginner",
        targetLocationId,
        startedAt: today,
      });
    }

    async function readFrom(userId: string, characterId: string, from: Date, draws: number[]) {
      const started = await echo.startEchoReading(userId, characterId, from, rolls());
      expect(started.echoReadingError).toBeUndefined();
      const end = new Date(from.getTime() + readingMs);
      const state = await play.getPlayGameplayState(userId, characterId, end, rolls(...draws));
      expect(state.activeAction).toBeUndefined();
      return { state, end };
    }

    it("pool index eight is Werner's Lab and the other eight keep their order", () => {
      expect(pool).toHaveLength(9);
      expect(pool[8]).toBe(lab);
      expect(pool.slice(0, 8)).toEqual([
        LOCATION_IDS.stillreachLandingStation,
        LOCATION_IDS.windwardTrack,
        LOCATION_IDS.hilltopWorkshop,
        LOCATION_IDS.prospectingQuarry,
        LOCATION_IDS.theLowHum,
        LOCATION_IDS.theSurveyLine,
        LOCATION_IDS.theDrySeam,
        LOCATION_IDS.harmonicWorkings,
      ]);
    });

    it("uses a Seeker at the lab to start a hunt whose hidden target can be the lab itself", async () => {
      const { userId, characterId } = await makeCharacter();
      await give(characterId, SEEKER, 2);

      // The ninth draw hides the Echo here, so the very first reading finds it.
      const { state } = await readFrom(userId, characterId, today, [8, 0]);
      expect(state.echoHunt.notice).toMatchObject({ outcome: "found" });
      expect(await carried(characterId, SEEKER)).toBe(1);
      // A discovery ends the hunt.
      expect(await hunts(characterId)).toEqual([]);
    });

    it("points away from the lab with a persistent clue that never names the target", async () => {
      const { userId, characterId } = await makeCharacter();
      await give(characterId, SEEKER, 2);

      // Draw 0 hides the Echo at the Landing Station: north-west of the lab.
      const { state } = await readFrom(userId, characterId, today, [0]);
      const [hunt] = await hunts(characterId);
      expect(hunt).toMatchObject({
        planetId: PLANET_IDS.stillreach,
        targetLocationId: LOCATION_IDS.stillreachLandingStation,
        lastReadingLocationId: lab,
        lastReadingEastWest: "west",
        lastReadingNorthSouth: "north",
      });
      expect(state.echoHunt.lastReading).toMatchObject({
        locationId: lab,
        eastWest: "west",
        northSouth: "north",
        check: { ruledOut: true },
      });
      expect(JSON.stringify(state.echoHunt)).not.toContain(LOCATION_IDS.stillreachLandingStation);
    });

    it("shows a clue taken elsewhere against the lab, read-only and without the target", async () => {
      const { userId, characterId } = await makeCharacter({
        locationId: LOCATION_IDS.prospectingQuarry,
      });
      await give(characterId, SEEKER, 2);

      // Hidden at the lab, read from the Quarry: the lab is one row south of it.
      const { state, end } = await readFrom(userId, characterId, today, [8]);
      expect(state.echoHunt.lastReading).toMatchObject({
        locationId: LOCATION_IDS.prospectingQuarry,
        eastWest: "aligned",
        northSouth: "south",
      });
      expect(JSON.stringify(state.echoHunt)).not.toContain(lab);

      // Standing at the lab is consistent with the clue (not ruled out) and reveals nothing.
      await move(characterId, lab);
      const atLab = await play.getPlayGameplayState(userId, characterId, end, rolls());
      expect(atLab.echoHunt.lastReading?.check).toMatchObject({ ruledOut: false });
      expect(JSON.stringify(atLab.echoHunt)).not.toContain(`"${lab}"`);
      expect((await hunts(characterId))[0]?.targetLocationId).toBe(lab);

      // The Landing Station contradicts it.
      await move(characterId, LOCATION_IDS.stillreachLandingStation);
      const away = await play.getPlayGameplayState(userId, characterId, end, rolls());
      expect(away.echoHunt.lastReading?.check).toMatchObject({ ruledOut: true });
    });

    it("finds an Echo hidden at the lab when the next reading is taken there", async () => {
      const { userId, characterId } = await makeCharacter({
        locationId: LOCATION_IDS.prospectingQuarry,
      });
      await give(characterId, SEEKER, 3);
      const first = await readFrom(userId, characterId, today, [8]);
      expect(first.state.echoHunt.notice).toMatchObject({ outcome: "wrong" });

      await move(characterId, lab);
      const second = await readFrom(userId, characterId, first.end, [0]);
      expect(second.state.echoHunt.notice).toMatchObject({ outcome: "found" });
      expect(await hunts(characterId)).toEqual([]);
    });

    it("keeps a hunt persisted before this release on its original target and clue", async () => {
      const { userId, characterId } = await makeCharacter({
        locationId: LOCATION_IDS.theLowHum,
      });
      await give(characterId, SEEKER, 3);
      // As a hunt created under the eight-site pool would look: target and clue already stored.
      await plantHunt(characterId, LOCATION_IDS.theDrySeam);
      await db
        .update(rune.characterEchoHunts)
        .set({
          lastReadingLocationId: LOCATION_IDS.hilltopWorkshop,
          lastReadingEastWest: "east",
          lastReadingNorthSouth: "south",
          lastReadingAt: today,
        })
        .where(eq(rune.characterEchoHunts.characterId, characterId));

      // Reading it involves no draw at all: the target is never rerolled.
      const { state } = await readFrom(userId, characterId, today, []);
      const [hunt] = await hunts(characterId);
      expect(hunt).toMatchObject({
        targetLocationId: LOCATION_IDS.theDrySeam,
        lastReadingLocationId: LOCATION_IDS.theLowHum,
      });
      expect(state.echoHunt.notice).toMatchObject({ outcome: "wrong" });
      expect(await hunts(characterId)).toHaveLength(1);
    });

    it("leaves Skatboll's ten-location pool and its hunts alone", async () => {
      const { userId, characterId } = await makeCharacter({ locationId: LOCATION_IDS.theJag });
      await give(characterId, SEEKER, 2);
      const skatbollPool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll];
      expect(skatbollPool).toHaveLength(10);
      const target = skatbollPool.indexOf(LOCATION_IDS.crashSite);
      const { state } = await readFrom(userId, characterId, today, [target]);
      expect(state.echoHunt.notice).toMatchObject({ outcome: "wrong" });
      const [hunt] = await hunts(characterId);
      expect(hunt).toMatchObject({
        planetId: PLANET_IDS.skatboll,
        targetLocationId: LOCATION_IDS.crashSite,
      });
      expect(skatbollPool).not.toContain(lab);
    });
  });
});
