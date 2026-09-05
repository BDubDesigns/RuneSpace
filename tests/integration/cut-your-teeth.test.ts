import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #110 Cut Your Teeth persistence and XP boundary (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let equipment: typeof import("@/server/equipment");
  let miningCommands: typeof import("@/server/mining-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-01-01T00:00:00.000Z");

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    equipment = await import("@/server/equipment");
    miningCommands = await import("@/server/mining-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "CYT Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Cyt ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    return { userId, character };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function completeWalkItOffAtTheJag(userId: string, characterId: string) {
    await db
      .insert(rune.characterMissions)
      .values({ characterId, missionId: "walk_it_off", acceptedAt: now });
    await move(characterId, LOCATION_IDS.theJag);
    const completed = await missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.walkItOff,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    return completed;
  }

  /** Equips a carried Cutter into its gear slot directly through the server boundary. */
  async function equipCutter(userId: string, characterId: string) {
    const cutters = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, characterId),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    const cutter = cutters[0];
    if (!cutter) throw new Error("fixture requires a granted Cutter");
    await equipment.changeEquipment(userId, characterId, {
      kind: "equip",
      itemInstanceId: cutter.id,
      target: { assignmentKind: "gear", suitSlotId: "mining_tool" },
    });
  }

  async function addShale(characterId: string, quantity: number) {
    if (quantity <= 0) return;
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity });
  }

  async function completeMiningAttempts(userId: string, characterId: string) {
    const start = new Date(now.getTime() + 10_000);
    await miningCommands.startFerriteShaleMining(userId, characterId, start, deterministicRandom());
    const durationMs = getEffectiveGameBalance().mining.attemptDurationTicks * GAME_TICK_MS * 5 + 1;
    const stopped = await miningCommands.stopMining(
      userId,
      characterId,
      new Date(start.getTime() + durationMs),
      deterministicRandom(),
    );
    expect(stopped.run.attempts).toBeGreaterThanOrEqual(5);
  }

  async function miningXp(characterId: string) {
    const rows = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
    return rows[0]?.totalXp ?? 0;
  }

  it("refuses acceptance until Walk It Off is completed for the same character", async () => {
    const { userId, character } = await makeCharacter();
    await move(character.id, LOCATION_IDS.theJag);
    // Even owning shale + having accepted nothing of Walk It Off must refuse.
    await addShale(character.id, 10);
    const refused = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(refused.mission.status).toBe("refused");

    // Accepting (but not completing) Walk It Off still refuses.
    await db
      .insert(rune.characterMissions)
      .values({ characterId: character.id, missionId: "walk_it_off", acceptedAt: now });
    const refusedActive = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(refusedActive.mission.status).toBe("refused");
    expect(
      await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, character.id),
            eq(rune.characterMissions.missionId, "cut_your_teeth"),
          ),
        ),
    ).toHaveLength(0);
  });

  it("arrives already accepted via continuation, is Tansy-only/idempotent, and completes once with exactly +100 Mining XP without consuming shale", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);

    // The continuation already accepted Cut Your Teeth: explicit acceptance
    // is idempotent for any NPC once accepted.
    const already = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(already.mission.status).toBe("already_accepted");
    const wrongNpc = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );
    expect(wrongNpc.mission.status).toBe("already_accepted");

    // Completion refusals follow objective precedence: equip first, then stack.
    const beforeAnyXp = await miningXp(character.id);
    const unequipped = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(unequipped.mission).toMatchObject({ status: "refused", reason: "equipment" });

    // Full stack still refuses while the Cutter sits in Inventory.
    await addShale(character.id, 10);
    const stillUnequipped = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(stillUnequipped.mission).toMatchObject({ status: "refused", reason: "equipment" });
    expect(await miningXp(character.id)).toBe(beforeAnyXp);

    await equipCutter(userId, character.id);
    await completeMiningAttempts(userId, character.id);
    const beforeCompletionXp = await miningXp(character.id);

    // Dropping below one full stack falls back to refusal — inventory is the truth.
    // Scope the destructive delete to THIS character's shale only; a concurrent
    // test character's inventory must never be touched.
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, character.id),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.ferriteShale),
        ),
      );
    await addShale(character.id, 9);
    const nineOnly = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(nineOnly.mission).toMatchObject({ status: "refused", reason: "insufficient_items" });
    expect(await miningXp(character.id)).toBe(beforeCompletionXp);
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, character.id),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.ferriteShale),
        ),
      );

    await addShale(character.id, 10);
    const completed = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    expect(await miningXp(character.id)).toBe(beforeCompletionXp + 100);

    // Shale was inspected, not consumed.
    const stacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(stacks.filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)[0]?.quantity).toBe(10);

    // Retry/concurrent submissions cannot re-award.
    const retry = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(retry.mission.status).toBe("already_completed");
    const [again] = await Promise.all([
      missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.cutYourTeeth,
        NPC_IDS.tansyRusk,
        new Date(now.getTime() + 1_000),
        deterministicRandom(),
      ),
      missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.cutYourTeeth,
        NPC_IDS.tansyRusk,
        new Date(now.getTime() + 2_000),
        deterministicRandom(),
      ),
    ]);
    expect([retry.mission.status, again.mission.status].flat()).toContain("already_completed");
    expect(await miningXp(character.id)).toBe(beforeCompletionXp + 100);

    // Objective projection reflects the completed state through real state reads.
    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const cyt = state.missions.find((mission) => mission.missionId === "cut_your_teeth");
    expect(cyt).toMatchObject({ state: "completed", title: "Cut Your Teeth" });
    const wio = state.missions.find((mission) => mission.missionId === "walk_it_off");
    expect(wio?.state).toBe("completed");
  });

  it("keeps completion refused while traveling or mid-action", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);
    await db
      .insert(rune.characterMissions)
      .values({ characterId: character.id, missionId: "cut_your_teeth", acceptedAt: now })
      .onConflictDoNothing(); // continuation already accepted; idempotent safeguard
    await equipCutter(userId, character.id);
    await addShale(character.id, 10);
    await completeMiningAttempts(userId, character.id);
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "ferrite_shale_mining",
      startedAt: now,
      resolvedThroughAt: now,
    });
    const busy = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(busy.mission).toMatchObject({ status: "refused", reason: "not_stationary" });
    expect(await miningXp(character.id)).toBe(75);
  });

  it("reaches SHOW SHALE only after five real Mining attempts", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);

    // The Cutter is granted by mission one and the player already has a full
    // stack. Cut Your Teeth arrives already accepted via the continuation, but
    // the new tracked Mining requirement still has to be earned authoritatively.
    await equipCutter(userId, character.id);
    await addShale(character.id, 10);
    await completeMiningAttempts(userId, character.id);

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const cyt = state.missions.find((mission) => mission.missionId === "cut_your_teeth");
    expect(cyt).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Show a full stack of Ferrite Shale to Tansy Rusk",
      stage: { requirementsSatisfied: true, turnInAvailable: true, nextObjectiveKind: undefined },
    });

    // Completion succeeds immediately and awards exactly +100 once.
    const completed = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    expect(await miningXp(character.id)).toBe(175);
  });

  it("keeps requirements recognized while busy and never asks for more shale", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);
    await db
      .insert(rune.characterMissions)
      .values({ characterId: character.id, missionId: "cut_your_teeth", acceptedAt: now })
      .onConflictDoNothing(); // continuation already accepted; idempotent safeguard
    await equipCutter(userId, character.id);
    await addShale(character.id, 10);
    await completeMiningAttempts(userId, character.id);
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "ferrite_shale_mining",
      startedAt: now,
      resolvedThroughAt: now,
    });

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const cyt = state.missions.find((mission) => mission.missionId === "cut_your_teeth");
    // Requirements ARE satisfied (Cutter equipped + full stack), but the
    // character is mid-Mining so the turn-in is NOT available. The projection
    // must expose both facts distinctly — never a false "need more shale".
    expect(cyt).toMatchObject({
      state: "active",
      stage: { requirementsSatisfied: true, turnInAvailable: false, nextObjectiveKind: undefined },
    });
    expect(cyt?.currentObjective).toBe("Show a full stack of Ferrite Shale to Tansy Rusk");

    // After the Mining action resolves, the SAME inventory/equipment state is
    // immediately turn-in ready (SHOW SHALE) — no re-collection needed.
    await db.delete(rune.activeActions).where(eq(rune.activeActions.characterId, character.id));
    const afterStop = await play.getPlayGameplayState(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    const cytAfterStop = afterStop.missions.find(
      (mission) => mission.missionId === "cut_your_teeth",
    );
    expect(cytAfterStop).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Show a full stack of Ferrite Shale to Tansy Rusk",
      stage: { requirementsSatisfied: true, turnInAvailable: true },
    });
  });

  it("awards exactly one completion and +100 XP under concurrent first-completion requests", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);
    await db
      .insert(rune.characterMissions)
      .values({ characterId: character.id, missionId: "cut_your_teeth", acceptedAt: now })
      .onConflictDoNothing(); // continuation already accepted; idempotent safeguard
    await equipCutter(userId, character.id);
    await addShale(character.id, 10);
    await completeMiningAttempts(userId, character.id);

    // Two FIRST completion requests race: the mission is accepted and
    // incomplete with every requirement satisfied. Exactly one must win.
    const [first, second] = await Promise.all([
      missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.cutYourTeeth,
        NPC_IDS.tansyRusk,
        new Date(now.getTime() + 1_000),
        deterministicRandom(),
      ),
      missions.completeMission(
        userId,
        character.id,
        MISSION_IDS.cutYourTeeth,
        NPC_IDS.tansyRusk,
        new Date(now.getTime() + 2_000),
        deterministicRandom(),
      ),
    ]);
    const statuses = [first.mission.status, second.mission.status];
    expect(statuses).toContain("completed");
    expect(statuses).toContain("already_completed");

    // Exactly +100 Mining XP total, once.
    expect(await miningXp(character.id)).toBe(175);

    // Shale unchanged — shown, never consumed.
    const stacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(stacks.filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)[0]?.quantity).toBe(10);

    // Persisted completion state is coherent: completedAt present, XP once.
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, character.id),
          eq(rune.characterMissions.missionId, "cut_your_teeth"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.completedAt).not.toBeNull();
  });

  it("accepts Cut Your Teeth atomically when Walk It Off completes (authored continuation)", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const cyt = state.missions.find((mission) => mission.missionId === "cut_your_teeth");
    expect(cyt).toMatchObject({
      state: "active",
      prerequisiteSatisfied: true,
      currentObjective: "Equip the Salvage Cutter from Inventory",
    });
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, character.id),
          eq(rune.characterMissions.missionId, "cut_your_teeth"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.acceptedAt).toEqual(now);
    expect(rows[0]?.completedAt).toBeNull();
    const progressRows = await db
      .select()
      .from(rune.characterMissionProgress)
      .where(eq(rune.characterMissionProgress.characterId, character.id));
    expect(progressRows).toEqual([
      expect.objectContaining({
        missionId: MISSION_IDS.cutYourTeeth,
        progressKey: "mining-attempts",
        progress: 0,
      }),
    ]);
    expect(progressRows.some((row) => row.missionId === MISSION_IDS.wasteNot)).toBe(false);
    // Walk It Off is complete; Cut Your Teeth is already the tracked mission.
    const wio = state.missions.find((mission) => mission.missionId === "walk_it_off");
    expect(wio?.state).toBe("completed");
  });

  it("never auto-accepts a mission merely because its prerequisite is satisfied", async () => {
    const { userId, character } = await makeCharacter();
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, character.id));
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: "walk_it_off",
      acceptedAt: now,
      completedAt: now,
    });

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const cyt = state.missions.find((mission) => mission.missionId === "cut_your_teeth");
    expect(cyt).toMatchObject({ state: "not_accepted", prerequisiteSatisfied: true });
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, character.id),
          eq(rune.characterMissions.missionId, "cut_your_teeth"),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("shows 0 / 10 (not 0 / 1) for zero shale through the real observation path", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);
    await db
      .insert(rune.characterMissions)
      .values({ characterId: character.id, missionId: "cut_your_teeth", acceptedAt: now })
      .onConflictDoNothing(); // continuation already accepted; idempotent safeguard
    // Five real Mining attempts are complete, but ZERO Ferrite Shale is
    // carried. The full-stack requirement must resolve from the canonical item
    // definition even though the character owns none — the objective must read
    // 0 / 10, never 0 / 1.
    await equipCutter(userId, character.id);
    await completeMiningAttempts(userId, character.id);
    await db.delete(rune.inventoryStacks).where(eq(rune.inventoryStacks.characterId, character.id));

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const cyt = state.missions.find((mission) => mission.missionId === "cut_your_teeth");
    expect(cyt).toMatchObject({
      state: "active",
      currentObjective: "Get a full stack of Ferrite Shale — 0 / 10",
    });
    expect(cyt?.stage).toMatchObject({
      requirementsSatisfied: false,
      turnInAvailable: false,
      nextObjectiveKind: "carried_stack",
    });
  });

  it("reports accurate N / 10 for partial shale through the real observation path", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);
    await db
      .insert(rune.characterMissions)
      .values({ characterId: character.id, missionId: "cut_your_teeth", acceptedAt: now })
      .onConflictDoNothing(); // continuation already accepted; idempotent safeguard
    await equipCutter(userId, character.id);
    await completeMiningAttempts(userId, character.id);
    await db.delete(rune.inventoryStacks).where(eq(rune.inventoryStacks.characterId, character.id));
    await addShale(character.id, 4);

    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    const cyt = state.missions.find((mission) => mission.missionId === "cut_your_teeth");
    expect(cyt).toMatchObject({
      state: "active",
      currentObjective: "Get a full stack of Ferrite Shale — 4 / 10",
    });
  });
});
