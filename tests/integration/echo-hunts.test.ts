import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  PLANET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { BEGINNER_ECHO_TARGET_POOLS } from "@/game/content/echo-hunts";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #393 — Beginner Resonance Echo hunts and First Resonance Echo, against
 * real PostgreSQL.
 *
 * What only the database proves: that a reading is one timed action that
 * resolves exactly once — live, on refresh, offline or under a duplicate Use —
 * and consumes exactly one Seeker; that the hidden target is chosen once per
 * planet, persists across travel and never reaches the client; that each
 * planet's hunt and clue are independent; that a discovery ends the hunt, pays
 * 50 Runeworking XP once and keeps or loses its one item against the inventory
 * left after the Seeker; and that the lesson's continuation grants the two
 * Seekers only when they fit, never undoing the lesson, with the in-person offer
 * granting them exactly once afterwards.
 */
suite("issue #393 Beginner Echo hunts (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let echo: typeof import("@/server/echo-hunt-commands");
  let inventory: typeof import("@/server/inventory");
  const createdUsers: string[] = [];
  const start = new Date("2026-10-23T00:00:00.000Z");
  const beginner = getEffectiveGameBalance().echoHunts.beginner;
  const readingMs = beginner.readingDurationTicks * GAME_TICK_MS;
  const at = (ms: number) => new Date(start.getTime() + ms);
  const SEEKER = ITEM_IDS.beginnerEchoSeeker;
  const ECHO = MISSION_IDS.firstResonanceEcho;
  const LESSON = MISSION_IDS.firstRuneworkingLesson;
  const enby = NPC_IDS.wiseOldEnby;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    echo = await import("@/server/echo-hunt-commands");
    inventory = await import("@/server/inventory");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A random whose integer draws are queued; Mining's two draws are irrelevant here. */
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
  const quiet = () => rolls();

  async function makeCharacter(label: string, locationId: string = LOCATION_IDS.hilltopWorkshop) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Echo ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, quiet());
    await move(character.id, locationId);
    return { userId, characterId: character.id };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function give(characterId: string, itemId: string, quantity: number) {
    const [row] = await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId, quantity })
      .returning({ id: rune.inventoryStacks.id });
    return row!.id;
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

  async function seekerStacks(characterId: string) {
    return db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, SEEKER),
        ),
      );
  }

  async function hunts(characterId: string) {
    return db
      .select()
      .from(rune.characterEchoHunts)
      .where(eq(rune.characterEchoHunts.characterId, characterId));
  }

  /** Replace the planet's active hunt with one hidden at `targetLocationId`. */
  async function plantHunt(characterId: string, planetId: string, targetLocationId: string) {
    await db
      .delete(rune.characterEchoHunts)
      .where(
        and(
          eq(rune.characterEchoHunts.characterId, characterId),
          eq(rune.characterEchoHunts.planetId, planetId),
        ),
      );
    await db.insert(rune.characterEchoHunts).values({
      characterId,
      planetId,
      tier: "beginner",
      targetLocationId,
      startedAt: start,
    });
  }

  async function runeworkingXp(characterId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.runeworking),
        ),
      );
    return row?.totalXp ?? 0;
  }

  async function missionRow(characterId: string, missionId: string) {
    const [row] = await db
      .select()
      .from(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, characterId),
          eq(rune.characterMissions.missionId, missionId),
        ),
      );
    return row;
  }

  /** Take one reading from `from`, resolved by a read `readingMs` later. */
  async function read(
    userId: string,
    characterId: string,
    from: Date,
    random: ReturnType<typeof rolls>,
  ) {
    const started = await echo.startEchoReading(userId, characterId, from, quiet());
    expect(started.echoReadingError).toBeUndefined();
    expect(started.activeAction?.actionId).toBe(beginner.readingActionId);
    const end = new Date(from.getTime() + readingMs);
    const state = await play.getPlayGameplayState(userId, characterId, end, random);
    expect(state.activeAction).toBeUndefined();
    return { end, state };
  }

  /** A character with the lesson accepted and its three attunements counted. */
  async function lessonReady(label: string) {
    const made = await makeCharacter(label);
    await db.insert(rune.characterMissions).values([
      {
        characterId: made.characterId,
        missionId: MISSION_IDS.notFromAroundHere,
        acceptedAt: start,
        completedAt: start,
      },
      { characterId: made.characterId, missionId: LESSON, acceptedAt: start },
    ]);
    await db.insert(rune.characterMissionProgress).values({
      characterId: made.characterId,
      missionId: LESSON,
      progressKey: "seekers-attuned",
      progress: 3,
      updatedAt: start,
    });
    return made;
  }

  /**
   * Fill carried slots with real items so exactly `freeSlots` stay free, or —
   * with `massBelow` — fill carried mass, heaviest stack per slot first, until
   * less than `massBelow` grams remain with at least `freeSlots` slots free.
   */
  async function fill(
    userId: string,
    characterId: string,
    options: { freeSlots: number; massBelow?: number },
  ) {
    const state = await play.getPlayGameplayState(userId, characterId, start, quiet());
    let slots = state.inventory.slotsAvailable - options.freeSlots;
    let mass = state.inventory.capacityGrams - state.inventory.massGrams;
    const heavy = [
      ITEM_IDS.motherlodeSlab,
      ITEM_IDS.stone,
      ITEM_IDS.runestone,
      ITEM_IDS.runeFragment,
    ] as const;
    while (slots > 0) {
      if (options.massBelow === undefined) {
        await give(characterId, ITEM_IDS.uncutQuartz, 1);
      } else {
        let best: { itemId: string; quantity: number; grams: number } | undefined;
        for (const itemId of heavy) {
          const definition = getItemDefinition(itemId);
          if (definition?.kind !== "stack") continue;
          const quantity = Math.min(definition.stackLimit, Math.floor(mass / definition.massGrams));
          const grams = quantity * definition.massGrams;
          if (quantity > 0 && grams > (best?.grams ?? 0)) best = { itemId, quantity, grams };
        }
        if (!best) break;
        await give(characterId, best.itemId, best.quantity);
        mass -= best.grams;
      }
      slots -= 1;
    }
    const after = await play.getPlayGameplayState(userId, characterId, start, quiet());
    if (options.massBelow === undefined) {
      expect(after.inventory.slotsAvailable).toBe(options.freeSlots);
    } else {
      expect(after.inventory.slotsAvailable).toBeGreaterThanOrEqual(options.freeSlots);
      expect(after.inventory.capacityGrams - after.inventory.massGrams).toBeLessThan(
        options.massBelow,
      );
    }
    return after;
  }

  describe("one reading", () => {
    it("is one stationary timed action that consumes exactly one Seeker and starts a hunt", async () => {
      const { userId, characterId } = await makeCharacter("Wrong");
      await give(characterId, SEEKER, 3);
      const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach];
      const target = pool.indexOf(LOCATION_IDS.theLowHum);

      const started = await echo.startEchoReading(userId, characterId, start, quiet());
      expect(started.activeAction).toMatchObject({
        actionId: beginner.readingActionId,
        nextAttemptDurationTicks: 8,
        nextAttemptAt: at(readingMs).toISOString(),
      });
      // A retried Use is the same reading, never a second one.
      await echo.startEchoReading(userId, characterId, at(1_000), quiet());
      // Travel and other work cannot overlap it.
      const travel = await play.beginTravel(
        userId,
        characterId,
        LOCATION_IDS.windwardTrack,
        at(1_000),
        quiet(),
      );
      expect(travel.commandError).toBe("another_action_active");
      // Mid-reading nothing has happened yet.
      const mid = await play.getPlayGameplayState(userId, characterId, at(2_000), quiet());
      expect(mid.activeAction?.actionId).toBe(beginner.readingActionId);
      expect(await carried(characterId, SEEKER)).toBe(3);
      expect(await hunts(characterId)).toEqual([]);

      const done = await play.getPlayGameplayState(
        userId,
        characterId,
        at(readingMs),
        rolls(target),
      );
      expect(done.activeAction).toBeUndefined();
      expect(await carried(characterId, SEEKER)).toBe(2);
      const [hunt] = await hunts(characterId);
      expect(hunt).toMatchObject({
        planetId: PLANET_IDS.stillreach,
        targetLocationId: LOCATION_IDS.theLowHum,
        lastReadingLocationId: LOCATION_IDS.hilltopWorkshop,
        lastReadingEastWest: "east",
        lastReadingNorthSouth: "north",
        lastReadingAt: at(readingMs),
      });
      expect(done.echoHunt).toMatchObject({
        searching: { planetId: PLANET_IDS.stillreach, planetName: "Stillreach" },
        lastReading: {
          locationId: LOCATION_IDS.hilltopWorkshop,
          eastWest: "east",
          northSouth: "north",
          check: { ruledOut: true },
        },
        notice: { outcome: "wrong", eastWest: "east", northSouth: "north", xpAwarded: 0 },
      });
      // The hidden target never reaches the client.
      expect(JSON.stringify(done.echoHunt)).not.toContain(LOCATION_IDS.theLowHum);
      expect(await runeworkingXp(characterId)).toBe(0);
      // Re-reading the state resolves nothing again.
      await play.getPlayGameplayState(userId, characterId, at(readingMs * 4), quiet());
      expect(await carried(characterId, SEEKER)).toBe(2);
    });

    it("resolves once after an offline gap, and once under concurrent Use", async () => {
      const { userId, characterId } = await makeCharacter("Offline");
      await give(characterId, SEEKER, 2);
      await plantHunt(characterId, PLANET_IDS.stillreach, LOCATION_IDS.theLowHum);
      await Promise.all([
        echo.startEchoReading(userId, characterId, start, quiet()),
        echo.startEchoReading(userId, characterId, start, quiet()),
      ]);
      // An hour later, one reading has resolved and no target was redrawn.
      await play.getPlayGameplayState(userId, characterId, at(3_600_000), quiet());
      expect(await carried(characterId, SEEKER)).toBe(1);
      expect(await hunts(characterId)).toMatchObject([
        { targetLocationId: LOCATION_IDS.theLowHum },
      ]);
      const notices = await db
        .select()
        .from(rune.echoReadingNotices)
        .where(eq(rune.echoReadingNotices.characterId, characterId));
      expect(notices).toHaveLength(1);
    });

    it("refuses Use without a Seeker, and keeps the reading's Seeker from being dropped", async () => {
      const { userId, characterId } = await makeCharacter("Reserve");
      const none = await echo.startEchoReading(userId, characterId, start, quiet());
      expect(none.echoReadingError).toBe("echo_no_seeker");
      expect(none.activeAction).toBeUndefined();

      const stackId = await give(characterId, SEEKER, 1);
      await echo.startEchoReading(userId, characterId, start, quiet());
      await expect(
        inventory.discardInventoryStack(
          userId,
          characterId,
          { stackId, mode: "one", expectedQuantity: 1 },
          at(1_000),
          quiet(),
        ),
      ).rejects.toThrow(/reading/);
      expect(await carried(characterId, SEEKER)).toBe(1);
    });
  });

  describe("planets", () => {
    it("keeps each planet's hunt and clue apart, across travel", async () => {
      const { userId, characterId } = await makeCharacter("Planets");
      await give(characterId, SEEKER, 5);
      await plantHunt(characterId, PLANET_IDS.skatboll, LOCATION_IDS.theJag);
      await db
        .update(rune.characterEchoHunts)
        .set({
          lastReadingLocationId: LOCATION_IDS.crashSite,
          lastReadingEastWest: "west",
          lastReadingNorthSouth: "south",
          lastReadingAt: start,
        })
        .where(eq(rune.characterEchoHunts.characterId, characterId));
      const stillreachPool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach];
      const { state } = await read(
        userId,
        characterId,
        start,
        rolls(stillreachPool.indexOf(LOCATION_IDS.harmonicWorkings)),
      );
      // On Stillreach only Stillreach's clue shows.
      expect(state.echoHunt.lastReading?.locationId).toBe(LOCATION_IDS.hilltopWorkshop);
      const byPlanet = Object.fromEntries((await hunts(characterId)).map((h) => [h.planetId, h]));
      expect(byPlanet[PLANET_IDS.skatboll]).toMatchObject({
        targetLocationId: LOCATION_IDS.theJag,
        lastReadingLocationId: LOCATION_IDS.crashSite,
      });
      expect(byPlanet[PLANET_IDS.stillreach]).toMatchObject({
        targetLocationId: LOCATION_IDS.harmonicWorkings,
      });
      // Back on Skatboll its own clue is waiting, judged against where the player stands.
      await move(characterId, LOCATION_IDS.holoHollow);
      const skatboll = await play.getPlayGameplayState(userId, characterId, at(60_000), quiet());
      expect(skatboll.echoHunt).toMatchObject({
        searching: { planetId: PLANET_IDS.skatboll },
        lastReading: { locationId: LOCATION_IDS.crashSite, eastWest: "west" },
      });
    });
  });

  describe("a discovery", () => {
    it("ends the hunt, pays 50 once, keeps its one item, and the next Use starts a new hunt", async () => {
      const { userId, characterId } = await makeCharacter("Found");
      await give(characterId, SEEKER, 3);
      await plantHunt(characterId, PLANET_IDS.stillreach, LOCATION_IDS.hilltopWorkshop);
      const { end, state } = await read(userId, characterId, start, rolls(999));
      expect(await hunts(characterId)).toEqual([]);
      expect(await runeworkingXp(characterId)).toBe(50);
      expect(await carried(characterId, ITEM_IDS.runestone)).toBe(1);
      expect(await carried(characterId, SEEKER)).toBe(2);
      expect(state.echoHunt.lastReading).toBeUndefined();
      expect(state.echoHunt.notice).toMatchObject({
        outcome: "found",
        rewardItemId: ITEM_IDS.runestone,
        rewardKept: true,
        xpAwarded: 50,
      });
      // Dismissing the result changes nothing else.
      await echo.acknowledgeEchoReading(userId, characterId, state.echoHunt.notice!.noticeId, end);
      const after = await play.getPlayGameplayState(userId, characterId, end, quiet());
      expect(after.echoHunt.notice).toBeUndefined();
      expect(await runeworkingXp(characterId)).toBe(50);

      const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach];
      await read(userId, characterId, end, rolls(pool.indexOf(LOCATION_IDS.theDrySeam)));
      expect(await hunts(characterId)).toMatchObject([
        { targetLocationId: LOCATION_IDS.theDrySeam },
      ]);
    });

    it("loses only the item when the inventory has no room after the Seeker is gone", async () => {
      const { userId, characterId } = await makeCharacter("Full");
      await give(characterId, SEEKER, 3);
      await fill(userId, characterId, { freeSlots: 0 });
      await plantHunt(characterId, PLANET_IDS.stillreach, LOCATION_IDS.hilltopWorkshop);
      // Draw 0 rolls a Rune Fragment: no slot, no partial Fragment stack.
      const { state } = await read(userId, characterId, start, rolls(0));
      expect(await carried(characterId, ITEM_IDS.runeFragment)).toBe(0);
      expect(await carried(characterId, SEEKER)).toBe(2);
      expect(await runeworkingXp(characterId)).toBe(50);
      expect(await hunts(characterId)).toEqual([]);
      expect(state.echoHunt.notice).toMatchObject({
        outcome: "found",
        rewardItemId: ITEM_IDS.runeFragment,
        rewardKept: false,
      });
    });

    it("keeps the item in the slot the last Seeker freed", async () => {
      const { userId, characterId } = await makeCharacter("Freed");
      await give(characterId, SEEKER, 1);
      await fill(userId, characterId, { freeSlots: 0 });
      await plantHunt(characterId, PLANET_IDS.stillreach, LOCATION_IDS.hilltopWorkshop);
      await read(userId, characterId, start, rolls(0));
      expect(await carried(characterId, SEEKER)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.runeFragment)).toBe(1);
    });
  });

  describe("First Resonance Echo", () => {
    const completeLesson = (userId: string, characterId: string, when = start) =>
      missions.completeMission(userId, characterId, LESSON, enby, when, quiet());
    const acceptEcho = (userId: string, characterId: string, when = start) =>
      missions.acceptMission(userId, characterId, ECHO, enby, when, quiet());
    const completeEcho = (userId: string, characterId: string, when = start) =>
      missions.completeMission(userId, characterId, ECHO, enby, when, quiet());

    it("continues from the lesson with exactly two Seekers, topping three up to five", async () => {
      const { userId, characterId } = await lessonReady("Gift");
      await give(characterId, SEEKER, 3);
      const done = await completeLesson(userId, characterId);
      expect(done.mission).toMatchObject({
        status: "completed",
        continuation: { missionId: ECHO, status: "accepted" },
      });
      expect(await runeworkingXp(characterId)).toBe(150);
      expect(await seekerStacks(characterId)).toEqual([{ quantity: 5 }]);
      expect(await missionRow(characterId, ECHO)).toMatchObject({ completedAt: null });
      // A replayed turn-in pays and grants nothing more.
      const again = await completeLesson(userId, characterId);
      expect(again.mission.status).toBe("already_completed");
      expect(again.mission).not.toHaveProperty("continuation");
      expect(await carried(characterId, SEEKER)).toBe(5);
      expect(await runeworkingXp(characterId)).toBe(150);
      // Accepted: the in-person offer is gone and cannot grant more.
      expect((await acceptEcho(userId, characterId)).mission.status).toBe("already_accepted");
      expect(await carried(characterId, SEEKER)).toBe(5);
    });

    for (const reason of ["slots", "mass"] as const) {
      it(`completes the lesson without the Mission when two Seekers do not fit (${reason}), then grants them once in person`, async () => {
        const { userId, characterId } = await lessonReady(`No room ${reason}`);
        await fill(
          userId,
          characterId,
          reason === "slots" ? { freeSlots: 0 } : { freeSlots: 1, massBelow: 400 },
        );
        const done = await completeLesson(userId, characterId);
        expect(done.mission).toMatchObject({
          status: "completed",
          continuation: { missionId: ECHO, status: "capacity_refused", capacityReason: reason },
        });
        expect(await missionRow(characterId, LESSON)).toMatchObject({ completedAt: start });
        expect(await runeworkingXp(characterId)).toBe(150);
        expect(await missionRow(characterId, ECHO)).toBeUndefined();
        expect(await carried(characterId, SEEKER)).toBe(0);

        // Still no room: refused again, nothing granted, nothing accepted.
        const refused = await acceptEcho(userId, characterId);
        expect(refused.mission).toMatchObject({
          status: "refused",
          reason: "capacity",
          capacityReason: reason,
        });
        expect(await missionRow(characterId, ECHO)).toBeUndefined();

        // Make room, then two concurrent accepts grant exactly two Seekers.
        await db
          .delete(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, characterId));
        const results = await Promise.all([
          acceptEcho(userId, characterId),
          acceptEcho(userId, characterId),
        ]);
        expect(results.map((result) => result.mission.status).sort()).toEqual([
          "accepted",
          "already_accepted",
        ]);
        expect(await carried(characterId, SEEKER)).toBe(2);
      });
    }

    it("offers itself to a character who finished the lesson before it existed", async () => {
      const { userId, characterId } = await lessonReady("Earlier");
      await db
        .update(rune.characterMissions)
        .set({ completedAt: start })
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, LESSON),
          ),
        );
      const state = await play.getPlayGameplayState(userId, characterId, start, quiet());
      const offer = state.missions.find((mission) => mission.missionId === ECHO)!;
      expect(offer.state).toBe("not_accepted");
      expect(offer.guidance).toEqual({ availableNpcIds: [enby] });
      expect((await acceptEcho(userId, characterId)).mission.status).toBe("accepted");
      expect(await carried(characterId, SEEKER)).toBe(2);
    });

    it("counts only a discovery after acceptance, then pays 300 once at the Enby", async () => {
      const { userId, characterId } = await lessonReady("Hunt");
      await completeLesson(userId, characterId);
      // A discovery made BEFORE acceptance would not count: prove the inverse —
      // a wrong reading after acceptance leaves 0/1.
      await plantHunt(characterId, PLANET_IDS.stillreach, LOCATION_IDS.theLowHum);
      const wrong = await read(userId, characterId, start, quiet());
      const zero = wrong.state.missions.find((mission) => mission.missionId === ECHO)!;
      expect(zero.requirements?.[0]).toMatchObject({ progress: { current: 0, target: 1 } });
      expect((await completeEcho(userId, characterId, wrong.end)).mission.status).toBe("refused");

      // Found on Skatboll — either planet counts.
      await move(characterId, LOCATION_IDS.theJag);
      await plantHunt(characterId, PLANET_IDS.skatboll, LOCATION_IDS.theJag);
      const found = await read(userId, characterId, wrong.end, rolls(0));
      const one = found.state.missions.find((mission) => mission.missionId === ECHO)!;
      expect(one.requirements?.[0]).toMatchObject({ satisfied: true });
      expect(one.currentObjective).toBe("Return to the Wise Old Enby at Hilltop Workshop");
      // Never completed by the discovery itself, nor away from the Enby.
      expect(await missionRow(characterId, ECHO)).toMatchObject({ completedAt: null });
      expect((await completeEcho(userId, characterId, found.end)).mission.status).toBe("refused");

      await move(characterId, LOCATION_IDS.hilltopWorkshop);
      const xpBefore = await runeworkingXp(characterId);
      expect(xpBefore).toBe(150 + 50);
      const results = await Promise.all([
        completeEcho(userId, characterId, found.end),
        completeEcho(userId, characterId, found.end),
      ]);
      expect(results.map((result) => result.mission.status).sort()).toEqual([
        "already_completed",
        "completed",
      ]);
      expect(await runeworkingXp(characterId)).toBe(xpBefore + 300);

      // Hunting goes on: a later discovery pays 50 only.
      // Both gifted Seekers are spent; any Seeker will do.
      await give(characterId, SEEKER, 1);
      await plantHunt(characterId, PLANET_IDS.stillreach, LOCATION_IDS.hilltopWorkshop);
      await read(userId, characterId, found.end, rolls(0));
      expect(await runeworkingXp(characterId)).toBe(xpBefore + 300 + 50);
    });

    it("does not back-credit a discovery made before acceptance", async () => {
      const { userId, characterId } = await lessonReady("Before");
      await fill(userId, characterId, { freeSlots: 0 });
      await completeLesson(userId, characterId);
      expect(await missionRow(characterId, ECHO)).toBeUndefined();
      // A discovery while the Mission is not accepted is a valid hunt, but credits nothing.
      await db
        .delete(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, characterId));
      await give(characterId, SEEKER, 1);
      await plantHunt(characterId, PLANET_IDS.stillreach, LOCATION_IDS.hilltopWorkshop);
      await read(userId, characterId, start, rolls(0));
      expect(await runeworkingXp(characterId)).toBe(150 + 50);
      const accepted = await acceptEcho(userId, characterId, at(readingMs));
      expect(accepted.mission.status).toBe("accepted");
      const projection = accepted.state.missions.find((mission) => mission.missionId === ECHO)!;
      expect(projection.requirements?.[0]).toMatchObject({
        satisfied: false,
        progress: { current: 0, target: 1 },
      });
    });
  });
});
