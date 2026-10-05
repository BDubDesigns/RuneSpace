import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #312 — Turn Back, against real PostgreSQL.
 *
 * The rules a browser or a pure unit test cannot prove: that cancellation
 * resolves Travel under the character lock first so arrival always wins the
 * race, that cancelling a walk durably suppresses Scavenge until a walk is
 * actually completed (so Turn Back is no way to reroll the random window), that
 * a claimed reward stays committed while an unclaimed one vanishes, and that a
 * ride is cancelled without a refund and without touching that suppression.
 */
suite("issue #312 Turn Back (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let travelCommands: typeof import("@/server/travel-commands");
  const createdUsers: string[] = [];
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const WALK_TICKS = balance.travel.adjacentWalkDurationTicks;
  const RIDE_TICKS = balance.travel.crewHaulerDurationTicks;
  const rewardRandom = { nextBasisPoints: () => 3_000, nextUnit: () => 0 };

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    travelCommands = await import("@/server/travel-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A roll source that records how often Travel asked it for a Scavenge window. */
  function countingRandom() {
    const random = {
      rolls: 0,
      nextBasisPoints() {
        random.rolls += 1;
        return 0;
      },
      nextUnit: () => 0,
    };
    return random;
  }

  const at = (tick: number) => new Date(startedAt.getTime() + tick * GAME_TICK_MS);

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Turn Back Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `TurnBack ${userId.slice(0, 6)}`,
    );
    return { userId, character };
  }

  async function walkFrom(userId: string, characterId: string, random = countingRandom()) {
    return play.beginTravel(
      userId,
      characterId,
      LOCATION_IDS.abandonedProcessingYard,
      startedAt,
      random,
    );
  }

  async function suppressionOf(characterId: string) {
    const [row] = await db
      .select({ suppressed: rune.characters.scavengeSuppressed })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row?.suppressed;
  }

  async function journeyRows(characterId: string) {
    const [actions, travel] = await Promise.all([
      db.select().from(rune.activeActions).where(eq(rune.activeActions.characterId, characterId)),
      db
        .select()
        .from(rune.characterTravelState)
        .where(eq(rune.characterTravelState.characterId, characterId)),
    ]);
    return { actions, travel };
  }

  describe("walking", () => {
    it("ends a fresh walk at the origin with no halfway place and no return trip", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);

      const state = await travelCommands.turnBackTravel(userId, character.id, at(1));

      expect(state.travelState).toBeUndefined();
      expect(state.activeAction).toBeUndefined();
      expect(state.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });

      // Nothing left over to arrive somewhere later.
      const later = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS * 3));
      expect(later.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
      expect(later.travelState).toBeUndefined();
    });

    it("restores ordinary stationary interactions at the origin straight away", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);
      await travelCommands.turnBackTravel(userId, character.id, at(1));

      const again = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.abandonedProcessingYard,
        at(2),
        countingRandom(),
      );
      expect(again.travelError).toBeUndefined();
      expect(again.travelState?.originLocationId).toBe(LOCATION_IDS.crashSite);
    });

    it("cancels late in the walk while arrival has still not committed", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);

      const state = await travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS - 1));

      expect(state.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
      expect(state.travelState).toBeUndefined();
      expect(state.scavengeSuppressed).toBe(true);
    });

    it("lets arrival win: a Turn Back that lands after arrival is due cannot send anyone home", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);

      const state = await travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS));

      expect(state.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
      expect(state.travelState).toBeUndefined();
      // Arriving is a completed walk, not a cancelled one.
      expect(state.scavengeSuppressed).toBe(false);
      expect(await suppressionOf(character.id)).toBe(false);
    });

    it("keeps arrival the winner when Turn Back races a due arrival concurrently", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);

      await Promise.all([
        travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS + 5)),
        play.getPlayGameplayState(userId, character.id, at(WALK_TICKS + 5)),
        travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS + 5)),
      ]);

      const [row] = await db
        .select({
          locationId: rune.characters.currentLocationId,
          suppressed: rune.characters.scavengeSuppressed,
        })
        .from(rune.characters)
        .where(eq(rune.characters.id, character.id));
      expect(row).toEqual({
        locationId: LOCATION_IDS.abandonedProcessingYard,
        suppressed: false,
      });
    });

    it("is harmless when retried or forged while not traveling", async () => {
      const { userId, character } = await makeCharacter();

      const idle = await travelCommands.turnBackTravel(userId, character.id, startedAt);
      expect(idle.travelState).toBeUndefined();
      expect(idle.scavengeSuppressed).toBe(false);
      expect(idle.location.currentLocationId).toBe(LOCATION_IDS.crashSite);

      await walkFrom(userId, character.id);
      const [first, second] = await Promise.all([
        travelCommands.turnBackTravel(userId, character.id, at(2)),
        travelCommands.turnBackTravel(userId, character.id, at(2)),
      ]);
      expect(first.travelState).toBeUndefined();
      expect(second.travelState).toBeUndefined();
      expect(await suppressionOf(character.id)).toBe(true);
      const retry = await travelCommands.turnBackTravel(userId, character.id, at(3));
      expect(retry.scavengeSuppressed).toBe(true);
      expect(retry.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
    });

    it("refuses a character the caller does not own", async () => {
      const owner = await makeCharacter();
      const stranger = await makeCharacter();
      await walkFrom(owner.userId, owner.character.id);

      await expect(
        travelCommands.turnBackTravel(stranger.userId, owner.character.id, at(1)),
      ).rejects.toThrow();
      expect((await journeyRows(owner.character.id)).travel).toHaveLength(1);
    });
  });

  describe("Scavenge suppression", () => {
    it("is set even when the opportunity had not appeared yet", async () => {
      const { userId, character } = await makeCharacter();
      const started = await walkFrom(userId, character.id);
      expect(started.travelState?.scavenge).toBeDefined();
      expect(started.scavengeSuppressed).toBe(false);

      // Tick 1 is before the earliest possible window (tick 3).
      const state = await travelCommands.turnBackTravel(userId, character.id, at(1));
      expect(state.scavengeSuppressed).toBe(true);
      expect(await suppressionOf(character.id)).toBe(true);
    });

    it("gives a later walk no window, spends no roll, and refuses a forged claim", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);
      await travelCommands.turnBackTravel(userId, character.id, at(1));

      const random = countingRandom();
      const second = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.abandonedProcessingYard,
        at(2),
        random,
      );
      expect(second.travelState).toMatchObject({ mode: "walk", scavengeSuppressed: true });
      expect(second.travelState?.scavenge).toBeUndefined();
      expect(random.rolls).toBe(0);
      const [row] = (await journeyRows(character.id)).travel;
      expect(row?.scavengeOpportunityStartTick).toBeNull();

      // Even deep into the walk, where a window would have been open.
      const claim = await play.claimScavenge(userId, character.id, at(2 + 10), rewardRandom);
      expect(claim.scavenge).toMatchObject({ status: "refused", reason: "scavenge_suppressed" });
      expect(
        await db
          .select()
          .from(rune.characterScavengeReveals)
          .where(eq(rune.characterScavengeReveals.characterId, character.id)),
      ).toHaveLength(0);
    });

    it("is not cleared by starting and cancelling more walks, and survives a fresh read", async () => {
      const { userId, character } = await makeCharacter();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await play.beginTravel(
          userId,
          character.id,
          LOCATION_IDS.abandonedProcessingYard,
          at(attempt * 10),
          countingRandom(),
        );
        await travelCommands.turnBackTravel(userId, character.id, at(attempt * 10 + 1));
        expect(await suppressionOf(character.id)).toBe(true);
      }
      // Every read is a fresh load of the character: there is no client latch.
      const reloaded = await play.getPlayGameplayState(userId, character.id, at(100));
      expect(reloaded.scavengeSuppressed).toBe(true);
    });

    it("clears only when a walking Journey arrives, after which a walk offers Scavenge again", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);
      await travelCommands.turnBackTravel(userId, character.id, at(1));

      await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.abandonedProcessingYard,
        at(2),
        countingRandom(),
      );
      const arrived = await play.getPlayGameplayState(userId, character.id, at(2 + WALK_TICKS));
      expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
      expect(arrived.scavengeSuppressed).toBe(false);

      const next = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.crashSite,
        at(100),
        countingRandom(),
      );
      expect(next.travelState?.scavengeSuppressed).toBe(false);
      expect(next.travelState?.scavenge).toBeDefined();
    });

    it("discards an unclaimed opportunity with the Journey", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);

      // Tick 4: the earliest window (tick 3) is open and unclaimed.
      const state = await travelCommands.turnBackTravel(userId, character.id, at(4));
      expect(state.scavengeSuppressed).toBe(true);
      expect(state.travelState).toBeUndefined();

      const claim = await play.claimScavenge(userId, character.id, at(4), rewardRandom);
      expect(claim.scavenge).toMatchObject({ status: "refused", reason: "no_travel" });
      expect(
        await db
          .select()
          .from(rune.characterScavengeReveals)
          .where(eq(rune.characterScavengeReveals.characterId, character.id)),
      ).toHaveLength(0);
    });

    it("keeps a claimed reward and reveal committed while still suppressing", async () => {
      const { userId, character } = await makeCharacter();
      await walkFrom(userId, character.id);
      const claim = await play.claimScavenge(userId, character.id, at(4), rewardRandom);
      expect(claim.scavenge.status).toBe("claimed");
      const stacksBefore = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id));

      const state = await travelCommands.turnBackTravel(userId, character.id, at(5));

      expect(state.scavengeSuppressed).toBe(true);
      expect(state.scavengeReveals).toHaveLength(1);
      expect(
        await db
          .select()
          .from(rune.characterScavengeReveals)
          .where(eq(rune.characterScavengeReveals.characterId, character.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, character.id)),
      ).toEqual(stacksBefore);
    });
  });

  describe("Crew Hauler", () => {
    async function rider(credits = 10) {
      const { userId, character } = await makeCharacter();
      await db.insert(rune.characterMissions).values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
          MISSION_IDS.outOfTheWeather,
        ].map((missionId) => ({
          characterId: character.id,
          missionId,
          acceptedAt: startedAt,
          completedAt: startedAt,
        })),
      );
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollow, credits })
        .where(eq(rune.characters.id, character.id));
      return { userId, character };
    }

    async function creditsOf(characterId: string) {
      const [row] = await db
        .select({ credits: rune.characters.credits })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId));
      return row?.credits;
    }

    it("cancels immediately at the origin, keeps the fare spent, and creates no suppression", async () => {
      const { userId, character } = await rider(10);
      const boarded = await play.beginTransportTravel(
        userId,
        character.id,
        LOCATION_IDS.theJag,
        startedAt,
      );
      expect(boarded.travelState?.mode).toBe("crew_hauler");
      expect(await creditsOf(character.id)).toBe(5);

      const state = await travelCommands.turnBackTravel(userId, character.id, at(3));

      expect(state.travelState).toBeUndefined();
      expect(state.location.currentLocationId).toBe(LOCATION_IDS.holoHollow);
      expect(state.scavengeSuppressed).toBe(false);
      expect(await suppressionOf(character.id)).toBe(false);
      expect(await creditsOf(character.id)).toBe(5);
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
    });

    it("lets arrival win a ride too", async () => {
      const { userId, character } = await rider(10);
      await play.beginTransportTravel(userId, character.id, LOCATION_IDS.theJag, startedAt);

      const state = await travelCommands.turnBackTravel(userId, character.id, at(RIDE_TICKS));

      expect(state.location.currentLocationId).toBe(LOCATION_IDS.theJag);
      expect(await creditsOf(character.id)).toBe(5);
    });

    it("neither cancelling nor completing a ride clears an existing walking suppression", async () => {
      const { userId, character } = await rider(20);
      await db
        .update(rune.characters)
        .set({ scavengeSuppressed: true })
        .where(eq(rune.characters.id, character.id));

      await play.beginTransportTravel(userId, character.id, LOCATION_IDS.theJag, startedAt);
      await travelCommands.turnBackTravel(userId, character.id, at(2));
      expect(await suppressionOf(character.id)).toBe(true);

      await play.beginTransportTravel(userId, character.id, LOCATION_IDS.theJag, at(10));
      const arrived = await play.getPlayGameplayState(userId, character.id, at(10 + RIDE_TICKS));
      expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.theJag);
      expect(arrived.scavengeSuppressed).toBe(true);
    });
  });
});
