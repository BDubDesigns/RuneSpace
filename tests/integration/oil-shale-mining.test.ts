import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import type { MiningRandom } from "@/game/domain/mining";
import { PrioritizePrimaryResourcesPreferenceRequestSchema } from "@/game/schemas/gameplay";
import type { ChatMessageView } from "@/game/schemas/chat";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import { createPlayResolver, ensurePlayProvisioning } from "@/server/play";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  systemAnnouncementsBy,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #342 — Skatboll Oil Shale Mining against real PostgreSQL.
 *
 * The rules only durable, transactional, server-side state can prove: the Mining
 * level gate holds against any request, the per-character Prioritize primary
 * resources setting is stored on the right character and read by lazy resolution,
 * and what a player is awarded — items, XP, run history, public chat and live
 * delivery — always matches what was actually committed to Inventory.
 */
suite("issue #342 Oil Shale Mining (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let preferences: typeof import("@/server/character-preference-commands");
  let equipment: typeof import("@/server/equipment");
  let chat: typeof import("@/server/chat");
  let realtime: typeof import("@/server/realtime");
  const createdUsers: string[] = [];
  // The character names this test created. System announcements belong to no
  // account, and suites run concurrently against one database, so every read and
  // the cleanup below are scoped to these names (see `systemAnnouncementsBy`).
  const finders: string[] = [];
  const ownedByThisTest = (message: { body?: string }) =>
    finders.some((name) => message.body?.startsWith(`${name} `));
  const balance = getEffectiveGameBalance();
  const oil = balance.mining.sources.oilShale;
  const thresholds = standardSkillLevelThresholds(balance);
  const xpForLevel = (level: number) => thresholds.find((entry) => entry.level === level)!.totalXp;
  const now = new Date("2026-10-01T00:00:00.000Z");
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);
  const ATTEMPT = oil.attemptDurationTicks;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    preferences = await import("@/server/character-preference-commands");
    equipment = await import("@/server/equipment");
    chat = await import("@/server/chat");
    realtime = await import("@/server/realtime");
  });

  // Foreign System announcements, standing in for another concurrently running
  // suite's rows: present for this whole file, so any unscoped read here ("no
  // announcement at all") or unscoped cleanup would fail or destroy them.
  const bystanders = ["rare_find", "ultra_rare_find"].map((kind) => ({
    kind,
    channel: "general",
    body: `Bystander${randomUUID().slice(0, 8)} just found Motherlode Slab at The South Cut!`,
  }));
  beforeAll(async () => {
    await db.insert(rune.chatMessages).values(bystanders);
  });
  afterAll(async () => {
    const survivors = await db
      .select({ body: rune.chatMessages.body })
      .from(rune.chatMessages)
      .where(
        inArray(
          rune.chatMessages.body,
          bystanders.map((row) => row.body),
        ),
      );
    await db.delete(rune.chatMessages).where(
      inArray(
        rune.chatMessages.body,
        bystanders.map((row) => row.body),
      ),
    );
    // This file's cleanup touched only its own finders' rows.
    expect(survivors).toHaveLength(bystanders.length);
  });

  afterEach(async () => {
    if (finders.length > 0)
      await db.delete(rune.chatMessages).where(systemAnnouncementsBy(rune, finders));
    finders.splice(0);
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /**
   * Scripted draws, consumed in the resolver's order: basis points per attempt,
   * then per full success the yield draw (0, 1, 2 -> 2, 3, 4 shale) and the
   * secondary-table draw (0-4 Sapphire, 5 Motherlode Slab, 6-99 nothing).
   */
  function script(draws: { basisPoints?: number[]; integers?: number[] } = {}) {
    const basisPoints = [...(draws.basisPoints ?? [])];
    const integers = [...(draws.integers ?? [])];
    const random: MiningRandom = {
      nextBasisPoints: () => basisPoints.shift() ?? 0,
      nextUnit: () => 0,
      nextInteger: (exclusiveMaximum) => integers.shift() ?? exclusiveMaximum - 1,
    };
    return random;
  }
  const SAPPHIRE_ROLL = 0;
  const SLAB_ROLL = 5;
  const NO_FIND = 99;
  const NEEDS_LOW_YIELD = 9_999;

  async function makeCharacter(
    miningLevel = 5,
    at: string = LOCATION_IDS.theSouthCut,
    label = "Cutter",
  ) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `${label}${userId.slice(0, 5)}`,
    );
    finders.push(character.displayName);
    await play.getPlayGameplayState(userId, character.id, now, script());
    await db
      .update(rune.characterSkillXp)
      .set({ totalXp: xpForLevel(miningLevel) })
      .where(
        and(
          eq(rune.characterSkillXp.characterId, character.id),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    await db
      .update(rune.characters)
      .set({ currentLocationId: at })
      .where(eq(rune.characters.id, character.id));
    return { userId, character };
  }

  /** Start Mining and resolve exactly one 100-tick attempt. */
  async function mineOnce(userId: string, characterId: string, random: MiningRandom) {
    await miningCommands.startMining(userId, characterId, now, random);
    return play.getPlayGameplayState(userId, characterId, tick(now, ATTEMPT), random);
  }

  const announcements = (kind: "rare_find" | "ultra_rare_find") =>
    db
      .select()
      .from(rune.chatMessages)
      .where(and(eq(rune.chatMessages.kind, kind), systemAnnouncementsBy(rune, finders)))
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
  const baseXp = (level: number) => xpForLevel(level);

  /**
   * Seven full stacks of light ore leave exactly one free slot of the eight, with
   * plenty of carrying mass left, so slots are the only limit in play.
   */
  async function fillAllButOneSlot(characterId: string) {
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 7 }, () => ({
        characterId,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 10,
      })),
    );
  }

  describe("the Mining 5 access gate", () => {
    it("refuses Mining 4 at the server, with no action, time, roll or XP", async () => {
      const { userId, character } = await makeCharacter(4);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.miningError).toBe("mining_level_required");
      expect(state.activeAction).toBeUndefined();
      expect(state.miningSource?.requiredMiningLevel).toBe(5);
      expect(state.miningSource?.successChanceBps).toBe(3_897);
      expect(
        await db
          .select()
          .from(rune.activeActions)
          .where(eq(rune.activeActions.characterId, character.id)),
      ).toEqual([]);
      expect(await miningXp(character.id)).toBe(baseXp(4));
    });

    it("lets Mining 5 start, at the 40.30% level-one-anchored chance", async () => {
      const { userId, character } = await makeCharacter(5);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.miningError).toBeUndefined();
      expect(state.activeAction?.actionId).toBe(oil.actionId);
      expect(state.miningSource).toMatchObject({
        itemId: ITEM_IDS.oilShale,
        successChanceBps: 4_030,
        attemptDurationTicks: 100,
        yieldMinimum: 2,
        yieldMaximum: 4,
        lowYield: { quantity: 1, xp: 20 },
      });
    });

    it("refuses repeated and forged requests the same way, whatever the client claims", async () => {
      const { userId, character } = await makeCharacter(4);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await miningCommands.startMining(userId, character.id, now, script());
        expect(state.miningError).toBe("mining_level_required");
        expect(state.activeAction).toBeUndefined();
      }
      // The Track, between the ship and the mine, offers no Mining at all.
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.southAccessTrack })
        .where(eq(rune.characters.id, character.id));
      const atTrack = await miningCommands.startMining(userId, character.id, now, script());
      expect(atTrack.travelError).toBe("mining_unavailable_here");
      expect(atTrack.activeAction).toBeUndefined();
    });
  });

  describe("outcomes", () => {
    it("pays a full success's ore and 100 XP, and 130 with a Sapphire that does not announce", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(userId, character.id, script({ integers: [1, SAPPHIRE_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(3);
      expect(state.carriedByItemId[ITEM_IDS.uncutSapphire]).toBe(1);
      expect(await miningXp(character.id)).toBe(baseXp(5) + 130);
      expect(state.run).toMatchObject({
        attempts: 1,
        successes: 1,
        xpGained: 130,
        itemsGained: { [ITEM_IDS.oilShale]: 3, [ITEM_IDS.uncutSapphire]: 1 },
      });
      expect(state.run.recentAttempts[0]).toMatchObject({
        success: true,
        lowYield: false,
        quantityAwarded: 3,
        xpAwarded: 130,
        secondaryFinds: [{ itemId: ITEM_IDS.uncutSapphire, quantity: 1 }],
      });
      // No public announcement of any kind from Oil Shale Mining's Sapphire.
      expect(await announcements("rare_find")).toEqual([]);
      expect(await announcements("ultra_rare_find")).toEqual([]);
    });

    it("pays a low yield exactly one shale and 20 XP, with no secondary and no announcement", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(
        userId,
        character.id,
        script({ basisPoints: [NEEDS_LOW_YIELD], integers: [SLAB_ROLL] }),
      );
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.motherlodeSlab] ?? 0).toBe(0);
      expect(await miningXp(character.id)).toBe(baseXp(5) + 20);
      expect(state.run).toMatchObject({ attempts: 1, successes: 0, failures: 1, xpGained: 20 });
      expect(state.run.recentAttempts[0]).toMatchObject({
        success: false,
        lowYield: true,
        quantityAwarded: 1,
        xpAwarded: 20,
        secondaryFinds: [],
      });
      expect(await announcements("ultra_rare_find")).toEqual([]);
    });
  });

  describe("the Motherlode Slab", () => {
    it("stores one 12 kg slab, 250 XP in all, and posts one ULTRA RARE FIND System row", async () => {
      const { userId, character } = await makeCharacter();
      const state = await mineOnce(userId, character.id, script({ integers: [0, SLAB_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.motherlodeSlab]).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(2);
      expect(await miningXp(character.id)).toBe(baseXp(5) + 250);
      expect(state.run.itemsGained[ITEM_IDS.motherlodeSlab]).toBe(1);

      expect(await announcements("rare_find")).toEqual([]);
      const [row] = await announcements("ultra_rare_find");
      expect(row).toMatchObject({
        kind: "ultra_rare_find",
        channel: "general",
        senderPlayerAccountId: null,
        senderCharacterId: null,
        senderCharacterName: null,
        body: `${character.displayName} just found Motherlode Slab at The South Cut!`,
      });

      // The shipped General history reads it back with the Ultra Rare treatment.
      const history = await chat.readChatHistory(userId, character.id, { channel: "general" });
      expect(history.messages.find((message) => message.id === row!.id)).toMatchObject({
        system: true,
        treatment: "ultra_rare_find",
        channel: "general",
      });
    });

    it("is delivered live only after the slab, the XP and the line have committed", async () => {
      const { userId, character } = await makeCharacter();
      const random = script({ integers: [0, SLAB_ROLL] });
      const seen: Promise<{ message: ChatMessageView; visible: number }>[] = [];
      const unsubscribe = realtime.getRealtimeFanout().subscribe({
        scope: { playerAccountId: "observer", characterId: "observer" },
        deliver: (envelope) => {
          if (envelope.type !== "chat.message") return;
          const message = envelope.data as ChatMessageView;
          // Only this test's own announcement: another suite's may share the process.
          if (!ownedByThisTest(message as { body?: string })) return;
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
        await mineOnce(userId, character.id, random);
        const delivered = await Promise.all(seen);
        expect(delivered).toHaveLength(1);
        expect(delivered[0]).toMatchObject({
          visible: 1,
          message: { system: true, treatment: "ultra_rare_find", channel: "general" },
        });
      } finally {
        unsubscribe();
      }
    });

    it("commits the slab, the XP and the line together or not at all, and is safe to retry", async () => {
      const { userId, character } = await makeCharacter();
      const random = script({ integers: [0, SLAB_ROLL, 0, SLAB_ROLL] });
      await miningCommands.startMining(userId, character.id, now, random);
      const due = tick(now, ATTEMPT);
      const delivered: unknown[] = [];
      const unsubscribe = realtime.getRealtimeFanout().subscribe({
        scope: { playerAccountId: "observer", characterId: "observer" },
        deliver: (envelope) => {
          if (
            envelope.type === "chat.message" &&
            ownedByThisTest(envelope.data as { body?: string })
          )
            delivered.push(envelope.data);
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
              const inFlight = await transaction
                .select()
                .from(rune.chatMessages)
                .where(
                  and(
                    eq(rune.chatMessages.kind, "ultra_rare_find"),
                    systemAnnouncementsBy(rune, finders),
                  ),
                );
              expect(inFlight).toHaveLength(1);
              throw new Error("forced failure after resolution");
            },
            due,
          ),
        ).rejects.toThrow(/forced failure after resolution/);

        expect(await announcements("ultra_rare_find")).toEqual([]);
        expect(await miningXp(character.id)).toBe(baseXp(5));
        expect(
          await db
            .select()
            .from(rune.inventoryStacks)
            .where(
              and(
                eq(rune.inventoryStacks.characterId, character.id),
                inArray(rune.inventoryStacks.itemId, [ITEM_IDS.motherlodeSlab, ITEM_IDS.oilShale]),
              ),
            ),
        ).toEqual([]);
        expect(delivered).toEqual([]);

        // The same window then resolves once and commits all of it.
        const retried = await play.getPlayGameplayState(userId, character.id, due, random);
        expect(retried.carriedByItemId[ITEM_IDS.motherlodeSlab]).toBe(1);
        expect(await miningXp(character.id)).toBe(baseXp(5) + 250);
        expect(await announcements("ultra_rare_find")).toHaveLength(1);
        expect(delivered).toHaveLength(1);
      } finally {
        unsubscribe();
      }
    });

    it("never double-awards when two requests resolve the same due attempt at once", async () => {
      const { userId, character } = await makeCharacter();
      const random = script({ integers: [0, SLAB_ROLL, 0, SLAB_ROLL, 0, SLAB_ROLL] });
      await miningCommands.startMining(userId, character.id, now, random);
      const due = tick(now, ATTEMPT);
      await Promise.all([
        play.getPlayGameplayState(userId, character.id, due, random),
        play.getPlayGameplayState(userId, character.id, due, random),
      ]);
      const state = await play.getPlayGameplayState(userId, character.id, due, random);
      expect(state.carriedByItemId[ITEM_IDS.motherlodeSlab]).toBe(1);
      expect(state.run.attempts).toBe(1);
      expect(await announcements("ultra_rare_find")).toHaveLength(1);
      expect(await miningXp(character.id)).toBe(baseXp(5) + 250);
    });
  });

  describe("Prioritize primary resources", () => {
    it("defaults Off, projected from the stored character, and validates as a boolean", async () => {
      const { userId, character } = await makeCharacter();
      const state = await play.getPlayGameplayState(userId, character.id, now, script());
      expect(state.prioritizePrimaryResources).toBe(false);
      const [row] = await db
        .select({ value: rune.characters.prioritizePrimaryResources })
        .from(rune.characters)
        .where(eq(rune.characters.id, character.id));
      expect(row!.value).toBe(false);

      const schema = PrioritizePrimaryResourcesPreferenceRequestSchema;
      const characterId = character.id;
      expect(schema.safeParse({ characterId, prioritizePrimaryResources: true }).success).toBe(
        true,
      );
      for (const forged of ["true", 1, null, undefined, {}]) {
        expect(schema.safeParse({ characterId, prioritizePrimaryResources: forged }).success).toBe(
          false,
        );
      }
    });

    it("persists per character and never touches another's", async () => {
      const first = await makeCharacter(5, LOCATION_IDS.theSouthCut, "Setter");
      const second = await makeCharacter(5, LOCATION_IDS.theSouthCut, "Bystander");
      const state = await preferences.setPrioritizePrimaryResourcesPreference(
        first.userId,
        first.character.id,
        true,
        now,
        script(),
      );
      expect(state.prioritizePrimaryResources).toBe(true);
      expect(
        (await play.getPlayGameplayState(first.userId, first.character.id, now, script()))
          .prioritizePrimaryResources,
      ).toBe(true);
      expect(
        (await play.getPlayGameplayState(second.userId, second.character.id, now, script()))
          .prioritizePrimaryResources,
      ).toBe(false);
      // It turns back Off as readily.
      expect(
        (
          await preferences.setPrioritizePrimaryResourcesPreference(
            first.userId,
            first.character.id,
            false,
            now,
            script(),
          )
        ).prioritizePrimaryResources,
      ).toBe(false);
    });

    it("cannot be set for a character the caller does not own", async () => {
      const owner = await makeCharacter();
      const intruder = await makeCharacter(5, LOCATION_IDS.theSouthCut, "Intruder");
      await expect(
        preferences.setPrioritizePrimaryResourcesPreference(
          intruder.userId,
          owner.character.id,
          true,
          now,
          script(),
        ),
      ).rejects.toThrow();
      const [row] = await db
        .select({ value: rune.characters.prioritizePrimaryResources })
        .from(rune.characters)
        .where(eq(rune.characters.id, owner.character.id));
      expect(row!.value).toBe(false);
    });

    it("Off refuses to start with room for the ore but not for a possible find", async () => {
      const { userId, character } = await makeCharacter();
      await fillAllButOneSlot(character.id);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.stop).toEqual({ activity: "mining", reason: "inventory_slots_full" });
      expect(state.activeAction).toBeUndefined();
      expect(await miningXp(character.id)).toBe(baseXp(5));
    });

    it("Off also protects the mass a Motherlode Slab needs, refusing before anything is spent", async () => {
      const { userId, character } = await makeCharacter();
      // Six stacks of heavy ore leave slots free and room for two shale by mass,
      // but not for the 12 kg slab beside them.
      await db.insert(rune.inventoryStacks).values(
        Array.from({ length: 6 }, () => ({
          characterId: character.id,
          itemId: ITEM_IDS.galvanite,
          quantity: 10,
        })),
      );
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.stop).toEqual({ activity: "mining", reason: "carried_mass_capacity_reached" });
      expect(state.activeAction).toBeUndefined();
      expect(await miningXp(character.id)).toBe(baseXp(5));
    });

    it("On starts on one free slot, keeps the ore up to the stack and forfeits the slab that has no room", async () => {
      const { userId, character } = await makeCharacter();
      await fillAllButOneSlot(character.id);
      await preferences.setPrioritizePrimaryResourcesPreference(
        userId,
        character.id,
        true,
        now,
        script(),
      );
      const state = await mineOnce(userId, character.id, script({ integers: [2, SLAB_ROLL] }));
      // A rolled 4 shale fills the one free slot; the Slab has nowhere to go.
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(4);
      expect(state.carriedByItemId[ITEM_IDS.motherlodeSlab] ?? 0).toBe(0);
      // Full classification and XP stand; the forfeited slab earned nothing.
      expect(await miningXp(character.id)).toBe(baseXp(5) + 100);
      expect(state.run).toMatchObject({
        attempts: 1,
        successes: 1,
        xpGained: 100,
        itemsGained: { [ITEM_IDS.oilShale]: 4 },
      });
      expect(state.run.recentAttempts[0]!.secondaryFinds).toEqual([]);
      expect(await announcements("ultra_rare_find")).toEqual([]);
      expect(await announcements("rare_find")).toEqual([]);
      expect(state.inventory.slotsAvailable).toBe(0);
    });

    it("On keeps only what fits when a rolled 4 meets a nearly full stack, still a full success", async () => {
      const { userId, character } = await makeCharacter();
      await fillAllButOneSlot(character.id);
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId: character.id, itemId: ITEM_IDS.oilShale, quantity: 4 });
      // All eight slots are in use and the shale stack has room for exactly one more.
      await preferences.setPrioritizePrimaryResourcesPreference(
        userId,
        character.id,
        true,
        now,
        script(),
      );
      const state = await mineOnce(userId, character.id, script({ integers: [2, SAPPHIRE_ROLL] }));
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(5);
      expect(state.carriedByItemId[ITEM_IDS.uncutSapphire] ?? 0).toBe(0);
      expect(state.run.recentAttempts[0]).toMatchObject({
        success: true,
        quantityAwarded: 1,
        xpAwarded: 100,
        secondaryFinds: [],
      });
    });

    it("resolves a lazy window under the setting last committed, never rewriting earlier results", async () => {
      const { userId, character } = await makeCharacter();
      const random = script({ integers: [0, NO_FIND, 0, NO_FIND, 0, NO_FIND] });
      await miningCommands.startMining(userId, character.id, now, random);
      // One attempt is due; turning the setting On resolves it first, under Off.
      await preferences.setPrioritizePrimaryResourcesPreference(
        userId,
        character.id,
        true,
        tick(now, ATTEMPT),
        random,
      );
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, ATTEMPT),
        random,
      );
      expect(state.prioritizePrimaryResources).toBe(true);
      expect(state.run.attempts).toBe(1);
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(2);
    });
  });

  describe("a charged Loadsteel Cutter's bonus ore", () => {
    const toolSlot = { assignmentKind: "gear" as const, suitSlotId: "mining_tool" };
    const LOADSTEEL_TICKS = 80;

    /** Equip a Loadsteel Cutter holding `charge` (it needs Mining 5, which these characters have). */
    async function equipLoadsteel(userId: string, characterId: string, charge: number) {
      const [instance] = await db
        .insert(rune.itemInstances)
        .values({ characterId, itemId: ITEM_IDS.loadsteelCutter, currentCharge: charge })
        .returning();
      await equipment.changeEquipment(
        userId,
        characterId,
        { kind: "equip", itemInstanceId: instance!.id, target: toolSlot },
        now,
      );
      return instance!;
    }
    const chargeOf = async (instanceId: string) =>
      (
        await db
          .select({ charge: rune.itemInstances.currentCharge })
          .from(rune.itemInstances)
          .where(eq(rune.itemInstances.id, instanceId))
      )[0]!.charge;

    it("pays a charged low yield 2 shale and 20 XP, and a charged success 3 to 5, offline", async () => {
      const { userId, character } = await makeCharacter();
      const cutter = await equipLoadsteel(userId, character.id, 10);
      const random = script({
        // success, low, low, success, success
        basisPoints: [0, NEEDS_LOW_YIELD, NEEDS_LOW_YIELD, 0, 0],
        // yields 2 -> 3, 3 -> 4 and 4 -> 5 with the charge; no finds
        integers: [0, NO_FIND, 1, NO_FIND, 2, NO_FIND],
      });
      const projected = await miningCommands.startMining(userId, character.id, now, random);
      expect(projected.miningSource).toMatchObject({
        yieldMinimum: 2,
        yieldMaximum: 4,
        chargedYieldMinimum: 3,
        chargedYieldMaximum: 5,
        chargedLowYieldQuantity: 2,
        lowYield: { quantity: 1, xp: 20 },
      });
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, LOADSTEEL_TICKS * 5),
        random,
      );
      const attempts = state.run.recentAttempts;
      expect(attempts.map((attempt) => attempt.quantityAwarded)).toEqual([3, 2, 2, 4, 5]);
      expect(attempts.map((attempt) => attempt.xpAwarded)).toEqual([100, 20, 20, 100, 100]);
      expect(attempts.every((attempt) => attempt.boosted && attempt.chargeConsumed)).toBe(true);
      // Low yields never found anything.
      expect(attempts.filter((attempt) => attempt.lowYield)).toHaveLength(2);
      expect(attempts.every((attempt) => attempt.secondaryFinds.length === 0)).toBe(true);
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(3 + 2 + 2 + 4 + 5);
      expect(state.run).toMatchObject({ attempts: 5, successes: 3, failures: 2, xpGained: 340 });
      expect(await miningXp(character.id)).toBe(baseXp(5) + 340);
      // Exactly one charge per attempt, whatever the outcome.
      expect(await chargeOf(cutter.id)).toBe(5);
      expect(await announcements("ultra_rare_find")).toEqual([]);
    });

    it("spends the last charge on a low yield and pays the ordinary one after it", async () => {
      const { userId, character } = await makeCharacter();
      const cutter = await equipLoadsteel(userId, character.id, 1);
      const random = script({ basisPoints: [NEEDS_LOW_YIELD, NEEDS_LOW_YIELD] });
      await miningCommands.startMining(userId, character.id, now, random);
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, LOADSTEEL_TICKS * 2),
        random,
      );
      expect(
        state.run.recentAttempts.map((a) => [a.boosted, a.quantityAwarded, a.xpAwarded]),
      ).toEqual([
        [true, 2, 20],
        [false, 1, 20],
      ]);
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(3);
      expect(await chargeOf(cutter.id)).toBe(0);
    });

    it("On: keeps the ordinary shale and full XP when only the bonus does not fit, then stops cleanly", async () => {
      const { userId, character } = await makeCharacter();
      const cutter = await equipLoadsteel(userId, character.id, 10);
      await fillAllButOneSlot(character.id);
      // The last slot is a shale stack at 4 of 5: room for exactly one more.
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId: character.id, itemId: ITEM_IDS.oilShale, quantity: 4 });
      await preferences.setPrioritizePrimaryResourcesPreference(
        userId,
        character.id,
        true,
        now,
        script(),
      );
      const random = script({ basisPoints: [NEEDS_LOW_YIELD, 0] });
      await miningCommands.startMining(userId, character.id, now, random);
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, LOADSTEEL_TICKS * 2),
        random,
      );
      expect(state.run.recentAttempts).toHaveLength(1);
      expect(state.run.recentAttempts[0]).toMatchObject({
        lowYield: true,
        quantityAwarded: 1,
        xpAwarded: 20,
        boosted: true,
      });
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(5);
      expect(await miningXp(character.id)).toBe(baseXp(5) + 20);
      expect(await chargeOf(cutter.id)).toBe(9);
      // The next attempt could not keep even one shale, so it never began.
      expect(state.stop).toEqual({ activity: "mining", reason: "inventory_slots_full" });
    });

    it("Off: refuses before spending anything when there is no room for shale plus a find", async () => {
      const { userId, character } = await makeCharacter();
      await fillAllButOneSlot(character.id);
      const cutter = await equipLoadsteel(userId, character.id, 10);
      const state = await miningCommands.startMining(userId, character.id, now, script());
      expect(state.stop).toEqual({ activity: "mining", reason: "inventory_slots_full" });
      expect(state.activeAction).toBeUndefined();
      expect(await chargeOf(cutter.id)).toBe(10);
      expect(await miningXp(character.id)).toBe(baseXp(5));
    });

    it("leaves The Jag's dead miss empty: a charge is spent and buys no ore", async () => {
      const { userId, character } = await makeCharacter(5, LOCATION_IDS.theJag);
      const cutter = await equipLoadsteel(userId, character.id, 10);
      const random = script({ basisPoints: [NEEDS_LOW_YIELD] });
      await miningCommands.startMining(userId, character.id, now, random);
      const state = await play.getPlayGameplayState(userId, character.id, tick(now, 8), random);
      expect(state.run.recentAttempts[0]).toMatchObject({
        success: false,
        lowYield: false,
        boosted: true,
        chargeConsumed: true,
        quantityAwarded: 0,
        xpAwarded: 0,
      });
      expect(state.carriedByItemId[ITEM_IDS.ferriteShale] ?? 0).toBe(0);
      expect(await miningXp(character.id)).toBe(baseXp(5));
      expect(await chargeOf(cutter.id)).toBe(9);
      expect(state.miningSource?.chargedLowYieldQuantity).toBeNull();
    });
  });

  describe("offline and batched resolution", () => {
    it("resolves several attempts in one window with exact per-attempt accounting", async () => {
      const { userId, character } = await makeCharacter();
      const random = script({
        // Success, low yield, success.
        basisPoints: [0, NEEDS_LOW_YIELD, 0],
        // Yields 2 and 4, no finds, then a Sapphire on the last.
        integers: [0, NO_FIND, 2, SAPPHIRE_ROLL],
      });
      await miningCommands.startMining(userId, character.id, now, random);
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        tick(now, ATTEMPT * 3),
        random,
      );
      expect(state.run).toMatchObject({ attempts: 3, successes: 2, failures: 1 });
      // 2 + 1 + 4 shale, one Sapphire; 100 + 20 + 130 XP.
      expect(state.carriedByItemId[ITEM_IDS.oilShale]).toBe(7);
      expect(state.carriedByItemId[ITEM_IDS.uncutSapphire]).toBe(1);
      expect(await miningXp(character.id)).toBe(baseXp(5) + 250);
      expect(state.run.xpGained).toBe(250);
      expect(state.run.recentAttempts.map((attempt) => attempt.lowYield)).toEqual([
        false,
        true,
        false,
      ]);
    });
  });

  describe("persisted history", () => {
    it("backfills 'not a low yield' into stored history once, idempotently", async () => {
      const { character } = await makeCharacter();
      const attempt = (sequence: number, extra: Record<string, unknown> = {}) => ({
        sequence,
        success: true,
        itemId: ITEM_IDS.ferriteShale,
        quantityAwarded: 1,
        xpAwarded: 15,
        secondaryFinds: [],
        ...extra,
      });
      const stored = [attempt(1), attempt(2, { lowYield: true, success: false }), attempt(3)];
      await db
        .insert(rune.characterMiningState)
        .values({ characterId: character.id, recentAttempts: stored })
        .onConflictDoUpdate({
          target: rune.characterMiningState.characterId,
          set: { recentAttempts: stored },
        });

      // The migration's data step: the statement after its last breakpoint.
      const migration = readFileSync("drizzle/0044_oil_shale_mining.sql", "utf8");
      const migrationBackfill = migration.split("--> statement-breakpoint").at(-1)!;
      // The statement is database-wide, and suites share one database and run
      // concurrently, so this test applies the migration's own statement but
      // restricted to the one row it seeded. The guard proves the restriction
      // really was applied to the statement under test, never a rewritten copy.
      const outerWhere = `WHERE jsonb_typeof("recent_attempts") = 'array'`;
      expect(migrationBackfill.split(outerWhere)).toHaveLength(2);
      expect(character.id).toMatch(/^[\w-]+$/);
      const backfill = migrationBackfill.replace(
        outerWhere,
        `WHERE "character_id" = '${character.id}'\n\tAND jsonb_typeof("recent_attempts") = 'array'`,
      );
      expect(backfill).not.toBe(migrationBackfill);
      const lowYields = async () =>
        (
          await db
            .select({ recentAttempts: rune.characterMiningState.recentAttempts })
            .from(rune.characterMiningState)
            .where(eq(rune.characterMiningState.characterId, character.id))
        )[0]!.recentAttempts as { sequence: number; lowYield: boolean }[];

      await db.execute(sql.raw(backfill));
      const once = await lowYields();
      expect(once.map((entry) => [entry.sequence, entry.lowYield])).toEqual([
        [1, false],
        [2, true],
        [3, false],
      ]);
      await db.execute(sql.raw(backfill));
      expect(await lowYields()).toEqual(once);
    });
  });
});
