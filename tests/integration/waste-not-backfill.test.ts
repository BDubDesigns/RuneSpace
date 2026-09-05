import pg from "pg";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTION_IDS, MISSION_IDS } from "@/game/config/foundations";
import {
  EXECUTION_CONFIRMATION,
  executeBackfill,
  queryScan,
  reportFromScan,
} from "@/scripts/waste-not-backfill.mjs";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite =
  DATABASE_URL && process.env.RUNESPACE_ISSUE_141_INTEGRATION ? describe : describe.skip;
const { Client } = pg;

suite("Issue #141 Waste Not backfill (real PostgreSQL)", () => {
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

  async function makeCompletedCut(label: string) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `${label} ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await db.insert(rune.characterMissions).values([
      {
        characterId: character.id,
        missionId: MISSION_IDS.walkItOff,
        acceptedAt: now,
        completedAt: now,
      },
      {
        characterId: character.id,
        missionId: MISSION_IDS.cutYourTeeth,
        acceptedAt: now,
        completedAt: now,
      },
    ]);
    return character.id;
  }

  it("reports dry-run cohorts, skips active actions, executes reviewed 0/5 rows, and is idempotent", async () => {
    const eligibleId = await makeCompletedCut("Eligible");
    const activeId = await makeCompletedCut("Active");
    const alreadyAcceptedId = await makeCompletedCut("Already Accepted");
    await db.insert(rune.characterMissions).values({
      characterId: alreadyAcceptedId,
      missionId: MISSION_IDS.wasteNot,
      acceptedAt: now,
    });
    await db.insert(rune.characterMissionProgress).values({
      characterId: alreadyAcceptedId,
      missionId: MISSION_IDS.wasteNot,
      progressKey: "refining-attempts",
      progress: 0,
    });
    await db.insert(rune.activeActions).values({
      characterId: activeId,
      actionId: ACTION_IDS.refining,
      startedAt: now,
      resolvedThroughAt: now,
    });

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const beforeRows = await db
        .select()
        .from(rune.characterMissions)
        .where(eq(rune.characterMissions.characterId, eligibleId));
      const scan = await queryScan(client);
      const report = reportFromScan(scan);
      expect(report).toMatchObject({
        mode: "dry-run",
        wouldAcceptCharacterIds: [eligibleId],
        skippedActiveAction: [{ characterId: activeId, actionId: ACTION_IDS.refining }],
        alreadyAcceptedCharacterIds: [alreadyAcceptedId],
        counts: { wouldAccept: 1, skippedActiveAction: 1, alreadyAccepted: 1 },
      });
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(eq(rune.characterMissions.characterId, eligibleId)),
      ).toEqual(beforeRows);
      expect(
        await db
          .select()
          .from(rune.characterMissionProgress)
          .where(eq(rune.characterMissionProgress.characterId, eligibleId)),
      ).toEqual([]);

      await expect(
        executeBackfill(client, report, EXECUTION_CONFIRMATION, now),
      ).resolves.toMatchObject({
        mode: "execute",
        accepted: 1,
        verification: {
          withinTransaction: {
            expected: 1,
            accepted: 1,
            progressAtZero: 1,
            passed: true,
          },
        },
      });

      const after = await queryScan(client);
      expect(after.wouldAcceptCharacterIds).toEqual([]);
      expect(after.skippedActiveAction).toEqual([
        { characterId: activeId, actionId: ACTION_IDS.refining },
      ]);
      expect(after.alreadyAcceptedCharacterIds).toEqual([alreadyAcceptedId, eligibleId].sort());

      await expect(
        executeBackfill(client, report, EXECUTION_CONFIRMATION, now),
      ).resolves.toMatchObject({ mode: "execute", accepted: 0 });
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(
            and(
              eq(rune.characterMissions.characterId, eligibleId),
              eq(rune.characterMissions.missionId, MISSION_IDS.wasteNot),
            ),
          ),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(rune.characterMissionProgress)
          .where(eq(rune.characterMissionProgress.characterId, eligibleId)),
      ).toEqual([
        expect.objectContaining({
          missionId: MISSION_IDS.wasteNot,
          progressKey: "refining-attempts",
          progress: 0,
        }),
      ]);
    } finally {
      await client.end();
    }
  });

  it("rejects an unconfirmed execution without writing", async () => {
    const eligibleId = await makeCompletedCut("Unconfirmed");
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const report = reportFromScan(await queryScan(client));
      await expect(executeBackfill(client, report, "WRONG-CONFIRMATION", now)).rejects.toThrow(
        `--execute requires --confirm ${EXECUTION_CONFIRMATION}`,
      );
      await expect(
        executeBackfill(
          client,
          { ...report, counts: { ...report.counts, wouldAccept: 99 } },
          EXECUTION_CONFIRMATION,
          now,
        ),
      ).rejects.toThrow("report counts do not match its character cohorts");
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(
            and(
              eq(rune.characterMissions.characterId, eligibleId),
              eq(rune.characterMissions.missionId, MISSION_IDS.wasteNot),
            ),
          ),
      ).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("rejects database-state drift before writes", async () => {
    const reviewedId = await makeCompletedCut("Reviewed");
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const report = reportFromScan(await queryScan(client));
      await makeCompletedCut("Drifted");
      await expect(executeBackfill(client, report, EXECUTION_CONFIRMATION, now)).rejects.toThrow(
        "database state no longer matches the reviewed dry-run report",
      );
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(
            and(
              eq(rune.characterMissions.characterId, reviewedId),
              eq(rune.characterMissions.missionId, MISSION_IDS.wasteNot),
            ),
          ),
      ).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("rolls back mission and progress rows when the guarded execution fails", async () => {
    const eligibleId = await makeCompletedCut("Rollback");
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const report = reportFromScan(await queryScan(client));
      const failingClient = {
        query: async (query: string, parameters?: unknown[]) => {
          if (query.includes("INSERT INTO character_mission_progress"))
            throw new Error("simulated backfill failure");
          return client.query(query, parameters);
        },
      };
      await expect(
        executeBackfill(failingClient as never, report, EXECUTION_CONFIRMATION, now),
      ).rejects.toThrow("simulated backfill failure");
      expect(
        await db
          .select()
          .from(rune.characterMissions)
          .where(
            and(
              eq(rune.characterMissions.characterId, eligibleId),
              eq(rune.characterMissions.missionId, MISSION_IDS.wasteNot),
            ),
          ),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(rune.characterMissionProgress)
          .where(eq(rune.characterMissionProgress.characterId, eligibleId)),
      ).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
