import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTION_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #40 persistent locations and timed travel (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let resolution: typeof import("@/server/action-resolution");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    resolution = await import("@/server/action-resolution");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Travel Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Travel ${userId.slice(0, 6)}`,
    );
    return { userId, character };
  }

  it("provisions every character at the Crash Site with no travel state", async () => {
    const { character } = await makeCharacter();
    const rows = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(rows[0]?.currentLocationId).toBe(LOCATION_IDS.crashSite);
    await expect(
      db
        .select()
        .from(rune.characterTravelState)
        .where(eq(rune.characterTravelState.characterId, character.id)),
    ).resolves.toEqual([]);
  });

  it("enforces ownership when beginning travel", async () => {
    const { character } = await makeCharacter();
    const outsider = await makeCharacter();
    await expect(
      play.beginTravel(outsider.userId, character.id, LOCATION_IDS.abandonedProcessingYard),
    ).rejects.toThrow(/not found/i);
  });

  it("begins travel from the Crash Site while idle and keeps the origin until arrival", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const state = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      startedAt,
    );
    expect(state.travelState).toMatchObject({
      originLocationId: LOCATION_IDS.crashSite,
      destinationLocationId: LOCATION_IDS.abandonedProcessingYard,
    });
    const rows = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(rows[0]?.currentLocationId).toBe(LOCATION_IDS.crashSite);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);
    const travelRows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(travelRows).toHaveLength(1);
  });

  it("replaces active Mining atomically, resolving only completed work once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    await play.getPlayGameplayState(userId, character.id, startedAt, random);
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, character.id));
    await miningCommands.startFerriteShaleMining(userId, character.id, startedAt, random);

    const completedAt = new Date("2026-01-01T00:00:06.600Z");
    const traveled = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theLongScramble,
      completedAt,
      random,
    );
    // Exactly one completed attempt is banked before Travel begins.
    expect(traveled.run).toMatchObject({
      attempts: 1,
      successes: 1,
      shaleGained: 1,
      xpGained: 15,
    });
    expect(traveled.travelState?.destinationLocationId).toBe(LOCATION_IDS.theLongScramble);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);

    // No Mining reward is earned during the Travel interval.
    const arriveAt = new Date("2026-01-01T00:00:40.000Z");
    const afterTravel = await play.getPlayGameplayState(userId, character.id, arriveAt, random);
    expect(afterTravel.run).toMatchObject({
      attempts: 1,
      successes: 1,
      shaleGained: 1,
      xpGained: 15,
    });
    expect(afterTravel.ferriteShaleQuantity).toBe(1);
  });

  it("survives partial travel progress across a refresh and arrives exactly once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);

    // 12 seconds into a 24-second journey: not yet arrived.
    const partial = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:12.000Z"),
    );
    expect(partial.travelState).toBeDefined();
    expect(partial.location.currentLocationId).toBe(LOCATION_IDS.crashSite);

    // Resolve the full journey: location flips once, travel state cleared.
    const arrived = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    expect(arrived.travelState).toBeUndefined();
    const travelRows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(travelRows).toHaveLength(0);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(0);

    // A repeat refresh must not move the character again or duplicate arrival.
    const repeat = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T01:00:00.000Z"),
    );
    expect(repeat.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
  });

  it("refuses concurrent duplicate journeys and resolves arrival exactly once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);

    const arriveAt = new Date("2026-01-01T00:00:24.600Z");
    const [first, second] = await Promise.all([
      play.getPlayGameplayState(userId, character.id, arriveAt),
      play.getPlayGameplayState(userId, character.id, arriveAt),
    ]);
    expect(first.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    expect(second.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    const travelRows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(travelRows).toHaveLength(0);
  });

  it("rejects invalid destinations and failed transactions preserve prior state", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const sameLocation = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.crashSite,
      startedAt,
    );
    expect(sameLocation.travelError).toBe("same_location");
    await expect(
      db
        .select()
        .from(rune.characterTravelState)
        .where(eq(rune.characterTravelState.characterId, character.id)),
    ).resolves.toEqual([]);
    expect(
      (await db.select().from(rune.characters).where(eq(rune.characters.id, character.id)))[0]
        ?.currentLocationId,
    ).toBe(LOCATION_IDS.crashSite);
  });

  it("blocks Mining while in transit or away from The Jag", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);

    const transitMining = await miningCommands.startFerriteShaleMining(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
    );
    // An active travel action blocks Mining server-side (no manipulated client can bypass).
    expect(transitMining.commandError).toBe("another_action_active");
    // The travel action remains authoritative; getMiningGameplayState reports it.
    const transitView = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
    );
    expect(transitView.travelState?.destinationLocationId).toBe(
      LOCATION_IDS.abandonedProcessingYard,
    );
    expect(transitView.activeAction).toBeUndefined();

    // After arrival at the Processing Yard, Mining still cannot start there.
    await play.getPlayGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z"));
    const yardMining = await miningCommands.startFerriteShaleMining(
      userId,
      character.id,
      new Date("2026-01-01T00:00:30.000Z"),
    );
    expect(yardMining.travelError).toBe("mining_unavailable_here");
    expect(yardMining.activeAction).toBeUndefined();
  });

  it("refuses a manipulated/stale destination that is not adjacent or unknown", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const unknown = await play.beginTravel(userId, character.id, "deep_void", startedAt);
    expect(unknown.travelError).toBe("unknown_destination");
  });

  it("refuses to replace an unsupported active action with Travel", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    // Insert an unsupported active action — not Mining, not Travel.
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "future_activity",
      startedAt,
      resolvedThroughAt: startedAt,
    });
    const result = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      startedAt,
    );
    // Travel is refused.
    expect(result.commandError).toBe("another_action_active");
    // The unsupported action row remains completely untouched.
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionId).toBe("future_activity");
    // No Travel row is created.
    const travelRows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(travelRows).toHaveLength(0);
    // currentLocationId remains unchanged.
    const chars = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(chars[0]?.currentLocationId).toBe(LOCATION_IDS.crashSite);
  });

  it("rejects arrival when the persisted travel row is missing", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // Delete the travel row to simulate corrupted state.
    await db
      .delete(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    // Resolving arrival must fail with an integrity error; the action and
    // location remain intact.
    await expect(
      play.getPlayGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
    ).rejects.toThrow(/travel state row/);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);
    const chars = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(chars[0]?.currentLocationId).toBe(LOCATION_IDS.crashSite);
  });

  it("rejects arrival with an unknown persisted destination", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // Corrupt the travel row with an unknown destination.
    await db
      .update(rune.characterTravelState)
      .set({ destinationLocationId: "deep_void" })
      .where(eq(rune.characterTravelState.characterId, character.id));
    await expect(
      play.getPlayGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
    ).rejects.toThrow(/Unknown persisted destination/);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);
    const chars = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(chars[0]?.currentLocationId).toBe(LOCATION_IDS.crashSite);
  });

  it("rejects arrival when the stored origin differs from the character location", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // Corrupt: set origin to a string that differs from the character's
    // authoritative current location (crash_site) but still satisfies the
    // DB CHECK (origin ≠ destination).
    await db
      .update(rune.characterTravelState)
      .set({ originLocationId: "alien_landing_zone" })
      .where(eq(rune.characterTravelState.characterId, character.id));
    await expect(
      play.getPlayGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
    ).rejects.toThrow(/Unknown persisted origin/);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);
    const chars = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(chars[0]?.currentLocationId).toBe(LOCATION_IDS.crashSite);
  });

  it("rejects arrival when the stored origin is known but does not match the character location", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await play.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // The travel row stores origin=crash_site, destination=abandoned_processing_yard.
    // Simulate corruption: directly set the character's current location to the
    // Processing Yard so it no longer matches the stored origin.
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, character.id));
    await expect(
      play.getPlayGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
    ).rejects.toThrow(/does not match stored travel origin/);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);
    // Location is restored after rollback.
    // Note: the rollback also restores the character location to what it was
    // when the transaction started (which was abandoned_processing_yard after
    // our corruption). We verify the row is unchanged.
    const chars = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(chars[0]?.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
  });

  it("rejects a direct Crash Site to The Jag shortcut and enforces the two-leg route", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const direct = await play.beginTravel(userId, character.id, LOCATION_IDS.theJag, startedAt);
    expect(direct.travelError).toBe("not_adjacent");
    expect(direct.location.currentLocationId).toBe(LOCATION_IDS.crashSite);

    const toScramble = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theLongScramble,
      startedAt,
    );
    expect(toScramble.travelState?.destinationLocationId).toBe(LOCATION_IDS.theLongScramble);
    const atScramble = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    expect(atScramble.location.currentLocationId).toBe(LOCATION_IDS.theLongScramble);

    const toJag = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theJag,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    expect(toJag.travelState?.destinationLocationId).toBe(LOCATION_IDS.theJag);
    const atJag = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:49.200Z"),
    );
    expect(atJag.location.currentLocationId).toBe(LOCATION_IDS.theJag);

    const backToScramble = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theLongScramble,
      new Date("2026-01-01T00:00:49.200Z"),
    );
    expect(backToScramble.travelState?.destinationLocationId).toBe(LOCATION_IDS.theLongScramble);
    const back = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:01:13.800Z"),
    );
    expect(back.location.currentLocationId).toBe(LOCATION_IDS.theLongScramble);

    const jagDirect = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.crashSite,
      new Date("2026-01-01T00:01:13.800Z"),
    );
    expect(jagDirect.travelState?.destinationLocationId).toBe(LOCATION_IDS.crashSite);
  });

  it("rejects Mining at Crash Site and The Long Scramble, accepts only at The Jag", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await play.getPlayGameplayState(userId, character.id, now);

    const atCrash = await miningCommands.startFerriteShaleMining(userId, character.id, now);
    expect(atCrash.travelError).toBe("mining_unavailable_here");

    await play.beginTravel(userId, character.id, LOCATION_IDS.theLongScramble, now);
    const atScramble = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    expect(atScramble.location.currentLocationId).toBe(LOCATION_IDS.theLongScramble);
    const scrambleMining = await miningCommands.startFerriteShaleMining(
      userId,
      character.id,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    expect(scrambleMining.travelError).toBe("mining_unavailable_here");

    await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theJag,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    const atJag = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:49.200Z"),
    );
    expect(atJag.location.currentLocationId).toBe(LOCATION_IDS.theJag);
    const jagMining = await miningCommands.startFerriteShaleMining(
      userId,
      character.id,
      new Date("2026-01-01T00:00:49.200Z"),
    );
    expect(jagMining.activeAction?.actionId).toBe(ACTION_IDS.ferriteShaleMining);
    expect(jagMining.travelError).toBeUndefined();
  });

  it("reaches The Jag from the Annex only via explicit legs through Crash Site and Long Scramble", async () => {
    const { userId, character } = await makeCharacter();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.emergencyPowerAnnex })
      .where(eq(rune.characters.id, character.id));

    const direct = await play.beginTravel(userId, character.id, LOCATION_IDS.theJag, t0);
    expect(direct.travelError).toBe("not_adjacent");

    const toCrash = await play.beginTravel(userId, character.id, LOCATION_IDS.crashSite, t0);
    expect(toCrash.travelState?.destinationLocationId).toBe(LOCATION_IDS.crashSite);
    const atCrash = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    expect(atCrash.location.currentLocationId).toBe(LOCATION_IDS.crashSite);

    await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theLongScramble,
      new Date("2026-01-01T00:00:24.600Z"),
    );
    const atScramble = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:49.200Z"),
    );
    expect(atScramble.location.currentLocationId).toBe(LOCATION_IDS.theLongScramble);

    await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theJag,
      new Date("2026-01-01T00:00:49.200Z"),
    );
    const atJag = await play.getPlayGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:01:13.800Z"),
    );
    expect(atJag.location.currentLocationId).toBe(LOCATION_IDS.theJag);
  });
});
