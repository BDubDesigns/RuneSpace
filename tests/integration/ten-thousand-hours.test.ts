import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS, MISSION_IDS, NPC_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #190 — 10,000 Hours' authoritative boundaries, against real PostgreSQL.
 *
 * The rules that only a database can prove: that Wade's six Scrap are granted
 * all-or-nothing with the acceptance stamp itself and never twice, that a
 * refusal leaves absolutely nothing behind, that accepting is what opens the
 * bench and the Trade counter, and that the turn-in pays 50 Credits exactly
 * once with no second helping of Welding XP.
 */
suite("issue #190 10,000 Hours acceptance (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let trade: typeof import("@/server/trade");
  let practiceCommands: typeof import("@/server/practice-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-09-15T00:00:00.000Z");
  const balance = getEffectiveGameBalance();

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    trade = await import("@/server/trade");
    practiceCommands = await import("@/server/practice-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  /**
   * A character who has already finished Keep the Change and walked to the
   * yard — exactly the state an existing pre-beta player is in after this
   * deploys, with no backfill of any kind.
   */
  async function apprenticeAtTheYard(label = "Ten Thousand Hours Tester") {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Hours ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    await db
      .insert(rune.characterMissions)
      .values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
          MISSION_IDS.keepTheChange,
        ].map((missionId) => ({
          characterId: character.id,
          missionId,
          acceptedAt: now,
          completedAt: now,
        })),
      );
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    return { userId, character };
  }

  const accept = (userId: string, characterId: string) =>
    missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.tenThousandHours,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );

  async function carriedScrap(characterId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.scrapMetal),
        ),
      );
    return { total: rows.reduce((sum, row) => sum + row.quantity, 0), stacks: rows.length };
  }

  async function missionRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, MISSION_IDS.tenThousandHours),
          ),
        )
    )[0];
  }

  async function credits(characterId: string) {
    return (
      await db
        .select({ credits: rune.characters.credits })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]?.credits;
  }

  async function weldingXp(characterId: string) {
    return (
      await db
        .select({ totalXp: rune.characterSkillXp.totalXp })
        .from(rune.characterSkillXp)
        .where(
          and(
            eq(rune.characterSkillXp.characterId, characterId),
            eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
          ),
        )
    )[0]?.totalXp;
  }

  /** Fill inventory slots so a grant of six cannot fit. */
  async function fillSlots(characterId: string, stacks: number) {
    for (let index = 0; index < stacks; index += 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 1 });
    }
  }

  it("grants exactly six Scrap with the acceptance stamp", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    const result = await accept(userId, character.id);

    expect(result.mission.status).toBe("accepted");
    const scrap = await carriedScrap(character.id);
    expect(scrap.total).toBe(6);
    // Non-stacking: six pieces is six occupied slots.
    expect(scrap.stacks).toBe(6);
    expect((await missionRow(character.id))?.acceptedAt).not.toBeNull();
  });

  it("grants them exactly once under retries and concurrent acceptance", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    const [first, second] = await Promise.all([
      accept(userId, character.id),
      accept(userId, character.id),
    ]);
    const statuses = [first.mission.status, second.mission.status].sort();
    expect(statuses).toEqual(["accepted", "already_accepted"]);

    // A third, sequential retry changes nothing either.
    expect((await accept(userId, character.id)).mission.status).toBe("already_accepted");
    expect((await carriedScrap(character.id)).total).toBe(6);
  });

  it("refuses without granting anything, accepting anything, or leaving a row", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    // The starter container holds eight slots; leave room for only five pieces.
    await fillSlots(character.id, 3);

    const refused = await accept(userId, character.id);
    expect(refused.mission).toMatchObject({
      status: "refused",
      reason: "capacity",
      capacityReason: "slots",
    });
    expect((await carriedScrap(character.id)).total).toBe(0);
    expect(await missionRow(character.id)).toBeUndefined();
    // No progress row was created for a Mission that was never accepted.
    const progress = await db
      .select()
      .from(rune.characterMissionProgress)
      .where(
        and(
          eq(rune.characterMissionProgress.characterId, character.id),
          eq(rune.characterMissionProgress.missionId, MISSION_IDS.tenThousandHours),
        ),
      );
    expect(progress).toHaveLength(0);
  });

  it("accepts cleanly on the retry once the player has made room", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await fillSlots(character.id, 3);
    expect((await accept(userId, character.id)).mission.status).toBe("refused");

    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, character.id),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.ferriteShale),
        ),
      );

    const retried = await accept(userId, character.id);
    expect(retried.mission.status).toBe("accepted");
    expect((await carriedScrap(character.id)).total).toBe(6);
  });

  it("refuses an acceptance attempted from anywhere but the yard", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.holoHollow })
      .where(eq(rune.characters.id, character.id));

    const refused = await accept(userId, character.id);
    expect(refused.mission.status).toBe("refused");
    expect((await carriedScrap(character.id)).total).toBe(0);
    expect(await missionRow(character.id)).toBeUndefined();
  });

  it("refuses acceptance from anybody but Wade", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    const refused = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.tenThousandHours,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(refused.mission.status).toBe("refused");
    expect((await carriedScrap(character.id)).total).toBe(0);
  });

  it("refuses until Keep the Change is genuinely completed", async () => {
    const userId = await createTestUser(db, authSchema, "Ten Thousand Hours Prerequisite");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Pre ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));

    const refused = await accept(userId, character.id);
    expect(refused.mission.status).toBe("refused");
    expect((await carriedScrap(character.id)).total).toBe(0);
  });

  it("opens the bench and Wade's Trade counter from that one accepted record", async () => {
    const { userId, character } = await apprenticeAtTheYard();

    // Locked beforehand: the bench refuses and the counter does not exist.
    const lockedStart = await practiceCommands.startPracticeWelding(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(lockedStart.practiceError).toBe("practice_locked");
    expect(lockedStart.practice.unlocked).toBe(false);

    const lockedTrade = await trade.tradeWithMerchant(
      userId,
      character.id,
      { itemId: ITEM_IDS.scrapMetal, direction: "buy", quantity: 1 },
      now,
    );
    expect(lockedTrade.trade).toMatchObject({ status: "refused", reason: "no_merchant" });

    await accept(userId, character.id);

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    expect(state.practice.unlocked).toBe(true);
    const opened = await trade.tradeWithMerchant(
      userId,
      character.id,
      { itemId: ITEM_IDS.scrapMetal, direction: "buy", quantity: 1 },
      now,
    );
    expect(opened.trade.status).toBe("traded");
  });

  it("sells Scrap at two Credits in any quantity Credits and capacity allow", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await accept(userId, character.id);
    // Six pieces already fill six of eight slots; sell nothing, buy what fits.
    await db
      .update(rune.characters)
      .set({ credits: 100 })
      .where(eq(rune.characters.id, character.id));

    const bought = await trade.tradeWithMerchant(
      userId,
      character.id,
      { itemId: ITEM_IDS.scrapMetal, direction: "buy", quantity: 2 },
      now,
    );
    expect(bought.trade).toMatchObject({ status: "traded", totalCredits: 4 });
    expect((await carriedScrap(character.id)).total).toBe(8);
    expect(await credits(character.id)).toBe(96);

    // And capacity, not stock, is what stops the next purchase.
    const overCapacity = await trade.tradeWithMerchant(
      userId,
      character.id,
      { itemId: ITEM_IDS.scrapMetal, direction: "buy", quantity: 1 },
      now,
    );
    expect(overCapacity.trade).toMatchObject({ status: "refused", reason: "slots" });
  });

  it("does not let Wade buy Slag back; that stays Bix's line", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await accept(userId, character.id);
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId: character.id, itemId: ITEM_IDS.slag, quantity: 2 });

    const refused = await trade.tradeWithMerchant(
      userId,
      character.id,
      { itemId: ITEM_IDS.slag, direction: "sell", quantity: 1 },
      now,
    );
    expect(refused.trade).toMatchObject({ status: "refused", reason: "not_traded" });
  });

  it("pays 50 Credits exactly once at the turn-in, and no extra Welding XP", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await accept(userId, character.id);
    // Three genuine welds are proven in the Practice suite; this is the turn-in.
    await db
      .update(rune.characterMissionProgress)
      .set({ progress: 3 })
      .where(
        and(
          eq(rune.characterMissionProgress.characterId, character.id),
          eq(rune.characterMissionProgress.missionId, MISSION_IDS.tenThousandHours),
        ),
      );
    const creditsBefore = (await credits(character.id))!;
    const xpBefore = await weldingXp(character.id);

    const completed = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.tenThousandHours,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    expect(await credits(character.id)).toBe(creditsBefore + 50);
    expect(await weldingXp(character.id)).toBe(xpBefore);

    // Retried and concurrent turn-ins pay nothing further.
    const [again, alsoAgain] = await Promise.all([
      missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.tenThousandHours,
        NPC_IDS.wadeRusk,
        now,
        deterministicRandom(),
      ),
      missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.tenThousandHours,
        NPC_IDS.wadeRusk,
        now,
        deterministicRandom(),
      ),
    ]);
    expect(again.mission.status).toBe("already_completed");
    expect(alsoAgain.mission.status).toBe("already_completed");
    expect(await credits(character.id)).toBe(creditsBefore + 50);
  });

  it("refuses the turn-in before three welds are genuinely done", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await accept(userId, character.id);
    const refused = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.tenThousandHours,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );
    expect(refused.mission).toMatchObject({ status: "refused", reason: "tracked_activity" });
  });

  it("keeps the bench and the counter open after the Mission is finished", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await accept(userId, character.id);
    await db
      .update(rune.characterMissions)
      .set({ completedAt: now })
      .where(
        and(
          eq(rune.characterMissions.characterId, character.id),
          eq(rune.characterMissions.missionId, MISSION_IDS.tenThousandHours),
        ),
      );

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    expect(state.practice.unlocked).toBe(true);
    expect(state.workOrders.revealed).toBe(true);
    expect(state.workOrders.meetsWeldingLevel).toBe(false);
    expect(state.workOrders.requiredWeldingLevel).toBe(balance.workOrders.requiredWeldingLevel);
  });

  it("keeps the Work Orders terminal hidden until the Mission is turned in", async () => {
    const { userId, character } = await apprenticeAtTheYard();
    await accept(userId, character.id);
    // Even at a high Welding level, the terminal stays scenery until then.
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId: character.id, skillId: SKILL_IDS.welding, totalXp: 100_000 })
      .onConflictDoUpdate({
        target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
        set: { totalXp: 100_000 },
      });

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    expect(state.workOrders.revealed).toBe(false);
    expect(state.workOrders.meetsWeldingLevel).toBe(true);
  });
});
