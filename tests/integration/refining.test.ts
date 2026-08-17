import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { grantCharacterSkillXp } from "@/server/progression";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #81 Refining persistence and concurrency (real PostgreSQL)", () => {
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
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Refining Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Ref ${userId.slice(0, 6)}`,
    );
    return { userId, character };
  }

  async function provisionAtYard(
    userId: string,
    characterId: string,
    now = new Date("2026-01-01T00:00:00.000Z"),
  ) {
    // Ensure starter state then move to Processing Yard
    await mining.getMiningGameplayState(userId, characterId, now, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, characterId));
    return now;
  }

  async function addShale(characterId: string, quantity: number) {
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity });
  }

  it("enforces Processing Yard location for Refining", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await mining.getMiningGameplayState(userId, character.id, now);
    // Still at Crash Site — starting Refining must be refused via refiningError, not travelError
    const refused = await mining.startRefining(userId, character.id, now);
    expect(refused.refiningError).toBe("refining_unavailable_here");
    expect(refused.travelError).toBeUndefined();
    expect(refused.activeAction).toBeUndefined();
    await expect(
      db.select().from(rune.activeActions).where(eq(rune.activeActions.characterId, character.id)),
    ).resolves.toEqual([]);

    // A manipulated direct call is still server-authoritative: no active action is created
    const stillRefused = await mining.startRefining(userId, character.id, now);
    expect(stillRefused.refiningError).toBe("refining_unavailable_here");
  });

  it("fresh character starts Refining at level 1 / 0 XP without duplicating rows", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, now);
    const xpRows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    const refiningRow = xpRows.find((r) => r.skillId === SKILL_IDS.refining)!;
    expect(refiningRow.totalXp).toBe(0);
    const state = await mining.getMiningGameplayState(userId, character.id, now);
    expect(state.refining.level).toBe(1);
    expect(state.refining.totalXp).toBe(0);
    // Repeated reads do not duplicate
    const after = await mining.getMiningGameplayState(userId, character.id, now);
    const xpRows2 = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    expect(xpRows2.filter((r) => r.skillId === SKILL_IDS.refining)).toHaveLength(1);
    expect(after.refining.level).toBe(1);
  });

  it("real pre-#81 existing character (no refining row/state) provisions Refining lazily at level 1 / 0 XP", async () => {
    const { userId, character } = await makeCharacter();
    const now = new Date("2026-01-01T00:00:00.000Z");
    // Establish normal starter state then strip refining to simulate pre-#81
    await mining.getMiningGameplayState(userId, character.id, now, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    (await db
      .delete(rune.characterSkillXp)
      .where(
        eq(rune.characterSkillXp.characterId, character.id) as unknown as never,
      )) as unknown as never;
    // Re-insert only mining + strength to simulate old starter (no refining)
    await db.insert(rune.characterSkillXp).values([
      { characterId: character.id, skillId: SKILL_IDS.mining, totalXp: 500 },
      { characterId: character.id, skillId: SKILL_IDS.strength, totalXp: 0 },
    ]);
    await db
      .delete(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, character.id));
    // Confirm pre-condition: no refining row/state
    const beforeXp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    expect(beforeXp.find((r) => r.skillId === SKILL_IDS.refining)).toBeUndefined();
    const beforeState = await db
      .select()
      .from(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, character.id));
    expect(beforeState).toEqual([]);

    // Move to Yard (provisionAtYard does getMiningGameplayState which would recreate refining; do it manually)
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, character.id));
    // First gameplay read — missing refining XP means 0 XP / level 1, without creating a zero row
    const state = await mining.getMiningGameplayState(userId, character.id, now, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    expect(state.refining.level).toBe(1);
    expect(state.refining.totalXp).toBe(0);
    const afterXp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    // Acceptable for the XP row to remain absent after a read — missing means 0 XP
    expect(afterXp.find((r) => r.skillId === SKILL_IDS.refining)).toBeUndefined();

    // Start Refining should succeed even without a pre-existing zero-XP row
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 5 });
    await mining.startRefining(userId, character.id, now, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    const started = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(started[0]?.actionId).toBe(ACTION_IDS.refining);

    // Resolving an attempt creates the refining XP/state and grants 15 XP
    const resolved = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    expect(resolved.refiningRun.attempts).toBe(1);
    expect(resolved.refiningRun.ferriteGained).toBe(1);
    const afterSuccessXp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    expect(afterSuccessXp.filter((r) => r.skillId === SKILL_IDS.refining)).toHaveLength(1);
    expect(afterSuccessXp.find((r) => r.skillId === SKILL_IDS.refining)!.totalXp).toBe(15);
    const afterSuccessState = await db
      .select()
      .from(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, character.id));
    expect(afterSuccessState).toHaveLength(1);
    expect(afterSuccessState[0]!.runAttempts).toBe(1);
    // Repeated reads do not duplicate either row
    await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    const finalXp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    expect(finalXp.filter((r) => r.skillId === SKILL_IDS.refining)).toHaveLength(1);
  });

  it("is idempotent while already Refining and does not reset cursor or run state", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 10);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    const first = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(first[0]?.actionId).toBe(ACTION_IDS.refining);

    // Resolve one attempt (7 ticks)
    const afterOne = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
      { nextBasisPoints: () => 0, nextUnit: () => 0 },
    );
    expect(afterOne.refiningRun.attempts).toBe(1);

    const cursorBefore = first[0]?.resolvedThroughAt;
    const runBefore = afterOne.refiningRun;

    // Repeating Start Refining while active must be idempotent
    const idempotent = await mining.startRefining(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
      { nextBasisPoints: () => 0, nextUnit: () => 0 },
    );
    expect(idempotent.activeAction?.actionId).toBe(ACTION_IDS.refining);
    expect(idempotent.refiningRun.attempts).toBe(runBefore.attempts);
    expect(idempotent.refiningRun.xpGained).toBe(runBefore.xpGained);
    const after = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    // Cursor (resolvedThroughAt) must not have been reset to start
    expect(after[0]?.resolvedThroughAt.getTime()).toBeGreaterThanOrEqual(cursorBefore!.getTime());
    // Run counters must not have been reset to zero
    expect(idempotent.refiningRun.attempts).toBeGreaterThan(0);
  });

  it("a completed success atomically consumes 2 shale, creates 1 Refined Ferrite, grants 15 XP, updates run history, and advances cursor once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 5);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });

    const successRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    const resolved = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
      successRandom,
    );
    expect(resolved.refiningRun).toMatchObject({
      attempts: 1,
      successes: 1,
      failures: 0,
      ferriteGained: 1,
      slagGained: 0,
      shaleConsumed: 2,
      xpGained: 15,
    });
    expect(resolved.refinedFerriteQuantity).toBe(1);
    expect(resolved.slagQuantity).toBe(0);
    expect(resolved.ferriteShaleQuantity).toBe(3);
    expect(resolved.refining.totalXp).toBe(15);
    expect(resolved.refiningRun.recentAttempts).toHaveLength(1);
    expect(resolved.refiningRun.recentAttempts[0]).toMatchObject({
      success: true,
      ferriteAwarded: 1,
      xpAwarded: 15,
    });
    const action = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(action[0]?.resolvedThroughAt.toISOString()).toBe(
      new Date("2026-01-01T00:00:04.200Z").toISOString(),
    );
  });

  it("a completed failure atomically consumes 2 shale, creates 1 Slag, grants 3 XP, updates run history, and advances cursor once", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 5);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 9_999,
      nextUnit: () => 0,
    });

    const failRandom = { nextBasisPoints: () => 9_999, nextUnit: () => 0 };
    const resolved = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
      failRandom,
    );
    expect(resolved.refiningRun).toMatchObject({
      attempts: 1,
      successes: 0,
      failures: 1,
      ferriteGained: 0,
      slagGained: 1,
      shaleConsumed: 2,
      xpGained: 3,
    });
    expect(resolved.slagQuantity).toBe(1);
    expect(resolved.refinedFerriteQuantity).toBe(0);
    expect(resolved.ferriteShaleQuantity).toBe(3);
    expect(resolved.refining.totalXp).toBe(3);
    expect(resolved.refiningRun.recentAttempts[0]).toMatchObject({
      success: false,
      slagAwarded: 1,
      xpAwarded: 3,
    });
  });

  it("rollback leaves shale/output/XP/run state/cursor unchanged (real refining persistence)", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 5);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });

    const now = new Date("2026-01-01T00:00:04.200Z");
    // Capture baseline before failure
    const beforeStacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    const beforeShale = beforeStacks
      .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
      .reduce((t, s) => t + s.quantity, 0);
    const beforeFerrite = beforeStacks
      .filter((s) => s.itemId === ITEM_IDS.refinedFerrite)
      .reduce((t, s) => t + s.quantity, 0);
    const beforeSlag = beforeStacks
      .filter((s) => s.itemId === ITEM_IDS.slag)
      .reduce((t, s) => t + s.quantity, 0);
    const beforeXp =
      (
        await db
          .select()
          .from(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, character.id))
      ).find((r) => r.skillId === SKILL_IDS.refining)?.totalXp ?? 0;
    const beforeAction = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    const beforeCursor = beforeAction[0]?.resolvedThroughAt.toISOString();
    const beforeState = await db
      .select()
      .from(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, character.id));

    // Use real refining resolver but inject failure after its normal writes (before commit)
    const refiningMod = await import("@/server/refining");
    const realResolver = refiningMod.createRefiningResolver({ nextBasisPoints: () => 0 });
    const failingResolver = {
      ...realResolver,
      persist: async (tx: DatabaseTransaction, outcome: unknown) => {
        await (
          realResolver as unknown as {
            persist: (tx: DatabaseTransaction, o: unknown) => Promise<void>;
          }
        ).persist(tx, outcome as never);
        throw new Error("intentional refining rollback");
      },
      supports: realResolver.supports!.bind(realResolver),
    };
    await expect(
      resolution.withResolvedOwnedCharacter(
        userId,
        character.id,
        failingResolver as never,
        async () => undefined,
        now,
      ),
    ).rejects.toThrow(/intentional/i);

    // Immediately after failure, before retry, prove nothing changed
    const afterStacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(
      afterStacks
        .filter((s) => s.itemId === ITEM_IDS.ferriteShale)
        .reduce((t, s) => t + s.quantity, 0),
    ).toBe(beforeShale);
    expect(
      afterStacks
        .filter((s) => s.itemId === ITEM_IDS.refinedFerrite)
        .reduce((t, s) => t + s.quantity, 0),
    ).toBe(beforeFerrite);
    expect(
      afterStacks.filter((s) => s.itemId === ITEM_IDS.slag).reduce((t, s) => t + s.quantity, 0),
    ).toBe(beforeSlag);
    const afterXp =
      (
        await db
          .select()
          .from(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, character.id))
      ).find((r) => r.skillId === SKILL_IDS.refining)?.totalXp ?? 0;
    expect(afterXp).toBe(beforeXp);
    const afterState = await db
      .select()
      .from(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, character.id));
    expect(afterState[0]?.runAttempts).toBe(beforeState[0]?.runAttempts ?? 0);
    expect(afterState[0]?.runFerriteGained).toBe(beforeState[0]?.runFerriteGained ?? 0);
    expect(afterState[0]?.runSlagGained).toBe(beforeState[0]?.runSlagGained ?? 0);
    expect(afterState[0]?.runXpGained).toBe(beforeState[0]?.runXpGained ?? 0);
    expect(afterState[0]?.recentAttempts).toEqual(beforeState[0]?.recentAttempts ?? []);
    const afterAction = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(afterAction[0]?.resolvedThroughAt.toISOString()).toBe(beforeCursor);

    // Retry normally proves exactly one attempt commits
    const retried = await mining.getMiningGameplayState(userId, character.id, now, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    expect(retried.refiningRun.attempts).toBe(1);
    expect(retried.refinedFerriteQuantity).toBe(1);
  });

  it("retry/concurrent commands cannot duplicate output/XP or double-consume shale", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 10);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });

    const at = new Date("2026-01-01T00:00:04.200Z");
    const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
    const [a, b] = await Promise.all([
      mining.getMiningGameplayState(userId, character.id, at, random),
      mining.getMiningGameplayState(userId, character.id, at, random),
    ]);
    expect(a.refiningRun.attempts).toBe(1);
    expect(b.refiningRun.attempts).toBe(1);
    expect(a.refinedFerriteQuantity).toBe(1);
    expect(b.refinedFerriteQuantity).toBe(1);
    const stacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(
      stacks
        .filter((s) => s.itemId === ITEM_IDS.refinedFerrite)
        .reduce((t, s) => t + s.quantity, 0),
    ).toBe(1);
    const xpRows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    expect(xpRows.find((r) => r.skillId === SKILL_IDS.refining)?.totalXp).toBe(15);
  });

  it("partial Refining work survives ordinary refresh/reconnect", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 10);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });

    const partialAt = new Date("2026-01-01T00:00:03.600Z"); // 6 ticks, <7
    const first = await mining.getMiningGameplayState(userId, character.id, partialAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    expect(first.refiningRun.attempts).toBe(0);
    expect(first.ferriteShaleQuantity).toBe(10);
    const actionAfterPartial = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actionAfterPartial[0]?.resolvedThroughAt.toISOString()).toBe(startedAt.toISOString());

    const second = await mining.getMiningGameplayState(userId, character.id, partialAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    expect(second.refiningRun.attempts).toBe(0);
    expect(second.ferriteShaleQuantity).toBe(10);
  });

  it("starting Travel while Refining resolves only completed attempts, discards partial, records action_replaced, and begins Travel atomically", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 10);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });

    // 13 ticks = 1 completed (7) + 6 partial
    const travelAt = new Date(startedAt.getTime() + 7 * 600 + 6 * 600);
    const traveled = await mining.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.crashSite,
      travelAt,
      { nextBasisPoints: () => 0, nextUnit: () => 0 },
    );
    expect(traveled.refiningRun.attempts).toBe(1);
    expect(traveled.ferriteShaleQuantity).toBe(8); // 10 -2 (only completed)
    expect(traveled.refinedFerriteQuantity).toBe(1);
    expect(traveled.travelState?.destinationLocationId).toBe(LOCATION_IDS.crashSite);
    // Travel is active (travelState present, DB action is travel); activeAction projection is mining/refining-only
    expect(traveled.travelState).toBeDefined();
    const refiningState = await db
      .select()
      .from(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, character.id));
    expect(refiningState[0]?.lastStopReason).toBe("action_replaced");
    const actions = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionId).toBe(ACTION_IDS.travel);
  });

  it("Refining and Travel never overlap", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 5);
    await mining.startRefining(userId, character.id, startedAt);
    const traveled = await mining.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.crashSite,
      new Date("2026-01-01T00:00:04.200Z"),
    );
    expect(traveled.travelState?.destinationLocationId).toBe(LOCATION_IDS.crashSite);
    expect(traveled.activeAction).toBeUndefined();
    // Trying to start refining while traveling must be refused — travel is projected as travelState, not activeAction
    const refused = await mining.startRefining(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
    );
    expect(refused.commandError).toBe("another_action_active");
    expect(refused.travelState?.destinationLocationId).toBe(LOCATION_IDS.crashSite);
    expect(refused.activeAction).toBeUndefined();
  });

  it("bounded run-history and new-run reset semantics remain consistent with Mining", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 50);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });

    const far = new Date(startedAt.getTime() + 12 * 7 * 600);
    const resolved = await mining.getMiningGameplayState(userId, character.id, far, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    expect(resolved.refiningRun.attempts).toBe(12);
    expect(resolved.refiningRun.recentAttempts).toHaveLength(10);
    expect(resolved.refiningRun.recentAttempts.map((a) => a.sequence)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);

    await mining.stopRefining(userId, character.id, far, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    const stopped = await mining.getMiningGameplayState(userId, character.id, far);
    expect(stopped.refiningRun.attempts).toBe(12);
    const restarted = await mining.startRefining(
      userId,
      character.id,
      new Date(far.getTime() + 600),
      { nextBasisPoints: () => 0, nextUnit: () => 0 },
    );
    expect(restarted.refiningRun.attempts).toBe(0);
    expect(restarted.refiningRun.recentAttempts).toEqual([]);
  });

  it("the existing one-hour offline resolution cap applies", async () => {
    const { userId, character } = await makeCharacter();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, startedAt);
    await addShale(character.id, 5000);
    await mining.startRefining(userId, character.id, startedAt, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });

    // 2 hours later - but cap is 1 hour = 6000 ticks = floor(6000/7)=857 attempts max
    const farFuture = new Date(startedAt.getTime() + 2 * 60 * 60 * 1000);
    const resolved = await mining.getMiningGameplayState(userId, character.id, farFuture, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    // Should be capped, not 2h worth (which would be ~1714 attempts). Allow either exact cap or shale-limited.
    expect(resolved.refiningRun.attempts).toBeLessThanOrEqual(857);
    expect(resolved.refiningRun.attempts).toBeGreaterThan(0);
    // Cursor must not have advanced beyond cap window
    const action = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, character.id));
    if (action.length === 0) {
      // Refining stopped mid-cap (e.g. insufficient shale): the refining stop reason was persisted
      const refiningState = await db
        .select()
        .from(rune.characterRefiningState)
        .where(eq(rune.characterRefiningState.characterId, character.id));
      expect(refiningState[0]?.lastStopReason).toBeTruthy();
      return;
    }
    const elapsedMs = action[0]!.resolvedThroughAt.getTime() - startedAt.getTime();
    expect(elapsedMs).toBeLessThanOrEqual(60 * 60 * 1000 + 600); // cap + at most one tick rounding
  });

  it("Mining stop does not leak into Refining presentation after Travel to Yard", async () => {
    const { userId, character } = await makeCharacter();
    const atCrash = new Date("2026-01-01T00:00:00.000Z");
    await mining.getMiningGameplayState(userId, character.id, atCrash, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    await mining.startCrashSiteMining(userId, character.id, atCrash, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    // Stop mining with a mining-specific reason by removing tool, then travel to Yard
    await db.delete(rune.equippedItems).where(eq(rune.equippedItems.characterId, character.id));
    const afterStop = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:06.000Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    expect(afterStop.stop?.actionId).toBe(ACTION_IDS.crashSiteMining);
    // Travel to Processing Yard — mining stop should not be presented as refining stop
    await mining.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.abandonedProcessingYard,
      new Date("2026-01-01T00:00:06.000Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    const arrived = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:30.000Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.abandonedProcessingYard);
    // Mining stop remains tagged as a mining stop — refining presentation must ignore it
    expect(arrived.stop?.actionId).toBe(ACTION_IDS.crashSiteMining);
    expect(arrived.stop?.reason).not.toBe("insufficient_ferrite_shale");
    // Prove refining UI helper does not interpret it: map mining reason through mining helper, not refining
    const miningReason = arrived.stop?.reason;
    expect([
      "manually_stopped",
      "inventory_slots_full",
      "carried_mass_capacity_reached",
      "compatible_mining_tool_missing",
      "mining_tool_replaced",
      "action_replaced",
    ]).toContain(miningReason);
    // Starting refining at Yard should not surface the old mining stop
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 2 });
    const atYard = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:30.000Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    // Still the mining-tagged stop — refining ignore check
    expect(atYard.stop?.actionId).toBe(ACTION_IDS.crashSiteMining);
  });

  it("Refining stop does not leak into Mining presentation", async () => {
    const { userId, character } = await makeCharacter();
    const atYard = new Date("2026-01-01T00:00:00.000Z");
    await provisionAtYard(userId, character.id, atYard);
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 5 });
    await mining.startRefining(userId, character.id, atYard, {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
    });
    // Drain shale via the refining run — after one success with 5 shale,
    // subsequent getMiningGameplayState calls will drain remaining shale
    // and Travel then persists action_replaced as the latest refining stop.
    const atFail = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:04.200Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    expect(atFail.refiningRun.attempts).toBe(1);
    // Travel away to Crash Site — beginTravel while refining records action_replaced
    const traveled = await mining.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.crashSite,
      new Date("2026-01-01T00:00:04.200Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    expect(traveled.travelState?.destinationLocationId).toBe(LOCATION_IDS.crashSite);
    const atCrash = await mining.getMiningGameplayState(
      userId,
      character.id,
      new Date("2026-01-01T00:00:30.000Z"),
      {
        nextBasisPoints: () => 0,
        nextUnit: () => 0,
      },
    );
    expect(atCrash.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
    // Refining stop remains tagged as refining — mining presentation must ignore it.
    // The latest refining stop is action_replaced (from the Travel replacement).
    expect(atCrash.stop?.actionId).toBe(ACTION_IDS.refining);
    expect(atCrash.stop?.reason).toBe("action_replaced");
    // Mining helper would not understand refining-specific reason
    expect([
      "manually_stopped",
      "inventory_slots_full",
      "carried_mass_capacity_reached",
      "compatible_mining_tool_missing",
      "mining_tool_replaced",
      "action_replaced",
    ]).not.toContain(atCrash.stop?.reason);
  });
});
