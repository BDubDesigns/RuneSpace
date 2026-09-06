import { and, eq } from "drizzle-orm";
import pg from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, MISSION_IDS, SKILL_IDS } from "@/game/config/foundations";
import {
  EXECUTION_CONFIRMATION,
  executeBackfill,
  queryScan,
  reportFromScan,
} from "@/scripts/hold-it-together-backfill.mjs";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite =
  DATABASE_URL && process.env.RUNESPACE_ISSUE_148_INTEGRATION ? describe : describe.skip;
const { Client } = pg;

suite("Issue #148 Hold It Together backfill (real PostgreSQL)", () => {
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

  async function makeCompletedWaste(label: string) {
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
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: MISSION_IDS.wasteNot,
      acceptedAt: now,
      completedAt: now,
    });
    return { userId, character };
  }

  it("backfills only the accepted mission row and preserves Cargo, inventory, and XP", async () => {
    const eligible = await makeCompletedWaste("Eligible");
    const alreadyAccepted = await makeCompletedWaste("Already Accepted");
    await db.insert(rune.characterMissions).values({
      characterId: alreadyAccepted.character.id,
      missionId: MISSION_IDS.holdItTogether,
      acceptedAt: now,
    });

    await db.insert(rune.inventoryStacks).values([
      { characterId: eligible.character.id, itemId: ITEM_IDS.refinedFerrite, quantity: 4 },
      { characterId: eligible.character.id, itemId: ITEM_IDS.slag, quantity: 2 },
    ]);
    await db
      .update(rune.characterCargoHoldRepair)
      .set({
        refinedFerriteContributed: 7,
        slagContributed: 3,
        weldingProgress: 4,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(rune.characterCargoHoldRepair.characterId, eligible.character.id));
    const before = {
      stacks: await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, eligible.character.id)),
      repair: await db
        .select()
        .from(rune.characterCargoHoldRepair)
        .where(eq(rune.characterCargoHoldRepair.characterId, eligible.character.id)),
      weldingXp: await db
        .select()
        .from(rune.characterSkillXp)
        .where(
          and(
            eq(rune.characterSkillXp.characterId, eligible.character.id),
            eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
          ),
        ),
    };

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const report = reportFromScan(await queryScan(client));
      expect(report).toMatchObject({
        wouldAcceptCharacterIds: [eligible.character.id],
        alreadyAcceptedCharacterIds: [alreadyAccepted.character.id],
        counts: { wouldAccept: 1, alreadyAccepted: 1 },
      });

      await expect(
        executeBackfill(client, report, EXECUTION_CONFIRMATION, now),
      ).resolves.toMatchObject({
        mode: "execute",
        accepted: 1,
        verification: {
          withinTransaction: {
            expected: 1,
            accepted: 1,
            completed: 0,
            progressRows: 0,
            passed: true,
          },
        },
      });

      const holdRows = await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, eligible.character.id),
            eq(rune.characterMissions.missionId, MISSION_IDS.holdItTogether),
          ),
        );
      expect(holdRows).toEqual([
        expect.objectContaining({ acceptedAt: expect.any(Date), completedAt: null }),
      ]);
      expect(
        await db
          .select()
          .from(rune.characterMissionProgress)
          .where(eq(rune.characterMissionProgress.characterId, eligible.character.id)),
      ).toEqual([]);
      expect({
        stacks: await db
          .select()
          .from(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, eligible.character.id)),
        repair: await db
          .select()
          .from(rune.characterCargoHoldRepair)
          .where(eq(rune.characterCargoHoldRepair.characterId, eligible.character.id)),
        weldingXp: await db
          .select()
          .from(rune.characterSkillXp)
          .where(
            and(
              eq(rune.characterSkillXp.characterId, eligible.character.id),
              eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
            ),
          ),
      }).toEqual(before);

      await expect(
        executeBackfill(client, report, EXECUTION_CONFIRMATION, now),
      ).resolves.toMatchObject({ mode: "execute", accepted: 0 });
    } finally {
      await client.end();
    }
  });
});
