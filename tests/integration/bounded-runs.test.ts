import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  practiceSectionXp,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MAX,
  BOUNDED_RUN_QUANTITY_CEILING,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #229 — bounded Refining and Practice runs, against real PostgreSQL.
 *
 * What only a database proves: that the selected quantity is durable across
 * lazy/offline resolution and refresh, that a run stops at exactly its selected
 * count inside one resolution window, and that Start revalidates the quantity
 * against the inventory as it stands inside the character lock — refusing a
 * stale or forged selection with no row, Scrap, or input touched.
 */
suite("issue #229 bounded runs (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let progression: typeof import("@/server/progression");
  let refiningCommands: typeof import("@/server/refining-commands");
  let practiceCommands: typeof import("@/server/practice-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-20T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const tick = GAME_TICK_MS;
  const weldMs =
    balance.welding.attemptDurationTicks * balance.practiceWelding.sectionsPerWeld * tick;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    progression = await import("@/server/progression");
    refiningCommands = await import("@/server/refining-commands");
    practiceCommands = await import("@/server/practice-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const at = (ms: number) => new Date(start.getTime() + ms);

  /** Every roll succeeds and returns the first input, so outcomes are predictable. */
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
      `Run ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, certain());
    return { userId, character };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function setRefiningLevel(characterId: string, level: number) {
    const threshold = standardSkillLevelThresholds(balance).find(
      (candidate) => candidate.level === level,
    );
    if (!threshold) throw new Error(`No authored threshold for level ${level}`);
    await db.transaction(async (transaction) => {
      await progression.grantCharacterSkillXp(transaction, {
        characterId,
        skillId: SKILL_IDS.refining,
        awardedXp: threshold.totalXp,
        thresholds: standardSkillLevelThresholds(balance),
      });
    });
  }

  async function setCarried(characterId: string, itemId: string, quantities: readonly number[]) {
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    for (const quantity of quantities) {
      await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    }
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

  async function activeActionCount(characterId: string) {
    return (
      await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, characterId))
    ).length;
  }

  describe("Refining", () => {
    async function refiner(level = 1) {
      const made = await makeCharacter("Bounded Refiner");
      if (level > 1) await setRefiningLevel(made.character.id, level);
      await move(made.character.id, LOCATION_IDS.abandonedProcessingYard);
      return made;
    }

    const ferriteMs = balance.refining.recipes.refinedFerrite.attemptDurationTicks * tick;

    it("projects, per recipe, the batches the inputs carried pay for", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10, 3]);
      const state = await play.getPlayGameplayState(userId, character.id, start, certain());
      const ferrite = state.refiningRecipes.find((r) => r.actionId === ACTION_IDS.refining)!;
      expect(ferrite.affordableBatches).toBe(6);
      // Locked recipes can never be started, so they pay for nothing.
      const slag = state.refiningRecipes.find(
        (r) => r.actionId === ACTION_IDS.ferriteShaleSlagRefining,
      )!;
      expect(slag.unlocked).toBe(false);
      expect(slag.affordableBatches).toBe(0);
    });

    it("attempts exactly the selected batches across a lazy offline window, then stops", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10, 10]);
      const started = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        certain(),
        3,
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.refining);
      expect(started.refiningRun).toMatchObject({ selection: 3, attempts: 0 });

      // Mid-run refresh projects where the run stands.
      const midway = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ferriteMs),
        certain(),
      );
      expect(midway.refiningRun).toMatchObject({ selection: 3, attempts: 1 });
      expect(midway.activeAction?.actionId).toBe(ACTION_IDS.refining);

      // An hour away resolves only the two remaining selected batches.
      const later = await play.getPlayGameplayState(
        userId,
        character.id,
        at(60 * 60 * 1000),
        certain(),
      );
      expect(later.activeAction).toBeUndefined();
      expect(later.refiningRun).toMatchObject({ selection: 3, attempts: 3 });
      expect(later.stop).toEqual({ activity: "refining", reason: "run_completed" });
      expect(await carried(character.id, ITEM_IDS.ferriteShale)).toBe(14);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(3);
    });

    it("counts failed attempts toward the selection", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10]);
      const failing = () => ({ nextBasisPoints: () => 9_999, nextUnit: () => 0 });
      await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        failing(),
        2,
      );
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ferriteMs * 10),
        failing(),
      );
      expect(done.refiningRun).toMatchObject({ attempts: 2, successes: 0, failures: 2 });
      expect(done.refiningRun.xpGained).toBe(2 * balance.refining.recipes.refinedFerrite.failureXp);
      expect(await carried(character.id, ITEM_IDS.slag)).toBe(2);
      expect(done.stop).toEqual({ activity: "refining", reason: "run_completed" });
    });

    it("keeps the ordinary stop reason when inputs run out before the selection", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [6]);
      await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        certain(),
        3,
      );
      // The player drops Shale mid-run: the run cannot finish its selection.
      await setCarried(character.id, ITEM_IDS.ferriteShale, [2]);
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ferriteMs * 10),
        certain(),
      );
      expect(done.refiningRun.attempts).toBe(1);
      expect(done.stop).toEqual({ activity: "refining", reason: "insufficient_inputs" });
    });

    it("Max runs Galvaferrite until the real results leave nothing to pour", async () => {
      // Four of each input pay for four pours. At Refining 8 a pour can fail
      // and hand one input back, and the run keeps going on what is left.
      async function alloyRun(rolls: readonly number[], units: readonly number[]) {
        const made = await refiner(8);
        await setCarried(made.character.id, ITEM_IDS.refinedFerrite, [4]);
        await setCarried(made.character.id, ITEM_IDS.galvanicStock, [4]);
        const state = await play.getPlayGameplayState(
          made.userId,
          made.character.id,
          start,
          certain(),
        );
        // What the inputs pay for — never a prediction of what Max will do.
        expect(
          state.refiningRecipes.find((r) => r.actionId === ACTION_IDS.galvaferriteRefining)!
            .affordableBatches,
        ).toBe(4);
        const started = await refiningCommands.startRefining(
          made.userId,
          made.character.id,
          ACTION_IDS.galvaferriteRefining,
          start,
          certain(),
          BOUNDED_RUN_MAX,
        );
        expect(started.refiningError).toBeUndefined();
        expect(started.refiningRun.selection).toBe(BOUNDED_RUN_MAX);
        // Max is its own durable mode, not a stored number.
        const [row] = await db
          .select({ selected: rune.characterRefiningState.runSelectedAttempts })
          .from(rune.characterRefiningState)
          .where(eq(rune.characterRefiningState.characterId, made.character.id));
        expect(row!.selected).toBeNull();
        let rolled = 0;
        let chosen = 0;
        const random = {
          nextBasisPoints: () => rolls[rolled++] ?? 0,
          nextUnit: () => units[chosen++] ?? 0,
        };
        const alloyMs = balance.refining.recipes.galvaferrite.attemptDurationTicks * tick;
        // A refresh mid-run still knows it is a Max run.
        const midway = await play.getPlayGameplayState(
          made.userId,
          made.character.id,
          at(alloyMs),
          random,
        );
        expect(midway.activeAction?.actionId).toBe(ACTION_IDS.galvaferriteRefining);
        expect(midway.refiningRun).toMatchObject({ selection: BOUNDED_RUN_MAX, attempts: 1 });
        const done = await play.getPlayGameplayState(
          made.userId,
          made.character.id,
          at(60 * 60 * 1000),
          random,
        );
        expect(done.activeAction).toBeUndefined();
        expect(done.refiningRun.selection).toBe(BOUNDED_RUN_MAX);
        return { ...made, done };
      }

      // Every pour succeeds: both inputs go each time, four pours, then out.
      const lucky = await alloyRun([0, 0, 0, 0, 0], []);
      expect(lucky.done.refiningRun).toMatchObject({ attempts: 4, successes: 4, failures: 0 });
      expect(lucky.done.stop).toEqual({ activity: "refining", reason: "insufficient_inputs" });
      expect(await carried(lucky.character.id, ITEM_IDS.galvaferrite)).toBe(4);

      // Every pour fails, alternating which input comes back: each spends one
      // unit, so the same start runs seven attempts on the real results.
      const unlucky = await alloyRun(
        [9_999, 9_999, 9_999, 9_999, 9_999, 9_999, 9_999, 9_999],
        [0, 0.9, 0, 0.9, 0, 0.9, 0, 0.9],
      );
      expect(unlucky.done.refiningRun).toMatchObject({ attempts: 7, successes: 0, failures: 7 });
      expect(unlucky.done.stop).toEqual({ activity: "refining", reason: "insufficient_inputs" });
      expect(await carried(unlucky.character.id, ITEM_IDS.refinedFerrite)).toBe(1);
      expect(await carried(unlucky.character.id, ITEM_IDS.galvanicStock)).toBe(0);
    });

    it("refuses Max when not even one batch can begin", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [1]);
      const refused = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        certain(),
        BOUNDED_RUN_MAX,
      );
      expect(refused.activeAction).toBeUndefined();
      expect(refused.stop).toEqual({ activity: "refining", reason: "insufficient_inputs" });
      expect(await activeActionCount(character.id)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.ferriteShale)).toBe(1);
    });

    it("a Max run that reaches the internal safety ceiling stops with its own reason", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10, 10]);
      await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        certain(),
        BOUNDED_RUN_MAX,
      );
      // Simulate a run that has somehow attempted all but one of the ceiling.
      await db
        .update(rune.characterRefiningState)
        .set({ runAttempts: BOUNDED_RUN_QUANTITY_CEILING - 1 })
        .where(eq(rune.characterRefiningState.characterId, character.id));
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ferriteMs * 10),
        certain(),
      );
      expect(done.activeAction).toBeUndefined();
      expect(done.refiningRun.attempts).toBe(BOUNDED_RUN_QUANTITY_CEILING);
      expect(done.stop).toEqual({ activity: "refining", reason: "run_safety_limit" });
      // One batch, then the guard — not the Shale — ended it.
      expect(await carried(character.id, ITEM_IDS.ferriteShale)).toBe(18);
    });

    it("refuses a number above what the inputs pay for without starting anything", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10]);
      const refused = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        certain(),
        6,
      );
      expect(refused.refiningError).toBe("refining_quantity_unavailable");
      expect(refused.activeAction).toBeUndefined();
      // The refusal carries the fresh count to choose again from.
      expect(
        refused.refiningRecipes.find((r) => r.actionId === ACTION_IDS.refining)!.affordableBatches,
      ).toBe(5);
      expect(await activeActionCount(character.id)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.ferriteShale)).toBe(10);
    });

    it("revalidates at Start when inventory changed after the projection", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10]);
      const projected = await play.getPlayGameplayState(userId, character.id, start, certain());
      const maximum = projected.refiningRecipes.find(
        (r) => r.actionId === ACTION_IDS.refining,
      )!.affordableBatches;
      expect(maximum).toBe(5);
      // Something spends Shale between the projection and Start.
      await setCarried(character.id, ITEM_IDS.ferriteShale, [4]);
      const refused = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        certain(),
        maximum,
      );
      expect(refused.refiningError).toBe("refining_quantity_unavailable");
      expect(refused.activeAction).toBeUndefined();
      expect(
        refused.refiningRecipes.find((r) => r.actionId === ACTION_IDS.refining)!.affordableBatches,
      ).toBe(2);
      // Choosing again from the fresh count starts normally.
      const started = await refiningCommands.startRefining(
        userId,
        character.id,
        ACTION_IDS.refining,
        start,
        certain(),
        2,
      );
      expect(started.refiningError).toBeUndefined();
      expect(started.refiningRun.selection).toBe(2);
    });

    it("refuses forged quantities at the command boundary", async () => {
      const { userId, character } = await refiner();
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10]);
      for (const forged of [0, -3, 2.5]) {
        const refused = await refiningCommands.startRefining(
          userId,
          character.id,
          ACTION_IDS.refining,
          start,
          certain(),
          forged,
        );
        expect(refused.refiningError).toBe("refining_quantity_unavailable");
        expect(refused.activeAction).toBeUndefined();
      }
      await expect(
        db
          .update(rune.characterRefiningState)
          .set({ runSelectedAttempts: 0 })
          .where(eq(rune.characterRefiningState.characterId, character.id)),
      ).rejects.toThrow();
    });

    it("gates both deliberate Slag recipes at Refining 5", async () => {
      const { userId, character } = await refiner(4);
      await setCarried(character.id, ITEM_IDS.ferriteShale, [10]);
      await setCarried(character.id, ITEM_IDS.galvanite, [10]);
      for (const actionId of [
        ACTION_IDS.ferriteShaleSlagRefining,
        ACTION_IDS.galvaniteSlagRefining,
      ]) {
        const refused = await refiningCommands.startRefining(
          userId,
          character.id,
          actionId,
          start,
          certain(),
          1,
        );
        expect(refused.refiningError).toBe("refining_recipe_locked");
        expect(refused.activeAction).toBeUndefined();
      }
    });

    it("runs both deliberate Slag recipes deterministically at Refining 5", async () => {
      const cases = [
        {
          actionId: ACTION_IDS.ferriteShaleSlagRefining,
          input: ITEM_IDS.ferriteShale,
          ticks: 6,
          slagPerBatch: 1,
          xp: 3,
        },
        {
          actionId: ACTION_IDS.galvaniteSlagRefining,
          input: ITEM_IDS.galvanite,
          ticks: 8,
          slagPerBatch: 2,
          xp: 5,
        },
      ];
      for (const { actionId, input, ticks, slagPerBatch, xp } of cases) {
        const { userId, character } = await refiner(5);
        await setCarried(character.id, input, [10]);
        // Every roll would fail a rolled recipe; a deterministic one never asks.
        const failing = () => ({ nextBasisPoints: () => 9_999, nextUnit: () => 0.99 });
        const started = await refiningCommands.startRefining(
          userId,
          character.id,
          actionId,
          start,
          failing(),
          4,
        );
        expect(started.activeAction?.actionId).toBe(actionId);
        expect(started.activeAction?.nextAttemptDurationTicks).toBe(ticks);
        const recipeState = started.refiningRecipes.find((r) => r.actionId === actionId)!;
        expect(recipeState).toMatchObject({ deterministic: true, successChanceBps: 10_000 });

        const done = await play.getPlayGameplayState(
          userId,
          character.id,
          at(ticks * tick * 4),
          failing(),
        );
        expect(done.refiningRun).toMatchObject({ attempts: 4, successes: 4, failures: 0 });
        expect(done.refiningRun.xpGained).toBe(4 * xp);
        expect(done.refiningRun.recentAttempts.every((attempt) => attempt.deterministic)).toBe(
          true,
        );
        expect(await carried(character.id, ITEM_IDS.slag)).toBe(4 * slagPerBatch);
        expect(await carried(character.id, input)).toBe(2);
        expect(done.stop).toEqual({ activity: "refining", reason: "run_completed" });
      }
    });
  });

  describe("Practice Welding", () => {
    async function welder(scrapStacks: readonly number[]) {
      const made = await makeCharacter("Bounded Welder");
      await db.insert(rune.characterMissions).values(
        [
          MISSION_IDS.walkItOff,
          MISSION_IDS.cutYourTeeth,
          MISSION_IDS.wasteNot,
          MISSION_IDS.holdItTogether,
          MISSION_IDS.keepTheChange,
        ].map((missionId) => ({
          characterId: made.character.id,
          missionId,
          acceptedAt: start,
          completedAt: start,
        })),
      );
      await move(made.character.id, LOCATION_IDS.ruskRecovery);
      await missions.acceptMission(
        made.userId,
        made.character.id,
        MISSION_IDS.tenThousandHours,
        "wade_rusk",
        start,
        certain(),
      );
      await setCarried(made.character.id, ITEM_IDS.scrapMetal, scrapStacks);
      return made;
    }

    it("projects the welds stacked Scrap pays for, one per two pieces", async () => {
      const { userId, character } = await welder([3, 3, 1]);
      const state = await play.getPlayGameplayState(userId, character.id, start, certain());
      expect(state.practice.scrapAvailable).toBe(7);
      expect(state.practice.affordableWelds).toBe(3);
    });

    it("a run of one is exactly one complete weld", async () => {
      const { userId, character } = await welder([3, 3]);
      const started = await practiceCommands.startPracticeWelding(
        userId,
        character.id,
        start,
        certain(),
        1,
      );
      expect(started.practice.active).toBe(true);
      expect(started.practice.run.selection).toBe(1);
      const done = await play.getPlayGameplayState(userId, character.id, at(weldMs * 5), certain());
      expect(done.practice.active).toBe(false);
      expect(done.practice.run.welds).toBe(1);
      expect(done.practice.lastStopReason).toBe("run_completed");
      expect(done.practice.cycleActive).toBe(false);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(4);
      expect(done.practice.run.xpGained).toBe(
        balance.practiceWelding.sectionsPerWeld * practiceSectionXp(balance),
      );
    });

    it("completes exactly the selected welds offline, at 100 XP each", async () => {
      const { userId, character } = await welder([3, 3, 3]);
      await practiceCommands.startPracticeWelding(userId, character.id, start, certain(), 3);
      const midway = await play.getPlayGameplayState(userId, character.id, at(weldMs), certain());
      expect(midway.practice.run).toMatchObject({ selection: 3, welds: 1 });
      expect(midway.practice.active).toBe(true);
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(60 * 60 * 1000),
        certain(),
      );
      expect(done.practice.run).toMatchObject({ selection: 3, welds: 3, xpGained: 300 });
      expect(done.practice.lastStopReason).toBe("run_completed");
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(3);
    });

    it("refuses a number above what the Scrap pays for before any is spent", async () => {
      const { userId, character } = await welder([3, 1]);
      const refused = await practiceCommands.startPracticeWelding(
        userId,
        character.id,
        start,
        certain(),
        3,
      );
      expect(refused.practiceError).toBe("practice_quantity_unavailable");
      expect(refused.practice.affordableWelds).toBe(2);
      expect(refused.practice.active).toBe(false);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(4);
      expect(await activeActionCount(character.id)).toBe(0);
    });

    it("counts a resumed partial weld as the run's first", async () => {
      const { userId, character } = await welder([2]);
      await practiceCommands.startPracticeWelding(userId, character.id, start, certain(), 1);
      // Stop partway: the weld is paid for and waiting, with no Scrap left.
      await practiceCommands.stopPracticeWelding(userId, character.id, at(weldMs / 2), certain());
      const stopped = await play.getPlayGameplayState(
        userId,
        character.id,
        at(weldMs / 2),
        certain(),
      );
      expect(stopped.practice.cycleActive).toBe(true);
      expect(stopped.practice.affordableWelds).toBe(1);

      await setCarried(character.id, ITEM_IDS.scrapMetal, [2]);
      const projected = await play.getPlayGameplayState(
        userId,
        character.id,
        at(weldMs / 2),
        certain(),
      );
      expect(projected.practice.affordableWelds).toBe(2);
      await practiceCommands.startPracticeWelding(
        userId,
        character.id,
        at(weldMs / 2),
        certain(),
        2,
      );
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(weldMs * 10),
        certain(),
      );
      expect(done.practice.run).toMatchObject({ selection: 2, welds: 2 });
      expect(done.practice.lastStopReason).toBe("run_completed");
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    });

    it("Finish Current completes the weld on the bench and starts no further selected weld", async () => {
      const { userId, character } = await welder([3, 3, 3]);
      await practiceCommands.startPracticeWelding(userId, character.id, start, certain(), 4);
      await play.getPlayGameplayState(userId, character.id, at(weldMs + weldMs / 2), certain());
      await practiceCommands.finishCurrentPracticeWeld(
        userId,
        character.id,
        at(weldMs + weldMs / 2),
        certain(),
      );
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(weldMs * 10),
        certain(),
      );
      expect(done.practice.active).toBe(false);
      expect(done.practice.run).toMatchObject({ selection: 4, welds: 2 });
      expect(done.practice.lastStopReason).toBe("finished_current_weld");
      expect(done.practice.finishCurrentWeld).toBe(false);
      expect(done.practice.cycleActive).toBe(false);
      // Two welds paid for, and not one piece more.
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(5);
    });

    it("Auto-discard never changes how many welds the run completes", async () => {
      const { userId, character } = await welder([3, 3]);
      await practiceCommands.setPracticeSlagPreference(
        userId,
        character.id,
        true,
        start,
        certain(),
      );
      await practiceCommands.startPracticeWelding(userId, character.id, start, certain(), 3);
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(weldMs * 10),
        certain(),
      );
      expect(done.practice.run).toMatchObject({ welds: 3, slagKept: 0, slagDiscarded: 6 });
      expect(done.practice.lastStopReason).toBe("run_completed");
    });

    it("Max welds until the Scrap runs out, and a refresh keeps it a Max run", async () => {
      const { userId, character } = await welder([3, 3, 1]);
      const started = await practiceCommands.startPracticeWelding(
        userId,
        character.id,
        start,
        certain(),
        BOUNDED_RUN_MAX,
      );
      expect(started.practice.active).toBe(true);
      expect(started.practice.run.selection).toBe(BOUNDED_RUN_MAX);
      const [row] = await db
        .select({ selected: rune.characterPracticeWelds.runSelectedWelds })
        .from(rune.characterPracticeWelds)
        .where(eq(rune.characterPracticeWelds.characterId, character.id));
      expect(row!.selected).toBeNull();

      const midway = await play.getPlayGameplayState(userId, character.id, at(weldMs), certain());
      expect(midway.practice.run).toMatchObject({ selection: BOUNDED_RUN_MAX, welds: 1 });
      expect(midway.practice.active).toBe(true);

      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(60 * 60 * 1000),
        certain(),
      );
      expect(done.practice.active).toBe(false);
      expect(done.practice.run).toMatchObject({
        selection: BOUNDED_RUN_MAX,
        welds: 3,
        xpGained: 300,
      });
      expect(done.practice.lastStopReason).toBe("out_of_scrap");
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(1);
    });

    it("Max resumes a paid partial weld as its first, then welds on while Scrap lasts", async () => {
      const { userId, character } = await welder([2]);
      await practiceCommands.startPracticeWelding(userId, character.id, start, certain(), 1);
      await practiceCommands.stopPracticeWelding(userId, character.id, at(weldMs / 2), certain());
      await setCarried(character.id, ITEM_IDS.scrapMetal, [3, 1]);
      await practiceCommands.startPracticeWelding(
        userId,
        character.id,
        at(weldMs / 2),
        certain(),
        BOUNDED_RUN_MAX,
      );
      const done = await play.getPlayGameplayState(
        userId,
        character.id,
        at(weldMs * 10),
        certain(),
      );
      // The paid weld, then two more from four Scrap.
      expect(done.practice.run).toMatchObject({ selection: BOUNDED_RUN_MAX, welds: 3 });
      expect(done.practice.lastStopReason).toBe("out_of_scrap");
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    });

    it("refuses Max when there is neither Scrap nor a paid weld", async () => {
      const { userId, character } = await welder([1]);
      const refused = await practiceCommands.startPracticeWelding(
        userId,
        character.id,
        start,
        certain(),
        BOUNDED_RUN_MAX,
      );
      expect(refused.practice.active).toBe(false);
      expect(refused.practiceError).toBe("insufficient_scrap");
      expect(await activeActionCount(character.id)).toBe(0);
      expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(1);
    });
  });
});
