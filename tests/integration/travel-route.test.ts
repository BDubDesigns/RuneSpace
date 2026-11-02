import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS, LOCATION_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #450 — Route To, against real PostgreSQL.
 *
 * A route is a chain of ordinary walks. What only a real database can prove:
 * each leg's arrival commits `characters.current_location_id` before the next
 * leg begins, the next leg starts at the previous leg's arrival instant (never
 * at whenever a server looked), an offline return replays every due leg in
 * order to the same state a watching player would have, Turn Back and Stop
 * After This Leg keep their distinct meanings under the arrival-wins lock, and
 * concurrent or repeated commands never add an arrival, a roll, or a reward.
 */
suite("issue #450 Route To (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let travelCommands: typeof import("@/server/travel-commands");
  const createdUsers: string[] = [];
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const WALK_TICKS = getEffectiveGameBalance().travel.adjacentWalkDurationTicks;
  const WALK_MS = WALK_TICKS * GAME_TICK_MS;

  const CRASH = LOCATION_IDS.crashSite;
  const SCRAMBLE = LOCATION_IDS.theLongScramble;
  const JAG = LOCATION_IDS.theJag;

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

  /** Every roll returns 0, so every walking window opens at tick 3; rolls are counted. */
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

  async function makeCharacter(locationId?: string) {
    const userId = await createTestUser(db, authSchema, "Route To Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Route ${userId.slice(0, 6)}`,
    );
    if (locationId) {
      await db
        .update(rune.characters)
        .set({ currentLocationId: locationId })
        .where(eq(rune.characters.id, character.id));
    }
    return { userId, character };
  }

  async function storedLocation(characterId: string) {
    const [row] = await db
      .select({
        locationId: rune.characters.currentLocationId,
        suppressed: rune.characters.scavengeSuppressed,
      })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row;
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

  async function revealsOf(characterId: string) {
    return db
      .select()
      .from(rune.characterScavengeReveals)
      .where(eq(rune.characterScavengeReveals.characterId, characterId));
  }

  async function routeToJag(userId: string, characterId: string, random = countingRandom()) {
    return play.beginRouteTravel(userId, characterId, JAG, startedAt, random);
  }

  describe("per-leg location commits", () => {
    it("plans the shortest legal path and starts its first leg as an ordinary walk", async () => {
      const { userId, character } = await makeCharacter();
      const random = countingRandom();

      const state = await routeToJag(userId, character.id, random);

      expect(state.travelError).toBeUndefined();
      expect(state.location.currentLocationId).toBe(CRASH);
      expect(state.travelState).toMatchObject({
        originLocationId: CRASH,
        destinationLocationId: SCRAMBLE,
        mode: "walk",
        startedAt: startedAt.toISOString(),
        arrivesAt: new Date(startedAt.getTime() + WALK_MS).toISOString(),
        scavengeSuppressed: false,
        route: {
          locationIds: [CRASH, SCRAMBLE, JAG],
          remainingLocationIds: [JAG],
          finalDestinationLocationId: JAG,
        },
      });
      expect(state.travelState?.scavenge).toBeDefined();
      // Exactly the one window roll an ordinary Walk spends at departure.
      expect(random.rolls).toBe(1);
    });

    it("commits B as the stored location before C, then commits C", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      const beforeB = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS - 1),
        countingRandom(),
      );
      expect(beforeB.location.currentLocationId).toBe(CRASH);
      expect((await storedLocation(character.id))?.locationId).toBe(CRASH);

      const atB = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS),
        countingRandom(),
      );
      // B is genuinely the character's location while the second leg walks.
      expect((await storedLocation(character.id))?.locationId).toBe(SCRAMBLE);
      expect(atB.location.currentLocationId).toBe(SCRAMBLE);
      expect(atB.travelState).toMatchObject({
        originLocationId: SCRAMBLE,
        destinationLocationId: JAG,
        startedAt: at(WALK_TICKS).toISOString(),
        arrivesAt: at(WALK_TICKS * 2).toISOString(),
        route: { remainingLocationIds: [], finalDestinationLocationId: JAG },
      });

      const beforeC = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS * 2 - 1),
        countingRandom(),
      );
      expect(beforeC.location.currentLocationId).toBe(SCRAMBLE);

      const atC = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS * 2),
        countingRandom(),
      );
      expect(atC.location.currentLocationId).toBe(JAG);
      expect(atC.travelState).toBeUndefined();
      expect(atC.activeAction).toBeUndefined();
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
    });

    it("starts the next leg at the arrival boundary however late the server looks", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      // Read 15 ticks after leg one arrived: leg two is already 15 ticks in.
      const late = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS + 15),
        countingRandom(),
      );
      expect(late.travelState?.startedAt).toBe(at(WALK_TICKS).toISOString());
      expect(late.travelState?.arrivesAt).toBe(at(WALK_TICKS * 2).toISOString());
      const [action] = (await journeyRows(character.id)).actions;
      expect(action?.startedAt.toISOString()).toBe(at(WALK_TICKS).toISOString());

      // Two legs are 48 seconds of walking: not a tick more, not a tick less.
      const early = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS * 2 - 1),
        countingRandom(),
      );
      expect(early.location.currentLocationId).toBe(SCRAMBLE);
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS * 2),
        countingRandom(),
      );
      expect(done.location.currentLocationId).toBe(JAG);
    });

    it("reaches the same authoritative state offline as a player who watched every leg", async () => {
      const watcher = await makeCharacter();
      const away = await makeCharacter();
      const watcherRandom = countingRandom();
      const awayRandom = countingRandom();
      await play.beginRouteTravel(
        watcher.userId,
        watcher.character.id,
        JAG,
        startedAt,
        watcherRandom,
      );
      await play.beginRouteTravel(away.userId, away.character.id, JAG, startedAt, awayRandom);

      // Watching: a read every few ticks, including both arrival boundaries.
      for (let tick = 5; tick <= WALK_TICKS * 2; tick += 5) {
        await play.getPlayGameplayState(
          watcher.userId,
          watcher.character.id,
          at(tick),
          watcherRandom,
        );
      }
      // The absent player comes back long after both legs.
      const returned = await play.getPlayGameplayState(
        away.userId,
        away.character.id,
        at(WALK_TICKS * 20),
        awayRandom,
      );
      const watched = await play.getPlayGameplayState(
        watcher.userId,
        watcher.character.id,
        at(WALK_TICKS * 20),
        watcherRandom,
      );

      expect(returned.location.currentLocationId).toBe(JAG);
      expect(watched.location.currentLocationId).toBe(JAG);
      expect(returned.travelState).toBeUndefined();
      expect(returned.scavengeSuppressed).toBe(watched.scavengeSuppressed);
      expect(returned.inventory.stacks).toEqual(watched.inventory.stacks);
      // One window roll per leg either way, and no reward for anyone who never claimed.
      expect(awayRandom.rolls).toBe(2);
      expect(watcherRandom.rolls).toBe(2);
      expect(await revealsOf(away.character.id)).toHaveLength(0);
      expect(await revealsOf(watcher.character.id)).toHaveLength(0);
    });

    it("replays every overdue leg in order after an absence past the offline cap", async () => {
      // Stillreach Landing -> The Dry Seam is four legs.
      const { userId, character } = await makeCharacter(LOCATION_IDS.stillreachLandingStation);
      const random = countingRandom();
      const started = await play.beginRouteTravel(
        userId,
        character.id,
        LOCATION_IDS.theDrySeam,
        startedAt,
        random,
      );
      expect(started.travelState?.route?.locationIds).toEqual([
        LOCATION_IDS.stillreachLandingStation,
        LOCATION_IDS.windwardTrack,
        LOCATION_IDS.prospectingQuarry,
        LOCATION_IDS.theSurveyLine,
        LOCATION_IDS.theDrySeam,
      ]);

      // Three hours away: far past the one-hour lazy-resolution cap.
      const returned = await play.getPlayGameplayState(
        userId,
        character.id,
        new Date(startedAt.getTime() + 3 * 60 * 60 * 1000),
        random,
      );
      expect(returned.location.currentLocationId).toBe(LOCATION_IDS.theDrySeam);
      expect(returned.travelState).toBeUndefined();
      expect(random.rolls).toBe(4);
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
    });

    it("stops mid-route on return exactly where the timeline puts the character", async () => {
      const { userId, character } = await makeCharacter(LOCATION_IDS.stillreachLandingStation);
      await play.beginRouteTravel(
        userId,
        character.id,
        LOCATION_IDS.theDrySeam,
        startedAt,
        countingRandom(),
      );

      // Two and a half legs later: two legs committed, the third under way.
      const returned = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS * 2 + WALK_TICKS / 2),
        countingRandom(),
      );
      expect(returned.location.currentLocationId).toBe(LOCATION_IDS.prospectingQuarry);
      expect(returned.travelState).toMatchObject({
        originLocationId: LOCATION_IDS.prospectingQuarry,
        destinationLocationId: LOCATION_IDS.theSurveyLine,
        startedAt: at(WALK_TICKS * 2).toISOString(),
        route: { remainingLocationIds: [LOCATION_IDS.theDrySeam] },
      });
    });
  });

  describe("legal routes", () => {
    it("refuses a destination whose own state is shut and starts nothing", async () => {
      const { userId, character } = await makeCharacter();
      const random = countingRandom();

      const state = await play.beginRouteTravel(
        userId,
        character.id,
        LOCATION_IDS.deepJag,
        startedAt,
        random,
      );

      expect(state.travelError).toBe("route_blocked");
      expect(state.travelState).toBeUndefined();
      expect(random.rolls).toBe(0);
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
    });

    it("refuses another planet's location: no walk crosses worlds", async () => {
      const { userId, character } = await makeCharacter();

      const state = await play.beginRouteTravel(
        userId,
        character.id,
        LOCATION_IDS.stillreachLandingStation,
        startedAt,
        countingRandom(),
      );

      expect(state.travelError).toBe("no_walking_route");
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
    });

    it("refuses the current location and leaves single-hex Walk's adjacency rule as it was", async () => {
      const { userId, character } = await makeCharacter();

      const same = await play.beginRouteTravel(userId, character.id, CRASH, startedAt);
      expect(same.travelError).toBe("same_location");

      // Walk still means one adjacent hex; only Route To plans a path.
      const walk = await play.beginTravel(userId, character.id, JAG, startedAt, countingRandom());
      expect(walk.travelError).toBe("not_adjacent");
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
    });

    it("treats a Route To one leg away as an ordinary Walk", async () => {
      const { userId, character } = await makeCharacter();

      const state = await play.beginRouteTravel(
        userId,
        character.id,
        SCRAMBLE,
        startedAt,
        countingRandom(),
      );

      expect(state.travelState).toMatchObject({ destinationLocationId: SCRAMBLE });
      expect(state.travelState?.route).toBeUndefined();
      const [row] = (await journeyRows(character.id)).travel;
      expect(row?.routeLocationIds).toBeNull();
    });

    it("uses the stable tie-break on Stillreach (Survey Line before Werner's Lab)", async () => {
      const { userId, character } = await makeCharacter(LOCATION_IDS.prospectingQuarry);

      const state = await play.beginRouteTravel(
        userId,
        character.id,
        LOCATION_IDS.harmonicWorkings,
        startedAt,
        countingRandom(),
      );

      expect(state.travelState?.route?.locationIds).toEqual([
        LOCATION_IDS.prospectingQuarry,
        LOCATION_IDS.theSurveyLine,
        LOCATION_IDS.harmonicWorkings,
      ]);
    });
  });

  describe("Turn Back and Stop After This Leg", () => {
    it("Turn Back mid first leg leaves A and ends the whole route", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      const state = await travelCommands.turnBackTravel(userId, character.id, at(10));

      expect(state.location.currentLocationId).toBe(CRASH);
      expect(state.travelState).toBeUndefined();
      expect(state.scavengeSuppressed).toBe(true);
      const later = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS * 5));
      expect(later.location.currentLocationId).toBe(CRASH);
    });

    it("Turn Back mid second leg leaves B, never A, and cancels C", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      const state = await travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS + 10));

      expect(state.location.currentLocationId).toBe(SCRAMBLE);
      expect(state.travelState).toBeUndefined();
      expect(state.scavengeSuppressed).toBe(true);
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
      const later = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS * 5));
      expect(later.location.currentLocationId).toBe(SCRAMBLE);
    });

    it("lets arrival win when Turn Back lands on a leg boundary", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      // Leg one is due: it commits B, leg two begins, and Turn Back cancels that.
      const atBoundary = await travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS));
      expect(atBoundary.location.currentLocationId).toBe(SCRAMBLE);
      expect(atBoundary.travelState).toBeUndefined();
    });

    it("lets the final arrival win: a late Turn Back cannot rewind a committed C", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      const state = await travelCommands.turnBackTravel(
        userId,
        character.id,
        at(WALK_TICKS * 2 + 3),
      );
      expect(state.location.currentLocationId).toBe(JAG);
      expect(state.scavengeSuppressed).toBe(false);
    });

    it("keeps arrival the winner when Turn Back races a due boundary concurrently", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      await Promise.all([
        travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS + 2)),
        play.getPlayGameplayState(userId, character.id, at(WALK_TICKS + 2)),
        travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS + 2)),
      ]);

      expect(await storedLocation(character.id)).toEqual({
        locationId: SCRAMBLE,
        suppressed: true,
      });
      expect(await journeyRows(character.id)).toEqual({ actions: [], travel: [] });
    });

    it("Stop After This Leg arrives at B normally and begins nothing further", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      const stopping = await travelCommands.stopRouteAfterLeg(userId, character.id, at(10));
      // Nothing was cancelled: the same leg is still under way.
      expect(stopping.travelState).toMatchObject({
        originLocationId: CRASH,
        destinationLocationId: SCRAMBLE,
        startedAt: startedAt.toISOString(),
        route: {
          locationIds: [CRASH, SCRAMBLE],
          remainingLocationIds: [],
          finalDestinationLocationId: SCRAMBLE,
        },
      });
      expect(stopping.travelState?.scavenge).toBeDefined();
      expect(stopping.scavengeSuppressed).toBe(false);

      const random = countingRandom();
      const arrived = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS), random);
      expect(arrived.location.currentLocationId).toBe(SCRAMBLE);
      expect(arrived.travelState).toBeUndefined();
      expect(random.rolls).toBe(0);
      // Stopping is a completed walk, not a Turn Back: no suppression.
      expect(arrived.scavengeSuppressed).toBe(false);
      const later = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS * 5));
      expect(later.location.currentLocationId).toBe(SCRAMBLE);
    });

    it("Stop After This Leg that lands after a boundary stops after the leg now under way", async () => {
      const { userId, character } = await makeCharacter(LOCATION_IDS.stillreachLandingStation);
      await play.beginRouteTravel(
        userId,
        character.id,
        LOCATION_IDS.theDrySeam,
        startedAt,
        countingRandom(),
      );

      // Leg one arrived at tick 40; leg two (Track -> Quarry) is under way.
      const stopping = await travelCommands.stopRouteAfterLeg(
        userId,
        character.id,
        at(WALK_TICKS + 1),
      );
      expect(stopping.location.currentLocationId).toBe(LOCATION_IDS.windwardTrack);
      expect(stopping.travelState?.destinationLocationId).toBe(LOCATION_IDS.prospectingQuarry);
      expect(stopping.travelState?.route?.remainingLocationIds).toEqual([]);

      const done = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS * 10));
      expect(done.location.currentLocationId).toBe(LOCATION_IDS.prospectingQuarry);
      expect(done.travelState).toBeUndefined();
    });

    it("is a harmless no-op off a route, after Turn Back, and when repeated", async () => {
      const { userId, character } = await makeCharacter();

      const idle = await travelCommands.stopRouteAfterLeg(userId, character.id, startedAt);
      expect(idle.travelState).toBeUndefined();

      await play.beginTravel(userId, character.id, SCRAMBLE, startedAt, countingRandom());
      const plainWalk = await travelCommands.stopRouteAfterLeg(userId, character.id, at(1));
      expect(plainWalk.travelState).toMatchObject({ destinationLocationId: SCRAMBLE });
      expect(plainWalk.travelState?.route).toBeUndefined();
      await travelCommands.turnBackTravel(userId, character.id, at(2));

      const afterTurnBack = await travelCommands.stopRouteAfterLeg(userId, character.id, at(3));
      expect(afterTurnBack.travelState).toBeUndefined();
      expect(afterTurnBack.location.currentLocationId).toBe(CRASH);

      await play.beginRouteTravel(userId, character.id, JAG, at(4), countingRandom());
      const [first, second] = await Promise.all([
        travelCommands.stopRouteAfterLeg(userId, character.id, at(5)),
        travelCommands.stopRouteAfterLeg(userId, character.id, at(5)),
      ]);
      expect(first.travelState?.route?.locationIds).toEqual([CRASH, SCRAMBLE]);
      expect(second.travelState?.route?.locationIds).toEqual([CRASH, SCRAMBLE]);
    });
  });

  describe("Scavenge on every leg", () => {
    it("offers each leg its own window and only a timely, explicit claim awards it", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);
      const legOneStart = startedAt.toISOString();

      // Leg one's window opens at tick 3 (roll 0) and lasts five ticks.
      const first = await play.claimScavenge(
        userId,
        character.id,
        at(4),
        countingRandom(),
        legOneStart,
      );
      expect(first.scavenge.status).toBe("claimed");
      const repeat = await play.claimScavenge(
        userId,
        character.id,
        at(5),
        countingRandom(),
        legOneStart,
      );
      expect(repeat.scavenge).toMatchObject({ status: "refused", reason: "already_claimed" });

      // Leg two has a fresh window of its own.
      const legTwo = await play.getPlayGameplayState(
        userId,
        character.id,
        at(WALK_TICKS + 1),
        countingRandom(),
      );
      expect(legTwo.travelState?.scavenge?.outcome).toBeUndefined();
      expect(legTwo.travelState?.scavenge?.opensAt).toBe(at(WALK_TICKS + 3).toISOString());

      // A claim still naming leg one is never read against leg two's window.
      const stale = await play.claimScavenge(
        userId,
        character.id,
        at(WALK_TICKS + 4),
        countingRandom(),
        legOneStart,
      );
      expect(stale.scavenge).toMatchObject({ status: "refused", reason: "missed" });
      expect(await revealsOf(character.id)).toHaveLength(1);

      const second = await play.claimScavenge(
        userId,
        character.id,
        at(WALK_TICKS + 4),
        countingRandom(),
        at(WALK_TICKS).toISOString(),
      );
      expect(second.scavenge.status).toBe("claimed");
      expect(await revealsOf(character.id)).toHaveLength(2);
    });

    it("never turns a missed window into a reward, and a refresh rolls nothing new", async () => {
      const { userId, character } = await makeCharacter();
      const departure = countingRandom();
      await routeToJag(userId, character.id, departure);

      const reads = countingRandom();
      for (const tick of [5, 20, 30, WALK_TICKS - 1]) {
        await play.getPlayGameplayState(userId, character.id, at(tick), reads);
      }
      // Reads inside a leg roll nothing; only leg two's departure rolls.
      expect(reads.rolls).toBe(0);
      await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS), reads);
      expect(reads.rolls).toBe(1);

      // Leg one's window is long gone: a late claim cannot reach it.
      const late = await play.claimScavenge(
        userId,
        character.id,
        at(WALK_TICKS + 1),
        countingRandom(),
        startedAt.toISOString(),
      );
      expect(late.scavenge).toMatchObject({ status: "refused", reason: "missed" });
      expect(await revealsOf(character.id)).toHaveLength(0);
    });

    it("keeps #312 suppression on the first leg only, lifted by that leg's arrival", async () => {
      const { userId, character } = await makeCharacter();
      await play.beginTravel(userId, character.id, SCRAMBLE, startedAt, countingRandom());
      await travelCommands.turnBackTravel(userId, character.id, at(1));

      const random = countingRandom();
      const started = await play.beginRouteTravel(userId, character.id, JAG, at(2), random);
      expect(started.travelState?.scavengeSuppressed).toBe(true);
      expect(started.travelState?.scavenge).toBeUndefined();
      expect(random.rolls).toBe(0);

      const legTwo = await play.getPlayGameplayState(
        userId,
        character.id,
        at(2 + WALK_TICKS),
        random,
      );
      expect(legTwo.scavengeSuppressed).toBe(false);
      expect(legTwo.travelState?.scavengeSuppressed).toBe(false);
      expect(legTwo.travelState?.scavenge).toBeDefined();
      expect(random.rolls).toBe(1);
    });
  });

  describe("repeated and concurrent commands", () => {
    it("treats a duplicate Route To as idempotent, before and after a leg boundary", async () => {
      const { userId, character } = await makeCharacter();
      const random = countingRandom();
      await routeToJag(userId, character.id, random);

      const retry = await play.beginRouteTravel(userId, character.id, JAG, at(1), random);
      expect(retry.travelError).toBeUndefined();
      expect(retry.travelState?.startedAt).toBe(startedAt.toISOString());

      const afterBoundary = await play.beginRouteTravel(
        userId,
        character.id,
        JAG,
        at(WALK_TICKS + 1),
        random,
      );
      expect(afterBoundary.travelError).toBeUndefined();
      expect(afterBoundary.travelState?.originLocationId).toBe(SCRAMBLE);
      // Departure plus leg two: the retries rolled nothing.
      expect(random.rolls).toBe(2);
    });

    it("refuses a different destination while routing instead of silently replacing it", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      const other = await play.beginRouteTravel(
        userId,
        character.id,
        LOCATION_IDS.ruskRecovery,
        at(1),
        countingRandom(),
      );
      expect(other.travelError).toBe("already_traveling");
      const walk = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        at(1),
        countingRandom(),
      );
      expect(walk.travelError).toBe("already_traveling");
      expect(walk.travelState?.route?.finalDestinationLocationId).toBe(JAG);
    });

    it("starts exactly one route from concurrent duplicate commands", async () => {
      const { userId, character } = await makeCharacter();
      const random = countingRandom();

      await Promise.all([
        play.beginRouteTravel(userId, character.id, JAG, startedAt, random),
        play.beginRouteTravel(userId, character.id, JAG, startedAt, random),
        play.beginRouteTravel(userId, character.id, JAG, startedAt, random),
      ]);

      const rows = await journeyRows(character.id);
      expect(rows.actions).toHaveLength(1);
      expect(rows.travel).toHaveLength(1);
      expect(random.rolls).toBe(1);
    });

    it("commits each arrival exactly once under concurrent reads at a boundary", async () => {
      const { userId, character } = await makeCharacter();
      await routeToJag(userId, character.id);

      const random = countingRandom();
      const states = await Promise.all(
        Array.from({ length: 4 }, () =>
          play.getPlayGameplayState(userId, character.id, at(WALK_TICKS + 1), random),
        ),
      );

      for (const state of states) {
        expect(state.location.currentLocationId).toBe(SCRAMBLE);
        expect(state.travelState?.startedAt).toBe(at(WALK_TICKS).toISOString());
      }
      // One leg-two departure, however many reads raced to reconcile it.
      expect(random.rolls).toBe(1);
      const rows = await journeyRows(character.id);
      expect(rows.actions).toHaveLength(1);
      expect(rows.travel).toHaveLength(1);
    });

    it("keeps the route under another owner's forged commands untouched", async () => {
      const owner = await makeCharacter();
      const stranger = await makeCharacter();
      await routeToJag(owner.userId, owner.character.id);

      await expect(
        travelCommands.stopRouteAfterLeg(stranger.userId, owner.character.id, at(1)),
      ).rejects.toThrow();
      await expect(
        play.beginRouteTravel(stranger.userId, owner.character.id, JAG, at(1)),
      ).rejects.toThrow();
      const [row] = (await journeyRows(owner.character.id)).travel;
      expect(row?.routeLocationIds).toEqual([CRASH, SCRAMBLE, JAG]);
    });
  });
});
