import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getRepairTargetBalance,
  practiceSectionXp,
  standardSkillLevelThresholds,
  workOrderSectionXp,
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
import { REPAIR_TARGETS } from "@/game/content/repair-targets";
import { getWorkOrder, WORK_ORDERS } from "@/game/content/work-orders";
import {
  cleanPassFromPersisted,
  cleanPassLifecycle,
  cleanPassOpportunityWindows,
  type CleanPassOpportunity,
} from "@/game/domain/clean-pass";
import type { PlayGameplayState } from "@/server/play";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #207 — customer Work Orders, against real PostgreSQL.
 *
 * What only a database proves: that accepting a job removes its exact recipe
 * and marks its posting In Progress in ONE transaction and never twice, that
 * the board is durable rather than rerolled on every login, that a job's
 * sections survive Stop and Travel, and that the single completion transaction
 * pays, releases the bench, refills the slot and credits the Mission exactly
 * once — including when the last section is discovered by lazy reconciliation
 * long after it actually resolved.
 */
suite("issue #207 Work Orders (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let workOrderCommands: typeof import("@/server/work-order-commands");
  let practiceCommands: typeof import("@/server/practice-commands");
  let repairCommands: typeof import("@/server/repair-commands");
  let cleanPass: typeof import("@/server/clean-pass");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-15T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const sectionMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const sectionXp = workOrderSectionXp(balance);

  /**
   * The board these suites weld against, seeded deterministically.
   *
   * Slot 0 is deliberately the one authored job with a mixed Ferrite-and-Cell
   * recipe, because a single-material recipe cannot prove that a partial
   * material list is refused as a whole.
   */
  const MIXED_JOB = WORK_ORDER_IDS.tansyCutterHousing;
  const DEFAULT_BOARD: readonly WorkOrderId[] = [
    MIXED_JOB,
    WORK_ORDER_IDS.rennCarryFrame,
    WORK_ORDER_IDS.vossHeaterHousing,
  ];
  const mixed = getWorkOrder(MIXED_JOB)!;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    workOrderCommands = await import("@/server/work-order-commands");
    practiceCommands = await import("@/server/practice-commands");
    repairCommands = await import("@/server/repair-commands");
    cleanPass = await import("@/server/clean-pass");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** Every roll lands on its window's minimum, so placements are predictable. */
  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  const at = (msFromStart: number) => new Date(start.getTime() + msFromStart);

  /**
   * An apprentice who has finished 10,000 Hours, reached the board's Welding
   * level, and taken 10,001 Hours off Wade — the state in which client work is
   * genuinely the player's.
   *
   * The board is then re-seeded deterministically. Seeding itself draws from
   * the authored pool with real randomness, which is right for a player and
   * useless for a fixture, so the jobs under test are chosen here and the draw
   * is proven separately below.
   */
  async function welder(
    options: { unlocked?: boolean; weldingLevel?: number; naturalBoard?: boolean } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Work Orders Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Order ${userId.slice(0, 6)}`,
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
    await setWeldingLevel(
      character.id,
      options.weldingLevel ?? balance.workOrders.requiredWeldingLevel,
    );

    if (options.unlocked !== false) {
      const accepted = await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.tenThousandOneHours,
        NPC_IDS.wadeRusk,
        start,
        deterministicRandom(),
      );
      expect(accepted.mission.status).toBe("accepted");
    }
    if (!options.naturalBoard) await seedBoard(character.id, DEFAULT_BOARD);
    return { userId, character };
  }

  /** Put the Welding skill exactly on one level's authored threshold. */
  async function setWeldingLevel(characterId: string, level: number) {
    const totalXp = standardSkillLevelThresholds(balance).find(
      (threshold) => threshold.level === level,
    )!.totalXp;
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId, skillId: SKILL_IDS.welding, totalXp })
      .onConflictDoUpdate({
        target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
        set: { totalXp },
      });
  }

  /** Replace whatever the pool drew with the three jobs a test wants posted. */
  async function seedBoard(characterId: string, workOrderIds: readonly WorkOrderId[]) {
    await db
      .delete(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, characterId));
    await db.insert(rune.characterWorkOrderPostings).values(
      workOrderIds.map((workOrderId, slotIndex) => ({
        characterId,
        slotIndex,
        workOrderId,
        postedAt: start,
        updatedAt: start,
      })),
    );
  }

  /** Carry a material list, split across stacks at the authored stack limit. */
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

  async function postings(characterId: string) {
    const rows = await db
      .select()
      .from(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, characterId));
    return rows.sort((a, b) => a.slotIndex - b.slotIndex);
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

  async function activeAction(characterId: string) {
    return (
      await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, characterId))
    )[0];
  }

  async function credits(characterId: string) {
    return (
      await db
        .select({ credits: rune.characters.credits })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]!.credits;
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

  async function workOrdersCompleted(characterId: string) {
    return (
      (
        await db
          .select({ progress: rune.characterMissionProgress.progress })
          .from(rune.characterMissionProgress)
          .where(
            and(
              eq(rune.characterMissionProgress.characterId, characterId),
              eq(rune.characterMissionProgress.missionId, MISSION_IDS.tenThousandOneHours),
              eq(rune.characterMissionProgress.progressKey, "work-orders-completed"),
            ),
          )
      )[0]?.progress ?? 0
    );
  }

  /** The active job's rolled opportunities, straight off its posting row. */
  function opportunitiesOf(row: { cleanPass: unknown }): readonly CleanPassOpportunity[] {
    return cleanPassFromPersisted(row.cleanPass).opportunities ?? [];
  }

  const refresh = (userId: string, characterId: string, ms: number) =>
    play.getPlayGameplayState(userId, characterId, at(ms), deterministicRandom());

  const accept = (userId: string, characterId: string, workOrderId: string, ms = 0) =>
    workOrderCommands.acceptWorkOrder(
      userId,
      characterId,
      workOrderId,
      at(ms),
      deterministicRandom(),
    );

  const startWelding = (userId: string, characterId: string, ms = 0) =>
    workOrderCommands.startWorkOrderWelding(userId, characterId, at(ms), deterministicRandom());

  describe("acceptance and materials", () => {
    it("refuses the whole recipe when only part of it is carried", async () => {
      const { userId, character } = await welder();
      // Every Refined Ferrite the job wants, and none of the Cells.
      await giveMaterials(character.id, [
        { itemId: ITEM_IDS.refinedFerrite, quantity: mixed.materials[0]!.quantity },
      ]);

      const refused = await accept(userId, character.id, MIXED_JOB);
      expect(refused.workOrder).toMatchObject({
        status: "refused",
        reason: "insufficient_materials",
      });
      // Nothing taken, and no posting claimed for a job that never went on.
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(
        mixed.materials[0]!.quantity,
      );
      expect((await postings(character.id)).every((row) => row.acceptedAt === null)).toBe(true);
    });

    it("refuses while travelling and from anywhere but the yard, leaving the board untouched", async () => {
      const { userId, character } = await welder();
      await giveMaterials(character.id, mixed.materials);
      const before = await postings(character.id);

      await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        start,
        deterministicRandom(),
      );
      const inTransit = await accept(userId, character.id, MIXED_JOB, 100);
      expect(inTransit.workOrder).toMatchObject({ status: "refused", reason: "in_transit" });

      // Standing somewhere else entirely, with no action at all.
      await db.delete(rune.activeActions).where(eq(rune.activeActions.characterId, character.id));
      await db
        .delete(rune.characterTravelState)
        .where(eq(rune.characterTravelState.characterId, character.id));
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollow })
        .where(eq(rune.characters.id, character.id));
      const elsewhere = await accept(userId, character.id, MIXED_JOB, 200);
      expect(elsewhere.workOrder).toMatchObject({ status: "refused", reason: "wrong_location" });

      expect(await postings(character.id)).toEqual(before);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(
        mixed.materials[0]!.quantity,
      );
    });

    it("refuses before 10,001 Hours has been accepted", async () => {
      const { userId, character } = await welder({ unlocked: false });
      await giveMaterials(character.id, mixed.materials);

      const refused = await accept(userId, character.id, MIXED_JOB);
      expect(refused.workOrder).toMatchObject({
        status: "refused",
        reason: "work_orders_locked",
      });
      expect((await postings(character.id)).every((row) => row.acceptedAt === null)).toBe(true);
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(mixed.materials[1]!.quantity);
    });

    it("refuses below the job's required Welding level", async () => {
      // Accepted with the level, then dropped below it: the level is rechecked
      // by the acceptance command itself, not assumed from the Mission.
      const { userId, character } = await welder();
      await setWeldingLevel(character.id, mixed.requiredWeldingLevel - 1);
      await giveMaterials(character.id, mixed.materials);

      const refused = await accept(userId, character.id, MIXED_JOB);
      expect(refused.workOrder).toMatchObject({ status: "refused", reason: "welding_level" });
      expect((await postings(character.id)).every((row) => row.acceptedAt === null)).toBe(true);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(
        mixed.materials[0]!.quantity,
      );
    });

    it("removes the exact recipe and marks the posting In Progress together", async () => {
      const { userId, character } = await welder();
      // One spare of each material, so an over-removal is visible.
      await giveMaterials(character.id, [
        { itemId: ITEM_IDS.refinedFerrite, quantity: mixed.materials[0]!.quantity + 2 },
        { itemId: ITEM_IDS.powerCell, quantity: mixed.materials[1]!.quantity + 1 },
      ]);

      const accepted = await accept(userId, character.id, MIXED_JOB);
      expect(accepted.workOrder).toEqual({ status: "accepted", workOrderId: MIXED_JOB });

      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(2);
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(1);
      const row = (await postings(character.id)).find((entry) => entry.workOrderId === MIXED_JOB);
      expect(row?.acceptedAt).not.toBeNull();
      expect(row?.sectionsCompleted).toBe(0);
      expect(opportunitiesOf(row!).length).toBeGreaterThan(0);
    });

    it("does not start section timing: acceptance creates no active action", async () => {
      const { userId, character } = await welder();
      await giveMaterials(character.id, mixed.materials);
      await accept(userId, character.id, MIXED_JOB);
      expect(await activeAction(character.id)).toBeUndefined();
    });

    it("cannot double-remove materials or create two jobs under concurrent acceptance", async () => {
      const { userId, character } = await welder();
      await giveMaterials(character.id, [
        { itemId: ITEM_IDS.refinedFerrite, quantity: mixed.materials[0]!.quantity * 2 },
        { itemId: ITEM_IDS.powerCell, quantity: mixed.materials[1]!.quantity * 2 },
      ]);

      const [first, second] = await Promise.all([
        accept(userId, character.id, MIXED_JOB),
        accept(userId, character.id, MIXED_JOB),
      ]);
      const statuses = [first.workOrder.status, second.workOrder.status].sort();
      expect(statuses).toEqual(["accepted", "refused"]);

      // A third, sequential retry changes nothing either.
      const retried = await accept(userId, character.id, MIXED_JOB, 100);
      expect(retried.workOrder.status).toBe("refused");

      const accepted = (await postings(character.id)).filter((row) => row.acceptedAt !== null);
      expect(accepted).toHaveLength(1);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(
        mixed.materials[0]!.quantity,
      );
      expect(await carried(character.id, ITEM_IDS.powerCell)).toBe(mixed.materials[1]!.quantity);
    });
  });

  describe("the board", () => {
    it("seeds exactly three distinct durable postings on the first touch", async () => {
      const { character } = await welder({ naturalBoard: true });
      const rows = await postings(character.id);

      expect(rows).toHaveLength(balance.workOrders.postedSlots);
      expect(rows.map((row) => row.slotIndex)).toEqual([0, 1, 2]);
      expect(new Set(rows.map((row) => row.workOrderId)).size).toBe(rows.length);
      for (const row of rows) {
        expect(getWorkOrder(row.workOrderId)).toBeDefined();
        expect(row.acceptedAt).toBeNull();
        expect(row.sectionsCompleted).toBe(0);
        expect(row.cleanPass).toBeNull();
      }
    });

    it("does not reroll the board on repeated state reads", async () => {
      const { userId, character } = await welder({ naturalBoard: true });
      const seeded = await postings(character.id);

      // Three separate "logins", hours apart.
      await refresh(userId, character.id, 60 * 60 * 1_000);
      await refresh(userId, character.id, 2 * 60 * 60 * 1_000);
      await refresh(userId, character.id, 5 * 60 * 60 * 1_000);

      const after = await postings(character.id);
      expect(after.map((row) => [row.slotIndex, row.workOrderId])).toEqual(
        seeded.map((row) => [row.slotIndex, row.workOrderId]),
      );
    });

    it("marks one posting In Progress and leaves the other two alone", async () => {
      const { userId, character } = await welder();
      await giveMaterials(character.id, mixed.materials);
      const before = await postings(character.id);

      await accept(userId, character.id, MIXED_JOB);

      const after = await postings(character.id);
      expect(after.filter((row) => row.acceptedAt !== null).map((row) => row.workOrderId)).toEqual([
        MIXED_JOB,
      ]);
      for (const row of after.filter((entry) => entry.workOrderId !== MIXED_JOB)) {
        const original = before.find((entry) => entry.slotIndex === row.slotIndex)!;
        expect(row).toEqual(original);
      }
    });

    it("replaces only the completed slot, with a job nothing else on the board holds", async () => {
      const { userId, character } = await welder();
      await giveMaterials(character.id, mixed.materials);
      await accept(userId, character.id, MIXED_JOB);
      const untouched = (await postings(character.id)).filter(
        (row) => row.workOrderId !== MIXED_JOB,
      );

      await startWelding(userId, character.id);
      await refresh(userId, character.id, sectionMs * mixed.sections);

      const after = await postings(character.id);
      expect(after).toHaveLength(balance.workOrders.postedSlots);
      for (const row of untouched) {
        const same = after.find((entry) => entry.slotIndex === row.slotIndex)!;
        expect(same.workOrderId).toBe(row.workOrderId);
      }
      const replacement = after.find((row) => row.slotIndex === 0)!;
      expect(replacement.workOrderId).not.toBe(MIXED_JOB);
      expect(untouched.map((row) => row.workOrderId)).not.toContain(replacement.workOrderId);
      expect(getWorkOrder(replacement.workOrderId)).toBeDefined();
      expect(replacement.acceptedAt).toBeNull();
    });

    it("ships no abandonment command, helper, or column anywhere", async () => {
      // A posted job is either accepted and finished or never taken: there is
      // deliberately no way to hand a client's property back half-welded.
      const abandonment = /abandon|forfeit|relinquish|giveup/i;
      const commandExports = Object.keys(await import("@/server/work-order-commands"));
      const persistenceExports = Object.keys(await import("@/server/work-orders"));
      const domainExports = Object.keys(await import("@/game/domain/work-orders"));

      expect(commandExports.filter((name) => abandonment.test(name))).toEqual([]);
      expect(persistenceExports.filter((name) => abandonment.test(name))).toEqual([]);
      expect(domainExports.filter((name) => abandonment.test(name))).toEqual([]);
      expect(
        Object.keys(rune.characterWorkOrderPostings).filter((column) => abandonment.test(column)),
      ).toEqual([]);
    });
  });

  describe("welding and completion", () => {
    async function onTheBench(ms = 0) {
      const fixture = await welder();
      await giveMaterials(fixture.character.id, mixed.materials);
      await accept(fixture.userId, fixture.character.id, MIXED_JOB, ms);
      return fixture;
    }

    it("resolves whole sections only, at the Work Order XP share", async () => {
      const { userId, character } = await onTheBench();
      const xpBefore = await weldingXp(character.id);

      const started = await startWelding(userId, character.id);
      expect(started.workOrder).toEqual({ status: "started" });
      expect((await activeAction(character.id))?.actionId).toBe(ACTION_IDS.workOrderWelding);

      // Three whole sections and most of a fourth: the partial one is not work.
      await refresh(userId, character.id, sectionMs * 3 + sectionMs - 1);
      const row = (await postings(character.id)).find((entry) => entry.acceptedAt !== null);
      expect(row?.sectionsCompleted).toBe(3);
      expect(await weldingXp(character.id)).toBe(xpBefore + 3 * sectionXp);
    });

    it("preserves the partial job across Stop, closing an open window as missed", async () => {
      const { userId, character } = await onTheBench();
      await startWelding(userId, character.id);
      const rolled = opportunitiesOf(
        (await postings(character.id)).find((row) => row.acceptedAt !== null)!,
      );
      // Deterministic rolls put the first opportunity at its window's minimum.
      expect(rolled[0]!.section).toBe(balance.welding.cleanPass.windowStartSection);

      // Stop while standing inside that very section.
      const stopped = await workOrderCommands.stopWorkOrderWelding(
        userId,
        character.id,
        at(sectionMs * (rolled[0]!.section - 1) + 100),
        deterministicRandom(),
      );
      expect(stopped.workOrder).toEqual({ status: "stopped" });

      const row = (await postings(character.id)).find((entry) => entry.acceptedAt !== null);
      expect(row?.sectionsCompleted).toBe(rolled[0]!.section - 1);
      const after = opportunitiesOf(row!);
      expect(after[0]!.outcome).toBe("missed");
      // The later opportunity is untouched and stays scheduled.
      expect(after[1]!.outcome).toBeNull();
      expect(await activeAction(character.id)).toBeUndefined();
    });

    it("interrupts the job on Travel, and welds nothing from the road", async () => {
      const { userId, character } = await onTheBench();
      await startWelding(userId, character.id);
      await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        at(sectionMs * 3 + 100),
        deterministicRandom(),
      );

      const interrupted = (await postings(character.id)).find((row) => row.acceptedAt !== null);
      expect(interrupted?.sectionsCompleted).toBe(3);
      expect((await activeAction(character.id))?.actionId).toBe(ACTION_IDS.travel);

      // Time spent elsewhere is not Welding time.
      await refresh(userId, character.id, sectionMs * 20);
      const later = (await postings(character.id)).find((row) => row.acceptedAt !== null);
      expect(later?.sectionsCompleted).toBe(3);
    });

    it("resumes from durable progress without rerolling the Clean Pass", async () => {
      const { userId, character } = await onTheBench();
      await startWelding(userId, character.id);
      await workOrderCommands.stopWorkOrderWelding(
        userId,
        character.id,
        at(sectionMs * 4),
        deterministicRandom(),
      );
      const partial = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      expect(partial.sectionsCompleted).toBe(4);

      // A different roll source on Resume must change nothing about the job.
      const resumed = await workOrderCommands.startWorkOrderWelding(
        userId,
        character.id,
        at(sectionMs * 5),
        { nextBasisPoints: () => 2, nextUnit: () => 0 },
      );
      expect(resumed.workOrder).toEqual({ status: "started" });
      const afterResume = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      expect(opportunitiesOf(afterResume)).toEqual(opportunitiesOf(partial));
      expect(afterResume.sectionsCompleted).toBe(4);

      // And the work continues from four rather than from zero.
      await refresh(userId, character.id, sectionMs * 7);
      const continued = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      expect(continued.sectionsCompleted).toBe(6);
    });

    it("pays a job's whole XP from its section count, with every opportunity missed", async () => {
      // A job's total is fixed by its length: the Clean Pass cadence moves work
      // earlier, it never adds sections or invents a higher per-section value.
      // Stop and Travel spend the two opportunities on this job without paying
      // anything, and the finished job still pays exactly its section count.
      const { userId, character } = await onTheBench();
      const xpBefore = await weldingXp(character.id);
      await startWelding(userId, character.id);

      const opportunities = opportunitiesOf(
        (await postings(character.id)).find((row) => row.acceptedAt !== null)!,
      );
      expect(opportunities.length).toBeGreaterThan(1);

      // Weld the whole job straight through, missing every opportunity.
      await refresh(userId, character.id, sectionMs * mixed.sections);

      expect(await weldingXp(character.id)).toBe(xpBefore + mixed.sections * sectionXp);
      expect(await workOrdersCompleted(character.id)).toBe(1);
      // The completed job's slot was released, so its opportunities are gone
      // with it rather than carried into the replacement posting.
      expect(
        opportunitiesOf((await postings(character.id)).find((row) => row.slotIndex === 0)!),
      ).toEqual([]);
    });

    it("pays that same whole XP when a Clean Pass is claimed along the way", async () => {
      // The other half of the property above. A claim moves one section's work
      // earlier and pays it through the claim rather than the resolver, so the
      // job finishes a section sooner — and still pays exactly its section
      // count, the same total as the job welded with every opportunity missed.
      const { userId, character } = await onTheBench();
      const xpBefore = await weldingXp(character.id);
      await startWelding(userId, character.id);
      const opportunity = opportunitiesOf(
        (await postings(character.id)).find((row) => row.acceptedAt !== null)!,
      )[0]!.section;

      const claimed = await cleanPass.claimCleanPass(
        userId,
        character.id,
        at(sectionMs * (opportunity - 1) + 100),
        deterministicRandom(),
      );
      expect(claimed.cleanPass).toEqual({ status: "claimed", awardedXp: sectionXp });

      // Weld out the rest of the job: one fewer ordinary section is left to do.
      await refresh(userId, character.id, sectionMs * mixed.sections);

      expect(await weldingXp(character.id)).toBe(xpBefore + mixed.sections * sectionXp);
      expect(await workOrdersCompleted(character.id)).toBe(1);
      expect((await postings(character.id)).filter((row) => row.acceptedAt !== null)).toEqual([]);
    });

    it("never auto-claims a Clean Pass the player welded straight past", async () => {
      const { userId, character } = await onTheBench();
      const xpBefore = await weldingXp(character.id);
      await startWelding(userId, character.id);

      await refresh(userId, character.id, sectionMs * 5);
      const row = (await postings(character.id)).find((entry) => entry.acceptedAt !== null)!;
      const state = cleanPassFromPersisted(row.cleanPass);
      expect(row.sectionsCompleted).toBe(5);
      // Nothing was written for it, and it reads as missed purely positionally.
      expect(opportunitiesOf(row)[0]!.outcome).toBeNull();
      expect(cleanPassLifecycle(state, 0, row.sectionsCompleted)).toBe("missed");
      // Five sections of XP, not six: elapsed time never claims anything.
      expect(await weldingXp(character.id)).toBe(xpBefore + 5 * sectionXp);
    });

    it("claims a Clean Pass for one extra section of the client's job", async () => {
      const { userId, character } = await onTheBench();
      await startWelding(userId, character.id);
      const opportunity = opportunitiesOf(
        (await postings(character.id)).find((row) => row.acceptedAt !== null)!,
      )[0]!.section;

      // Stand inside that very section: the sections before it have resolved.
      const claimAt = sectionMs * (opportunity - 1) + 100;
      await refresh(userId, character.id, claimAt);
      const before = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      expect(before.sectionsCompleted).toBe(opportunity - 1);

      const claimed = await cleanPass.claimCleanPass(
        userId,
        character.id,
        at(claimAt),
        deterministicRandom(),
      );

      expect(claimed.cleanPass).toEqual({ status: "claimed", awardedXp: sectionXp });
      const after = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      // Exactly one extra section on the client's job, immediately.
      expect(after.sectionsCompleted).toBe(before.sectionsCompleted + 1);
      // Durably recorded on the posting's own Clean Pass column, so a Resume
      // cannot reopen it...
      expect(opportunitiesOf(after)[0]).toEqual({ section: opportunity, outcome: "claimed" });
      // ...while the job's later opportunity is untouched and stays scheduled.
      expect(opportunitiesOf(after)[1]!.outcome).toBeNull();
    });

    it("pays the Work Order share for a claimed section, not Practice's or a repair's", async () => {
      const { userId, character } = await onTheBench();
      await startWelding(userId, character.id);
      const opportunity = opportunitiesOf(
        (await postings(character.id)).find((row) => row.acceptedAt !== null)!,
      )[0]!.section;
      const claimAt = sectionMs * (opportunity - 1) + 100;
      await refresh(userId, character.id, claimAt);
      const xpBefore = await weldingXp(character.id);

      await cleanPass.claimCleanPass(userId, character.id, at(claimAt), deterministicRandom());

      // A claimed section is worth one ordinary section of this work and
      // nothing more: the customer share, not the reduced Practice section and
      // not an authored repair's full Welding increment.
      expect(await weldingXp(character.id)).toBe(xpBefore + sectionXp);
      expect(sectionXp).not.toBe(practiceSectionXp(balance));
      expect(sectionXp).not.toBe(balance.welding.xpPerIncrement);
    });

    it("can never be the section that finishes an authored job", async () => {
      // Proven against the authored pool rather than by forcing the server's
      // fail-closed throw: the cadence shifts the last window left until it
      // leaves the authored ordinary tail behind it, so on every authored
      // length the latest claimable section is still short of the job's last.
      const trailing = balance.welding.cleanPass.trailingOrdinarySections;
      expect(trailing).toBeGreaterThanOrEqual(2);
      for (const job of WORK_ORDERS) {
        const windows = cleanPassOpportunityWindows(job.sections, balance);
        expect(windows.length).toBeGreaterThan(0);
        const last = windows[windows.length - 1]!;
        // A claim on the latest section of the last window leaves the tail.
        expect(job.sections - last.maxSection).toBeGreaterThanOrEqual(trailing);
        expect(last.maxSection + 1).toBeLessThan(job.sections);
      }
    });

    it("refuses a claim while welding with no window open", async () => {
      const { userId, character } = await onTheBench();
      await startWelding(userId, character.id);

      // The job's first section: the earliest authored opportunity is still
      // ahead of the work.
      const refused = await cleanPass.claimCleanPass(
        userId,
        character.id,
        at(100),
        deterministicRandom(),
      );
      expect(refused.cleanPass).toMatchObject({ status: "refused", reason: "none_open" });
      const row = (await postings(character.id)).find((entry) => entry.acceptedAt !== null)!;
      expect(row.sectionsCompleted).toBe(0);
      expect(opportunitiesOf(row).every((entry) => entry.outcome === null)).toBe(true);
    });

    it("refuses a claim with no client job on the bench at all", async () => {
      const { userId, character } = await welder();
      const refused = await cleanPass.claimCleanPass(
        userId,
        character.id,
        start,
        deterministicRandom(),
      );
      expect(refused.cleanPass).toMatchObject({ status: "refused", reason: "no_welding" });
    });

    it("pays, releases the bench, refills the slot and credits the Mission exactly once", async () => {
      const { userId, character } = await onTheBench();
      const creditsBefore = await credits(character.id);
      const xpBefore = await weldingXp(character.id);
      await startWelding(userId, character.id);
      expect(await workOrdersCompleted(character.id)).toBe(0);

      // One command, long after the last section actually resolved.
      await refresh(userId, character.id, sectionMs * mixed.sections + sectionMs * 3);

      expect(await credits(character.id)).toBe(creditsBefore + mixed.payoutCredits);
      expect(await weldingXp(character.id)).toBe(xpBefore + mixed.sections * sectionXp);
      expect((await postings(character.id)).filter((row) => row.acceptedAt !== null)).toEqual([]);
      const slot = (await postings(character.id)).find((row) => row.slotIndex === 0)!;
      expect(slot.workOrderId).not.toBe(MIXED_JOB);
      expect(slot.sectionsCompleted).toBe(0);
      expect(slot.cleanPass).toBeNull();
      expect(await workOrdersCompleted(character.id)).toBe(1);
      expect(await activeAction(character.id)).toBeUndefined();
    });

    it("cannot pay, credit, or refill twice under a retried or concurrent completion", async () => {
      const { userId, character } = await onTheBench();
      const creditsBefore = await credits(character.id);
      await startWelding(userId, character.id);

      const completionMs = sectionMs * mixed.sections;
      await Promise.all([
        refresh(userId, character.id, completionMs),
        refresh(userId, character.id, completionMs),
      ]);
      const refilled = (await postings(character.id)).find((row) => row.slotIndex === 0)!;

      // And a later sequential retry adds nothing on top.
      await refresh(userId, character.id, completionMs + sectionMs * 10);

      expect(await credits(character.id)).toBe(creditsBefore + mixed.payoutCredits);
      expect(await workOrdersCompleted(character.id)).toBe(1);
      const after = await postings(character.id);
      expect(after).toHaveLength(balance.workOrders.postedSlots);
      expect(after.find((row) => row.slotIndex === 0)!.workOrderId).toBe(refilled.workOrderId);
      expect(after.filter((row) => row.acceptedAt !== null)).toEqual([]);
    });
  });

  /**
   * The #207 playtest regression: a Work Order welded with no live progress.
   *
   * The Workbench said "Stop Welding", so the job genuinely was running, and
   * the Job meter and the Current section meter both sat still until Stop
   * reconciled the whole run at once. The generic live-action projection
   * enumerated Mining, Refining, every repair target and Practice — and not
   * `work_order_welding` — so a running customer job had no `activeAction` at
   * all. With no `progressStartedAt` and no `nextAttemptAt` there is no
   * boundary for the shared scheduler to wake on, which is what turned a
   * running job into a still one.
   */
  describe("a welding job is a live action", () => {
    /** A client job accepted and genuinely welding, from `ms`. */
    async function welding(ms = 0) {
      const fixture = await welder();
      await giveMaterials(fixture.character.id, mixed.materials);
      await accept(fixture.userId, fixture.character.id, MIXED_JOB, ms);
      const started = await startWelding(fixture.userId, fixture.character.id, ms);
      expect(started.workOrder).toEqual({ status: "started" });
      return { ...fixture, started };
    }

    it("projects the running job as the active action", async () => {
      const { started } = await welding();
      expect(started.state.activeAction).toBeDefined();
      expect(started.state.activeAction?.actionId).toBe(ACTION_IDS.workOrderWelding);
    });

    it("carries the global Welding section as that action's attempt window", async () => {
      const { started } = await welding();
      const timing = started.state.activeAction!;

      // The authoritative pair every Welding surface reads its timing from:
      // where the section in progress began, and when the next one lands.
      expect(timing.progressStartedAt).toBe(at(0).toISOString());
      expect(timing.nextAttemptAt).toBe(at(sectionMs).toISOString());
      expect(Date.parse(timing.nextAttemptAt) - Date.parse(timing.progressStartedAt)).toBe(
        balance.welding.attemptDurationTicks * GAME_TICK_MS,
      );
      expect(timing.nextAttemptDurationTicks).toBe(balance.welding.attemptDurationTicks);
      // Nothing shortens a Welding section; the Cutter charge is Mining's.
      expect(timing.nextAttemptBoosted).toBe(false);
    });

    it("advances its sections through ordinary reads, each read naming the next boundary", async () => {
      // The regression as a client meets it: no Stop, no claim, no command of
      // any kind — only state reads. The server has always reconciled sections
      // on a read; what the missing projection took away was the timing that
      // tells a client WHEN to read, so the reads stopped happening and the job
      // sat at zero. A read that advances the work must also hand back the
      // boundary the next section lands on, or nothing asks again.
      const { userId, character } = await welding();

      for (const sections of [0, 2, 4]) {
        const read = await refresh(userId, character.id, sectionMs * sections + 100);
        expect(read.workOrders.active?.sectionsCompleted).toBe(sections);
        expect(read.activeAction?.actionId).toBe(ACTION_IDS.workOrderWelding);
        expect(read.activeAction?.progressStartedAt).toBe(at(sectionMs * sections).toISOString());
        expect(read.activeAction?.nextAttemptAt).toBe(at(sectionMs * (sections + 1)).toISOString());
      }
    });

    it("carries the live section count into the Clean Pass projection", async () => {
      const { userId, character } = await welding();
      const read = await refresh(userId, character.id, sectionMs * 3 + 100);

      const cleanPass = read.workOrders.active?.cleanPass;
      expect(cleanPass?.opportunities.length).toBeGreaterThan(0);
      // `sectionsCompleted + 1` is the section being welded right now, which is
      // how the Clean Pass surface knows its window is open — so it has to be
      // the same live count the job itself reports, not a stale copy.
      expect(cleanPass?.sectionsCompleted).toBe(3);
      expect(cleanPass?.sectionsCompleted).toBe(read.workOrders.active?.sectionsCompleted);
    });

    it("drops the timing on Stop, with the job still on the bench", async () => {
      const { userId, character } = await welding();
      const stopped = await workOrderCommands.stopWorkOrderWelding(
        userId,
        character.id,
        at(sectionMs * 2),
        deterministicRandom(),
      );

      expect(stopped.workOrder).toEqual({ status: "stopped" });
      expect(stopped.state.activeAction).toBeUndefined();
      // Stopped is not abandoned: the job and its resolved sections stay put,
      // and only the live timing goes.
      expect(stopped.state.workOrders.active).toMatchObject({
        workOrderId: MIXED_JOB,
        sectionsCompleted: 2,
        active: false,
      });
      expect(stopped.state.workOrders.active?.cleanPass).toBeUndefined();
    });
  });

  /**
   * The fix generalized the projection's Welding classification rather than
   * adding a third special case, so the two kinds of Welding that already had
   * live timing must still have exactly the timing they had before (#172,
   * #190). One global section, projected identically for all of them.
   */
  describe("Practice and the authored repairs keep the timing they already had", () => {
    /** The one assertion every kind of Welding has to satisfy. */
    function expectSectionTiming(state: PlayGameplayState, actionId: string) {
      expect(state.activeAction?.actionId).toBe(actionId);
      expect(state.activeAction?.progressStartedAt).toBe(at(0).toISOString());
      expect(state.activeAction?.nextAttemptAt).toBe(at(sectionMs).toISOString());
      expect(state.activeAction?.nextAttemptDurationTicks).toBe(
        balance.welding.attemptDurationTicks,
      );
    }

    it("projects Practice Welding on the global Welding section", async () => {
      const { userId, character } = await welder();
      await giveMaterials(character.id, [
        { itemId: ITEM_IDS.scrapMetal, quantity: balance.practiceWelding.scrapPerWeld },
      ]);

      const started = await practiceCommands.startPracticeWelding(
        userId,
        character.id,
        start,
        deterministicRandom(),
      );
      expectSectionTiming(started, ACTION_IDS.practiceWelding);
    });

    // Driven off the repair-target registry, so a third authored target is
    // covered here the moment it is authored.
    for (const target of REPAIR_TARGETS) {
      it(`projects ${target.displayName} Welding on that same section`, async () => {
        const { userId, character } = await welder();
        const recipe = getRepairTargetBalance(target.id, balance);
        await db
          .update(rune.characters)
          .set({ currentLocationId: target.locationId })
          .where(eq(rune.characters.id, character.id));
        // Its authorizing Mission accepted and its recipe already in, which is
        // all a repair needs before the Welding itself can start.
        await db
          .insert(rune.characterMissions)
          .values({
            characterId: character.id,
            missionId: target.authorizingMissionId,
            acceptedAt: start,
          })
          .onConflictDoNothing();
        await db.insert(rune.characterRepairTargets).values({
          characterId: character.id,
          targetId: target.id,
          materials: installedMaterials(recipe),
        });

        const started = await repairCommands.startWelding(
          userId,
          character.id,
          target.id,
          start,
          deterministicRandom(),
        );
        expectSectionTiming(started, recipe.actionId);
      });
    }
  });

  describe("an accepted job outlives the Mission that opened the board", () => {
    /**
     * The adversarial case a review found: 10,001 Hours accepted, a real job
     * taken with real materials, then the operator console's
     * resetMissionChainAsAdmin un-accepts that Mission underneath it. Start
     * used to be refused work_orders_locked, the bench stayed occupied because
     * there is no abandon path, and the job — and the player's materials —
     * were stranded for good. Reproduced here by deleting the
     * character_missions row directly, which is all resetMissionChainAsAdmin
     * actually does to it, rather than invoking the admin command itself.
     */
    it("keeps a paid-for job weldable to completion, while new acceptance stays locked", async () => {
      const { userId, character } = await welder();
      await giveMaterials(character.id, mixed.materials);
      const accepted = await accept(userId, character.id, MIXED_JOB);
      expect(accepted.workOrder).toEqual({ status: "accepted", workOrderId: MIXED_JOB });
      const creditsBefore = await credits(character.id);
      const xpBefore = await weldingXp(character.id);

      // The operator reset, reproduced directly against the row it touches.
      await db
        .delete(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, character.id),
            eq(rune.characterMissions.missionId, MISSION_IDS.tenThousandOneHours),
          ),
        );

      // The posting the player already paid for is untouched by the reset.
      const afterReset = (await postings(character.id)).find(
        (row) => row.workOrderId === MIXED_JOB,
      )!;
      expect(afterReset.acceptedAt).not.toBeNull();
      expect(afterReset.workOrderId).toBe(MIXED_JOB);
      expect(afterReset.sectionsCompleted).toBe(0);

      // Taking NEW work still requires the unlock — this is the asymmetry that
      // matters: finishing what you paid for is not the same permission as
      // taking more.
      const refusedNewJob = await accept(userId, character.id, WORK_ORDER_IDS.rennCarryFrame);
      expect(refusedNewJob.workOrder).toMatchObject({
        status: "refused",
        reason: "work_orders_locked",
      });

      // But Start succeeds: a job already on the bench was paid for out of the
      // player's own pocket, and is its own authorization to finish.
      const started = await startWelding(userId, character.id);
      expect(started.workOrder).toEqual({ status: "started" });

      // It still welds, section by section, at the customer XP share — and
      // while it does, the board reflects the lock exactly as designed: the
      // active job stays projected, but there is nothing new to offer, so no
      // postings are.
      const midway = await refresh(userId, character.id, sectionMs * 2);
      const midwayRow = (await postings(character.id)).find((row) => row.acceptedAt !== null)!;
      expect(midwayRow.sectionsCompleted).toBe(2);
      expect(await weldingXp(character.id)).toBe(xpBefore + 2 * sectionXp);
      expect(midway.workOrders.active).toBeDefined();
      expect(midway.workOrders.postings).toEqual([]);

      // Welded through to completion, it pays, grants the rest of its XP,
      // releases the bench and refills the slot exactly once — the player is
      // never stranded.
      await refresh(userId, character.id, sectionMs * mixed.sections + sectionMs * 3);
      expect(await credits(character.id)).toBe(creditsBefore + mixed.payoutCredits);
      expect(await weldingXp(character.id)).toBe(xpBefore + mixed.sections * sectionXp);
      expect((await postings(character.id)).filter((row) => row.acceptedAt !== null)).toEqual([]);
      expect(await activeAction(character.id)).toBeUndefined();
    });
  });

  describe("the completion receipt", () => {
    /**
     * The regression a review found: the Workbench used to infer a completion
     * from an active job disappearing between two CLIENT renders, so the one
     * player who most needs telling — the one who was away while the job
     * finished — was told nothing, because their first load after being away
     * has no previous render to compare against. The receipt is now produced by
     * the transaction that actually pays, and these prove the two things that
     * makes true: it is present exactly once, on the response that discovered
     * the completion, and it is never produced by a job merely going away.
     */
    async function onTheBench(ms = 0) {
      const fixture = await welder();
      await giveMaterials(fixture.character.id, mixed.materials);
      await accept(fixture.userId, fixture.character.id, MIXED_JOB, ms);
      return fixture;
    }

    const receiptFor = (job: typeof mixed) => ({
      workOrderId: job.id,
      title: job.title,
      clientName: job.clientName,
      payoutCredits: job.payoutCredits,
    });

    it("reports a job that finished while the player was away, on the load that discovers it", async () => {
      const { userId, character } = await onTheBench();
      const creditsBefore = await credits(character.id);
      await startWelding(userId, character.id);

      // Away for the whole job and well past it, in one step and with no state
      // read while it ran: this is a fresh load that never saw the job running.
      const rediscovered = await refresh(
        userId,
        character.id,
        sectionMs * mixed.sections + sectionMs * 9,
      );

      expect(rediscovered.workOrders.recentCompletion).toEqual(receiptFor(mixed));
      expect(rediscovered.workOrders.active).toBeUndefined();
      // And the receipt describes something that genuinely happened.
      expect(await credits(character.id)).toBe(creditsBefore + mixed.payoutCredits);
      expect(await workOrdersCompleted(character.id)).toBe(1);
    });

    it("is consumed by that response: the next read is silent and the payout stays paid once", async () => {
      const { userId, character } = await onTheBench();
      const creditsBefore = await credits(character.id);
      await startWelding(userId, character.id);

      const completionMs = sectionMs * mixed.sections;
      const discovered = await refresh(userId, character.id, completionMs);
      expect(discovered.workOrders.recentCompletion).toEqual(receiptFor(mixed));

      // A receipt, not a standing flag: the very next refresh says nothing,
      // which is what lets the surface latch it instead of re-announcing it.
      const next = await refresh(userId, character.id, completionMs + sectionMs * 4);
      expect(next.workOrders.recentCompletion).toBeUndefined();
      expect(await credits(character.id)).toBe(creditsBefore + mixed.payoutCredits);
      expect(await workOrdersCompleted(character.id)).toBe(1);
    });

    it("reports a completion the player watched resolve, read by read", async () => {
      const { userId, character } = await onTheBench();
      const creditsBefore = await credits(character.id);
      await startWelding(userId, character.id);

      // The other path into the same boundary: several ordinary reads while the
      // job is still running, none of which has anything to report.
      for (const section of [2, 5, 9]) {
        const midway = await refresh(userId, character.id, sectionMs * section);
        expect(midway.workOrders.active?.workOrderId).toBe(MIXED_JOB);
        expect(midway.workOrders.recentCompletion).toBeUndefined();
      }

      const finished = await refresh(userId, character.id, sectionMs * mixed.sections);
      expect(finished.workOrders.recentCompletion).toEqual(receiptFor(mixed));
      expect(await credits(character.id)).toBe(creditsBefore + mixed.payoutCredits);
    });

    it("says nothing on a read that completed nothing", async () => {
      const { userId, character } = await welder();
      const idle = await refresh(userId, character.id, sectionMs * 3);
      expect(idle.workOrders.recentCompletion).toBeUndefined();

      // Nor for a job accepted and sitting on the bench with no Welding on it.
      await giveMaterials(character.id, mixed.materials);
      await accept(userId, character.id, MIXED_JOB, sectionMs * 3);
      const waiting = await refresh(userId, character.id, sectionMs * 20);
      expect(waiting.workOrders.active?.workOrderId).toBe(MIXED_JOB);
      expect(waiting.workOrders.recentCompletion).toBeUndefined();
    });

    it("goes to the one request that won a concurrent completion, and to no other", async () => {
      const { userId, character } = await onTheBench();
      const creditsBefore = await credits(character.id);
      await startWelding(userId, character.id);

      const completionMs = sectionMs * mixed.sections;
      const both = await Promise.all([
        refresh(userId, character.id, completionMs),
        refresh(userId, character.id, completionMs),
      ]);

      // The completion that is refused pays nothing, so it reports nothing:
      // exactly one of the two responses carries the receipt, and it is the one
      // whose transaction actually paid.
      expect(both.filter((state) => state.workOrders.recentCompletion !== undefined)).toEqual([
        expect.objectContaining({
          workOrders: expect.objectContaining({ recentCompletion: receiptFor(mixed) }),
        }),
      ]);
      expect(await credits(character.id)).toBe(creditsBefore + mixed.payoutCredits);
      expect(await workOrdersCompleted(character.id)).toBe(1);
    });

    it("never announces a payout for a job that only disappeared", async () => {
      // The operator reset from the suite above, read for what the surface is
      // told rather than for what the player can still weld: the Mission that
      // opened the board is gone underneath an accepted job, and nothing about
      // that is a completion.
      const { userId, character } = await onTheBench();
      const creditsBefore = await credits(character.id);
      await db
        .delete(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, character.id),
            eq(rune.characterMissions.missionId, MISSION_IDS.tenThousandOneHours),
          ),
        );

      const locked = await refresh(userId, character.id, sectionMs * 2);
      expect(locked.workOrders.recentCompletion).toBeUndefined();

      // And with the job itself taken off the bench — an active job becoming no
      // active job, the exact shape the old client-side inference mistook for a
      // completion — there is still nothing to announce.
      await db
        .update(rune.characterWorkOrderPostings)
        .set({ acceptedAt: null, sectionsCompleted: 0, cleanPass: null })
        .where(eq(rune.characterWorkOrderPostings.characterId, character.id));

      const vanished = await refresh(userId, character.id, sectionMs * 4);
      expect(vanished.workOrders.active).toBeUndefined();
      expect(vanished.workOrders.recentCompletion).toBeUndefined();
      expect(await credits(character.id)).toBe(creditsBefore);
      expect(await workOrdersCompleted(character.id)).toBe(0);
    });
  });
});
