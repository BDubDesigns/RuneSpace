import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #110 Cut Your Teeth persistence and XP boundary (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let mining: typeof import("@/server/mining");
  let missions: typeof import("@/server/missions");
  let equipment: typeof import("@/server/equipment");
  const createdUsers: string[] = [];
  const now = new Date("2026-01-01T00:00:00.000Z");

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    mining = await import("@/server/mining");
    missions = await import("@/server/missions");
    equipment = await import("@/server/equipment");
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
    await mining.getMiningGameplayState(userId, character.id, now, deterministicRandom());
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
    const completed = await missions.completeWalkItOff(
      userId,
      characterId,
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
    const refused = await missions.acceptCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(refused.mission.status).toBe("refused");

    // Accepting (but not completing) Walk It Off still refuses.
    await db
      .insert(rune.characterMissions)
      .values({ characterId: character.id, missionId: "walk_it_off", acceptedAt: now });
    const refusedActive = await missions.acceptCutYourTeeth(
      userId,
      character.id,
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

  it("accepts after completion, is Tansy-only/idempotent, and completes once with exactly +100 Mining XP without consuming shale", async () => {
    const { userId, character } = await makeCharacter();
    await completeWalkItOffAtTheJag(userId, character.id);

    // Wrong-location acceptance refuses.
    await move(character.id, LOCATION_IDS.crashSite);
    const wrongLocation = await missions.acceptCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(wrongLocation.mission.status).toBe("refused");
    await move(character.id, LOCATION_IDS.theJag);

    const first = await missions.acceptCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(first.mission.status).toBe("accepted");
    const second = await missions.acceptCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(second.mission.status).toBe("already_accepted");

    // Completion refusals follow objective precedence: equip first, then stack.
    const beforeAnyXp = await miningXp(character.id);
    const unequipped = await missions.completeCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(unequipped.mission).toMatchObject({ status: "refused", reason: "equipment" });

    // Full stack still refuses while the Cutter sits in Inventory.
    await addShale(character.id, 10);
    const stillUnequipped = await missions.completeCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(stillUnequipped.mission).toMatchObject({ status: "refused", reason: "equipment" });
    expect(await miningXp(character.id)).toBe(beforeAnyXp);

    await equipCutter(userId, character.id);

    // Dropping below one full stack falls back to refusal — inventory is the truth.
    await db
      .delete(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.itemId, ITEM_IDS.ferriteShale));
    await addShale(character.id, 9);
    const nineOnly = await missions.completeCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(nineOnly.mission).toMatchObject({ status: "refused", reason: "insufficient_items" });
    expect(await miningXp(character.id)).toBe(beforeAnyXp);
    await db
      .delete(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.itemId, ITEM_IDS.ferriteShale));

    await addShale(character.id, 10);
    const completed = await missions.completeCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    expect(await miningXp(character.id)).toBe(beforeAnyXp + 100);

    // Shale was inspected, not consumed.
    const stacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(stacks.filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)[0]?.quantity).toBe(10);

    // Retry/concurrent submissions cannot re-award.
    const retry = await missions.completeCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(retry.mission.status).toBe("already_completed");
    const [again] = await Promise.all([
      missions.completeCutYourTeeth(
        userId,
        character.id,
        new Date(now.getTime() + 1_000),
        deterministicRandom(),
      ),
      missions.completeCutYourTeeth(
        userId,
        character.id,
        new Date(now.getTime() + 2_000),
        deterministicRandom(),
      ),
    ]);
    expect([retry.mission.status, again.mission.status].flat()).toContain("already_completed");
    expect(await miningXp(character.id)).toBe(beforeAnyXp + 100);

    // Objective projection reflects the completed state through real state reads.
    const state = await mining.getMiningGameplayState(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
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
      .values({ characterId: character.id, missionId: "cut_your_teeth", acceptedAt: now });
    await equipCutter(userId, character.id);
    await addShale(character.id, 10);
    await db.insert(rune.activeActions).values({
      characterId: character.id,
      actionId: "ferrite_shale_mining",
      startedAt: now,
      resolvedThroughAt: now,
    });
    const busy = await missions.completeCutYourTeeth(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(busy.mission).toMatchObject({ status: "refused", reason: "not_stationary" });
    expect(await miningXp(character.id)).toBe(0);
  });
});
