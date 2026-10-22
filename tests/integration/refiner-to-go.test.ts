import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MAX,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #381 — Stillreach's Refiner-To-Go against real PostgreSQL, through the
 * same commands the browser calls.
 *
 * What only the database proves: the station is a validated venue, not a
 * client-chosen rate; the venue is persisted on the run, so a refresh, another
 * device or restarting the same recipe cannot reprice it; every attempt of a
 * lazy/offline window consumes its own 3x duration; and the Yard stays 1x.
 */
suite("issue #381 Refiner-To-Go (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let refiningCommands: typeof import("@/server/refining-commands");

  const createdUsers: string[] = [];
  const start = new Date("2026-10-22T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const thresholds = standardSkillLevelThresholds(balance);
  const fuel = balance.refining.recipes.smallFuelCanister;
  const at = (tick: number) => new Date(start.getTime() + tick * GAME_TICK_MS);
  const SHALE = ITEM_IDS.oilShale;
  const EMPTY = ITEM_IDS.emptySmallFuelCanister;
  const FULL = ITEM_IDS.fullSmallFuelCanister;
  const REFINER = LOCAL_PLACE_IDS.stillreachRefinerToGo;
  const succeeding = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const failing = () => ({ nextBasisPoints: () => 9_999, nextUnit: () => 0 });

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    progression = await import("@/server/progression");
    refiningCommands = await import("@/server/refining-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A Refining 8 character carrying 20 Oil Shale and 2 Empty canisters. */
  async function worker(location: LocationId = LOCATION_IDS.stillreachLandingStation) {
    const userId = await createTestUser(db, authSchema, "Refiner Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Refiner ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, succeeding());
    await db
      .update(rune.characters)
      .set({ currentLocationId: location })
      .where(eq(rune.characters.id, character.id));
    await db.transaction((transaction) =>
      progression.grantCharacterSkillXp(transaction, {
        characterId: character.id,
        skillId: SKILL_IDS.refining,
        awardedXp: thresholds.find((threshold) => threshold.level === 8)!.totalXp,
        thresholds,
      }),
    );
    // Oil Shale stacks five to a slot.
    await db
      .insert(rune.inventoryStacks)
      .values([
        ...[1, 2, 3, 4].map(() => ({ characterId: character.id, itemId: SHALE, quantity: 5 })),
        { characterId: character.id, itemId: EMPTY, quantity: 2 },
      ]);
    return { userId, character };
  }

  async function carried(characterId: string) {
    const rows = await db
      .select({ itemId: rune.inventoryStacks.itemId, quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    const totals: Record<string, number> = {};
    for (const row of rows) totals[row.itemId] = (totals[row.itemId] ?? 0) + row.quantity;
    return totals;
  }

  async function refiningXp(characterId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.refining),
        ),
      );
    return row?.totalXp ?? 0;
  }

  async function runPlace(characterId: string) {
    const [row] = await db
      .select({ place: rune.characterRefiningState.runLocalPlaceId })
      .from(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, characterId));
    return row?.place;
  }

  function startFuel(
    who: { userId: string; character: { id: string } },
    options: {
      selection?: number | typeof BOUNDED_RUN_MAX;
      random?: ReturnType<typeof succeeding>;
      now?: Date;
      localPlaceId?: string;
    } = {},
  ) {
    return refiningCommands.startRefining(
      who.userId,
      who.character.id,
      ACTION_IDS.fullSmallFuelCanisterRefining,
      options.now ?? start,
      options.random ?? succeeding(),
      options.selection ?? BOUNDED_RUN_MAX,
      options.localPlaceId,
    );
  }

  const refreshAt = (
    who: { userId: string; character: { id: string } },
    tick: number,
    random = succeeding(),
  ) => play.getPlayGameplayState(who.userId, who.character.id, at(tick), random);

  it("runs a fuel attempt at exactly 3x the canonical duration, from the persisted run", async () => {
    expect(fuel.attemptDurationTicks).toBe(60);
    const who = await worker();
    const started = await startFuel(who, { localPlaceId: REFINER });
    expect(started.refiningError).toBeUndefined();
    expect(started.activeAction?.actionId).toBe(ACTION_IDS.fullSmallFuelCanisterRefining);
    expect(started.activeAction?.nextAttemptDurationTicks).toBe(180);
    expect(Date.parse(started.activeAction!.nextAttemptAt)).toBe(at(180).getTime());
    expect(await runPlace(who.character.id)).toBe(REFINER);

    // One tick short of 180: nothing has resolved, however it is read.
    const early = await refreshAt(who, 179);
    expect(early.refiningRun.attempts).toBe(0);
    expect(await carried(who.character.id)).toMatchObject({ [SHALE]: 20, [EMPTY]: 2 });

    // 180 ticks: exactly one attempt, 100 XP, one Full canister, the empty spent.
    const first = await refreshAt(who, 180);
    expect(first.refiningRun.attempts).toBe(1);
    expect(first.refiningRun.recentAttempts[0]!.durationTicks).toBe(180);
    expect(await refiningXp(who.character.id)).toBe(
      thresholds.find((threshold) => threshold.level === 8)!.totalXp + 100,
    );
    expect(await carried(who.character.id)).toMatchObject({ [SHALE]: 10, [EMPTY]: 1, [FULL]: 1 });

    // A long offline window resolves each remaining attempt at its own 180 ticks
    // and never earlier: the second attempt lands at 360, then materials run out.
    const settled = await refreshAt(who, 1_000);
    expect(settled.refiningRun.attempts).toBe(2);
    expect(settled.refiningRun.recentAttempts.map((attempt) => attempt.durationTicks)).toEqual([
      180, 180,
    ]);
    expect(
      settled.refiningRun.recentAttempts.map((attempt) => Date.parse(attempt.resolvedAt)),
    ).toEqual([at(180).getTime(), at(360).getTime()]);
    expect(await carried(who.character.id)).toEqual({ [FULL]: 2 });
  });

  it("returns the empty and five shale on a failure, with the same 20 XP and no 3x XP", async () => {
    const who = await worker();
    const before = await refiningXp(who.character.id);
    await startFuel(who, { localPlaceId: REFINER, selection: 1, random: failing() });
    const done = await refreshAt(who, 180, failing());
    expect(done.refiningRun.attempts).toBe(1);
    expect(done.refiningRun.successes).toBe(0);
    expect(await carried(who.character.id)).toMatchObject({ [SHALE]: 15, [EMPTY]: 2 });
    expect(await carried(who.character.id)).not.toHaveProperty(FULL);
    expect(await refiningXp(who.character.id)).toBe(before + 20);
  });

  it("leaves the Processing Yard at 1x with no persisted venue", async () => {
    const who = await worker(LOCATION_IDS.abandonedProcessingYard);
    const started = await startFuel(who);
    expect(started.activeAction?.nextAttemptDurationTicks).toBe(60);
    expect(await runPlace(who.character.id)).toBeNull();
    const done = await refreshAt(who, 60);
    expect(done.refiningRun.attempts).toBe(1);
    expect(done.refiningRun.recentAttempts[0]!.durationTicks).toBe(60);
  });

  it("refuses a station that is not here, not a station, or not named", async () => {
    const station = await worker();
    // The ring itself hosts no Refining, so a bare start finds none.
    const bare = await startFuel(station);
    expect(bare.refiningError).toBe("refining_unavailable_here");
    // A neighbouring Local Place that hosts no Refining is not a station.
    const terminal = await startFuel(station, {
      localPlaceId: LOCAL_PLACE_IDS.stillreachFuelTerminal,
    });
    expect(terminal.refiningError).toBe("refining_unavailable_here");
    // An unknown ID names nothing.
    const unknown = await startFuel(station, { localPlaceId: "no_such_place" });
    expect(unknown.refiningError).toBe("refining_unavailable_here");

    // From any other World Location the station's parent is wrong, including the
    // Yard, which would otherwise host Refining at 1x.
    for (const location of [
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.windwardTrack,
      LOCATION_IDS.holoHollowLanding,
    ]) {
      const elsewhere = await worker(location);
      const forged = await startFuel(elsewhere, { localPlaceId: REFINER });
      expect(forged.refiningError).toBe("refining_unavailable_here");
      expect(forged.activeAction).toBeUndefined();
      expect(await runPlace(elsewhere.character.id)).not.toBe(REFINER);
    }
    expect(await carried(station.character.id)).toMatchObject({ [SHALE]: 20, [EMPTY]: 2 });
  });

  it("keeps the venue's rate when the same recipe is started again without it", async () => {
    const who = await worker();
    await startFuel(who, { localPlaceId: REFINER });
    // Reopening a different venue, or no venue, cannot reprice or restart the run.
    const again = await startFuel(who, { now: at(30) });
    expect(again.activeAction?.nextAttemptDurationTicks).toBe(180);
    expect(Date.parse(again.activeAction!.nextAttemptAt)).toBe(at(180).getTime());
    expect(await runPlace(who.character.id)).toBe(REFINER);
    const done = await refreshAt(who, 179);
    expect(done.refiningRun.attempts).toBe(0);
  });

  it("applies the same gates as the Yard: level and carried inputs only", async () => {
    const who = await worker();
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, who.character.id),
          eq(rune.inventoryStacks.itemId, EMPTY),
        ),
      );
    const noEmpty = await startFuel(who, { localPlaceId: REFINER });
    expect(noEmpty.activeAction).toBeUndefined();
    expect(noEmpty.refiningError).toBeUndefined();
    expect(noEmpty.stop).toMatchObject({ activity: "refining" });
  });
});
