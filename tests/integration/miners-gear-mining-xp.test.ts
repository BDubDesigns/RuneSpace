import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { applyMiningXpBonus, type MiningRandom } from "@/game/domain/mining";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #465 — the Legendary miner's set's additive +5% Mining XP each, against
 * real PostgreSQL: only genuinely equipped gear counts, the bonus is rounded once
 * per extraction attempt, and the attempt, run summary and persisted character XP
 * all agree on the same figure.
 */
suite("issue #465 Legendary miner's gear Mining XP (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let equipment: typeof import("@/server/equipment");
  const createdUsers: string[] = [];
  const balance = getEffectiveGameBalance();
  const shale = balance.mining.sources.ferriteShale;
  const thresholds = standardSkillLevelThresholds(balance);
  const startXp = thresholds.find((entry) => entry.level === 1)!.totalXp;
  const now = new Date("2026-10-01T00:00:00.000Z");
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);
  const ATTEMPT = shale.attemptDurationTicks;
  const feet = { assignmentKind: "gear", suitSlotId: balance.carrying.feetSuitSlotId } as const;
  const hands = { assignmentKind: "gear", suitSlotId: balance.carrying.handsSuitSlotId } as const;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    equipment = await import("@/server/equipment");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** Every roll is a certain success (basis points 0) with no Secondary Find (integer: last). */
  function certainSuccess(): MiningRandom {
    return {
      nextBasisPoints: () => 0,
      nextUnit: () => 0,
      nextInteger: (exclusiveMaximum) => exclusiveMaximum - 1,
    };
  }

  async function makeMiner() {
    const userId = await createTestUser(db, authSchema, "Gear");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Gear${userId.slice(0, 5)}`,
    );
    await play.getPlayGameplayState(userId, character.id, now, certainSuccess());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }

  async function addInstance(characterId: string, itemId: string) {
    const [row] = await db
      .insert(rune.itemInstances)
      .values({ characterId, itemId })
      .returning({ id: rune.itemInstances.id });
    return row!.id;
  }

  async function wear(
    miner: { userId: string; characterId: string },
    pieces: readonly ("boots" | "gloves")[],
  ) {
    for (const piece of pieces) {
      const itemInstanceId = await addInstance(
        miner.characterId,
        piece === "boots" ? ITEM_IDS.minersBoots : ITEM_IDS.minersGloves,
      );
      await equipment.changeEquipment(
        miner.userId,
        miner.characterId,
        { kind: "equip", itemInstanceId, target: piece === "boots" ? feet : hands },
        now,
      );
    }
  }

  async function miningXp(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    return row?.totalXp ?? 0;
  }

  /** Start Mining at The Jag and resolve exactly `attempts` attempts. */
  async function mine(miner: { userId: string; characterId: string }, attempts: number) {
    await miningCommands.startMining(miner.userId, miner.characterId, now, certainSuccess());
    return play.getPlayGameplayState(
      miner.userId,
      miner.characterId,
      tick(now, ATTEMPT * attempts),
      certainSuccess(),
    );
  }

  it.each([
    ["no gear", [] as ("boots" | "gloves")[], 0],
    ["one piece", ["boots"] as ("boots" | "gloves")[], 500],
    ["both pieces", ["boots", "gloves"] as ("boots" | "gloves")[], 1_000],
  ])(
    "pays %s the rounded-up XP in the run, the attempt and the character total",
    async (_name, pieces, bps) => {
      const miner = await makeMiner();
      await wear(miner, pieces);
      const state = await mine(miner, 1);
      const expected = applyMiningXpBonus(shale.successXp, bps);
      expect(state.run).toMatchObject({ attempts: 1, successes: 1, xpGained: expected });
      expect(await miningXp(miner.characterId)).toBe(startXp + expected);
    },
  );

  it("rounds once per attempt across a run, never once for the whole run", async () => {
    const miner = await makeMiner();
    await wear(miner, ["boots", "gloves"]);
    const attempts = 4;
    const state = await mine(miner, attempts);
    const perAttempt = applyMiningXpBonus(shale.successXp, 1_000);
    expect(state.run?.attempts).toBe(attempts);
    expect(state.run?.xpGained).toBe(perAttempt * attempts);
    expect(await miningXp(miner.characterId)).toBe(startXp + perAttempt * attempts);
    // One rounding over the whole run would pay a different (smaller) total here.
    expect(perAttempt * attempts).not.toBe(
      Math.ceil((shale.successXp * attempts * (10_000 + 1_000)) / 10_000),
    );
  });

  it("grants nothing for pieces that are only carried, never equipped", async () => {
    const miner = await makeMiner();
    await addInstance(miner.characterId, ITEM_IDS.minersBoots);
    await addInstance(miner.characterId, ITEM_IDS.minersGloves);
    const state = await mine(miner, 1);
    expect(state.equipment.miningXpBonusBps).toBe(0);
    expect(state.run?.xpGained).toBe(shale.successXp);
    expect(await miningXp(miner.characterId)).toBe(startXp + shale.successXp);
  });

  it("never rewrites an attempt already resolved when the gear is removed afterwards", async () => {
    const miner = await makeMiner();
    await wear(miner, ["boots", "gloves"]);
    await miningCommands.startMining(miner.userId, miner.characterId, now, certainSuccess());
    const bonused = applyMiningXpBonus(shale.successXp, 1_000);
    // Two attempts complete under the worn pair; the swap resolves them first.
    const afterSwap = await equipment.changeEquipment(
      miner.userId,
      miner.characterId,
      { kind: "unequip", target: feet },
      tick(now, ATTEMPT * 2 + 1),
      certainSuccess(),
    );
    expect(afterSwap.equipment.miningXpBonusBps).toBe(500);
    expect(await miningXp(miner.characterId)).toBe(startXp + bonused * 2);
  });

  it("leaves yield, speed and the success roll exactly as they were", async () => {
    const plain = await makeMiner();
    const geared = await makeMiner();
    await wear(geared, ["boots", "gloves"]);
    const plainState = await mine(plain, 1);
    const gearedState = await mine(geared, 1);
    expect(gearedState.run?.itemsGained).toEqual(plainState.run?.itemsGained);
    expect(gearedState.miningSource?.attemptDurationTicks).toBe(
      plainState.miningSource?.attemptDurationTicks,
    );
    expect(gearedState.miningSource?.yieldMinimum).toBe(plainState.miningSource?.yieldMinimum);
  });
});
