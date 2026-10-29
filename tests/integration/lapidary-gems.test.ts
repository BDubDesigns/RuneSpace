import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { THEYRE_MINERALS_MARIE as M } from "@/game/content/missions";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
/**
 * Issue #433 — Cut Topaz (Lapidary 5) and Cut Sapphire (Lapidary 8) through the real
 * server: direct-call level and graduation gates, exact one-for-one conversion and XP,
 * quantity and Max, capacity, offline resolution, persistence and Werner's buyback.
 */
suite("issue #433 Cut Topaz and Cut Sapphire", () => {
  let db: (typeof import("@/db"))["db"];
  let auth: typeof import("@/db/auth-schema");
  let r: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let chars: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let mission: typeof import("@/server/missions");
  let commands: typeof import("@/server/lapidary-commands");
  let trade: typeof import("@/server/trade");
  let thresholds: readonly { level: number; totalXp: number }[];
  const users: string[] = [];
  const t = new Date("2026-10-29T12:00:00Z");
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
    trade = await import("@/server/trade");
    thresholds = (await import("@/game/config/balance")).standardSkillLevelThresholds();
  });
  afterEach(async () => {
    for (const user of users.splice(0)) await cleanupTestUser(db, auth, r, user);
  });
  async function player() {
    const userId = await createTestUser(db, auth, "lapidary433");
    users.push(userId);
    const c = await createCharacterForUser(
      db,
      r,
      ownership,
      chars,
      userId,
      `Gem ${userId.slice(0, 7)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, c.id, t, rng());
    await db
      .update(r.characters)
      .set({ currentLocationId: LOCATION_IDS.wernersLab, credits: 0 })
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
  async function setLevel(p: Player, level: number, extraXp = 0) {
    await db
      .update(r.characterSkillXp)
      .set({ totalXp: thresholds.find((entry) => entry.level === level)!.totalXp + extraXp })
      .where(
        and(
          eq(r.characterSkillXp.characterId, p.id),
          eq(r.characterSkillXp.skillId, SKILL_IDS.lapidary),
        ),
      );
  }
  const start = (p: Player, actionId: string, quantity: number | "max" = 1, ticks = 0) =>
    commands.startLapidary(p.userId, p.id, actionId, quantity, at(ticks), rng());
  const accept = (p: Player) =>
    mission.acceptMission(p.userId, p.id, M.id, NPC_IDS.werner, t, rng());
  const ack = (p: Player, ticks: number, dialogueId: string) =>
    mission.acknowledgeMissionConversation(
      p.userId,
      p.id,
      M.id,
      NPC_IDS.werner,
      dialogueId,
      at(ticks),
      rng(),
    );
  /** Werner's real tutorial: Shape Stone, one supervised Cut Quartz, then graduation. */
  async function graduate(p: Player) {
    await give(p, ITEM_IDS.stone, [3]);
    await accept(p);
    await start(p, ACTION_IDS.shapeStone);
    await state(p, 20);
    await ack(p, 20, DIALOGUE_IDS.wernerQuartzLesson);
    await start(p, ACTION_IDS.cutQuartz, 1, 20);
    await state(p, 50);
    await mission.completeMission(p.userId, p.id, M.id, NPC_IDS.werner, at(50), rng());
    expect((await state(p, 50)).lapidaryWorkbench.access.kind).toBe("unrestricted");
  }
  const carried = (s: Awaited<ReturnType<typeof state>>, itemId: string) =>
    s.carriedByItemId[itemId] ?? 0;

  it("refuses both new recipes before the Mission is accepted, at any Lapidary level", async () => {
    const p = await player();
    await setLevel(p, 8);
    await give(p, ITEM_IDS.uncutTopaz, [2]);
    await give(p, ITEM_IDS.uncutSapphire, [2]);
    for (const action of [ACTION_IDS.cutTopaz, ACTION_IDS.cutSapphire]) {
      const s = await start(p, action);
      expect(s.lapidaryError).toBe("lapidary_locked");
      expect(s.activeAction).toBeUndefined();
    }
    const s = await state(p);
    expect(carried(s, ITEM_IDS.uncutTopaz)).toBe(2);
    expect(carried(s, ITEM_IDS.cutTopaz)).toBe(0);
  });

  it("refuses them while Werner's lessons are only supervised, even at Lapidary 8", async () => {
    const p = await player();
    await setLevel(p, 8);
    await give(p, ITEM_IDS.stone, [3]);
    await give(p, ITEM_IDS.uncutTopaz, [1]);
    await give(p, ITEM_IDS.uncutSapphire, [1]);
    await accept(p);
    for (const action of [ACTION_IDS.cutTopaz, ACTION_IDS.cutSapphire]) {
      expect((await start(p, action)).lapidaryError).toBe("lapidary_locked");
    }
    const s = await state(p);
    expect(s.activeAction).toBeUndefined();
    expect(carried(s, ITEM_IDS.uncutTopaz)).toBe(1);
    expect(carried(s, ITEM_IDS.uncutSapphire)).toBe(1);
  });

  it("refuses a graduate below the level, then works the moment the level is reached", async () => {
    const p = await player();
    await graduate(p);
    await give(p, ITEM_IDS.uncutTopaz, [1]);
    await give(p, ITEM_IDS.uncutSapphire, [1]);
    expect((await state(p, 60)).lapidary.level).toBeLessThan(5);
    for (const action of [ACTION_IDS.cutTopaz, ACTION_IDS.cutSapphire]) {
      const s = await start(p, action, 1, 60);
      expect(s.lapidaryError).toBe("lapidary_recipe_locked");
      expect(s.activeAction).toBeUndefined();
    }
    await setLevel(p, 5);
    expect((await start(p, ACTION_IDS.cutSapphire, 1, 60)).lapidaryError).toBe(
      "lapidary_recipe_locked",
    );
    const topaz = await start(p, ACTION_IDS.cutTopaz, 1, 60);
    expect(topaz.lapidaryError).toBeUndefined();
    expect(topaz.activeAction?.actionId).toBe(ACTION_IDS.cutTopaz);
    await db.delete(r.activeActions).where(eq(r.activeActions.characterId, p.id));
    await setLevel(p, 7);
    expect((await start(p, ACTION_IDS.cutSapphire, 1, 60)).lapidaryError).toBe(
      "lapidary_recipe_locked",
    );
    await setLevel(p, 8);
    const sapphire = await start(p, ACTION_IDS.cutSapphire, 1, 60);
    expect(sapphire.lapidaryError).toBeUndefined();
    expect(sapphire.activeAction?.actionId).toBe(ACTION_IDS.cutSapphire);
  });

  it("cuts one Topaz exactly once: 50 ticks, 1 uncut → 1 cut, 150 XP, and survives a replay", async () => {
    const p = await player();
    await graduate(p);
    await setLevel(p, 5);
    await give(p, ITEM_IDS.uncutTopaz, [2]);
    const before = (await state(p, 60)).lapidary.totalXp;
    await start(p, ACTION_IDS.cutTopaz, 1, 60);
    const early = await state(p, 60 + 49);
    expect(carried(early, ITEM_IDS.cutTopaz)).toBe(0);
    expect(carried(early, ITEM_IDS.uncutTopaz)).toBe(2);
    const [a, b] = await Promise.all([state(p, 60 + 50), state(p, 60 + 50)]);
    for (const s of [a, b]) {
      expect(carried(s, ITEM_IDS.cutTopaz)).toBe(1);
      expect(carried(s, ITEM_IDS.uncutTopaz)).toBe(1);
      expect(s.lapidary.totalXp).toBe(before + 150);
      expect(s.activeAction).toBeUndefined();
    }
    const later = await state(p, 5000);
    expect(carried(later, ITEM_IDS.cutTopaz)).toBe(1);
    expect(later.lapidary.totalXp).toBe(before + 150);
  });

  it("runs a numeric Sapphire batch and a Max batch, paying 300 XP per piece, stacks of two", async () => {
    const p = await player();
    await graduate(p);
    await setLevel(p, 8);
    await give(p, ITEM_IDS.uncutSapphire, [2, 2]);
    const before = (await state(p, 60)).lapidary.totalXp;
    expect((await start(p, ACTION_IDS.cutSapphire, 5, 60)).lapidaryError).toBe(
      "lapidary_quantity_unavailable",
    );
    await start(p, ACTION_IDS.cutSapphire, "max", 60);
    const done = await state(p, 60 + 4 * 75);
    expect(done.lapidaryWorkbench.run.cycles).toBe(4);
    expect(carried(done, ITEM_IDS.cutSapphire)).toBe(4);
    expect(carried(done, ITEM_IDS.uncutSapphire)).toBe(0);
    expect(done.lapidary.totalXp).toBe(before + 4 * 300);
    const stacks = await db
      .select()
      .from(r.inventoryStacks)
      .where(
        and(
          eq(r.inventoryStacks.characterId, p.id),
          eq(r.inventoryStacks.itemId, ITEM_IDS.cutSapphire),
        ),
      );
    expect(stacks.map((stack) => stack.quantity).sort()).toEqual([2, 2]);
  });

  it("resolves an offline Topaz run lazily on the next read and never pays twice", async () => {
    const p = await player();
    await graduate(p);
    await setLevel(p, 5);
    await give(p, ITEM_IDS.uncutTopaz, [2]);
    const before = (await state(p, 60)).lapidary.totalXp;
    await start(p, ACTION_IDS.cutTopaz, 2, 60);
    const s = await state(p, 100_000);
    expect(carried(s, ITEM_IDS.cutTopaz)).toBe(2);
    expect(s.lapidary.totalXp).toBe(before + 300);
    expect((await state(p, 200_000)).lapidary.totalXp).toBe(before + 300);
  });

  it("refuses without the matching uncut gem and consumes nothing", async () => {
    const p = await player();
    await graduate(p);
    await setLevel(p, 8);
    await give(p, ITEM_IDS.uncutQuartz, [1]);
    for (const action of [ACTION_IDS.cutTopaz, ACTION_IDS.cutSapphire]) {
      const s = await start(p, action, 1, 60);
      expect(s.lapidaryError).toBe("lapidary_insufficient_inputs");
      expect(s.activeAction).toBeUndefined();
    }
    expect(carried(await state(p, 60), ITEM_IDS.uncutQuartz)).toBe(1);
  });

  it("refuses a Topaz cut with no room for the finished gem, keeps the input, then cuts once room exists", async () => {
    const p = await player();
    await graduate(p);
    await setLevel(p, 5);
    // A full uncut stack keeps its slot after one gem is consumed, and the full cut stack
    // leaves the finished gem nowhere to go once every other slot is occupied.
    await give(p, ITEM_IDS.cutTopaz, [2]);
    await give(p, ITEM_IDS.uncutTopaz, [2]);
    const s = await state(p, 60);
    await give(p, ITEM_IDS.ferriteShale, Array(s.inventory.slotsAvailable).fill(1));
    const refused = await start(p, ACTION_IDS.cutTopaz, 1, 60);
    expect(refused.lapidaryError).toBe("lapidary_no_room");
    expect(refused.activeAction).toBeUndefined();
    expect(carried(refused, ITEM_IDS.uncutTopaz)).toBe(2);
    expect(carried(refused, ITEM_IDS.cutTopaz)).toBe(2);
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
    await start(p, ACTION_IDS.cutTopaz, 1, 60);
    const done = await state(p, 60 + 50);
    expect(carried(done, ITEM_IDS.cutTopaz)).toBe(3);
    expect(carried(done, ITEM_IDS.uncutTopaz)).toBe(1);
  });

  it("persists the new items and Credits through Werner's buyback at 36 and 70", async () => {
    const p = await player();
    await give(p, ITEM_IDS.cutTopaz, [2]);
    await give(p, ITEM_IDS.cutSapphire, [1]);
    const sellTopaz = await trade.tradeWithMerchant(
      p.userId,
      p.id,
      { itemId: ITEM_IDS.cutTopaz, direction: "sell", quantity: 2 },
      at(0),
    );
    expect(sellTopaz.trade).toMatchObject({ status: "traded", quantity: 2, totalCredits: 72 });
    const sellSapphire = await trade.tradeWithMerchant(
      p.userId,
      p.id,
      { itemId: ITEM_IDS.cutSapphire, direction: "sell", quantity: 1 },
      at(0),
    );
    expect(sellSapphire.trade).toMatchObject({ status: "traded", totalCredits: 70 });
    const [row] = await db.select().from(r.characters).where(eq(r.characters.id, p.id));
    expect(row!.credits).toBe(142);
    const retail = await trade.tradeWithMerchant(
      p.userId,
      p.id,
      { itemId: ITEM_IDS.cutTopaz, direction: "buy", quantity: 1 },
      at(0),
    );
    expect(retail.trade.status).toBe("refused");
  });
});
