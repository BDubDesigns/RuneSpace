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
import { CUT_YOUR_TEETH } from "@/game/content/missions";
import { ensureMissionProgressRows } from "@/server/mission-progress";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #141 Waste Not tracked activity (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let equipment: typeof import("@/server/equipment");
  let miningCommands: typeof import("@/server/mining-commands");
  let refiningCommands: typeof import("@/server/refining-commands");
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
    refiningCommands = await import("@/server/refining-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  function miningRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  function refiningRandom(rolls: readonly number[]) {
    let index = 0;
    return {
      nextBasisPoints: () => rolls[index++] ?? 0,
      nextUnit: () => 0,
    };
  }

  async function makeCharacter(label = "Waste Not Tester") {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Waste ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, miningRandom());
    return { userId, character };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function addShale(characterId: string, quantity: number) {
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity });
  }

  async function equipCutter(userId: string, characterId: string) {
    const cutter = (
      await db
        .select()
        .from(rune.itemInstances)
        .where(
          and(
            eq(rune.itemInstances.characterId, characterId),
            eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
          ),
        )
    )[0];
    if (!cutter) throw new Error("Waste Not fixture requires a Cutter");
    await equipment.changeEquipment(userId, characterId, {
      kind: "equip",
      itemInstanceId: cutter.id,
      target: { assignmentKind: "gear", suitSlotId: "mining_tool" },
    });
  }

  async function completeMining(userId: string, characterId: string) {
    await miningCommands.startFerriteShaleMining(
      userId,
      characterId,
      new Date(now.getTime() + 10_000),
      miningRandom(),
    );
    const duration = getEffectiveGameBalance().mining.attemptDurationTicks * GAME_TICK_MS * 5 + 1;
    await miningCommands.stopMining(
      userId,
      characterId,
      new Date(now.getTime() + 10_000 + duration),
      miningRandom(),
    );
  }

  async function completeCut(userId: string, characterId: string) {
    await db.insert(rune.characterMissions).values({
      characterId,
      missionId: MISSION_IDS.walkItOff,
      acceptedAt: now,
    });
    await move(characterId, LOCATION_IDS.theJag);
    const walk = await missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.walkItOff,
      NPC_IDS.tansyRusk,
      now,
      miningRandom(),
    );
    expect(walk.mission.status).toBe("completed");
    await equipCutter(userId, characterId);
    await completeMining(userId, characterId);
    await addShale(characterId, 10);
    const cut = await missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.cutYourTeeth,
      NPC_IDS.tansyRusk,
      now,
      miningRandom(),
    );
    expect(cut.mission.status).toBe("completed");
  }

  it("accepts Waste Not only through generic continuation and counts mixed Refining attempts", async () => {
    const { userId, character } = await makeCharacter();
    await completeCut(userId, character.id);

    const accepted = await db
      .select()
      .from(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, character.id),
          eq(rune.characterMissions.missionId, MISSION_IDS.wasteNot),
        ),
      );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.completedAt).toBeNull();
    const initialProgress = await db
      .select()
      .from(rune.characterMissionProgress)
      .where(eq(rune.characterMissionProgress.characterId, character.id));
    expect(initialProgress).toEqual([
      expect.objectContaining({
        missionId: MISSION_IDS.cutYourTeeth,
        progressKey: "mining-attempts",
        progress: 5,
      }),
      expect.objectContaining({
        missionId: MISSION_IDS.wasteNot,
        progressKey: "refining-attempts",
        progress: 0,
      }),
    ]);

    const manualAcceptance = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.wasteNot,
      NPC_IDS.wadeRusk,
      now,
      miningRandom(),
    );
    expect(manualAcceptance.mission.status).toBe("already_accepted");

    await move(character.id, LOCATION_IDS.abandonedProcessingYard);
    await refiningCommands.startRefining(
      userId,
      character.id,
      new Date(now.getTime() + 20_000),
      refiningRandom([0, 9_000, 0, 9_000, 0]),
    );
    const refiningDuration = getEffectiveGameBalance().refining.attemptDurationTicks;
    const resolved = await refiningCommands.stopRefining(
      userId,
      character.id,
      new Date(now.getTime() + 20_000 + refiningDuration * GAME_TICK_MS * 5 + 1),
      refiningRandom([0, 9_000, 0, 9_000, 0]),
    );
    expect(resolved.refiningRun.attempts).toBe(5);
    expect(resolved.refiningRun.successes).toBe(3);
    expect(resolved.refiningRun.failures).toBe(2);

    const progress = await db
      .select()
      .from(rune.characterMissionProgress)
      .where(
        and(
          eq(rune.characterMissionProgress.characterId, character.id),
          eq(rune.characterMissionProgress.missionId, MISSION_IDS.wasteNot),
        ),
      );
    expect(progress[0]?.progress).toBe(5);

    await move(character.id, LOCATION_IDS.crashSite);
    const completion = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.wasteNot,
      NPC_IDS.wadeRusk,
      new Date(now.getTime() + 60_000),
      miningRandom(),
    );
    expect(completion.mission.status).toBe("completed");

    const refiningXp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, character.id),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.refining),
        ),
      );
    expect(refiningXp[0]?.totalXp).toBe(151);
    const outputStacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(outputStacks.find((stack) => stack.itemId === ITEM_IDS.refinedFerrite)?.quantity).toBe(
      3,
    );
    expect(outputStacks.find((stack) => stack.itemId === ITEM_IDS.slag)?.quantity).toBe(2);
    expect(outputStacks.find((stack) => stack.itemId === ITEM_IDS.ferriteShale)?.quantity).toBe(5);
  });

  it("keeps completed Cut Your Teeth historical-free and initializes incomplete Cut at zero", async () => {
    const completed = await makeCharacter("Completed Cut Tester");
    await db.insert(rune.characterMissions).values([
      {
        characterId: completed.character.id,
        missionId: MISSION_IDS.walkItOff,
        acceptedAt: now,
        completedAt: now,
      },
      {
        characterId: completed.character.id,
        missionId: MISSION_IDS.cutYourTeeth,
        acceptedAt: now,
        completedAt: now,
      },
    ]);
    const completedState = await play.getPlayGameplayState(
      completed.userId,
      completed.character.id,
      now,
      miningRandom(),
    );
    expect(
      completedState.missions.find((mission) => mission.missionId === MISSION_IDS.cutYourTeeth),
    ).toMatchObject({ state: "completed" });
    expect(
      await db
        .select()
        .from(rune.characterMissionProgress)
        .where(eq(rune.characterMissionProgress.characterId, completed.character.id)),
    ).toEqual([]);

    const incomplete = await makeCharacter("Incomplete Cut Tester");
    await db.insert(rune.characterMissions).values([
      {
        characterId: incomplete.character.id,
        missionId: MISSION_IDS.walkItOff,
        acceptedAt: now,
        completedAt: now,
      },
      {
        characterId: incomplete.character.id,
        missionId: MISSION_IDS.cutYourTeeth,
        acceptedAt: now,
      },
    ]);
    await db.transaction(async (transaction) => {
      await ensureMissionProgressRows(transaction, incomplete.character.id, CUT_YOUR_TEETH, now);
    });
    const incompleteState = await play.getPlayGameplayState(
      incomplete.userId,
      incomplete.character.id,
      now,
      miningRandom(),
    );
    expect(
      incompleteState.missions.find((mission) => mission.missionId === MISSION_IDS.cutYourTeeth),
    ).toMatchObject({ currentObjective: "Return to The Jag" });
    expect(
      await db
        .select()
        .from(rune.characterMissionProgress)
        .where(eq(rune.characterMissionProgress.characterId, incomplete.character.id)),
    ).toEqual([
      expect.objectContaining({
        missionId: MISSION_IDS.cutYourTeeth,
        progressKey: "mining-attempts",
        progress: 0,
      }),
    ]);
  });
});
