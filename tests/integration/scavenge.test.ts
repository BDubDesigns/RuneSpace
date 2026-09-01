import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { characterScavengeReveals, inventoryStacks } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #88 authoritative Scavenge claims (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  const createdUsers: string[] = [];
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const travelRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };
  const rewardRandom = { nextBasisPoints: () => 3_000, nextUnit: () => 0 };

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Scavenge Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Scavenge ${userId.slice(0, 6)}`,
    );
    return { userId, character };
  }

  function atTick(tick: number) {
    return new Date(startedAt.getTime() + tick * GAME_TICK_MS);
  }

  async function beginFixture(userId: string, characterId: string) {
    await play.beginTravel(
      userId,
      characterId,
      LOCATION_IDS.abandonedProcessingYard,
      startedAt,
      travelRandom,
    );
  }

  it("commits one server-selected outcome and makes repeat claims idempotently refuse", async () => {
    const { userId, character } = await makeCharacter();
    await beginFixture(userId, character.id);

    const claimed = await play.claimScavenge(userId, character.id, atTick(4), rewardRandom);
    expect(claimed.scavenge).toMatchObject({
      status: "claimed",
      outcome: { outcomeId: "ferrite_shale_1", quantity: 1 },
    });
    expect(claimed.state.travelState?.scavenge.outcome?.outcomeId).toBe("ferrite_shale_1");
    expect(claimed.state.scavengeReveals).toHaveLength(1);

    const revealRows = await db
      .select()
      .from(characterScavengeReveals)
      .where(eq(characterScavengeReveals.characterId, character.id));
    expect(revealRows).toHaveLength(1);
    expect(revealRows[0]?.outcomeId).toBe("ferrite_shale_1");

    const repeat = await play.claimScavenge(userId, character.id, atTick(5), rewardRandom);
    expect(repeat.scavenge).toMatchObject({ status: "refused", reason: "already_claimed" });
    expect(
      (
        await db.select().from(inventoryStacks).where(eq(inventoryStacks.characterId, character.id))
      ).find((stack) => stack.itemId === ITEM_IDS.ferriteShale)?.quantity,
    ).toBe(1);
  });

  it("accepts the one-second backend grace without extending the client-visible window", async () => {
    const withinGraceFixture = await makeCharacter();
    await beginFixture(withinGraceFixture.userId, withinGraceFixture.character.id);
    const { claimGraceMs } = getEffectiveGameBalance().travel.scavenge;
    const withinGrace = new Date(atTick(8).getTime() + claimGraceMs - 1);
    const withinGraceResult = await play.claimScavenge(
      withinGraceFixture.userId,
      withinGraceFixture.character.id,
      withinGrace,
      rewardRandom,
    );
    expect(withinGraceResult.scavenge.status).toBe("claimed");

    const expiredFixture = await makeCharacter();
    await beginFixture(expiredFixture.userId, expiredFixture.character.id);
    const afterGrace = new Date(atTick(8).getTime() + claimGraceMs);
    const afterGraceResult = await play.claimScavenge(
      expiredFixture.userId,
      expiredFixture.character.id,
      afterGrace,
      rewardRandom,
    );
    expect(afterGraceResult.scavenge).toMatchObject({ status: "refused", reason: "missed" });
  });

  it("preflights every possible award before calling the reward RNG", async () => {
    const { userId, character } = await makeCharacter();
    await beginFixture(userId, character.id);
    await db.insert(inventoryStacks).values(
      Array.from({ length: 8 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 1,
      })),
    );
    let rollCalls = 0;
    const shouldNotRoll = {
      nextBasisPoints: () => {
        rollCalls += 1;
        throw new Error("Scavenge reward RNG must not run after capacity refusal");
      },
      nextUnit: () => 0,
    };

    const result = await play.claimScavenge(userId, character.id, atTick(4), shouldNotRoll);
    expect(result.scavenge).toMatchObject({
      status: "refused",
      reason: "capacity_blocked",
    });
    expect(rollCalls).toBe(0);
    expect(
      await db
        .select()
        .from(characterScavengeReveals)
        .where(eq(characterScavengeReveals.characterId, character.id)),
    ).toEqual([]);
  });

  it("keeps a committed reveal after arrival and acknowledges it idempotently", async () => {
    const { userId, character } = await makeCharacter();
    await beginFixture(userId, character.id);
    const claimed = await play.claimScavenge(userId, character.id, atTick(4), rewardRandom);
    const revealId = claimed.state.scavengeReveals[0]?.revealId;
    expect(revealId).toBeDefined();

    const arrived = await play.getPlayGameplayState(userId, character.id, atTick(41));
    expect(arrived.travelState).toBeUndefined();
    expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    expect(arrived.scavengeReveals).toHaveLength(1);
    expect(arrived.scavengeReveals[0]?.revealId).toBe(revealId);

    const acknowledged = await play.acknowledgeScavengeReveal(
      userId,
      character.id,
      revealId!,
      atTick(42),
    );
    expect(acknowledged.acknowledged).toBe(true);
    expect(acknowledged.state.scavengeReveals).toEqual([]);

    const repeated = await play.acknowledgeScavengeReveal(
      userId,
      character.id,
      revealId!,
      atTick(43),
    );
    expect(repeated.acknowledged).toBe(false);
    expect(repeated.state.scavengeReveals).toEqual([]);
  });
});
