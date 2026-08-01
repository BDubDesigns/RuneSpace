import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { POWER_ANNEX_REWARD_SOURCE_ID } from "@/game/domain/power-annex";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("Issue #47 Power Annex claims (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let mining: typeof import("@/server/mining");
  let annex: typeof import("@/server/power-annex");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    mining = await import("@/server/mining");
    annex = await import("@/server/power-annex");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeAccount(characterCount = 1) {
    const userId = await createTestUser(db, authSchema, "Power Annex Tester");
    createdUsers.push(userId);
    const created = [];
    for (let slot = 0; slot < characterCount; slot += 1) {
      created.push(
        await createCharacterForUser(
          db,
          rune,
          ownership,
          characters,
          userId,
          `Annex ${userId.slice(0, 6)} ${slot}`,
        ),
      );
    }
    return { userId, characters: created };
  }

  async function powerCellStacks(characterId: string) {
    return db
      .select()
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.powerCell),
        ),
      );
  }

  it("authorizes location, grants once per Pacific date, and is idempotent", async () => {
    const { userId, characters: owned } = await makeAccount();
    const character = owned[0]!;
    const beforeMidnight = new Date("2026-01-02T07:59:59.000Z");
    const outsider = await makeAccount();
    await expect(
      annex.claimPowerCells(outsider.userId, character.id, beforeMidnight),
    ).rejects.toThrow(/not found/i);

    const wrongLocation = await annex.claimPowerCells(userId, character.id, beforeMidnight);
    expect(wrongLocation.claim).toMatchObject({ status: "error", reason: "not_at_annex" });
    expect(await powerCellStacks(character.id)).toEqual([]);

    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.emergencyPowerAnnex })
      .where(eq(rune.characters.id, character.id));
    const first = await annex.claimPowerCells(userId, character.id, beforeMidnight);
    expect(first.claim).toMatchObject({ status: "claimed", quantity: 5, resetDate: "2026-01-01" });
    expect((await powerCellStacks(character.id)).map((stack) => stack.quantity)).toEqual([5]);

    const retry = await annex.claimPowerCells(userId, character.id, beforeMidnight);
    expect(retry.claim).toMatchObject({ status: "already_claimed", resetDate: "2026-01-01" });
    expect((await powerCellStacks(character.id)).map((stack) => stack.quantity)).toEqual([5]);

    const afterMidnight = await annex.claimPowerCells(
      userId,
      character.id,
      new Date("2026-01-02T08:00:00.000Z"),
    );
    expect(afterMidnight.claim).toMatchObject({ status: "claimed", resetDate: "2026-01-02" });
    expect((await powerCellStacks(character.id)).map((stack) => stack.quantity).sort()).toEqual([
      5, 5,
    ]);
    await expect(
      db
        .select()
        .from(rune.characterPowerCellDailyClaims)
        .where(eq(rune.characterPowerCellDailyClaims.characterId, character.id)),
    ).resolves.toHaveLength(2);
  });

  it("lets all three characters on one account claim independently", async () => {
    const { userId, characters: owned } = await makeAccount(3);
    const now = new Date("2026-04-01T12:00:00.000Z");
    for (const character of owned) {
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.emergencyPowerAnnex })
        .where(eq(rune.characters.id, character.id));
    }

    const results = await Promise.all(
      owned.map((character) => annex.claimPowerCells(userId, character.id, now)),
    );
    expect(results.map((result) => result.claim.status)).toEqual(["claimed", "claimed", "claimed"]);
    for (const character of owned) {
      expect(
        (await powerCellStacks(character.id)).reduce((total, stack) => total + stack.quantity, 0),
      ).toBe(5);
    }
    expect(
      await db
        .select()
        .from(rune.characterPowerCellDailyClaims)
        .where(
          and(
            eq(rune.characterPowerCellDailyClaims.rewardSourceId, POWER_ANNEX_REWARD_SOURCE_ID),
            inArray(
              rune.characterPowerCellDailyClaims.characterId,
              owned.map((character) => character.id),
            ),
          ),
        ),
    ).toHaveLength(3);
  });

  it("refuses full-reward slot or mass fit without recording a claim", async () => {
    const slotsFixture = await makeAccount();
    const slotCharacter = slotsFixture.characters[0]!;
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.emergencyPowerAnnex })
      .where(eq(rune.characters.id, slotCharacter.id));
    await mining.getMiningGameplayState(
      slotsFixture.userId,
      slotCharacter.id,
      new Date("2026-04-02T12:00:00Z"),
    );
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 8 }, (_, index) => ({
        characterId: slotCharacter.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: index + 1,
      })),
    );
    const slotResult = await annex.claimPowerCells(
      slotsFixture.userId,
      slotCharacter.id,
      new Date("2026-04-02T12:00:00Z"),
    );
    expect(slotResult.claim).toMatchObject({ status: "error", reason: "slots" });
    expect(await powerCellStacks(slotCharacter.id)).toEqual([]);
    expect(
      await db
        .select()
        .from(rune.characterPowerCellDailyClaims)
        .where(eq(rune.characterPowerCellDailyClaims.characterId, slotCharacter.id)),
    ).toEqual([]);

    const massFixture = await makeAccount();
    const massCharacter = massFixture.characters[0]!;
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.emergencyPowerAnnex })
      .where(eq(rune.characters.id, massCharacter.id));
    await mining.getMiningGameplayState(
      massFixture.userId,
      massCharacter.id,
      new Date("2026-04-02T12:00:00Z"),
    );
    await db.insert(rune.itemInstances).values(
      Array.from({ length: 7 }, () => ({
        characterId: massCharacter.id,
        itemId: ITEM_IDS.salvageCutter,
      })),
    );
    const massResult = await annex.claimPowerCells(
      massFixture.userId,
      massCharacter.id,
      new Date("2026-04-02T12:00:00Z"),
    );
    expect(massResult.claim).toMatchObject({ status: "error", reason: "mass" });
    expect(await powerCellStacks(massCharacter.id)).toEqual([]);
    expect(
      await db
        .select()
        .from(rune.characterPowerCellDailyClaims)
        .where(eq(rune.characterPowerCellDailyClaims.characterId, massCharacter.id)),
    ).toEqual([]);
  });

  it("serializes concurrent claims and never resolves an active action", async () => {
    const { userId, characters: owned } = await makeAccount();
    const character = owned[0]!;
    const now = new Date("2026-05-01T12:00:00.000Z");
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.emergencyPowerAnnex })
      .where(eq(rune.characters.id, character.id));

    const concurrent = await Promise.all([
      annex.claimPowerCells(userId, character.id, now),
      annex.claimPowerCells(userId, character.id, now),
    ]);
    expect(concurrent.map((result) => result.claim.status).sort()).toEqual([
      "already_claimed",
      "claimed",
    ]);
    expect(
      (await powerCellStacks(character.id)).reduce((total, stack) => total + stack.quantity, 0),
    ).toBe(5);

    await db
      .delete(rune.characterPowerCellDailyClaims)
      .where(eq(rune.characterPowerCellDailyClaims.characterId, character.id));
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "future_activity",
      startedAt: now,
      resolvedThroughAt: now,
    });
    const blocked = await annex.claimPowerCells(
      userId,
      character.id,
      new Date("2026-05-01T13:00:00Z"),
    );
    expect(blocked.claim).toMatchObject({ status: "error", reason: "active_action" });
    expect(await powerCellStacks(character.id)).toHaveLength(1);
    await expect(
      db.select().from(rune.activeActions).where(eq(rune.activeActions.characterId, character.id)),
    ).resolves.toMatchObject([
      { actionId: "future_activity", startedAt: now, resolvedThroughAt: now },
    ]);
    expect(
      await db
        .select()
        .from(rune.characterPowerCellDailyClaims)
        .where(eq(rune.characterPowerCellDailyClaims.characterId, character.id)),
    ).toEqual([]);
  });
});
