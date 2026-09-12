import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS, MISSION_IDS, NPC_IDS } from "@/game/config/foundations";
import { DIALOGUE_IDS, LOCAL_PLACE_IDS } from "@/game/config/foundations";
import { getLocalPlace } from "@/game/content/local-places";
import { deriveLocalPlaceAccess } from "@/game/domain/local-places";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #170 — Keep the Change, against real PostgreSQL.
 *
 * These are the rules a browser or a pure unit test cannot prove: that Wade's
 * 24-Credit budget is granted exactly once even under retries and concurrent
 * requests, that the mandatory Bix conversation is satisfied only by the
 * authoritative command at the right place, that delivery consumes exactly
 * three Power Cells through the shared inventory boundary whatever the stack
 * layout, that completion pays nothing extra, and that HH B&B's door derives
 * from the completion record itself rather than a second stored flag.
 */
suite("issue #170 Keep the Change (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let missionState: typeof import("@/server/mission-state");
  const createdUsers: string[] = [];
  const now = new Date("2026-09-12T00:00:00.000Z");

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    missionState = await import("@/server/mission-state");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  async function makeCharacter(label = "Keep the Change Tester") {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Keep ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    return { userId, character };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  /** Seeds the completed starter chain so Keep the Change is eligible. */
  async function completeChainThroughHoldItTogether(characterId: string) {
    await db
      .insert(rune.characterMissions)
      .values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
        ].map((missionId) => ({ characterId, missionId, acceptedAt: now, completedAt: now })),
      );
  }

  async function credits(characterId: string) {
    const row = (
      await db
        .select({ credits: rune.characters.credits })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0];
    return row?.credits;
  }

  async function addPowerCells(characterId: string, quantities: readonly number[]) {
    for (const quantity of quantities) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.powerCell, quantity });
    }
  }

  async function carriedPowerCells(characterId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.powerCell),
        ),
      );
    return {
      total: rows.reduce((sum, row) => sum + row.quantity, 0),
      stacks: rows.map((row) => row.quantity).sort((a, b) => a - b),
    };
  }

  async function conversationProgress(characterId: string) {
    const row = (
      await db
        .select({ progress: rune.characterMissionProgress.progress })
        .from(rune.characterMissionProgress)
        .where(
          and(
            eq(rune.characterMissionProgress.characterId, characterId),
            eq(rune.characterMissionProgress.missionId, MISSION_IDS.keepTheChange),
            eq(rune.characterMissionProgress.progressKey, "bix-introduction"),
          ),
        )
    )[0];
    return row?.progress;
  }

  const accept = (userId: string, characterId: string) =>
    missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.keepTheChange,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );

  const meetBix = (
    userId: string,
    characterId: string,
    npcId: string = NPC_IDS.bixWeller,
    dialogueId: string = DIALOGUE_IDS.bixKeepTheChangeIntroduction,
  ) =>
    missions.acknowledgeMissionConversation(
      userId,
      characterId,
      MISSION_IDS.keepTheChange,
      npcId,
      dialogueId,
      now,
      deterministicRandom(),
    );

  const deliver = (userId: string, characterId: string) =>
    missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.keepTheChange,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );

  /** Accepted at Wade, met Bix, and standing at The Jag ready to hand over. */
  async function readyToDeliver(cellStacks: readonly number[]) {
    const { userId, character } = await makeCharacter();
    await completeChainThroughHoldItTogether(character.id);
    expect((await accept(userId, character.id)).mission.status).toBe("accepted");
    await move(character.id, LOCATION_IDS.holoHollow);
    expect((await meetBix(userId, character.id)).mission.status).toBe("acknowledged");
    await addPowerCells(character.id, cellStacks);
    await move(character.id, LOCATION_IDS.theJag);
    return { userId, character };
  }

  describe("availability and the 24-Credit budget", () => {
    it("refuses acceptance until Hold It Together is completed, and grants nothing", () => {
      return (async () => {
        const { userId, character } = await makeCharacter();
        const before = await credits(character.id);
        const refused = await accept(userId, character.id);
        expect(refused.mission.status).toBe("refused");
        expect(await credits(character.id)).toBe(before);
        expect(
          await db
            .select()
            .from(rune.characterMissions)
            .where(
              and(
                eq(rune.characterMissions.characterId, character.id),
                eq(rune.characterMissions.missionId, MISSION_IDS.keepTheChange),
              ),
            ),
        ).toHaveLength(0);
      })();
    });

    it("does not auto-accept after Hold It Together — the player has to take the job", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      const state = await play.getPlayGameplayState(
        userId,
        character.id,
        now,
        deterministicRandom(),
      );
      const projected = state.missions.find(
        (mission) => mission.missionId === MISSION_IDS.keepTheChange,
      );
      expect(projected?.state).toBe("not_accepted");
      expect(projected?.prerequisiteSatisfied).toBe(true);
      expect(await credits(character.id)).toBe(rune.STARTING_CREDITS);
    });

    it("grants exactly 24 Credits when the job is taken", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      const before = await credits(character.id);
      expect((await accept(userId, character.id)).mission.status).toBe("accepted");
      expect(await credits(character.id)).toBe((before ?? 0) + 24);
    });

    it("never grants the budget twice on a retry", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      expect((await accept(userId, character.id)).mission.status).toBe("accepted");
      const retried = await accept(userId, character.id);
      expect(retried.mission.status).toBe("already_accepted");
      expect(await credits(character.id)).toBe(rune.STARTING_CREDITS + 24);
    });

    it("never grants the budget twice under concurrent acceptance", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      const results = await Promise.all([
        accept(userId, character.id),
        accept(userId, character.id),
        accept(userId, character.id),
      ]);
      const statuses = results.map((result) => result.mission.status).sort();
      expect(statuses).toEqual(["accepted", "already_accepted", "already_accepted"]);
      expect(await credits(character.id)).toBe(rune.STARTING_CREDITS + 24);
    });

    it("refuses acceptance from the wrong person or the wrong place, granting nothing", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      const wrongNpc = await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.keepTheChange,
        NPC_IDS.bixWeller,
        now,
        deterministicRandom(),
      );
      expect(wrongNpc.mission.status).toBe("refused");

      await move(character.id, LOCATION_IDS.holoHollow);
      const wrongPlace = await accept(userId, character.id);
      expect(wrongPlace.mission.status).toBe("refused");
      expect(await credits(character.id)).toBe(rune.STARTING_CREDITS);
    });
  });

  describe("the mandatory Bix conversation", () => {
    it("refuses to record the conversation before the job is accepted", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await move(character.id, LOCATION_IDS.holoHollow);
      const refused = await meetBix(userId, character.id);
      expect(refused.mission.status).toBe("refused");
      expect(await conversationProgress(character.id)).toBeUndefined();
    });

    it("refuses credit for another person or another scene", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await accept(userId, character.id);
      await move(character.id, LOCATION_IDS.holoHollow);

      // Right scene, wrong person.
      expect((await meetBix(userId, character.id, NPC_IDS.rennCalder)).mission.status).toBe(
        "refused",
      );
      // Right person, a scene this mission does not author.
      expect(
        (await meetBix(userId, character.id, NPC_IDS.bixWeller, DIALOGUE_IDS.bixPowerCellsTopic))
          .mission.status,
      ).toBe("refused");
      expect(await conversationProgress(character.id)).toBe(0);
    });

    it("refuses credit from anywhere but the authored location", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await accept(userId, character.id);
      // Standing at the Crash Site, not in town.
      expect((await meetBix(userId, character.id)).mission.status).toBe("refused");
      expect(await conversationProgress(character.id)).toBe(0);
    });

    it("records the conversation once and stays satisfied when replayed", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await accept(userId, character.id);
      await move(character.id, LOCATION_IDS.holoHollow);

      expect((await meetBix(userId, character.id)).mission.status).toBe("acknowledged");
      expect(await conversationProgress(character.id)).toBe(1);
      // Playing the scene again is a harmless no-op rather than a second event.
      const again = await meetBix(userId, character.id);
      expect(again.mission.status).toBe("already_acknowledged");
      expect(await conversationProgress(character.id)).toBe(1);

      const concurrent = await Promise.all([
        meetBix(userId, character.id),
        meetBix(userId, character.id),
      ]);
      for (const result of concurrent) {
        expect(result.mission.status).toBe("already_acknowledged");
      }
      expect(await conversationProgress(character.id)).toBe(1);
    });

    it("is not satisfied by trading with Bix", async () => {
      const trade = await import("@/server/trade");
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      await accept(userId, character.id);
      await move(character.id, LOCATION_IDS.holoHollow);

      const bought = await trade.tradeWithMerchant(
        userId,
        character.id,
        {
          localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
          itemId: ITEM_IDS.powerCell,
          direction: "buy",
          quantity: 3,
        },
        now,
      );
      expect(bought.trade.status).toBe("traded");
      // Money moved and Cells arrived, but the introduction has not happened.
      expect(await conversationProgress(character.id)).toBe(0);
      expect((await carriedPowerCells(character.id)).total).toBe(3);
      await move(character.id, LOCATION_IDS.theJag);
      const refused = await deliver(userId, character.id);
      expect(refused.mission).toMatchObject({ status: "refused", reason: "npc_conversation" });
    });
  });

  describe("delivering exactly three Power Cells", () => {
    it("refuses delivery when the player is short, consuming nothing", async () => {
      const { userId, character } = await readyToDeliver([2]);
      const refused = await deliver(userId, character.id);
      expect(refused.mission).toMatchObject({ status: "refused", reason: "insufficient_items" });
      expect((await carriedPowerCells(character.id)).total).toBe(2);
    });

    it("consumes exactly three from one stack", async () => {
      const { userId, character } = await readyToDeliver([3]);
      expect((await deliver(userId, character.id)).mission.status).toBe("completed");
      expect(await carriedPowerCells(character.id)).toEqual({ total: 0, stacks: [] });
    });

    it("consumes exactly three spread across stacks and keeps the remainder", async () => {
      // Two partial stacks: the shared removal planner decides which rows to
      // decrement, and only three cells in total may leave.
      const { userId, character } = await readyToDeliver([2, 2]);
      expect((await deliver(userId, character.id)).mission.status).toBe("completed");
      expect((await carriedPowerCells(character.id)).total).toBe(1);
    });

    it("leaves extra Cells alone", async () => {
      const { userId, character } = await readyToDeliver([5, 4]);
      expect((await deliver(userId, character.id)).mission.status).toBe("completed");
      expect((await carriedPowerCells(character.id)).total).toBe(6);
    });

    it("pays nothing extra on completion", async () => {
      const { userId, character } = await readyToDeliver([3]);
      const before = await credits(character.id);
      const xpBefore = await db
        .select()
        .from(rune.characterSkillXp)
        .where(eq(rune.characterSkillXp.characterId, character.id));
      const itemsBefore = await db
        .select()
        .from(rune.itemInstances)
        .where(eq(rune.itemInstances.characterId, character.id));

      expect((await deliver(userId, character.id)).mission).toEqual({ status: "completed" });

      // The budget the player kept is untouched, and no second payout exists.
      expect(await credits(character.id)).toBe(before);
      expect(
        await db
          .select()
          .from(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, character.id)),
      ).toEqual(xpBefore);
      expect(
        await db
          .select()
          .from(rune.itemInstances)
          .where(eq(rune.itemInstances.characterId, character.id)),
      ).toHaveLength(itemsBefore.length);
    });

    it("cannot be completed twice, and a replay consumes nothing more", async () => {
      const { userId, character } = await readyToDeliver([5]);
      expect((await deliver(userId, character.id)).mission.status).toBe("completed");
      expect((await carriedPowerCells(character.id)).total).toBe(2);
      const replayed = await deliver(userId, character.id);
      expect(replayed.mission.status).toBe("already_completed");
      expect((await carriedPowerCells(character.id)).total).toBe(2);
    });

    it("cannot be completed twice under concurrent turn-ins", async () => {
      const { userId, character } = await readyToDeliver([5, 5]);
      const results = await Promise.all([
        deliver(userId, character.id),
        deliver(userId, character.id),
      ]);
      expect(results.map((result) => result.mission.status).sort()).toEqual([
        "already_completed",
        "completed",
      ]);
      // Exactly one delivery of three cells came out of the ten carried.
      expect((await carriedPowerCells(character.id)).total).toBe(7);
    });

    it("accepts Cells the player already had before taking the job", async () => {
      const { userId, character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      // Carried before acceptance, and never traded for.
      await addPowerCells(character.id, [3]);
      const startingCredits = await credits(character.id);
      expect((await accept(userId, character.id)).mission.status).toBe("accepted");
      await move(character.id, LOCATION_IDS.holoHollow);
      expect((await meetBix(userId, character.id)).mission.status).toBe("acknowledged");
      await move(character.id, LOCATION_IDS.theJag);
      expect((await deliver(userId, character.id)).mission.status).toBe("completed");
      // Nothing was spent, so the whole budget stays with the player.
      expect(await credits(character.id)).toBe((startingCredits ?? 0) + 24);
    });
  });

  describe("the HH B&B unlock", () => {
    it("derives from the completion record with no second stored flag", async () => {
      const { userId, character } = await readyToDeliver([3]);
      const bnb = getLocalPlace(LOCAL_PLACE_IDS.hhBnb)!;

      const lockedIds = await db.transaction((transaction) =>
        missionState.loadCompletedMissionIds(transaction, character.id),
      );
      expect(lockedIds.has(MISSION_IDS.keepTheChange)).toBe(false);
      expect(deriveLocalPlaceAccess(bnb, lockedIds).available).toBe(false);

      expect((await deliver(userId, character.id)).mission.status).toBe("completed");

      const openIds = await db.transaction((transaction) =>
        missionState.loadCompletedMissionIds(transaction, character.id),
      );
      expect(openIds.has(MISSION_IDS.keepTheChange)).toBe(true);
      expect(deriveLocalPlaceAccess(bnb, openIds)).toEqual({ available: true });

      // The unlock is the Mission row itself: no place/unlock table exists to
      // disagree with it.
      expect(Object.keys(rune).some((name) => /unlock/i.test(name) && /place/i.test(name))).toBe(
        false,
      );
    });

    it("stays locked for a character who has not finished the job", async () => {
      const { character } = await makeCharacter();
      await completeChainThroughHoldItTogether(character.id);
      const ids = await db.transaction((transaction) =>
        missionState.loadCompletedMissionIds(transaction, character.id),
      );
      expect(ids.has(MISSION_IDS.holdItTogether)).toBe(true);
      expect(deriveLocalPlaceAccess(getLocalPlace(LOCAL_PLACE_IDS.hhBnb)!, ids).available).toBe(
        false,
      );
    });
  });
});
