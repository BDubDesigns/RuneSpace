import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS, PLANET_IDS } from "@/game/config/foundations";
import { BEGINNER_ECHO_TARGET_POOLS } from "@/game/content/echo-hunts";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #491, slice 1 — the Holo Drive-In World Location against real PostgreSQL.
 *
 * What only the server proves: that an ordinary walk works between Holo Hollow and the
 * Drive-In and is refused to and from the two hexes it merely touches (and from other
 * places), and that a Beginner Echo hunt can be hidden at and found at the Drive-In while
 * a hunt persisted before this release keeps the target it already had. No migration
 * backs any of it: every assertion runs on the existing schema.
 */
suite("issue #491 Holo Drive-In (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let echo: typeof import("@/server/echo-hunt-commands");
  let travelCommands: typeof import("@/server/travel-commands");
  const createdUsers: string[] = [];
  const deterministicRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

  const today = new Date("2026-11-06T18:00:00.000Z");
  const driveIn = LOCATION_IDS.holoDriveIn;
  const beginner = getEffectiveGameBalance().echoHunts.beginner;
  const readingMs = beginner.readingDurationTicks * GAME_TICK_MS;
  const SEEKER = ITEM_IDS.beginnerEchoSeeker;
  const tick = (n: number) => new Date(today.getTime() + n * GAME_TICK_MS);
  // Comfortably longer than any single Skatboll walking leg.
  const LEG_TICKS = 400;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    echo = await import("@/server/echo-hunt-commands");
    travelCommands = await import("@/server/travel-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A brand-new character who has completed and accepted nothing at all. */
  async function makeCharacter(locationId: string) {
    const userId = await createTestUser(db, authSchema, "Drive-In Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Drive ${userId.slice(0, 8)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, today, deterministicRandom);
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  describe("walking to and from the Drive-In", () => {
    it("walks Holo Hollow -> Holo Drive-In -> Holo Hollow, in ordinary legs, with no gate", async () => {
      const { userId, characterId } = await makeCharacter(LOCATION_IDS.holoHollow);
      let elapsed = 0;
      for (const destination of [driveIn, LOCATION_IDS.holoHollow]) {
        const begun = await play.beginTravel(userId, characterId, destination, tick(elapsed));
        expect(begun.travelError, destination).toBeUndefined();
        expect(begun.travelState).toBeDefined();
        elapsed += LEG_TICKS;
        const arrived = await play.getPlayGameplayState(userId, characterId, tick(elapsed));
        expect(arrived.location.currentLocationId).toBe(destination);
        expect(arrived.travelState).toBeUndefined();
        elapsed += 1;
      }
    });

    it("takes the same time as any other Holo Hollow walking leg", async () => {
      const { userId, characterId } = await makeCharacter(LOCATION_IDS.holoHollow);
      const toDriveIn = await play.beginTravel(userId, characterId, driveIn, tick(0));
      const duration = (begun: typeof toDriveIn) =>
        new Date(begun.travelState!.arrivesAt).getTime() -
        new Date(begun.travelState!.startedAt).getTime();
      await travelCommands.turnBackTravel(userId, characterId, tick(1));
      const toYard = await play.beginTravel(
        userId,
        characterId,
        LOCATION_IDS.ruskRecovery,
        tick(2),
      );
      expect(toYard.travelError).toBeUndefined();
      expect(duration(toDriveIn)).toBe(duration(toYard));
    });

    it("turns back a walk toward the Drive-In to its origin, with no halfway place", async () => {
      const { userId, characterId } = await makeCharacter(LOCATION_IDS.holoHollow);
      await play.beginTravel(userId, characterId, driveIn, tick(0));
      const turned = await travelCommands.turnBackTravel(userId, characterId, tick(1));
      expect(turned.travelState).toBeUndefined();
      expect(turned.location.currentLocationId).toBe(LOCATION_IDS.holoHollow);
    });

    it("refuses a walk between the Drive-In and the two hexes it merely touches", async () => {
      const { userId, characterId } = await makeCharacter(driveIn);
      for (const [index, touching] of [
        LOCATION_IDS.emergencyPowerAnnex,
        LOCATION_IDS.ruskRecovery,
      ].entries()) {
        await move(characterId, driveIn);
        const outward = await play.beginTravel(userId, characterId, touching, tick(index));
        expect(outward.travelError, touching).toBe("not_adjacent");
        await move(characterId, touching);
        const inward = await play.beginTravel(userId, characterId, driveIn, tick(index + 10));
        expect(inward.travelError, touching).toBe("not_adjacent");
      }
    });

    it("refuses a walk to the Drive-In from anywhere that is not Holo Hollow", async () => {
      for (const origin of [
        LOCATION_IDS.crashSite,
        LOCATION_IDS.holoHollowLanding,
        LOCATION_IDS.theJag,
      ]) {
        const { userId, characterId } = await makeCharacter(origin);
        const forged = await play.beginTravel(userId, characterId, driveIn, tick(0));
        expect(forged.travelError, origin).toBe("not_adjacent");
      }
    });
  });

  describe("Beginner Echo hunts with the Holo Drive-In as the eleventh Skatboll target", () => {
    const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll];
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

    async function give(characterId: string, itemId: string, quantity: number) {
      await db.insert(rune.inventoryStacks).values({
        characterId,
        itemId,
        quantity,
        createdAt: today,
        updatedAt: today,
      });
    }

    async function hunts(characterId: string) {
      return db
        .select()
        .from(rune.characterEchoHunts)
        .where(eq(rune.characterEchoHunts.characterId, characterId));
    }

    async function readFrom(userId: string, characterId: string, from: Date, draws: number[]) {
      const started = await echo.startEchoReading(userId, characterId, from, rolls());
      expect(started.echoReadingError).toBeUndefined();
      const end = new Date(from.getTime() + readingMs);
      const state = await play.getPlayGameplayState(userId, characterId, end, rolls(...draws));
      expect(state.activeAction).toBeUndefined();
      return { state, end };
    }

    it("is the eleventh and last pool entry, after the ten that kept their order", () => {
      expect(pool).toHaveLength(11);
      expect(pool[10]).toBe(driveIn);
      expect(pool.slice(0, 10)).toEqual([
        LOCATION_IDS.crashSite,
        LOCATION_IDS.abandonedProcessingYard,
        LOCATION_IDS.emergencyPowerAnnex,
        LOCATION_IDS.theLongScramble,
        LOCATION_IDS.theJag,
        LOCATION_IDS.holoHollow,
        LOCATION_IDS.ruskRecovery,
        LOCATION_IDS.southAccessTrack,
        LOCATION_IDS.theSouthCut,
        LOCATION_IDS.holoHollowLanding,
      ]);
      expect(pool).not.toContain(LOCATION_IDS.deepJag);
    });

    it("hides an Echo at the Drive-In, rules it out from elsewhere and finds it on arrival", async () => {
      const { userId, characterId } = await makeCharacter(LOCATION_IDS.holoHollow);
      await give(characterId, SEEKER, 3);

      // Draw index 10: the Drive-In. A reading from Holo Hollow is a clue, not a find.
      const first = await readFrom(userId, characterId, today, [pool.indexOf(driveIn)]);
      expect(first.state.echoHunt.notice).toMatchObject({ outcome: "wrong" });
      const [hunt] = await hunts(characterId);
      expect(hunt).toMatchObject({
        planetId: PLANET_IDS.skatboll,
        targetLocationId: driveIn,
        lastReadingLocationId: LOCATION_IDS.holoHollow,
      });
      // Standing at Holo Hollow, the Drive-In is due north: the same column, one row up.
      expect(first.state.echoHunt.lastReading).toMatchObject({
        locationId: LOCATION_IDS.holoHollow,
        eastWest: "aligned",
        northSouth: "north",
      });
      expect(JSON.stringify(first.state.echoHunt)).not.toContain(driveIn);

      // Walk there and take the next reading: the hunt is found and cleared.
      await move(characterId, driveIn);
      const second = await readFrom(userId, characterId, first.end, [0]);
      expect(second.state.echoHunt.notice).toMatchObject({ outcome: "found" });
      expect(await hunts(characterId)).toEqual([]);
    });

    it("keeps a hunt persisted before this release on its original target", async () => {
      const { userId, characterId } = await makeCharacter(LOCATION_IDS.crashSite);
      await give(characterId, SEEKER, 3);
      // As a hunt created under the ten-site pool would look: target already stored.
      await db.insert(rune.characterEchoHunts).values({
        characterId,
        planetId: PLANET_IDS.skatboll,
        tier: "beginner",
        targetLocationId: LOCATION_IDS.theJag,
        startedAt: today,
      });

      // Reading it involves no draw at all: the target is never rerolled.
      const started = await echo.startEchoReading(userId, characterId, today, rolls());
      expect(started.echoReadingError).toBeUndefined();
      await play.getPlayGameplayState(
        userId,
        characterId,
        new Date(today.getTime() + readingMs),
        rolls(),
      );
      const [hunt] = await hunts(characterId);
      expect(hunt).toMatchObject({ targetLocationId: LOCATION_IDS.theJag });
    });
  });
});
