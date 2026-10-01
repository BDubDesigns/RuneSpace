import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { standardSkillLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS, SKILL_IDS } from "@/game/config/foundations";
import type { RealtimeEnvelope } from "@/game/schemas/realtime";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #274 — automatic System notices for recipe unlocks, against real
 * PostgreSQL through the shared character command boundary.
 *
 * The XP grant is the only writer, so these prove what pure derivation cannot:
 * the notice commits or rolls back with its XP, serialized commands cannot
 * duplicate one crossing, the realtime prompt waits for the commit, the
 * operator's SET TOTAL XP repair writes nothing, and read state is durable.
 */
suite("issue #274 recipe-unlock System notices (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let progression: typeof import("@/server/progression");
  let resolution: typeof import("@/server/action-resolution");
  let systemNotices: typeof import("@/server/system-notices");
  let adminCommands: typeof import("@/server/admin-command-seams");
  let realtime: typeof import("@/server/realtime");

  const createdUsers: string[] = [];
  const thresholds = standardSkillLevelThresholds();
  const xpForLevel = (level: number) =>
    thresholds.find((threshold) => threshold.level === level)!.totalXp;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    progression = await import("@/server/progression");
    resolution = await import("@/server/action-resolution");
    systemNotices = await import("@/server/system-notices");
    adminCommands = await import("@/server/admin-command-seams");
    realtime = await import("@/server/realtime");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A character whose Refining sits at exactly `totalXp`, written directly. */
  async function refiner(totalXp: number) {
    const userId = await createTestUser(db, authSchema, "Unlock Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Unlock ${userId.slice(0, 6)}`,
    );
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId: character.id, skillId: SKILL_IDS.refining, totalXp });
    return { userId, character };
  }

  /** Award Refining XP through the shared owned-character command boundary. */
  function award(userId: string, characterId: string, awardedXp: number) {
    return resolution.withLockedOwnedCharacter(userId, characterId, (transaction) =>
      progression.grantCharacterSkillXp(transaction, {
        characterId,
        skillId: SKILL_IDS.refining,
        awardedXp,
        thresholds,
      }),
    );
  }

  async function noticesFor(characterId: string) {
    return db
      .select()
      .from(rune.recipeUnlockNotices)
      .where(eq(rune.recipeUnlockNotices.characterId, characterId))
      .orderBy(rune.recipeUnlockNotices.seq);
  }

  async function refiningXp(characterId: string) {
    const rows = await db
      .select({ skillId: rune.characterSkillXp.skillId, totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, characterId));
    return rows.find((row) => row.skillId === SKILL_IDS.refining)?.totalXp;
  }

  /** Record what one character's open stream would receive. */
  function listen(character: { id: string; playerAccountId: string }) {
    const received: RealtimeEnvelope[] = [];
    const unsubscribe = realtime.getRealtimeFanout().subscribe({
      scope: { playerAccountId: character.playerAccountId, characterId: character.id },
      deliver: (envelope) => received.push(envelope),
      close: () => undefined,
    });
    return { received, unsubscribe };
  }

  it("writes nothing when an award does not raise the level", async () => {
    const { userId, character } = await refiner(xpForLevel(5));
    await award(userId, character.id, 10);
    expect(await noticesFor(character.id)).toEqual([]);
  });

  it("writes one grouped notice for an exact crossing and never repeats it", async () => {
    const { userId, character } = await refiner(xpForLevel(5) - 1);
    await award(userId, character.id, 1);
    const [notice, ...rest] = await noticesFor(character.id);
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({
      skillId: SKILL_IDS.refining,
      previousLevel: 4,
      level: 5,
      recipeActionIds: [
        ACTION_IDS.galvanicStockRefining,
        ACTION_IDS.ferriteShaleSlagRefining,
        ACTION_IDS.galvaniteSlagRefining,
      ],
      readAt: null,
    });

    // Later XP above the crossed threshold — even another level — repeats nothing.
    await award(userId, character.id, xpForLevel(7) - xpForLevel(5));
    expect(await noticesFor(character.id)).toHaveLength(1);

    const inbox = await systemNotices.readSystemNotices(userId, character.id);
    expect(inbox.unread).toBe(1);
    expect(inbox.notices).toEqual([
      {
        id: notice!.id,
        seq: notice!.seq,
        body: [
          "Refining Level 5 reached.",
          "New recipes unlocked:",
          "- Galvanic Stock",
          "- Slag from Ferrite Shale",
          "- Slag from Galvanite",
        ].join("\n"),
        sentAt: notice!.createdAt.toISOString(),
      },
    ]);
  });

  it("groups every recipe a skipped-level award unlocks into one notice", async () => {
    const { userId, character } = await refiner(xpForLevel(5) - 1);
    await award(userId, character.id, xpForLevel(8) - xpForLevel(5) + 1);
    const notices = await noticesFor(character.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      previousLevel: 4,
      level: 8,
      recipeActionIds: [
        ACTION_IDS.galvanicStockRefining,
        ACTION_IDS.ferriteShaleSlagRefining,
        ACTION_IDS.galvaniteSlagRefining,
        ACTION_IDS.galvaferriteRefining,
      ],
    });
  });

  it("writes nothing for a level rise that unlocks no recipe", async () => {
    const { userId, character } = await refiner(xpForLevel(6) - 1);
    await award(userId, character.id, 1);
    expect(await noticesFor(character.id)).toEqual([]);
  });

  it("rolls the notice back with its XP and publishes nothing", async () => {
    const { userId, character } = await refiner(xpForLevel(5) - 1);
    const stream = listen(character);
    try {
      await expect(
        resolution.withLockedOwnedCharacter(userId, character.id, async (transaction) => {
          await progression.grantCharacterSkillXp(transaction, {
            characterId: character.id,
            skillId: SKILL_IDS.refining,
            awardedXp: 1,
            thresholds,
          });
          throw new Error("later step failed");
        }),
      ).rejects.toThrow("later step failed");
      expect(await refiningXp(character.id)).toBe(xpForLevel(5) - 1);
      expect(await noticesFor(character.id)).toEqual([]);
      expect(stream.received).toEqual([]);
    } finally {
      stream.unsubscribe();
    }
  });

  it("prompts the character's open tabs only after the XP commits", async () => {
    const { userId, character } = await refiner(xpForLevel(5) - 1);
    const stream = listen(character);
    try {
      await resolution.withLockedOwnedCharacter(userId, character.id, async (transaction) => {
        await progression.grantCharacterSkillXp(transaction, {
          characterId: character.id,
          skillId: SKILL_IDS.refining,
          awardedXp: 1,
          thresholds,
        });
        expect(stream.received).toEqual([]);
      });
      expect(stream.received.map((envelope) => envelope.type)).toEqual(["system.notice"]);
    } finally {
      stream.unsubscribe();
    }
  });

  it("cannot duplicate one crossing across concurrent commands", async () => {
    const { userId, character } = await refiner(xpForLevel(5) - 1);
    await Promise.all([award(userId, character.id, 1), award(userId, character.id, 1)]);
    expect(await refiningXp(character.id)).toBe(xpForLevel(5) + 1);
    expect(await noticesFor(character.id)).toHaveLength(1);
  });

  it("never writes a notice for the operator's SET TOTAL XP repair", async () => {
    const { character } = await refiner(xpForLevel(4));
    const stream = listen(character);
    try {
      await adminCommands.setSkillTotalXpAsAdmin(
        "recipe-unlock-test-admin",
        character.id,
        SKILL_IDS.refining,
        xpForLevel(8),
      );
      expect(await refiningXp(character.id)).toBe(xpForLevel(8));
      expect(await noticesFor(character.id)).toEqual([]);
      expect(stream.received.filter((envelope) => envelope.type === "system.notice")).toEqual([]);
    } finally {
      stream.unsubscribe();
    }
  });

  it("keeps read state durable and leaves a newer notice unread", async () => {
    const { userId, character } = await refiner(xpForLevel(5) - 1);
    await award(userId, character.id, 1);
    const [first] = await noticesFor(character.id);
    await award(userId, character.id, xpForLevel(8) - xpForLevel(5));
    expect((await systemNotices.readSystemNotices(userId, character.id)).unread).toBe(2);

    const stream = listen(character);
    try {
      await systemNotices.markSystemNoticesRead(userId, character.id, { throughSeq: first!.seq });
      expect(stream.received.map((envelope) => envelope.type)).toEqual(["system.read"]);
      const afterFirst = await systemNotices.readSystemNotices(userId, character.id);
      expect(afterFirst.unread).toBe(1);
      expect(afterFirst.notices).toHaveLength(2);

      const newest = afterFirst.notices.at(-1)!.seq;
      await systemNotices.markSystemNoticesRead(userId, character.id, { throughSeq: newest });
      expect((await systemNotices.readSystemNotices(userId, character.id)).unread).toBe(0);

      // Re-reading changes nothing and tells no other tab anything.
      await systemNotices.markSystemNoticesRead(userId, character.id, { throughSeq: newest });
      expect(stream.received).toHaveLength(2);
      const readAt = (await noticesFor(character.id)).map((notice) => notice.readAt);
      expect(readAt.every((value) => value instanceof Date)).toBe(true);
    } finally {
      stream.unsubscribe();
    }
  });

  it("only ever reads the active player's own character", async () => {
    const { userId, character } = await refiner(xpForLevel(5) - 1);
    await award(userId, character.id, 1);
    const other = await refiner(0);
    await expect(
      systemNotices.readSystemNotices(other.userId, character.id),
    ).rejects.toBeInstanceOf(ownership.OwnershipError);
    await expect(
      systemNotices.markSystemNoticesRead(other.userId, character.id, { throughSeq: 1e9 }),
    ).rejects.toBeInstanceOf(ownership.OwnershipError);
    expect((await systemNotices.readSystemNotices(userId, character.id)).unread).toBe(1);
  });
});
