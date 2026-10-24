import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, skillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
  SKILL_LEVEL_DIALOGUE_IDS,
} from "@/game/config/foundations";
import { FIRST_RUNEWORKING_LESSON_REWARD_XP } from "@/game/content/missions";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #391 — Seeker? I Hardly Know Her!, against real PostgreSQL.
 *
 * What only the database proves: that completing Not From Around Here accepts
 * the lesson in the same transaction and a character who finished the mystery
 * earlier is offered it in person; that only Seeker attunements made after
 * acceptance count, capped at three, and carried Seekers count for nothing;
 * that the turn-in at the Enby pays 150 Runeworking XP exactly once under
 * concurrency and consumes nothing; and that which Fragment advice the Enby
 * gives follows the character's persisted Mining level.
 */
suite("issue #391 Seeker? I Hardly Know Her! (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let runeworking: typeof import("@/server/runeworking-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-10-23T00:00:00.000Z");
  const seeker = getEffectiveGameBalance().runeworking.recipes.beginnerEchoSeeker;
  const LESSON = MISSION_IDS.firstRuneworkingLesson;
  const enby = NPC_IDS.wiseOldEnby;
  const cycleMs = seeker.durationTicks * GAME_TICK_MS;
  const at = (ms: number) => new Date(start.getTime() + ms);

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    runeworking = await import("@/server/runeworking-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const certain = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  async function makeCharacter(label: string) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Lesson ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, certain());
    return { userId, character };
  }

  /** A character at Hilltop Workshop who finished the mystery before the lesson existed. */
  async function solvedEarlier(label: string) {
    const made = await makeCharacter(label);
    await move(made.character.id, LOCATION_IDS.hilltopWorkshop);
    await db.insert(rune.characterMissions).values({
      characterId: made.character.id,
      missionId: MISSION_IDS.notFromAroundHere,
      acceptedAt: start,
      completedAt: start,
    });
    return made;
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function giveStack(characterId: string, itemId: string, quantity: number) {
    const [row] = await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId, quantity })
      .returning({ id: rune.inventoryStacks.id });
    return row!.id;
  }

  async function carried(characterId: string, itemId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function lessonRows(characterId: string) {
    return db
      .select()
      .from(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, characterId),
          eq(rune.characterMissions.missionId, LESSON),
        ),
      );
  }

  async function runeworkingXp(characterId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.runeworking),
        ),
      );
    return row?.totalXp ?? 0;
  }

  async function lesson(userId: string, characterId: string, when: Date) {
    const state = await play.getPlayGameplayState(userId, characterId, when, certain());
    return state.missions.find((mission) => mission.missionId === LESSON)!;
  }

  /** Attune `count` Seekers in one run starting at `from`; returns when it ends. */
  async function attune(userId: string, characterId: string, count: number, from: Date) {
    await giveStack(characterId, ITEM_IDS.runeFragment, count);
    const started = await runeworking.startRuneworking(
      userId,
      characterId,
      ACTION_IDS.beginnerEchoSeekerRuneworking,
      count,
      from,
    );
    expect(started.runeworkingError).toBeUndefined();
    const end = new Date(from.getTime() + cycleMs * count);
    await play.getPlayGameplayState(userId, characterId, end, certain());
    return end;
  }

  const acceptAtEnby = (userId: string, characterId: string, when: Date) =>
    missions.acceptMission(userId, characterId, LESSON, enby, when, certain());
  const finish = (userId: string, characterId: string, when: Date) =>
    missions.completeMission(userId, characterId, LESSON, enby, when, certain());

  describe("both routes to the same lesson", () => {
    it("accepts the lesson when Not From Around Here is completed at the Enby", async () => {
      const { userId, character } = await makeCharacter("Continuation");
      const fragment = await giveStack(character.id, ITEM_IDS.runeFragment, 1);
      const accepted = await missions.acceptItemOfferMission(
        userId,
        character.id,
        MISSION_IDS.notFromAroundHere,
        fragment,
        start,
        certain(),
      );
      expect(accepted.mission.status).toBe("accepted");
      expect(await lessonRows(character.id)).toEqual([]);
      await move(character.id, LOCATION_IDS.hilltopWorkshop);
      const done = await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.notFromAroundHere,
        enby,
        start,
        certain(),
      );
      expect(done.mission.status).toBe("completed");
      const rows = await lessonRows(character.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ acceptedAt: start, completedAt: null });
      const projection = done.state.missions.find((mission) => mission.missionId === LESSON)!;
      expect(projection.state).toBe("active");
      expect(projection.currentObjective).toBe(
        "Attune Beginner Echo Seekers at the Resonance Rig — 0 / 3",
      );
      // The Rig opened in that same transaction.
      expect(done.state.resonanceRig.unlocked).toBe(true);
      // A replayed completion converges on the same single lesson record.
      await missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.notFromAroundHere,
        enby,
        start,
        certain(),
      );
      expect(await lessonRows(character.id)).toHaveLength(1);
    });

    it("offers the lesson in person to a character who solved the mystery earlier", async () => {
      const { userId, character } = await solvedEarlier("Fallback");
      const offered = await lesson(userId, character.id, start);
      expect(offered.state).toBe("not_accepted");
      expect(offered.prerequisiteSatisfied).toBe(true);
      expect(offered.guidance).toEqual({ availableNpcIds: [enby] });
      const [first, second] = await Promise.all([
        acceptAtEnby(userId, character.id, start),
        acceptAtEnby(userId, character.id, start),
      ]);
      expect([first.mission.status, second.mission.status].sort()).toEqual([
        "accepted",
        "already_accepted",
      ]);
      expect(await lessonRows(character.id)).toHaveLength(1);
      expect((await lesson(userId, character.id, start)).state).toBe("active");
    });

    it("is not offered away from the Enby, nor before the mystery is solved", async () => {
      const elsewhere = await solvedEarlier("Away");
      await move(elsewhere.character.id, LOCATION_IDS.stillreachLandingStation);
      const away = await acceptAtEnby(elsewhere.userId, elsewhere.character.id, start);
      expect(away.mission.status).toBe("refused");
      expect(await lessonRows(elsewhere.character.id)).toEqual([]);

      const early = await makeCharacter("Early");
      await move(early.character.id, LOCATION_IDS.hilltopWorkshop);
      const refused = await acceptAtEnby(early.userId, early.character.id, start);
      expect(refused.mission.status).toBe("refused");
      expect(await lessonRows(early.character.id)).toEqual([]);
    });
  });

  describe("progress counts attunements after acceptance", () => {
    it("ignores Seekers made before acceptance and Seekers merely carried", async () => {
      const { userId, character } = await solvedEarlier("Before");
      const afterEarly = await attune(userId, character.id, 2, start);
      await giveStack(character.id, ITEM_IDS.beginnerEchoSeeker, 3);
      expect(await carried(character.id, ITEM_IDS.beginnerEchoSeeker)).toBe(5);
      await acceptAtEnby(userId, character.id, afterEarly);
      const fresh = await lesson(userId, character.id, afterEarly);
      expect(fresh.state).toBe("active");
      expect(fresh.requirements?.[0]).toMatchObject({
        satisfied: false,
        progress: { current: 0, target: 3 },
        sourcesItemId: ITEM_IDS.beginnerEchoSeeker,
      });

      const afterOne = await attune(userId, character.id, 1, afterEarly);
      expect((await lesson(userId, character.id, afterOne)).currentObjective).toBe(
        "Attune Beginner Echo Seekers at the Resonance Rig — 1 / 3",
      );
    });

    it("caps at 3/3 and hands off to the turn-in at the Enby", async () => {
      const { userId, character } = await solvedEarlier("Cap");
      await acceptAtEnby(userId, character.id, start);
      const end = await attune(userId, character.id, 5, start);
      const ready = await lesson(userId, character.id, end);
      expect(ready.state).toBe("ready_for_completion");
      expect(ready.requirements?.[0]).toMatchObject({
        satisfied: true,
        progress: { current: 3, target: 3 },
      });
      expect(ready.requirements?.[0]?.sourcesItemId).toBeUndefined();
      expect(ready.currentObjective).toBe("Return to the Wise Old Enby at Hilltop Workshop");
    });

    it("refuses the turn-in early, elsewhere, or mid-run", async () => {
      const { userId, character } = await solvedEarlier("Early turn-in");
      await acceptAtEnby(userId, character.id, start);
      expect((await finish(userId, character.id, start)).mission.status).toBe("refused");
      const end = await attune(userId, character.id, 3, start);

      // Busy at the Rig: a fourth attunement is running.
      await giveStack(character.id, ITEM_IDS.runeFragment, 1);
      await runeworking.startRuneworking(
        userId,
        character.id,
        ACTION_IDS.beginnerEchoSeekerRuneworking,
        1,
        end,
      );
      expect((await finish(userId, character.id, end)).mission).toMatchObject({
        status: "refused",
        reason: "not_stationary",
      });
      const idle = new Date(end.getTime() + cycleMs);
      await play.getPlayGameplayState(userId, character.id, idle, certain());

      await move(character.id, LOCATION_IDS.stillreachLandingStation);
      expect((await finish(userId, character.id, idle)).mission.status).toBe("refused");
      expect(await lessonRows(character.id)).toMatchObject([{ completedAt: null }]);
    });
  });

  describe("the turn-in", () => {
    it("pays 150 Runeworking XP exactly once under concurrency and keeps every Seeker", async () => {
      const { userId, character } = await solvedEarlier("Turn in");
      await acceptAtEnby(userId, character.id, start);
      const end = await attune(userId, character.id, 3, start);
      const xpBefore = await runeworkingXp(character.id);
      expect(xpBefore).toBe(3 * seeker.baseXp);
      const seekersBefore = await carried(character.id, ITEM_IDS.beginnerEchoSeeker);

      const results = await Promise.all([
        finish(userId, character.id, end),
        finish(userId, character.id, end),
      ]);
      expect(results.map((result) => result.mission.status).sort()).toEqual([
        "already_completed",
        "completed",
      ]);
      expect(await runeworkingXp(character.id)).toBe(xpBefore + FIRST_RUNEWORKING_LESSON_REWARD_XP);
      // The lesson consumes no Seeker; its continuation (#393) adds exactly two.
      expect(await carried(character.id, ITEM_IDS.beginnerEchoSeeker)).toBe(seekersBefore + 2);
      expect(
        results.find((result) => result.mission.status === "completed")?.mission,
      ).toMatchObject({
        continuation: { missionId: MISSION_IDS.firstResonanceEcho, status: "accepted" },
      });
      const [row] = await lessonRows(character.id);
      expect(row?.completedAt).toEqual(end);

      const done = await lesson(userId, character.id, end);
      expect(done.state).toBe("completed");
      expect(done.guidance).toBeUndefined();
      // Later attunements credit nothing and pay no second reward.
      const later = await attune(userId, character.id, 1, end);
      expect(await runeworkingXp(character.id)).toBe(
        xpBefore + FIRST_RUNEWORKING_LESSON_REWARD_XP + seeker.baseXp,
      );
      expect((await finish(userId, character.id, later)).mission.status).toBe("already_completed");
    });
  });

  describe("the Enby's Fragment advice follows the persisted Mining level", () => {
    const advice = SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice;
    const miningXp = (level: number) =>
      skillLevelThresholds(SKILL_IDS.mining)!.find((threshold) => threshold.level === level)!
        .totalXp;

    async function adviceAt(miningLevel: number | undefined) {
      const { userId, character } = await solvedEarlier(`Mining ${miningLevel ?? "none"}`);
      const row = and(
        eq(rune.characterSkillXp.characterId, character.id),
        eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
      );
      if (miningLevel === undefined) await db.delete(rune.characterSkillXp).where(row);
      else
        await db
          .update(rune.characterSkillXp)
          .set({ totalXp: miningXp(miningLevel) })
          .where(row);
      const state = await play.getPlayGameplayState(userId, character.id, start, certain());
      return state.skillLevelDialogue[advice];
    }

    it("gives the novice advice with no Mining XP row and below Mining 8", async () => {
      expect(await adviceAt(undefined)).toBe(DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice);
      expect(await adviceAt(7)).toBe(DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice);
    });

    it("gives the experienced advice from Mining 8", async () => {
      expect(await adviceAt(8)).toBe(DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced);
      expect(await adviceAt(9)).toBe(DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced);
    });
  });
});
