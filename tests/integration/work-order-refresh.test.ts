import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
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
 * Issue #217 — Refining eligibility revalidation and ForceSales' daily board
 * refresh, against real PostgreSQL.
 *
 * What only a database proves: that the daily entitlement and the board
 * replacement commit together or not at all, that a concurrent/retried
 * refresh cannot spend the entitlement twice, that the active posting is
 * never touched by a refresh, and that the first-use presentation state
 * persists until a refresh genuinely commits.
 */
suite("issue #217 Refining eligibility and ForceSales refresh (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let missions: typeof import("@/server/missions");
  let workOrderCommands: typeof import("@/server/work-order-commands");
  let workOrders: typeof import("@/server/work-orders");
  let workOrderRefresh: typeof import("@/server/work-order-refresh");
  const createdUsers: string[] = [];
  const balance = getEffectiveGameBalance();
  const thresholds = standardSkillLevelThresholds(balance);

  const REFINING_JOB = WORK_ORDER_IDS.vossCountertopCooker;
  const refiningJob = getWorkOrder(REFINING_JOB)!;
  // Every job the Refining-5+ pool can seed, so a refresh over the full pool
  // always has genuine alternatives to draw instead of the postings it just
  // cleared.
  const FULL_BOARD: readonly WorkOrderId[] = [
    WORK_ORDER_IDS.rennCarryFrame,
    WORK_ORDER_IDS.vossHeaterHousing,
    WORK_ORDER_IDS.bixShopShelving,
  ];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    missions = await import("@/server/missions");
    workOrderCommands = await import("@/server/work-order-commands");
    workOrders = await import("@/server/work-orders");
    workOrderRefresh = await import("@/server/work-order-refresh");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  async function setSkillLevel(characterId: string, skillId: string, level: number) {
    // Level 1 (0 XP) is the game's actual floor; standardSkillLevelThresholds
    // authors no level-0 entry, and a character with no row already defaults
    // to level 1, so there is nothing to write for level <= 1.
    if (level <= 1) return;
    const totalXp = thresholds.find((threshold) => threshold.level === level)!.totalXp;
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId, skillId, totalXp })
      .onConflictDoUpdate({
        target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
        set: { totalXp },
      });
  }

  async function seedBoard(characterId: string, workOrderIds: readonly WorkOrderId[]) {
    await db
      .delete(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, characterId));
    await db.insert(rune.characterWorkOrderPostings).values(
      workOrderIds.map((workOrderId, slotIndex) => ({
        characterId,
        slotIndex,
        workOrderId,
        postedAt: new Date("2026-09-20T00:00:00.000Z"),
        updatedAt: new Date("2026-09-20T00:00:00.000Z"),
      })),
    );
  }

  async function giveMaterials(
    characterId: string,
    materials: readonly { itemId: string; quantity: number }[],
  ) {
    for (const material of materials) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: material.itemId, quantity: material.quantity });
    }
  }

  async function postings(characterId: string) {
    const rows = await db
      .select()
      .from(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, characterId));
    return rows.sort((a, b) => a.slotIndex - b.slotIndex);
  }

  async function refreshRows(characterId: string) {
    return db
      .select()
      .from(rune.characterWorkOrderBoardRefreshes)
      .where(eq(rune.characterWorkOrderBoardRefreshes.characterId, characterId));
  }

  /** `loadWorkOrderRefreshState` takes a transaction; wrap the top-level `db`. */
  function loadRefreshState(characterId: string, resetDate: string) {
    return db.transaction((transaction) =>
      workOrders.loadWorkOrderRefreshState(transaction, { characterId, resetDate }),
    );
  }

  /**
   * An apprentice with the board unlocked, standing at Rusk Recovery, with
   * Welding and Refining set to whatever a test needs.
   */
  async function apprentice(
    options: {
      unlocked?: boolean;
      weldingLevel?: number;
      refiningLevel?: number;
      board?: readonly WorkOrderId[];
    } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "ForceSales Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Refresh ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
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
        acceptedAt: new Date("2026-09-01T00:00:00.000Z"),
        completedAt: new Date("2026-09-01T00:00:00.000Z"),
      })),
    );
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    await setSkillLevel(
      character.id,
      SKILL_IDS.welding,
      options.weldingLevel ?? balance.workOrders.requiredWeldingLevel,
    );
    await setSkillLevel(
      character.id,
      SKILL_IDS.refining,
      options.refiningLevel ?? balance.workOrders.refresh.requiredRefiningLevel,
    );
    if (options.unlocked !== false) {
      const accepted = await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.tenThousandOneHours,
        NPC_IDS.wadeRusk,
        new Date("2026-09-01T00:00:00.000Z"),
        deterministicRandom(),
      );
      expect(accepted.mission.status).toBe("accepted");
    }
    await seedBoard(character.id, options.board ?? FULL_BOARD);
    return { userId, character };
  }

  describe("Refining revalidation on acceptance", () => {
    it("refuses a Refining-5 job below the level, and accepts once it is met", async () => {
      const { userId, character } = await apprentice({ refiningLevel: 4, board: [REFINING_JOB] });
      await giveMaterials(character.id, refiningJob.materials);

      const refused = await workOrderCommands.acceptWorkOrder(
        userId,
        character.id,
        REFINING_JOB,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(refused.workOrder).toMatchObject({ status: "refused", reason: "refining_level" });
      expect((await postings(character.id)).every((row) => row.acceptedAt === null)).toBe(true);

      await setSkillLevel(character.id, SKILL_IDS.refining, 5);
      const accepted = await workOrderCommands.acceptWorkOrder(
        userId,
        character.id,
        REFINING_JOB,
        new Date("2026-09-20T12:00:01.000Z"),
        deterministicRandom(),
      );
      expect(accepted.workOrder).toEqual({ status: "accepted", workOrderId: REFINING_JOB });
    });

    it("never trusts a forged accept for a job the server itself never posted at that level", async () => {
      // Even a job genuinely on the board must be revalidated: dropping below
      // the level after acceptance-time checks would have run must still
      // refuse, exactly like the existing Welding revalidation.
      const { userId, character } = await apprentice({ refiningLevel: 5, board: [REFINING_JOB] });
      await giveMaterials(character.id, refiningJob.materials);
      await setSkillLevel(character.id, SKILL_IDS.refining, 4);

      const refused = await workOrderCommands.acceptWorkOrder(
        userId,
        character.id,
        REFINING_JOB,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(refused.workOrder).toMatchObject({ status: "refused", reason: "refining_level" });
    });
  });

  describe("unlock gating", () => {
    it("refuses refresh before Refining 5, even with the board unlocked", async () => {
      const { userId, character } = await apprentice({ refiningLevel: 4 });
      const before = await postings(character.id);

      const refused = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(refused.refresh).toMatchObject({ status: "refused", reason: "refining_level" });
      expect(await postings(character.id)).toEqual(before);
      expect(await refreshRows(character.id)).toEqual([]);
    });

    it("refuses refresh before the board itself is unlocked, even at Refining 5", async () => {
      const { userId, character } = await apprentice({ unlocked: false, refiningLevel: 5 });

      const refused = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(refused.refresh).toMatchObject({ status: "refused", reason: "work_orders_locked" });
      expect(await refreshRows(character.id)).toEqual([]);
    });

    it("succeeds once both the board and Refining 5 hold", async () => {
      const { userId, character } = await apprentice();

      const result = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(result.refresh).toEqual({ status: "refreshed" });
    });
  });

  describe("full-board replacement", () => {
    it("replaces all three postings when nothing is active", async () => {
      const { userId, character } = await apprentice();
      const before = await postings(character.id);

      await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );

      const after = await postings(character.id);
      expect(after).toHaveLength(3);
      expect(after.every((row) => row.acceptedAt === null)).toBe(true);
      // Same slots, different jobs — the anti-redraw rule avoids every posting
      // it just removed while sixteen jobs' worth of alternatives exist.
      for (const row of after) {
        const original = before.find((entry) => entry.slotIndex === row.slotIndex)!;
        expect(row.workOrderId).not.toBe(original.workOrderId);
      }
      const beforeIds = new Set(before.map((row) => row.workOrderId));
      expect(after.some((row) => beforeIds.has(row.workOrderId))).toBe(false);
    });

    it("preserves the active posting exactly and replaces only the other two", async () => {
      const { userId, character } = await apprentice();
      await giveMaterials(character.id, refiningJob.materials);
      await seedBoard(character.id, [REFINING_JOB, ...FULL_BOARD.slice(0, 2)]);
      await workOrderCommands.acceptWorkOrder(
        userId,
        character.id,
        REFINING_JOB,
        new Date("2026-09-20T11:00:00.000Z"),
        deterministicRandom(),
      );
      const activeBefore = (await postings(character.id)).find((row) => row.slotIndex === 0)!;
      expect(activeBefore.acceptedAt).not.toBeNull();
      const clearedBefore = (await postings(character.id)).filter((row) => row.slotIndex !== 0);

      await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );

      const after = await postings(character.id);
      const activeAfter = after.find((row) => row.slotIndex === 0)!;
      expect(activeAfter).toEqual(activeBefore);
      const clearedAfter = after.filter((row) => row.slotIndex !== 0);
      expect(clearedAfter.every((row) => row.acceptedAt === null)).toBe(true);
      for (const row of clearedAfter) {
        const original = clearedBefore.find((entry) => entry.slotIndex === row.slotIndex)!;
        expect(row.workOrderId).not.toBe(original.workOrderId);
      }
      expect(clearedAfter.map((row) => row.workOrderId)).not.toContain(REFINING_JOB);
    });

    // The anti-redraw fallback itself (relaxing rather than leaving a slot
    // unfilled when the eligible pool is too small to avoid every cleared
    // job) is exercised at the unit level against a synthetic pool — see
    // "falls back to redrawing a just-cleared posting when it is the only
    // way to fill every slot" in tests/unit/work-orders.test.ts. It cannot be
    // reproduced truthfully through this command against the real content:
    // every authored job requires Welding 5 and nothing more, and reaching
    // Refining 5 (required just to call refresh at all) makes every one of
    // the sixteen authored jobs eligible, so the real pool never shrinks
    // small enough to force a redraw.
  });

  describe("daily entitlement", () => {
    it("consumes exactly one refresh per Pacific reset date, restoring on the next", async () => {
      const { userId, character } = await apprentice();
      const first = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(first.refresh).toEqual({ status: "refreshed" });
      const afterFirst = await postings(character.id);

      const sameDay = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T23:00:00.000Z"),
        deterministicRandom(),
      );
      expect(sameDay.refresh).toMatchObject({
        status: "refused",
        reason: "already_refreshed_today",
      });
      expect(await postings(character.id)).toEqual(afterFirst);

      // Past the next Pacific local midnight (07:00 UTC during PDT).
      const nextDay = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-21T08:00:00.000Z"),
        deterministicRandom(),
      );
      expect(nextDay.refresh).toEqual({ status: "refreshed" });
      expect(await refreshRows(character.id)).toHaveLength(2);
    });

    it("serializes concurrent refresh commands into exactly one commit", async () => {
      const { userId, character } = await apprentice();

      const [first, second] = await Promise.all([
        workOrderRefresh.refreshWorkOrderBoard(
          userId,
          character.id,
          new Date("2026-09-20T12:00:00.000Z"),
          deterministicRandom(),
        ),
        workOrderRefresh.refreshWorkOrderBoard(
          userId,
          character.id,
          new Date("2026-09-20T12:00:00.000Z"),
          deterministicRandom(),
        ),
      ]);
      const statuses = [first.refresh.status, second.refresh.status].sort();
      expect(statuses).toEqual(["refreshed", "refused"]);
      expect(await refreshRows(character.id)).toHaveLength(1);

      // A later sequential retry the same day changes nothing further.
      const retried = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T13:00:00.000Z"),
        deterministicRandom(),
      );
      expect(retried.refresh).toMatchObject({
        status: "refused",
        reason: "already_refreshed_today",
      });
      expect(await refreshRows(character.id)).toHaveLength(1);
    });

    it("never spends the entitlement on a refusal that never touched the board", async () => {
      const { userId, character } = await apprentice({ refiningLevel: 4 });
      const before = await postings(character.id);

      await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(await refreshRows(character.id)).toEqual([]);

      // Genuinely eligible now: the earlier refusal must not have spent
      // anything.
      await setSkillLevel(character.id, SKILL_IDS.refining, 5);
      const result = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:01.000Z"),
        deterministicRandom(),
      );
      expect(result.refresh).toEqual({ status: "refreshed" });
      expect(await postings(character.id)).not.toEqual(before);
    });

    it("refuses refresh while travelling, leaving the board and entitlement untouched", async () => {
      const { userId, character } = await apprentice();
      const play = await import("@/server/play");
      await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.holoHollow,
        new Date("2026-09-20T11:59:59.900Z"),
        deterministicRandom(),
      );
      const before = await postings(character.id);

      const refused = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(refused.refresh).toMatchObject({ status: "refused", reason: "in_transit" });
      expect(await postings(character.id)).toEqual(before);
      expect(await refreshRows(character.id)).toEqual([]);
    });

    it("allows refresh while a job is In Progress, per the settled ForceSales rule", async () => {
      const { userId, character } = await apprentice();
      await giveMaterials(character.id, refiningJob.materials);
      await seedBoard(character.id, [REFINING_JOB, ...FULL_BOARD.slice(0, 2)]);
      await workOrderCommands.acceptWorkOrder(
        userId,
        character.id,
        REFINING_JOB,
        new Date("2026-09-20T11:00:00.000Z"),
        deterministicRandom(),
      );
      await workOrderCommands.startWorkOrderWelding(
        userId,
        character.id,
        new Date("2026-09-20T11:00:00.000Z"),
        deterministicRandom(),
      );

      const result = await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      expect(result.refresh).toEqual({ status: "refreshed" });
    });
  });

  describe("first-use presentation state", () => {
    it("reports everRefreshed only after a genuinely committed refresh", async () => {
      const { userId, character } = await apprentice();
      const beforeState = await loadRefreshState(character.id, "2026-09-20");
      expect(beforeState).toEqual({ refreshedToday: false, everRefreshed: false });

      await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );

      const afterState = await loadRefreshState(character.id, "2026-09-20");
      expect(afterState).toEqual({ refreshedToday: true, everRefreshed: true });
    });

    it("persists everRefreshed across a later reset date, never resetting to first-use again", async () => {
      const { userId, character } = await apprentice();
      await workOrderRefresh.refreshWorkOrderBoard(
        userId,
        character.id,
        new Date("2026-09-20T12:00:00.000Z"),
        deterministicRandom(),
      );
      const dayOne = await loadRefreshState(character.id, "2026-09-20");
      expect(dayOne).toEqual({ refreshedToday: true, everRefreshed: true });

      const dayTwo = await loadRefreshState(character.id, "2026-09-21");
      expect(dayTwo).toEqual({ refreshedToday: false, everRefreshed: true });
    });
  });
});
