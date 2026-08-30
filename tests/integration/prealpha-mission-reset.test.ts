import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { executeReset, scanResetState, verifyReset } from "@/scripts/prealpha-mission-reset.mjs";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite =
  DATABASE_URL && process.env.RUNESPACE_ISSUE_126_INTEGRATION ? describe : describe.skip;
const { Client } = pg;

suite("Issue #126 pre-alpha mission reset (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  const createdUsers: string[] = [];
  const now = new Date("2026-01-01T00:00:00.000Z");

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function createResetFixture() {
    const userId = await createTestUser(db, authSchema, "Issue 126 Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Issue 126 ${randomUUID().slice(0, 8)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await db.insert(rune.characterMissions).values([
      { characterId: character.id, missionId: MISSION_IDS.walkItOff, acceptedAt: now },
      {
        characterId: character.id,
        missionId: MISSION_IDS.cutYourTeeth,
        acceptedAt: now,
        completedAt: now,
      },
    ]);
    const [cutter, spareCutter, container] = await db
      .insert(rune.itemInstances)
      .values([
        { characterId: character.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 },
        { characterId: character.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 7 },
        { characterId: character.id, itemId: ITEM_IDS.mykeaSchleppraum8, currentCharge: null },
      ])
      .returning();
    await db.insert(rune.equippedItems).values([
      {
        characterId: character.id,
        assignmentKind: "gear",
        suitSlotId: "mining_tool",
        itemInstanceId: cutter!.id,
      },
      {
        characterId: character.id,
        assignmentKind: "container",
        suitSlotId: "container_attachment_1",
        itemInstanceId: container!.id,
      },
    ]);
    await db.insert(rune.inventoryStacks).values([
      { characterId: character.id, itemId: ITEM_IDS.ferriteShale, quantity: 4 },
      { characterId: character.id, itemId: ITEM_IDS.powerCell, quantity: 2 },
    ]);
    await db.insert(rune.characterSkillXp).values([
      { characterId: character.id, skillId: SKILL_IDS.mining, totalXp: 215 },
      { characterId: character.id, skillId: SKILL_IDS.refining, totalXp: 31 },
    ]);
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, character.id));
    return { userId, character };
  }

  it("reports a read-only dry run and removes only the requested state", async () => {
    const { character } = await createResetFixture();
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const dryRun = await scanResetState(client);
      const report = {
        kind: "runespace.issue-126.prealpha-mission-reset",
        schemaVersion: 1,
        mode: "dry-run",
        authority: {
          missionIds: { walkItOff: MISSION_IDS.walkItOff, cutYourTeeth: MISSION_IDS.cutYourTeeth },
          itemIds: { salvageCutter: ITEM_IDS.salvageCutter },
          skillIds: { mining: SKILL_IDS.mining },
        },
        generatedAt: now.toISOString(),
        affectedCharacterIds: dryRun.characterIds,
        counts: dryRun.counts,
        unsafeStates: dryRun.unsafeStates,
        baseline: dryRun.baseline,
      };
      expect(report.affectedCharacterIds).toEqual([character.id]);
      expect(report.counts).toMatchObject({
        affectedCharacters: 1,
        walkItOffRows: 1,
        cutYourTeethRows: 1,
        salvageCutterInstances: 2,
        equippedSalvageCutterAssignments: 1,
        unrelatedInventoryStackRows: 2,
        unrelatedInventoryQuantity: 6,
        unrelatedItemInstances: 1,
      });
      expect(report.unsafeStates).toEqual([]);

      const beforeMissionRows = await db
        .select()
        .from(rune.characterMissions)
        .where(eq(rune.characterMissions.characterId, character.id));
      await executeReset(client, report);
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(eq(rune.characterMissions.characterId, character.id)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(rune.itemInstances)
          .where(
            and(
              eq(rune.itemInstances.characterId, character.id),
              eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
            ),
          ),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(rune.equippedItems)
          .where(eq(rune.equippedItems.characterId, character.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, character.id)),
      ).toHaveLength(2);
      expect(
        await db
          .select()
          .from(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, character.id)),
      ).toHaveLength(2);
      expect(beforeMissionRows).toHaveLength(2);
      expect(await verifyReset(client, report)).toMatchObject({
        verification: {
          walkItOffRowsRemaining: 0,
          cutYourTeethRowsRemaining: 0,
          salvageCutterInstancesRemaining: 0,
          equippedSalvageCutterAssignmentsRemaining: 0,
          unrelatedInventoryItemCountsUnchanged: true,
          miningXpUnchanged: true,
          unrelatedStateUnchanged: true,
          passed: true,
        },
      });
    } finally {
      await client.end();
    }
  });

  it("rolls back all deletions when a later reset statement fails", async () => {
    const { character } = await createResetFixture();
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const scan = await scanResetState(client);
      const report = {
        kind: "runespace.issue-126.prealpha-mission-reset",
        schemaVersion: 1,
        mode: "dry-run",
        authority: {
          missionIds: { walkItOff: MISSION_IDS.walkItOff, cutYourTeeth: MISSION_IDS.cutYourTeeth },
          itemIds: { salvageCutter: ITEM_IDS.salvageCutter },
          skillIds: { mining: SKILL_IDS.mining },
        },
        generatedAt: now.toISOString(),
        affectedCharacterIds: scan.characterIds,
        counts: scan.counts,
        unsafeStates: scan.unsafeStates,
        baseline: scan.baseline,
      };
      const failingClient = {
        query: async (query: string, parameters?: unknown[]) => {
          if (query.includes("DELETE FROM character_missions"))
            throw new Error("simulated maintenance failure");
          return client.query(query, parameters);
        },
      };
      await expect(executeReset(failingClient, report)).rejects.toThrow(
        "simulated maintenance failure",
      );
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(eq(rune.characterMissions.characterId, character.id)),
      ).toHaveLength(2);
      expect(
        await db
          .select()
          .from(rune.itemInstances)
          .where(
            and(
              eq(rune.itemInstances.characterId, character.id),
              eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
            ),
          ),
      ).toHaveLength(2);
      expect(
        await db
          .select()
          .from(rune.equippedItems)
          .where(eq(rune.equippedItems.characterId, character.id)),
      ).toHaveLength(2);
    } finally {
      await client.end();
    }
  });

  it("refuses an active character without changing its reset state", async () => {
    const { character } = await createResetFixture();
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: ACTION_IDS.travel,
      startedAt: now,
      resolvedThroughAt: now,
    });
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const scan = await scanResetState(client);
      expect(scan.unsafeStates).toContainEqual(
        expect.objectContaining({ code: "active_action", count: 1 }),
      );
      const report = {
        kind: "runespace.issue-126.prealpha-mission-reset",
        schemaVersion: 1,
        mode: "dry-run",
        authority: {
          missionIds: { walkItOff: MISSION_IDS.walkItOff, cutYourTeeth: MISSION_IDS.cutYourTeeth },
          itemIds: { salvageCutter: ITEM_IDS.salvageCutter },
          skillIds: { mining: SKILL_IDS.mining },
        },
        generatedAt: now.toISOString(),
        affectedCharacterIds: scan.characterIds,
        counts: scan.counts,
        unsafeStates: scan.unsafeStates,
        baseline: scan.baseline,
      };
      await expect(executeReset(client, report)).rejects.toThrow("unsafe state");
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(eq(rune.characterMissions.characterId, character.id)),
      ).toHaveLength(2);
    } finally {
      await client.end();
    }
  });
});
