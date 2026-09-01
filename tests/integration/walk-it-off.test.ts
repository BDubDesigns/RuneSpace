import { eq, and } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS, MISSION_IDS, NPC_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #102 Walk It Off persistence and reward boundary (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
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
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Walk It Off Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Walk ${userId.slice(0, 6)}`,
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

  function acceptWalkItOffAt(npcId: string) {
    return (userId: string, characterId: string) =>
      missions.acceptMission(
        userId,
        characterId,
        MISSION_IDS.walkItOff,
        npcId,
        now,
        deterministicRandom(),
      );
  }

  function completeWalkItOffAt(npcId: string) {
    return (userId: string, characterId: string) =>
      missions.completeMission(
        userId,
        characterId,
        MISSION_IDS.walkItOff,
        npcId,
        now,
        deterministicRandom(),
      );
  }

  async function acceptAtCrash(userId: string, characterId: string) {
    const accepted = await acceptWalkItOffAt(NPC_IDS.wadeRusk)(userId, characterId);
    expect(accepted.mission.status).toBe("accepted");
    return accepted;
  }

  it("provisions a new character with MYKEA but no Cutter or equipment assignment", async () => {
    const { userId, character } = await makeCharacter();
    const instances = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.characterId, character.id));
    const assignments = await db
      .select()
      .from(rune.equippedItems)
      .where(eq(rune.equippedItems.characterId, character.id));
    expect(instances.filter((row) => row.itemId === ITEM_IDS.salvageCutter)).toHaveLength(0);
    expect(instances.filter((row) => row.itemId === ITEM_IDS.mykeaSchleppraum8)).toHaveLength(1);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.assignmentKind).toBe("container");
    const state = await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    expect(state.equipment.salvageCutter).toBeUndefined();
    expect(state.inventory.uniqueItems.map((item) => item.itemId)).toEqual([]);
  });

  it("accepts at the stationary Crash Site and keeps NPCs independent of mission persistence", async () => {
    const { userId, character } = await makeCharacter();
    const preMission = await completeWalkItOffAt(NPC_IDS.tansyRusk)(userId, character.id);
    expect(preMission.mission).toMatchObject({ status: "refused", reason: "not_accepted" });
    const accepted = await acceptAtCrash(userId, character.id);
    expect(accepted.state.missions[0]).toMatchObject({ state: "active" });
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.completedAt).toBeNull();
  });

  it("supports the explorer-first route and remote acceptance at The Jag", async () => {
    const { userId, character } = await makeCharacter();
    await move(character.id, LOCATION_IDS.theJag);
    const accepted = await acceptWalkItOffAt(NPC_IDS.tansyRusk)(userId, character.id);
    expect(accepted.mission.status).toBe("accepted");
    expect(accepted.state.missions[0]).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Talk to Tansy Rusk",
    });
    expect(
      await db
        .select()
        .from(rune.characterMissions)
        .where(eq(rune.characterMissions.characterId, character.id)),
    ).toMatchObject([{ acceptedAt: now, completedAt: null }]);
  });

  it("enforces ownership and makes acceptance idempotent", async () => {
    const owner = await makeCharacter();
    const outsider = await makeCharacter();
    await expect(
      acceptWalkItOffAt(NPC_IDS.wadeRusk)(outsider.userId, owner.character.id),
    ).rejects.toThrow(/not found/i);
    const first = await acceptAtCrash(owner.userId, owner.character.id);
    const second = await acceptWalkItOffAt(NPC_IDS.wadeRusk)(owner.userId, owner.character.id);
    expect(first.mission.status).toBe("accepted");
    expect(second.mission.status).toBe("already_accepted");
  });

  it("does not complete on arrival alone and preserves retryable reward capacity failures", async () => {
    const { userId, character } = await makeCharacter();
    await acceptAtCrash(userId, character.id);
    await move(character.id, LOCATION_IDS.theJag);
    const arrived = await play.getPlayGameplayState(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(arrived.missions[0]).toMatchObject({
      state: "ready_for_completion",
      currentObjective: "Talk to Tansy Rusk",
    });
    const eightStacks = Array.from({ length: 8 }, () => ({
      characterId: character.id,
      itemId: ITEM_IDS.ferriteShale,
      quantity: 1,
    }));
    await db.insert(rune.inventoryStacks).values(eightStacks);
    const refused = await completeWalkItOffAt(NPC_IDS.tansyRusk)(userId, character.id);
    expect(refused.mission).toMatchObject({
      status: "refused",
      reason: "capacity",
      capacityReason: "slots",
    });
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
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(rune.characterMissions)
        .where(eq(rune.characterMissions.characterId, character.id)),
    ).toMatchObject([{ completedAt: null }]);
    const oneStack = await db
      .select({ id: rune.inventoryStacks.id })
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id))
      .limit(1);
    await db.delete(rune.inventoryStacks).where(eq(rune.inventoryStacks.id, oneStack[0]!.id));
    const completed = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.walkItOff,
      NPC_IDS.tansyRusk,
      new Date(now.getTime() + 1_000),
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    if (completed.mission.status !== "completed") throw new Error("completion fixture failed");
    expect(completed.mission.reward?.quantity).toBe(1);
    expect(completed.state.inventory.uniqueItems).toHaveLength(1);
    expect(completed.state.equipment.salvageCutter).toBeUndefined();
  });

  it("refuses a mass-over-capacity reward without writing mission or item state", async () => {
    const { userId, character } = await makeCharacter();
    await acceptAtCrash(userId, character.id);
    await move(character.id, LOCATION_IDS.theJag);
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 7 }, () => ({
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 55,
      })),
    );
    const refused = await completeWalkItOffAt(NPC_IDS.tansyRusk)(userId, character.id);
    expect(refused.mission).toMatchObject({
      status: "refused",
      reason: "capacity",
      capacityReason: "mass",
    });
    if (refused.mission.status !== "refused") throw new Error("capacity fixture failed");
    expect(refused.mission.message).toMatch(/mass/i);
    expect(
      await db
        .select()
        .from(rune.itemInstances)
        .where(eq(rune.itemInstances.characterId, character.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(rune.characterMissions)
        .where(eq(rune.characterMissions.characterId, character.id)),
    ).toMatchObject([{ completedAt: null }]);
  });

  it("serializes concurrent completion into exactly one unequipped Cutter", async () => {
    const { userId, character } = await makeCharacter();
    await acceptAtCrash(userId, character.id);
    await move(character.id, LOCATION_IDS.theJag);
    const results = await Promise.all([
      completeWalkItOffAt(NPC_IDS.tansyRusk)(userId, character.id),
      completeWalkItOffAt(NPC_IDS.tansyRusk)(userId, character.id),
    ]);
    expect(results.map((result) => result.mission.status).sort()).toEqual([
      "already_completed",
      "completed",
    ]);
    const cutters = await db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, character.id),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
    expect(cutters).toHaveLength(1);
    expect(
      await db
        .select()
        .from(rune.equippedItems)
        .where(eq(rune.equippedItems.itemInstanceId, cutters[0]!.id)),
    ).toHaveLength(0);
  });

  it("allows separate characters to accept their own mission row", async () => {
    const first = await makeCharacter();
    const second = await makeCharacter();
    const [acceptedFirst, acceptedSecond] = await Promise.all([
      acceptWalkItOffAt(NPC_IDS.wadeRusk)(first.userId, first.character.id),
      acceptWalkItOffAt(NPC_IDS.wadeRusk)(second.userId, second.character.id),
    ]);
    expect(acceptedFirst.mission.status).toBe("accepted");
    expect(acceptedSecond.mission.status).toBe("accepted");
  });
});

function deterministicRandom() {
  return { nextBasisPoints: () => 0, nextUnit: () => 0 };
}
