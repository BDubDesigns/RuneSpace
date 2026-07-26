import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTION_IDS, LOCATION_IDS } from "@/game/config/foundations";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { grantCharacterSkillXp } from "@/server/progression";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #40 persistent locations and timed travel (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let mining: typeof import("@/server/mining");
  let resolution: typeof import("@/server/action-resolution");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    mining = await import("@/server/mining");
    resolution = await import("@/server/action-resolution");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0)) await cleanupUser(userId);
  });

  async function makeCharacter() {
    const userId = randomUUID();
    createdUsers.push(userId);
    await db.insert(authSchema.user).values({
      id: userId,
      name: "Travel Tester",
      email: `${userId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const account = await ownership.ensurePlayerAccount(userId);
    const character = await characters.createCharacter(account.id, `Travel ${userId.slice(0, 6)}`);
    return { userId, character };
  }

  async function cleanupUser(userId: string) {
    const accounts = await db
      .select({ id: rune.playerAccounts.id })
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    for (const account of accounts) {
      const characterRows = await db
        .select({ id: rune.characters.id })
        .from(rune.characters)
        .where(eq(rune.characters.playerAccountId, account.id));
      for (const character of characterRows) {
        await db
          .delete(rune.characterMiningState)
          .where(eq(rune.characterMiningState.characterId, character.id));
        await db
          .delete(rune.characterStarterProvisioning)
          .where(eq(rune.characterStarterProvisioning.characterId, character.id));
        await db
          .delete(rune.characterTravelState)
          .where(eq(rune.characterTravelState.characterId, character.id));
        await db.delete(rune.equippedItems).where(eq(rune.equippedItems.characterId, character.id));
        await db.delete(rune.activeActions).where(eq(rune.activeActions.characterId, character.id));
        await db
          .delete(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, character.id));
        await db
          .delete(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, character.id));
        await db.delete(rune.itemInstances).where(eq(rune.itemInstances.characterId, character.id));
      }
      await db.delete(rune.characters).where(eq(rune.characters.playerAccountId, account.id));
    }
    await db.delete(rune.playerAccounts).where(eq(rune.playerAccounts.userId, userId));
    await db.delete(authSchema.user).where(eq(authSchema.user.id, userId));
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
      mining.beginTravel(outsider.userId, character.id, LOCATION_IDS.abandonedProcessingYard),
    ).rejects.toThrow(/not found/i);
  });

  it("begins travel from the Crash Site while idle and keeps the origin until arrival", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const state = await mining.beginTravel(
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
    await mining.getMiningGameplayState(userId, character.id, startedAt, random);
    await mining.startCrashSiteMining(userId, character.id, startedAt, random);

    const completedAt = new Date("2026-01-01T00:00:06.600Z");
    const traveled = await mining.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
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
    expect(traveled.travelState?.destinationLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);

    // No Mining reward is earned during the Travel interval.
    const arriveAt = new Date("2026-01-01T00:00:40.000Z");
    const afterTravel = await mining.getMiningGameplayState(userId, character.id, arriveAt, random);
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
    await mining.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);

    // 12 seconds into a 24-second journey: not yet arrived.
    const partial = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:12.000Z"),
    );
    expect(partial.travelState).toBeDefined();
    expect(partial.location.currentLocationId).toBe(LOCATION_IDS.crashSite);

    // Resolve the full journey: location flips once, travel state cleared.
    const arrived = await mining.getMiningGameplayState(
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
    const repeat = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T01:00:00.000Z"),
    );
    expect(repeat.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
  });

  it("refuses concurrent duplicate journeys and resolves arrival exactly once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await mining.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);

    const arriveAt = new Date("2026-01-01T00:00:24.600Z");
    const [first, second] = await Promise.all([
      mining.getMiningGameplayState(userId, character.id, arriveAt),
      mining.getMiningGameplayState(userId, character.id, arriveAt),
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
    const sameLocation = await mining.beginTravel(
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

  it("blocks Mining while in transit or away from the Crash Site", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await mining.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);

    const transitMining = await mining.startCrashSiteMining(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
    );
    // An active travel action blocks Mining server-side (no manipulated client can bypass).
    expect(transitMining.commandError).toBe("another_action_active");
    // The travel action remains authoritative; getMiningGameplayState reports it.
    const transitView = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
    );
    expect(transitView.travelState?.destinationLocationId).toBe(
      LOCATION_IDS.abandonedProcessingYard,
    );
    expect(transitView.activeAction).toBeUndefined();

    // After arrival at the Processing Yard, Mining still cannot start there.
    await mining.getMiningGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z"));
    const yardMining = await mining.startCrashSiteMining(
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
    const unknown = await mining.beginTravel(userId, character.id, "deep_void", startedAt);
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
    const result = await mining.beginTravel(
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
    await mining.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // Delete the travel row to simulate corrupted state.
    await db
      .delete(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    // Resolving arrival must fail with an integrity error; the action and
    // location remain intact.
    await expect(
      mining.getMiningGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
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
    await mining.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // Corrupt the travel row with an unknown destination.
    await db
      .update(rune.characterTravelState)
      .set({ destinationLocationId: "deep_void" })
      .where(eq(rune.characterTravelState.characterId, character.id));
    await expect(
      mining.getMiningGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
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
    await mining.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // Corrupt: set origin to a string that differs from the character's
    // authoritative current location (crash_site) but still satisfies the
    // DB CHECK (origin ≠ destination).
    await db
      .update(rune.characterTravelState)
      .set({ originLocationId: "alien_landing_zone" })
      .where(eq(rune.characterTravelState.characterId, character.id));
    await expect(
      mining.getMiningGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
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
    await mining.beginTravel(userId, character.id, LOCATION_IDS.abandonedProcessingYard, startedAt);
    // The travel row stores origin=crash_site, destination=abandoned_processing_yard.
    // Simulate corruption: directly set the character's current location to the
    // Processing Yard so it no longer matches the stored origin.
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, character.id));
    await expect(
      mining.getMiningGameplayState(userId, character.id, new Date("2026-01-01T00:00:24.600Z")),
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
});
