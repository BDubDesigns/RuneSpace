import { readFileSync } from "node:fs";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import type { ChatMessageView } from "@/game/schemas/chat";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { createPlayResolver, ensurePlayProvisioning } from "@/server/play";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #308 — Mining Secondary Finds against real PostgreSQL.
 *
 * The rules only durable, transactional, server-side state can prove: a find is
 * stored beside the ore with its XP and run history; the authored announcements
 * (and only those) reach General as System rows with no sender; the item, the
 * XP and the announcement commit or roll back together; delivery happens only
 * after the commit; and a System line neither spends a send budget nor can be
 * reported.
 */
suite("issue #308 Mining Secondary Finds (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let chat: typeof import("@/server/chat");
  let reports: typeof import("@/server/player-reports");
  let realtime: typeof import("@/server/realtime");
  const createdUsers: string[] = [];
  const balance = getEffectiveGameBalance();
  const now = new Date("2026-10-01T00:00:00.000Z");
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    chat = await import("@/server/chat");
    reports = await import("@/server/player-reports");
    realtime = await import("@/server/realtime");
  });

  afterEach(async () => {
    // System rows belong to no user, so a user's cleanup never reaches them.
    await db.delete(rune.chatMessages).where(ne(rune.chatMessages.kind, "player"));
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** Every attempt succeeds at minimum yield; the find roll is whatever the test says. */
  const finding = (roll: number): MiningRandom => ({
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
    nextInteger: () => roll,
  });
  // The Jag's table over 120 outcomes: Quartz [0, 3), Topaz [3, 5).
  const JAG_QUARTZ = 0;
  const JAG_TOPAZ = 3;
  // Deep Jag's over 385: Topaz [0, 11), Sapphire [11, 18).
  const DEEP_TOPAZ = 0;
  const DEEP_SAPPHIRE = 11;

  async function makeCharacter(at: string = LOCATION_IDS.theJag) {
    const userId = await createTestUser(db, authSchema, "Finder");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Finder${userId.slice(0, 5)}`,
    );
    await play.getPlayGameplayState(userId, character.id, now, finding(119));
    if (at === LOCATION_IDS.deepJag) {
      await seedRepairTarget(db, rune, character.id, REPAIR_TARGET_IDS.deepJagCaveIn, {
        weldingProgress: getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance)
          .repairIncrements,
        completedAt: now,
      });
    }
    await db
      .update(rune.characters)
      .set({ currentLocationId: at })
      .where(eq(rune.characters.id, character.id));
    return { userId, character };
  }

  /** Start Mining and resolve exactly one attempt at the source's own duration. */
  async function mineOnce(
    userId: string,
    characterId: string,
    random: MiningRandom,
    source: "ferriteShale" | "galvanite" = "ferriteShale",
  ) {
    await miningCommands.startMining(userId, characterId, now, random);
    const due = tick(now, balance.mining.sources[source].attemptDurationTicks);
    return play.getPlayGameplayState(userId, characterId, due, random);
  }

  const announcements = () =>
    db
      .select()
      .from(rune.chatMessages)
      .where(eq(rune.chatMessages.kind, "rare_find"))
      .orderBy(desc(rune.chatMessages.seq));

  async function miningXp(characterId: string) {
    const rows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    return rows[0]?.totalXp ?? 0;
  }

  it("keeps the find beside the ore with its XP and run history", async () => {
    const { userId, character } = await makeCharacter();
    const state = await mineOnce(userId, character.id, finding(JAG_TOPAZ));

    expect(state.carriedByItemId[ITEM_IDS.ferriteShale]).toBe(1);
    expect(state.carriedByItemId[ITEM_IDS.uncutTopaz]).toBe(1);
    // 15 Shale XP + 20 Topaz XP, one combined total.
    expect(await miningXp(character.id)).toBe(35);
    expect(state.run).toMatchObject({
      attempts: 1,
      successes: 1,
      xpGained: 35,
      itemsGained: { [ITEM_IDS.ferriteShale]: 1, [ITEM_IDS.uncutTopaz]: 1 },
    });
    expect(state.run.recentAttempts[0]).toMatchObject({
      itemId: ITEM_IDS.ferriteShale,
      quantityAwarded: 1,
      xpAwarded: 35,
      secondaryFinds: [{ itemId: ITEM_IDS.uncutTopaz, quantity: 1 }],
    });
  });

  it("awards the same 20 Topaz XP at Deep Jag on top of Galvanite's 25", async () => {
    const { userId, character } = await makeCharacter(LOCATION_IDS.deepJag);
    const state = await mineOnce(userId, character.id, finding(DEEP_TOPAZ), "galvanite");
    expect(state.carriedByItemId[ITEM_IDS.galvanite]).toBe(1);
    expect(state.carriedByItemId[ITEM_IDS.uncutTopaz]).toBe(1);
    expect(await miningXp(character.id)).toBe(45);
  });

  it("finds nothing — and announces nothing — when the roll misses every span", async () => {
    const { userId, character } = await makeCharacter();
    const state = await mineOnce(userId, character.id, finding(119));
    expect(state.carriedByItemId[ITEM_IDS.uncutTopaz] ?? 0).toBe(0);
    expect(state.run.recentAttempts[0]?.secondaryFinds).toEqual([]);
    expect(await miningXp(character.id)).toBe(15);
    expect(await announcements()).toEqual([]);
  });

  it.each([
    ["The Jag", LOCATION_IDS.theJag, JAG_QUARTZ, "Uncut Quartz", "ferriteShale", false],
    ["The Jag", LOCATION_IDS.theJag, JAG_TOPAZ, "Uncut Topaz", "ferriteShale", true],
    ["Deep Jag", LOCATION_IDS.deepJag, DEEP_TOPAZ, "Uncut Topaz", "galvanite", false],
    ["Deep Jag", LOCATION_IDS.deepJag, DEEP_SAPPHIRE, "Uncut Sapphire", "galvanite", true],
  ] as const)(
    "%s: %s finds announce only when authored to (%s)",
    async (placeName, locationId, roll, itemName, source, announced) => {
      const { userId, character } = await makeCharacter(locationId);
      await mineOnce(userId, character.id, finding(roll), source);
      const rows = await announcements();
      if (!announced) {
        expect(rows).toEqual([]);
        return;
      }
      expect(rows).toHaveLength(1);
      const [row] = rows;
      // The character's name, never the account's.
      expect(row!.body).toBe(`${character.displayName} just found ${itemName} at ${placeName}!`);
    },
  );

  it("posts a System row to General with no sender, a durable timeline place, and no player semantics", async () => {
    const { userId, character } = await makeCharacter();
    await mineOnce(userId, character.id, finding(JAG_TOPAZ));
    const [row] = await announcements();
    expect(row).toMatchObject({
      kind: "rare_find",
      channel: "general",
      senderPlayerAccountId: null,
      senderCharacterId: null,
      senderCharacterName: null,
      conversationId: null,
      promotedPriceCredits: null,
    });
    // No mentions, no fake identity anywhere.
    expect(
      await db
        .select()
        .from(rune.chatMessageMentions)
        .where(eq(rune.chatMessageMentions.messageId, row!.id)),
    ).toEqual([]);

    // Durable General history carries it, to its finder and to everyone else.
    const history = await chat.readChatHistory(userId, character.id, { channel: "general" });
    const view = history.messages.find((message) => message.id === row!.id);
    expect(view).toMatchObject({
      redacted: false,
      system: true,
      treatment: "rare_find",
      channel: "general",
      body: row!.body,
    });
    expect(view).not.toHaveProperty("senderCharacterId");
    const other = await makeCharacter();
    const otherHistory = await chat.readChatHistory(other.userId, other.character.id, {
      channel: "general",
    });
    expect(otherHistory.messages.some((message) => message.id === row!.id)).toBe(true);
    // Trade never shows it.
    const trade = await chat.readChatHistory(userId, character.id, { channel: "trade" });
    expect(trade.messages.some((message) => message.id === row!.id)).toBe(false);
  });

  it("spends no send budget and cannot be reported", async () => {
    const { userId, character } = await makeCharacter();
    await mineOnce(userId, character.id, finding(JAG_TOPAZ));
    const [row] = await announcements();
    const history = await chat.readChatHistory(userId, character.id, { channel: "general" });
    // The announcement is the finder's find, not the finder's send.
    expect(history.budget.recentSendExpiresInMs).toEqual([]);

    const reporter = await makeCharacter();
    const report = await reports.reportMessage(reporter.userId, reporter.character.id, {
      messageId: row!.id,
      reason: "harassment_hate",
    });
    expect(report).toMatchObject({ error: expect.any(String) });
  });

  it("is delivered live to everyone, and only once the find has committed", async () => {
    const { userId, character } = await makeCharacter();
    const seen: Promise<{ message: ChatMessageView; visible: number }>[] = [];
    const unsubscribe = realtime.getRealtimeFanout().subscribe({
      scope: { playerAccountId: "observer", characterId: "observer" },
      deliver: (envelope) => {
        if (envelope.type !== "chat.message") return;
        const message = envelope.data as ChatMessageView;
        seen.push(
          db
            .select({ id: rune.chatMessages.id })
            .from(rune.chatMessages)
            .where(eq(rune.chatMessages.id, message.id))
            .then((rows) => ({ message, visible: rows.length })),
        );
      },
      close: () => {},
    });
    try {
      await mineOnce(userId, character.id, finding(JAG_TOPAZ));
      const delivered = await Promise.all(seen);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        visible: 1,
        message: { system: true, treatment: "rare_find", channel: "general" },
      });
    } finally {
      unsubscribe();
    }
  });

  it("commits the item, the XP and the announcement together, or none of them", async () => {
    const { userId, character } = await makeCharacter();
    const random = finding(JAG_TOPAZ);
    await miningCommands.startMining(userId, character.id, now, random);
    const due = tick(now, balance.mining.sources.ferriteShale.attemptDurationTicks);

    const delivered: unknown[] = [];
    const unsubscribe = realtime.getRealtimeFanout().subscribe({
      scope: { playerAccountId: "observer", characterId: "observer" },
      deliver: (envelope) => {
        if (envelope.type === "chat.message") delivered.push(envelope.data);
      },
      close: () => {},
    });
    try {
      await expect(
        withResolvedOwnedCharacter(
          userId,
          character.id,
          createPlayResolver(random),
          async (transaction, context) => {
            await ensurePlayProvisioning(transaction, context.character.id);
            // The due attempt has resolved inside this transaction by now.
            const inFlight = await transaction
              .select()
              .from(rune.chatMessages)
              .where(eq(rune.chatMessages.kind, "rare_find"));
            expect(inFlight).toHaveLength(1);
            throw new Error("forced failure after resolution");
          },
          due,
        ),
      ).rejects.toThrow(/forced failure after resolution/);

      // Nothing survived: no stack, no XP, no history, no announcement, no delivery.
      expect(await announcements()).toEqual([]);
      expect(await miningXp(character.id)).toBe(0);
      expect(
        await db
          .select()
          .from(rune.inventoryStacks)
          .where(
            and(
              eq(rune.inventoryStacks.characterId, character.id),
              inArray(rune.inventoryStacks.itemId, [ITEM_IDS.uncutTopaz, ITEM_IDS.ferriteShale]),
            ),
          ),
      ).toEqual([]);
      expect(delivered).toEqual([]);

      // The same window then resolves exactly once and commits all of it.
      const retried = await play.getPlayGameplayState(userId, character.id, due, random);
      expect(retried.carriedByItemId[ITEM_IDS.uncutTopaz]).toBe(1);
      expect(await miningXp(character.id)).toBe(35);
      expect(await announcements()).toHaveLength(1);
      expect(delivered).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it("keeps a rolled find when only one slot remains beside a partial ore stack", async () => {
    const { userId, character } = await makeCharacter();
    // Seven slots are taken by full stacks of other ore; the eighth is a partial
    // Shale stack and there is exactly one free slot: ore tops up, the find takes it.
    await db.insert(rune.inventoryStacks).values([
      ...Array.from({ length: 6 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.galvanite,
        quantity: 10,
      })),
      { characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 9 },
    ]);
    const state = await mineOnce(userId, character.id, finding(JAG_TOPAZ));
    expect(state.carriedByItemId[ITEM_IDS.ferriteShale]).toBe(10);
    expect(state.carriedByItemId[ITEM_IDS.uncutTopaz]).toBe(1);
    expect(state.run.recentAttempts[0]?.secondaryFinds).toHaveLength(1);
  });

  it("refuses to start with no room for the ore beside a possible find", async () => {
    const { userId, character } = await makeCharacter();
    // Seven full stacks leave one free slot: enough for the ore, not for ore plus a find.
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 7 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.galvanite,
        quantity: 10,
      })),
    );
    const state = await miningCommands.startMining(userId, character.id, now, finding(JAG_TOPAZ));
    expect(state.stop).toEqual({ activity: "mining", reason: "inventory_slots_full" });
    expect(state.activeAction).toBeUndefined();
  });

  it("backfills 'no finds' into stored history once, idempotently", async () => {
    const { character } = await makeCharacter();
    const attempt = (sequence: number, extra: Record<string, unknown> = {}) => ({
      sequence,
      success: true,
      itemId: ITEM_IDS.ferriteShale,
      quantityAwarded: 1,
      xpAwarded: 15,
      ...extra,
    });
    const stored = [
      attempt(1),
      attempt(2, { secondaryFinds: [{ itemId: ITEM_IDS.uncutTopaz, quantity: 1 }], xpAwarded: 35 }),
      attempt(3),
    ];
    await db
      .insert(rune.characterMiningState)
      .values({ characterId: character.id, recentAttempts: stored })
      .onConflictDoUpdate({
        target: rune.characterMiningState.characterId,
        set: { recentAttempts: stored },
      });

    // The migration's data step: the statement after its last breakpoint.
    const migration = readFileSync("drizzle/0041_mining_secondary_finds.sql", "utf8");
    const backfill = migration.split("--> statement-breakpoint").at(-1)!;
    const recentAttempts = async () =>
      (
        await db
          .select({ recentAttempts: rune.characterMiningState.recentAttempts })
          .from(rune.characterMiningState)
          .where(eq(rune.characterMiningState.characterId, character.id))
      )[0]!.recentAttempts as { sequence: number; secondaryFinds: unknown[] }[];

    await db.execute(sql.raw(backfill));
    const once = await recentAttempts();
    expect(once.map((entry) => [entry.sequence, entry.secondaryFinds])).toEqual([
      [1, []],
      [2, [{ itemId: ITEM_IDS.uncutTopaz, quantity: 1 }]],
      [3, []],
    ]);
    // Order is kept, an attempt that already carries finds is untouched, and a
    // second run changes nothing.
    await db.execute(sql.raw(backfill));
    expect(await recentAttempts()).toEqual(once);
  });
});
