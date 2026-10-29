import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { THEYRE_MINERALS_MARIE as M } from "@/game/content/missions";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";
const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("issue #431 Lapidary and durable Mission stages", () => {
  let db: (typeof import("@/db"))["db"];
  let auth: typeof import("@/db/auth-schema");
  let r: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let chars: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let mission: typeof import("@/server/missions");
  let commands: typeof import("@/server/lapidary-commands");
  const users: string[] = [];
  const t = new Date("2026-10-28T12:00:00Z");
  const at = (ticks: number) => new Date(t.getTime() + ticks * GAME_TICK_MS);
  const rng = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  beforeAll(async () => {
    db = (await import("@/db")).db;
    auth = await import("@/db/auth-schema");
    r = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    chars = await import("@/server/characters");
    play = await import("@/server/play");
    mission = await import("@/server/missions");
    commands = await import("@/server/lapidary-commands");
  });
  afterEach(async () => {
    for (const user of users.splice(0)) await cleanupTestUser(db, auth, r, user);
  });
  async function player() {
    const userId = await createTestUser(db, auth, "lapidary431");
    users.push(userId);
    const c = await createCharacterForUser(
      db,
      r,
      ownership,
      chars,
      userId,
      `Lap ${userId.slice(0, 7)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, c.id, t, rng());
    await db
      .update(r.characters)
      .set({ currentLocationId: LOCATION_IDS.wernersLab })
      .where(eq(r.characters.id, c.id));
    return { userId, id: c.id };
  }
  type Player = Awaited<ReturnType<typeof player>>;
  const state = (p: Player, ticks = 0) =>
    play.getPlayGameplayState(p.userId, p.id, at(ticks), rng());
  async function give(p: Player, itemId: string, quantities: number[]) {
    for (const quantity of quantities)
      await db.insert(r.inventoryStacks).values({ characterId: p.id, itemId, quantity });
  }
  const accept = (p: Player) =>
    mission.acceptMission(p.userId, p.id, M.id, NPC_IDS.werner, t, rng());
  const start = (
    p: Player,
    actionId = ACTION_IDS.shapeStone,
    quantity: number | "max" = 1,
    ticks = 0,
  ) => commands.startLapidary(p.userId, p.id, actionId, quantity, at(ticks), rng());
  const ack = (p: Player, ticks = 20, dialogueId = DIALOGUE_IDS.wernerQuartzLesson) =>
    mission.acknowledgeMissionConversation(
      p.userId,
      p.id,
      M.id,
      NPC_IDS.werner,
      dialogueId,
      at(ticks),
      rng(),
    );
  const finish = (p: Player, ticks = 50) =>
    mission.completeMission(p.userId, p.id, M.id, NPC_IDS.werner, at(ticks), rng());
  const current = (s: Awaited<ReturnType<typeof state>>) =>
    s.missions.find((m) => m.missionId === M.id)!;
  async function stage2(p: Player) {
    await give(p, ITEM_IDS.stone, [3]);
    await accept(p);
    await start(p);
    return state(p, 20);
  }
  async function stage3(p: Player) {
    await stage2(p);
    return ack(p);
  }
  async function stage4(p: Player) {
    await stage3(p);
    await start(p, ACTION_IDS.cutQuartz, 1, 20);
    return state(p, 50);
  }
  it("provisions the sixth progression skill and locks both recipes before acceptance", async () => {
    const p = await player();
    for (const action of [ACTION_IDS.shapeStone, ACTION_IDS.cutQuartz]) {
      const s = await start(p, action);
      expect(s.lapidaryError).toBe("lapidary_locked");
      expect(s.lapidary.totalXp).toBe(0);
      expect(s.activeAction).toBeUndefined();
    }
    expect((await state(p)).progression.skills.some((s) => s.displayName === "Lapidary")).toBe(
      true,
    );
  });
  it("acceptance grants no Quartz and authorizes only one supervised Stone", async () => {
    const p = await player();
    await give(p, ITEM_IDS.stone, [3]);
    const accepted = await accept(p);
    expect(accepted.mission.status).toBe("accepted");
    expect(accepted.state.carriedByItemId[ITEM_IDS.uncutQuartz] ?? 0).toBe(0);
    expect(current(accepted.state).stage?.id).toBe(M.stages![0]!.id);
    for (const quantity of [2, "max"] as const)
      expect((await start(p, ACTION_IDS.shapeStone, quantity)).lapidaryError).toBe(
        "lapidary_quantity_unavailable",
      );
    expect((await start(p, ACTION_IDS.cutQuartz)).lapidaryError).toBe("lapidary_locked");
    expect((await ack(p, 0)).mission.status).toBe("refused");
    expect((await finish(p, 0)).mission.status).toBe("refused");
  });
  it("commits one supervised unit and one stage across a long offline batch and reconnect", async () => {
    const p = await player();
    await give(p, ITEM_IDS.stone, [3]);
    await accept(p);
    await start(p);
    const s = await state(p, 2000);
    expect(s.lapidary.totalXp).toBe(15);
    expect(s.carriedByItemId[ITEM_IDS.stone]).toBe(2);
    expect(s.lapidaryWorkbench.run.cycles).toBe(1);
    expect(s.activeAction).toBeUndefined();
    expect(current(s).stage?.id).toBe(M.stages![1]!.id);
    expect(s.lapidaryWorkbench.access.kind).toBe("locked");
    expect((await state(p, 4000)).lapidary.totalXp).toBe(15);
    expect((await start(p, ACTION_IDS.shapeStone, 1, 4000)).lapidaryError).toBe("lapidary_locked");
  });
  it("caps a forged persisted supervised Max at one completed unit", async () => {
    const p = await player();
    await give(p, ITEM_IDS.stone, [3]);
    await accept(p);
    await start(p);
    await db
      .update(r.characterLapidaryState)
      .set({ runSelectedCycles: null })
      .where(eq(r.characterLapidaryState.characterId, p.id));
    const s = await state(p, 2000);
    expect(s.lapidary.totalXp).toBe(15);
    expect(s.lapidaryWorkbench.run.cycles).toBe(1);
  });
  it("rechecks stage identity when resolving a stale supervised action before minting anything", async () => {
    const p = await player();
    await give(p, ITEM_IDS.stone, [3]);
    await accept(p);
    await start(p);
    await db
      .update(r.characterMissions)
      .set({ completedStageIds: [M.stages![0]!.id] })
      .where(
        and(eq(r.characterMissions.characterId, p.id), eq(r.characterMissions.missionId, M.id)),
      );
    const s = await state(p, 2000);
    expect(s.lapidary.totalXp).toBe(0);
    expect(s.carriedByItemId[ITEM_IDS.stone]).toBe(3);
    expect(s.lapidaryWorkbench.lastStopReason).toBe("access_denied");
  });
  it("refuses a full-inventory gift without acknowledgement or history, then grants once on retry", async () => {
    const p = await player();
    let s = await stage2(p);
    await give(p, ITEM_IDS.ferriteShale, Array(s.inventory.slotsAvailable).fill(1));
    const refused = await ack(p);
    expect(refused.mission).toMatchObject({ status: "refused", reason: "capacity" });
    expect(current(refused.state).stage?.id).toBe(M.stages![1]!.id);
    expect(refused.state.carriedByItemId[ITEM_IDS.uncutQuartz] ?? 0).toBe(0);
    const [stack] = await db
      .select()
      .from(r.inventoryStacks)
      .where(
        and(
          eq(r.inventoryStacks.characterId, p.id),
          eq(r.inventoryStacks.itemId, ITEM_IDS.ferriteShale),
        ),
      )
      .limit(1);
    await db.delete(r.inventoryStacks).where(eq(r.inventoryStacks.id, stack!.id));
    const replies = await Promise.all([ack(p), ack(p)]);
    expect(replies.map((x) => x.mission.status).sort()).toEqual([
      "acknowledged",
      "already_acknowledged",
    ]);
    s = await state(p, 20);
    expect(s.carriedByItemId[ITEM_IDS.uncutQuartz]).toBe(1);
    expect(current(s).stage?.id).toBe(M.stages![2]!.id);
    expect((await ack(p)).mission).toEqual({ status: "already_acknowledged" });
  });
  it("qualifies self-sourced Quartz and preserves progress after selling or storing the output", async () => {
    const p = await player();
    await give(p, ITEM_IDS.uncutQuartz, [1]);
    await stage3(p);
    expect((await state(p, 20)).carriedByItemId[ITEM_IDS.uncutQuartz]).toBe(2);
    await start(p, ACTION_IDS.cutQuartz, 1, 20);
    const cut = await state(p, 50);
    expect(cut.lapidary.totalXp).toBe(90);
    expect(cut.carriedByItemId[ITEM_IDS.cutQuartz]).toBe(1);
    expect(current(cut).stage?.id).toBe(M.stages![3]!.id);
    const trade = await import("@/server/trade");
    const sale = await trade.tradeWithMerchant(
      p.userId,
      p.id,
      { itemId: ITEM_IDS.cutQuartz, direction: "sell", quantity: 1 },
      at(50),
    );
    expect(sale.trade).toMatchObject({ status: "traded", totalCredits: 16 });
    const results = await Promise.all([finish(p), finish(p)]);
    expect(results.map((x) => x.mission.status).sort()).toEqual(["already_completed", "completed"]);
    const s = await state(p, 100);
    expect(s.lapidary.totalXp).toBe(240);
    expect(current(s).state).toBe("completed");
    expect(s.lapidaryWorkbench.access.kind).toBe("unrestricted");
    expect((await ack(p, 100)).mission.status).toBe("already_acknowledged");
    expect((await state(p, 100)).lapidaryWorkbench.access.kind).toBe("unrestricted");
  });
  it("after graduation supports numeric and Max runs, exact inputs/outputs/XP and Finish Current", async () => {
    const p = await player();
    await stage4(p);
    await finish(p);
    await give(p, ITEM_IDS.uncutQuartz, [2]);
    await start(p, ACTION_IDS.cutQuartz, 2, 50);
    const s = await state(p, 110);
    expect(s.lapidary.totalXp).toBe(390);
    expect(s.lapidaryWorkbench.run.cycles).toBe(2);
    expect(s.carriedByItemId[ITEM_IDS.cutQuartz]).toBe(3);
    await start(p, ACTION_IDS.shapeStone, "max", 110);
    await commands.finishCurrentLapidary(p.userId, p.id, at(111), rng());
    const stopped = await state(p, 1000);
    expect(stopped.lapidaryWorkbench.run.cycles).toBe(1);
    expect(stopped.lapidary.totalXp).toBe(405);
    expect(stopped.lapidaryWorkbench.lastStopReason).toBe("finished_current");
  });
  it("concurrent starts reserve one recipe and duplicate resolution cannot duplicate XP or progress", async () => {
    const p = await player();
    await give(p, ITEM_IDS.stone, [3]);
    await accept(p);
    await Promise.all([start(p), start(p)]);
    const results = await Promise.all([state(p, 20), state(p, 20)]);
    expect(results.every((s) => s.lapidary.totalXp === 15)).toBe(true);
    expect((await state(p, 40)).carriedByItemId[ITEM_IDS.stone]).toBe(2);
  });
  it("operator interruption preserves unfinished ingredients and grants nothing", async () => {
    const p = await player();
    await give(p, ITEM_IDS.stone, [1]);
    await accept(p);
    await start(p);
    const { withResolvedCharacter } = await import("@/server/action-resolution");
    const { forceIdleResolvedAction } = await import("@/server/play-interrupt");
    await withResolvedCharacter(
      p.id,
      play.createPlayResolver(rng()),
      (tx, context) =>
        forceIdleResolvedAction(tx, {
          character: context.character,
          action: context.action,
          now: at(19),
        }),
      at(19),
    );
    const s = await state(p, 40);
    expect(s.lapidary.totalXp).toBe(0);
    expect(s.carriedByItemId[ITEM_IDS.stone]).toBe(1);
    expect(current(s).stage?.id).toBe(M.stages![0]!.id);
  });
  it("legacy active and completed Mission rows keep their projections and empty stage history", async () => {
    const p = await player();
    await db.insert(r.characterMissions).values([
      { characterId: p.id, missionId: MISSION_IDS.walkItOff, acceptedAt: t },
      { characterId: p.id, missionId: MISSION_IDS.cutYourTeeth, acceptedAt: t, completedAt: t },
    ]);
    const s = await state(p);
    expect(s.missions.find((m) => m.missionId === MISSION_IDS.walkItOff)).toMatchObject({
      state: "active",
      currentObjective: "Travel to The Jag",
    });
    expect(s.missions.find((m) => m.missionId === MISSION_IDS.cutYourTeeth)?.state).toBe(
      "completed",
    );
    const rows = await db
      .select()
      .from(r.characterMissions)
      .where(eq(r.characterMissions.characterId, p.id));
    expect(rows.every((row) => row.completedStageIds.length === 0)).toBe(true);
  });
  it("the actual additive migration preserves preexisting saved single-stage rows", async () => {
    const p = await player();
    await db.insert(r.characterMissions).values([
      { characterId: p.id, missionId: MISSION_IDS.walkItOff, acceptedAt: t },
      { characterId: p.id, missionId: MISSION_IDS.cutYourTeeth, acceptedAt: t, completedAt: t },
    ]);
    const before = (await state(p)).missions.filter((m) =>
      [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth].includes(m.missionId),
    );
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`CREATE TEMP TABLE migration_431_missions ON COMMIT DROP AS SELECT character_id,mission_id,accepted_at,completed_at FROM character_missions WHERE character_id=${p.id}`,
      );
      const migration = readFileSync("drizzle/0055_lapidary_mission_stages.sql", "utf8");
      const statement = migration.match(/ALTER TABLE "character_missions" ADD COLUMN[^;]+;/)![0];
      await tx.execute(
        sql.raw(statement.replace('"character_missions"', '"migration_431_missions"')),
      );
      const migrated = await tx.execute(
        sql`SELECT * FROM migration_431_missions ORDER BY mission_id`,
      );
      expect(migrated.rows).toHaveLength(2);
      expect(
        migrated.rows.every(
          (row) => Array.isArray(row.completed_stage_ids) && row.completed_stage_ids.length === 0,
        ),
      ).toBe(true);
      expect(
        Date.parse(
          String(
            migrated.rows.find((row) => row.mission_id === MISSION_IDS.cutYourTeeth)?.completed_at,
          ),
        ),
      ).toEqual(t.getTime());
      await tx.execute(
        sql`CREATE TEMP TABLE migration_431_characters ON COMMIT DROP AS SELECT id FROM characters WHERE id=${p.id}`,
      );
      await tx.execute(
        sql`CREATE TEMP TABLE migration_431_xp ON COMMIT DROP AS SELECT character_id,skill_id,total_xp FROM character_skill_xp WHERE character_id=${p.id}`,
      );
      await tx.execute(sql`ALTER TABLE migration_431_xp ADD PRIMARY KEY (character_id,skill_id)`);
      await tx.execute(sql`DELETE FROM migration_431_xp WHERE skill_id='lapidary'`);
      const backfill = migration
        .match(/INSERT INTO character_skill_xp[^;]+;/)![0]
        .replace("INSERT INTO character_skill_xp", "INSERT INTO migration_431_xp")
        .replace("FROM characters", "FROM migration_431_characters");
      await tx.execute(sql.raw(backfill));
      const xp = async () =>
        (await tx.execute(sql`SELECT total_xp FROM migration_431_xp WHERE skill_id='lapidary'`))
          .rows;
      expect(await xp()).toEqual([{ total_xp: "0" }]);
      await tx.execute(sql`UPDATE migration_431_xp SET total_xp=75 WHERE skill_id='lapidary'`);
      await tx.execute(sql.raw(backfill));
      expect(await xp()).toEqual([{ total_xp: "75" }]);
    });
    expect(
      (await state(p)).missions.filter((m) =>
        [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth].includes(m.missionId),
      ),
    ).toEqual(before);
  });

  it("a Level-99 character can complete the same lessons and graduation", async () => {
    const p = await player();
    const { standardSkillLevelThresholds } = await import("@/game/config/balance");
    const xp = standardSkillLevelThresholds().at(-1)!.totalXp;
    await db
      .update(r.characterSkillXp)
      .set({ totalXp: xp })
      .where(
        and(
          eq(r.characterSkillXp.characterId, p.id),
          eq(r.characterSkillXp.skillId, SKILL_IDS.lapidary),
        ),
      );
    await stage4(p);
    await finish(p);
    const s = await state(p, 60);
    expect(s.lapidary.level).toBe(99);
    expect(s.lapidary.totalXp).toBe(xp + 240);
    expect(s.lapidaryWorkbench.access.kind).toBe("unrestricted");
  });

  it("a supervised Quartz cut needs post-consumption capacity and preserves its reserved input", async () => {
    const p = await player();
    await give(p, ITEM_IDS.uncutQuartz, [1]);
    await stage3(p);
    const s = await state(p, 20);
    await give(p, ITEM_IDS.ferriteShale, Array(s.inventory.slotsAvailable).fill(1));
    const refused = await start(p, ACTION_IDS.cutQuartz, 1, 20);
    expect(refused.lapidaryError).toBe("lapidary_no_room");
    expect(refused.carriedByItemId[ITEM_IDS.uncutQuartz]).toBe(2);
    expect(refused.lapidary.totalXp).toBe(15);
    const [loose] = await db
      .select()
      .from(r.inventoryStacks)
      .where(
        and(
          eq(r.inventoryStacks.characterId, p.id),
          eq(r.inventoryStacks.itemId, ITEM_IDS.ferriteShale),
        ),
      )
      .limit(1);
    await db.delete(r.inventoryStacks).where(eq(r.inventoryStacks.id, loose!.id));
    await start(p, ACTION_IDS.cutQuartz, 1, 20);
    const { assertActiveWorkpieceResolvable } = await import("@/server/fabrication-reservation");
    await expect(
      db.transaction(async (tx) => {
        await tx
          .delete(r.inventoryStacks)
          .where(
            and(
              eq(r.inventoryStacks.characterId, p.id),
              eq(r.inventoryStacks.itemId, ITEM_IDS.uncutQuartz),
            ),
          );
        await assertActiveWorkpieceResolvable(tx, p.id);
      }),
    ).rejects.toThrow(/reserved/);
    expect((await state(p, 50)).carriedByItemId[ITEM_IDS.cutQuartz]).toBe(1);
  });
});
