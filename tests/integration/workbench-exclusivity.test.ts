import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  practiceSectionXp,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
  WORK_ORDER_IDS,
  type WorkOrderId,
} from "@/game/config/foundations";
import { getWorkOrder } from "@/game/content/work-orders";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #207 — one Workbench, one unfinished unit, against real PostgreSQL.
 *
 * There is a single bench in Wade's yard, and once customer property can be on
 * it the question "is anything already on it?" has to have exactly one answer.
 * What only a database proves is that a refused command leaves the OTHER
 * unit's row byte-for-byte as it found it — a Practice weld the player paid two
 * Scrap for is never silently overwritten by a client job, and an accepted job
 * is never quietly cleared by a fresh weld — and that "Finish Current Weld and
 * Stop" is the one path that clears the bench without costing another cycle.
 */
suite("issue #207 Workbench exclusivity (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let practiceCommands: typeof import("@/server/practice-commands");
  let workOrderCommands: typeof import("@/server/work-order-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-15T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const sectionMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const weldMs = sectionMs * balance.practiceWelding.sectionsPerWeld;
  const practiceXp = practiceSectionXp(balance);
  /** Welding XP at the level threshold every fixture in this suite starts on. */
  const startingWeldingXp = standardSkillLevelThresholds(balance).find(
    (threshold) => threshold.level === balance.workOrders.requiredWeldingLevel,
  )!.totalXp;

  const JOB = WORK_ORDER_IDS.rennCarryFrame;
  const BOARD: readonly WorkOrderId[] = [
    JOB,
    WORK_ORDER_IDS.vossHeaterHousing,
    WORK_ORDER_IDS.bixShopShelving,
  ];
  const job = getWorkOrder(JOB)!;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    practiceCommands = await import("@/server/practice-commands");
    workOrderCommands = await import("@/server/work-order-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  const at = (msFromStart: number) => new Date(start.getTime() + msFromStart);

  /**
   * An apprentice with both kinds of work available to them: the bench open
   * from 10,000 Hours, client work open from 10,001 Hours, and enough Scrap
   * that a second Practice weld is genuinely affordable — which is what makes
   * "consumed no further Scrap" a real assertion rather than a shortage.
   */
  async function welder(options: { scrap?: number; materials?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, "Workbench Exclusivity Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Bench ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, deterministicRandom());
    await db.insert(rune.characterMissions).values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
        MISSION_IDS.tenThousandHours,
      ].map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));

    await db
      .insert(rune.characterSkillXp)
      .values({ characterId: character.id, skillId: SKILL_IDS.welding, totalXp: startingWeldingXp })
      .onConflictDoUpdate({
        target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
        set: { totalXp: startingWeldingXp },
      });

    const accepted = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.tenThousandOneHours,
      NPC_IDS.wadeRusk,
      start,
      deterministicRandom(),
    );
    expect(accepted.mission.status).toBe("accepted");

    // The board is drawn from the pool with real randomness, which is right for
    // a player and useless for a fixture; these tests choose their postings.
    await db
      .delete(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, character.id));
    await db.insert(rune.characterWorkOrderPostings).values(
      BOARD.map((workOrderId, slotIndex) => ({
        characterId: character.id,
        slotIndex,
        workOrderId,
        postedAt: start,
        updatedAt: start,
      })),
    );

    await setScrap(character.id, options.scrap ?? 4);
    if (options.materials !== false) await giveMaterials(character.id, job.materials);
    return { userId, character };
  }

  /** Each piece as its own single-piece row — a valid layout at three to a stack (#230). */
  async function setScrap(characterId: string, pieces: number) {
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.scrapMetal),
        ),
      );
    for (let index = 0; index < pieces; index += 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.scrapMetal, quantity: 1 });
    }
  }

  async function giveMaterials(
    characterId: string,
    materials: readonly { itemId: string; quantity: number }[],
  ) {
    for (const material of materials) {
      const definition = getItemDefinition(material.itemId, balance);
      if (definition?.kind !== "stack") {
        throw new Error(`${material.itemId} is not a stackable Work Order material`);
      }
      let remaining = material.quantity;
      while (remaining > 0) {
        const quantity = Math.min(remaining, definition.stackLimit);
        remaining -= quantity;
        await db
          .insert(rune.inventoryStacks)
          .values({ characterId, itemId: material.itemId, quantity });
      }
    }
  }

  async function practiceRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterPracticeWelds)
        .where(eq(rune.characterPracticeWelds.characterId, characterId))
    )[0];
  }

  async function postings(characterId: string) {
    const rows = await db
      .select()
      .from(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, characterId));
    return rows.sort((a, b) => a.slotIndex - b.slotIndex);
  }

  async function activeAction(characterId: string) {
    return (
      await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, characterId))
    )[0];
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

  async function weldingXp(characterId: string) {
    return (
      (
        await db
          .select({ totalXp: rune.characterSkillXp.totalXp })
          .from(rune.characterSkillXp)
          .where(
            and(
              eq(rune.characterSkillXp.characterId, characterId),
              eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
            ),
          )
      )[0]?.totalXp ?? 0
    );
  }

  const refresh = (userId: string, characterId: string, ms: number) =>
    play.getPlayGameplayState(userId, characterId, at(ms), deterministicRandom());

  const startPractice = (userId: string, characterId: string, ms = 0) =>
    practiceCommands.startPracticeWelding(userId, characterId, at(ms), deterministicRandom());

  const stopPractice = (userId: string, characterId: string, ms: number) =>
    practiceCommands.stopPracticeWelding(userId, characterId, at(ms), deterministicRandom());

  const finishCurrentWeld = (userId: string, characterId: string, ms: number) =>
    practiceCommands.finishCurrentPracticeWeld(userId, characterId, at(ms), deterministicRandom());

  const acceptJob = (userId: string, characterId: string, ms: number) =>
    workOrderCommands.acceptWorkOrder(userId, characterId, JOB, at(ms), deterministicRandom());

  /** A Practice weld the player paid for, stopped with real partial progress. */
  async function stoppedPartialWeld(userId: string, characterId: string, sections = 4) {
    await startPractice(userId, characterId);
    await stopPractice(userId, characterId, sectionMs * sections);
    const row = await practiceRow(characterId);
    expect(row?.cycleActive).toBe(true);
    expect(row?.sectionsCompleted).toBe(sections);
    return row!;
  }

  /** A client job on the bench, with its materials already committed. */
  async function acceptedJob(userId: string, characterId: string) {
    const accepted = await acceptJob(userId, characterId, 0);
    expect(accepted.workOrder).toMatchObject({ status: "accepted", workOrderId: JOB });
    return (await postings(characterId)).find((row) => row.acceptedAt !== null)!;
  }

  describe("an unfinished Practice weld holds the bench", () => {
    it("refuses a Work Order over a weld the player stopped part-way, untouched", async () => {
      const { userId, character } = await welder();
      const before = await stoppedPartialWeld(userId, character.id);

      const refused = await acceptJob(userId, character.id, sectionMs * 6);
      expect(refused.workOrder).toMatchObject({
        status: "refused",
        reason: "workbench_occupied",
      });
      // The paid weld is exactly as it was, and the job's materials are still
      // the player's: nothing was committed for a job that never went on.
      expect(await practiceRow(character.id)).toEqual(before);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(job.materials[0]!.quantity);
      expect((await postings(character.id)).every((row) => row.acceptedAt === null)).toBe(true);
    });

    it("refuses a Work Order while a weld is actually running, untouched", async () => {
      const { userId, character } = await welder();
      await startPractice(userId, character.id);
      const before = await practiceRow(character.id);

      // A running weld is still the bench being occupied, and says so: the
      // terminal is only ever standing next to bench work, so the generic
      // "finish the active activity" other surfaces give would be less true.
      const refused = await acceptJob(userId, character.id, 100);
      expect(refused.workOrder).toMatchObject({
        status: "refused",
        reason: "workbench_occupied",
      });
      expect(await practiceRow(character.id)).toEqual(before);
      expect((await activeAction(character.id))?.actionId).toBe(ACTION_IDS.practiceWelding);
      expect((await postings(character.id)).every((row) => row.acceptedAt === null)).toBe(true);
    });

    it("lets the same weld Resume, keeping every section it already had", async () => {
      const { userId, character } = await welder({ scrap: 2 });
      const stopped = await stoppedPartialWeld(userId, character.id);
      // Resume works with no Scrap left at all: this weld's two were spent when
      // it began.
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);

      const resumed = await startPractice(userId, character.id, sectionMs * 6);
      expect(resumed.practiceError).toBeUndefined();
      const row = await practiceRow(character.id);
      expect(row?.sectionsCompleted).toBe(stopped.sectionsCompleted);
      expect(row?.cycleActive).toBe(true);
      expect(row?.cleanPass).toEqual(stopped.cleanPass);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    });
  });

  describe("an accepted Work Order holds the bench", () => {
    it("refuses a fresh Practice weld, leaving the job and its Scrap alone", async () => {
      const { userId, character } = await welder();
      const before = await acceptedJob(userId, character.id);
      const scrapBefore = await carried(character.id, ITEM_IDS.scrapMetal);

      const refused = await startPractice(userId, character.id, 1_000);
      expect(refused.practiceError).toBe("workbench_occupied");
      expect((await postings(character.id)).find((row) => row.acceptedAt !== null)).toEqual(before);
      // A refused start materializes no Practice row and spends no Scrap.
      expect(await practiceRow(character.id)).toBeUndefined();
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(scrapBefore);
      expect(await activeAction(character.id)).toBeUndefined();
    });

    it("refuses a fresh Practice weld while the job is being welded, untouched", async () => {
      const { userId, character } = await welder();
      await acceptedJob(userId, character.id);
      await workOrderCommands.startWorkOrderWelding(
        userId,
        character.id,
        start,
        deterministicRandom(),
      );
      const before = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      const scrapBefore = await carried(character.id, ITEM_IDS.scrapMetal);

      // An active action is refused one step earlier than the bench check, so
      // it reports through the shared command channel rather than as a
      // Practice-specific error.
      const refused = await startPractice(userId, character.id, 100);
      expect(refused.commandError).toBe("another_action_active");
      expect(refused.practiceError).toBeUndefined();
      expect((await postings(character.id)).find((row) => row.acceptedAt !== null)).toEqual(before);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(scrapBefore);
      expect((await activeAction(character.id))?.actionId).toBe(ACTION_IDS.workOrderWelding);
    });

    it("lets the same job Resume, keeping every section it already had", async () => {
      const { userId, character } = await welder();
      await acceptedJob(userId, character.id);
      await workOrderCommands.startWorkOrderWelding(
        userId,
        character.id,
        start,
        deterministicRandom(),
      );
      await workOrderCommands.stopWorkOrderWelding(
        userId,
        character.id,
        at(sectionMs * 3),
        deterministicRandom(),
      );
      const stopped = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      expect(stopped.sectionsCompleted).toBe(3);

      const resumed = await workOrderCommands.startWorkOrderWelding(
        userId,
        character.id,
        at(sectionMs * 4),
        deterministicRandom(),
      );
      expect(resumed.workOrder).toEqual({ status: "started" });
      const row = (await postings(character.id)).find((entry) => entry.acceptedAt !== null)!;
      expect(row.sectionsCompleted).toBe(3);
      expect(row.cleanPass).toEqual(stopped.cleanPass);

      // And the work continues from three rather than from zero.
      await refresh(userId, character.id, sectionMs * 6);
      expect(
        (await postings(character.id)).find((entry) => entry.acceptedAt !== null)
          ?.sectionsCompleted,
      ).toBe(5);
    });
  });

  describe("Stop After Current Weld", () => {
    /**
     * The shared proof, from whichever state the bench was in: the paid weld
     * completes with ordinary semantics, no next cycle begins, the durable
     * intent is spent, and the bench is genuinely free for client work.
     */
    async function expectFinishedCleanly(userId: string, characterId: string) {
      const row = await practiceRow(characterId);
      expect(row?.cycleActive).toBe(false);
      expect(row?.sectionsCompleted).toBe(0);
      expect(row?.finishCurrentWeld).toBe(false);
      expect(row?.lastStopReason).toBe("finished_current_weld");
      expect(row?.cleanPass).toBeNull();
      expect(await activeAction(characterId)).toBeUndefined();

      // Ordinary completion semantics: the weld's Slag and its whole XP.
      expect(await carried(characterId, ITEM_IDS.slag)).toBe(balance.practiceWelding.slagPerWeld);
      expect(await weldingXp(characterId)).toBe(
        startingWeldingXp + balance.practiceWelding.sectionsPerWeld * practiceXp,
      );

      // The one Scrap assertion that matters: the next cycle's two are still
      // carried, because no next cycle was ever begun.
      expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(2);

      // And the bench is clear enough for a customer's property.
      const accepted = await acceptJob(userId, characterId, weldMs * 3);
      expect(accepted.workOrder).toMatchObject({ status: "accepted", workOrderId: JOB });
    }

    it("finishes a RUNNING weld and stops there", async () => {
      const { userId, character } = await welder({ scrap: 4 });
      await startPractice(userId, character.id);
      // Part-way through the weld the player has already paid for.
      await refresh(userId, character.id, sectionMs * 3);
      expect((await practiceRow(character.id))?.sectionsCompleted).toBe(3);

      const intent = await finishCurrentWeld(userId, character.id, sectionMs * 3 + 100);
      expect(intent.practiceError).toBeUndefined();
      // The projected client field, not just the row: this is what the
      // Workbench UI actually reads to show the control as armed.
      expect(intent.practice.finishCurrentWeld).toBe(true);
      expect((await practiceRow(character.id))?.finishCurrentWeld).toBe(true);

      // Long enough for a second weld, had one ever been started.
      const resolved = await refresh(userId, character.id, weldMs * 2);
      expect(resolved.practice.finishCurrentWeld).toBe(false);
      await expectFinishedCleanly(userId, character.id);
    });

    it("finishes a STOPPED partial weld and stops there", async () => {
      const { userId, character } = await welder({ scrap: 4 });
      await stoppedPartialWeld(userId, character.id);
      expect(await activeAction(character.id)).toBeUndefined();

      // The weld cannot finish unless it runs, so this resumes it — and
      // resuming a paid weld consumes nothing and rerolls nothing.
      const intent = await finishCurrentWeld(userId, character.id, sectionMs * 5);
      expect(intent.practiceError).toBeUndefined();
      expect((await activeAction(character.id))?.actionId).toBe(ACTION_IDS.practiceWelding);
      expect(intent.practice.finishCurrentWeld).toBe(true);
      expect((await practiceRow(character.id))?.finishCurrentWeld).toBe(true);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(2);

      const resolved = await refresh(userId, character.id, weldMs * 3);
      expect(resolved.practice.finishCurrentWeld).toBe(false);
      await expectFinishedCleanly(userId, character.id);
    });
  });

  it("still preserves a partial weld and its rolls on an ordinary Stop", async () => {
    const { userId, character } = await welder({ scrap: 2 });
    await startPractice(userId, character.id);
    const running = await practiceRow(character.id);

    await stopPractice(userId, character.id, sectionMs * 4);

    const stopped = await practiceRow(character.id);
    expect(stopped?.sectionsCompleted).toBe(4);
    expect(stopped?.cycleActive).toBe(true);
    // Ordinary Stop is not "finish and stop": it sets no such intent.
    expect(stopped?.finishCurrentWeld).toBe(false);
    // The rolls are the same rolls, with only the window Stop closed marked.
    expect((stopped?.cleanPass as { section: number }[]).map((entry) => entry.section)).toEqual(
      (running?.cleanPass as { section: number }[]).map((entry) => entry.section),
    );
    // Stop never refunds Scrap and never produces Slag early.
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    expect(await carried(character.id, ITEM_IDS.slag)).toBe(0);
  });

  it("never lets a refused command overwrite the other unfinished bench unit", async () => {
    const { userId, character } = await welder();

    // A Practice weld holds the bench: every Work Order command is refused and
    // the weld's row is byte-for-byte what it was.
    const weld = await stoppedPartialWeld(userId, character.id);
    for (const attempt of [
      () => acceptJob(userId, character.id, sectionMs * 6),
      () =>
        workOrderCommands.startWorkOrderWelding(
          userId,
          character.id,
          at(sectionMs * 6),
          deterministicRandom(),
        ),
      () =>
        workOrderCommands.stopWorkOrderWelding(
          userId,
          character.id,
          at(sectionMs * 6),
          deterministicRandom(),
        ),
    ]) {
      const refused = await attempt();
      expect(refused.workOrder.status).toBe("refused");
      expect(await practiceRow(character.id)).toEqual(weld);
      expect((await postings(character.id)).every((row) => row.acceptedAt === null)).toBe(true);
    }

    // Now the other way round, on a clean bench with a client job on it.
    const finished = await welder();
    const job0 = await acceptedJob(finished.userId, finished.character.id);
    for (const attempt of [
      () => startPractice(finished.userId, finished.character.id, 1_000),
      () => stopPractice(finished.userId, finished.character.id, 1_000),
      () => finishCurrentWeld(finished.userId, finished.character.id, 1_000),
    ]) {
      await attempt();
      expect(
        (await postings(finished.character.id)).find((row) => row.acceptedAt !== null),
      ).toEqual(job0);
    }
  });
});
