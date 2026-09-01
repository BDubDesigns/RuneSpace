import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ITEM_IDS, LOCATION_IDS, NPC_IDS, SKILL_IDS } from "@/game/config/foundations";
import type { ContentId } from "@/game/schemas/ids";
import type { MissionDefinition } from "@/game/content/missions";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #124 framework-level proofs for the generic authoritative completion
 * boundary. A synthetic test definition exercises the consume-item turn-in
 * path that no production mission currently authors (B1 in the
 * pre-mission-framework audit): exact consumption through the #112 boundary,
 * post-consumption reward capacity preflight, and full rollback. The
 * definition is injected through `completeMissionWithDefinition` — no fake
 * player-visible production quest is added.
 */
const SYNTHETIC_ID = "synthetic_consume_turn_in" as ContentId;

function syntheticMission(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: SYNTHETIC_ID,
    title: "Synthetic Consume Turn-In",
    summary: "Hand in a full stack of Ferrite Shale for a Cutter.",
    offers: [
      {
        npcId: NPC_IDS.tansyRusk,
        locationId: LOCATION_IDS.theJag,
        dialogueId: "tansy_rusk_cut_your_teeth_offer" as never,
      },
    ],
    requirements: [
      {
        kind: "carried_stack",
        itemId: ITEM_IDS.ferriteShale,
        quantity: 10,
        turnIn: "consume_required_quantity",
        objective: "Bring {required} {item}",
      },
    ],
    turnIn: {
      npcId: NPC_IDS.tansyRusk,
      locationId: LOCATION_IDS.theJag,
      requiresStationary: true,
      objective: "Hand in the shale",
      dialogueId: "tansy_rusk_cut_your_teeth_turn_in" as never,
    },
    reward: { kind: "item", itemId: ITEM_IDS.salvageCutter },
    dialogue: {},
    ...overrides,
  };
}

suite("issue #124 generic consume-item completion boundary (real PostgreSQL)", () => {
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

  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  async function makeAcceptedCharacterAtTheJag() {
    const userId = await createTestUser(db, authSchema, "Framework Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Framework ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: SYNTHETIC_ID,
      acceptedAt: now,
    });
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.theJag })
      .where(eq(rune.characters.id, character.id));
    return { userId, character };
  }

  async function addShaleStacks(characterId: string, stacks: readonly number[]) {
    if (stacks.length === 0) return;
    await db
      .insert(rune.inventoryStacks)
      .values(stacks.map((quantity) => ({ characterId, itemId: ITEM_IDS.ferriteShale, quantity })));
  }

  async function shaleQuantities(characterId: string) {
    const stacks = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    return stacks
      .filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)
      .map((stack) => stack.quantity)
      .sort((a, b) => a - b);
  }

  async function cutters(characterId: string) {
    const instances = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.characterId, characterId));
    return instances.filter((instance) => instance.itemId === ITEM_IDS.salvageCutter);
  }

  it("consumes the exact required quantity through #112 and grants the item reward once", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    // Two partial stacks totalling exactly 10.
    await addShaleStacks(character.id, [4, 6]);

    const completed = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      syntheticMission(),
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    expect(await shaleQuantities(character.id)).toEqual([]);
    expect(await cutters(character.id)).toHaveLength(1);

    // Retry observes already_completed and never double-consumes or re-rewards.
    await addShaleStacks(character.id, [10]);
    const retry = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      syntheticMission(),
      NPC_IDS.tansyRusk,
      new Date(now.getTime() + 1_000),
      deterministicRandom(),
    );
    expect(retry.mission.status).toBe("already_completed");
    expect(await shaleQuantities(character.id)).toEqual([10]);
    expect(await cutters(character.id)).toHaveLength(1);
  });

  it("refuses insufficient quantity without consuming anything or stamping completion", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    await addShaleStacks(character.id, [5, 4]);

    const refused = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      syntheticMission(),
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(refused.mission).toMatchObject({ status: "refused", reason: "insufficient_items" });
    // Consumption is all-or-nothing: the partial stacks survive untouched.
    expect(await shaleQuantities(character.id)).toEqual([4, 5]);
    expect(await cutters(character.id)).toHaveLength(0);
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(rows[0]?.completedAt).toBeNull();
  });

  it("preflights the item reward against the POST-consumPTION candidate inventory", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    // Fill all 8 container slots with shale stacks totalling exactly 10. The
    // Cutter reward needs a free slot — impossible before consumption, but
    // consuming every stack frees the capacity the reward requires.
    await addShaleStacks(character.id, [3, 1, 1, 1, 1, 1, 1, 1]);

    const completed = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      syntheticMission(),
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    expect(await shaleQuantities(character.id)).toEqual([]);
    expect(await cutters(character.id)).toHaveLength(1);
  });

  it("still refuses a reward that does not fit even after consumption frees capacity", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    // Nine stacks: one full shale stack (the consumed requirement) plus eight
    // non-consumed stacks. Consuming the shale frees one slot, but the eight
    // remaining stacks still fill the container — the Cutter reward has
    // nowhere to go even post-consumption, and nothing is mutated.
    await addShaleStacks(character.id, [10]);
    await db.insert(rune.inventoryStacks).values(
      Array.from({ length: 8 }, (_, index) => ({
        characterId: character.id,
        itemId: index % 2 === 0 ? ITEM_IDS.slag : ITEM_IDS.refinedFerrite,
        quantity: 1,
      })),
    );
    const refused = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      syntheticMission(),
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(refused.mission).toMatchObject({
      status: "refused",
      reason: "capacity",
      capacityReason: "slots",
    });
    // Consumption is planned, never applied before the plan is valid.
    expect(await shaleQuantities(character.id)).toEqual([10]);
    expect(await cutters(character.id)).toHaveLength(0);
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(rows[0]?.completedAt).toBeNull();
  });

  it("rolls back consumption when the reward application fails mid-transaction", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    await addShaleStacks(character.id, [10]);
    // Strength has no approved progression curve, so the reward application
    // throws AFTER consumption is applied — the whole transaction must roll
    // back: no consumption, no completion stamp.
    const brokenReward = syntheticMission({
      reward: {
        kind: "skill_xp",
        skillId: SKILL_IDS.strength as (typeof SKILL_IDS)[keyof typeof SKILL_IDS],
        amount: 50,
      },
    });
    await expect(
      missions.completeMissionWithDefinition(
        userId,
        character.id,
        brokenReward,
        NPC_IDS.tansyRusk,
        now,
        deterministicRandom(),
      ),
    ).rejects.toThrow(/progression curve/);
    expect(await shaleQuantities(character.id)).toEqual([10]);
    const rows = await db
      .select()
      .from(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, character.id));
    expect(rows[0]?.completedAt).toBeNull();
  });

  it("grants a Skill XP reward exactly once under concurrent first completions", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    await addShaleStacks(character.id, [10]);
    const xpMission = syntheticMission({
      reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 25 },
    });

    const [first, second] = await Promise.all([
      missions.completeMissionWithDefinition(
        userId,
        character.id,
        xpMission,
        NPC_IDS.tansyRusk,
        new Date(now.getTime() + 1_000),
        deterministicRandom(),
      ),
      missions.completeMissionWithDefinition(
        userId,
        character.id,
        xpMission,
        NPC_IDS.tansyRusk,
        new Date(now.getTime() + 2_000),
        deterministicRandom(),
      ),
    ]);
    const statuses = [first.mission.status, second.mission.status];
    expect(statuses).toContain("completed");
    expect(statuses).toContain("already_completed");

    // Exactly one consumption and exactly one XP grant.
    expect(await shaleQuantities(character.id)).toEqual([]);
    const xp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, character.id));
    expect(xp.filter((row) => row.skillId === SKILL_IDS.mining)).toMatchObject([{ totalXp: 25 }]);
  });

  it("refuses the wrong turn-in NPC authoritatively", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    await addShaleStacks(character.id, [10]);
    const refused = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      syntheticMission(),
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );
    expect(refused.mission).toMatchObject({ status: "refused", reason: "wrong_npc" });
    expect(await shaleQuantities(character.id)).toEqual([10]);
  });

  it("shows (consume zero) when the requirement authors turn-in: show", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    await addShaleStacks(character.id, [10]);
    const showMission = syntheticMission({
      requirements: [
        {
          kind: "carried_stack",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 10,
          turnIn: "show",
          objective: "Show {required} {item}",
        },
      ],
      reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 10 },
    });
    const completed = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      showMission,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");
    // Shown, never consumed.
    expect(await shaleQuantities(character.id)).toEqual([10]);
  });

  it("consumes equal-quantity stacks in #112 order: quantity, then creation time, then ID", async () => {
    const { userId, character } = await makeAcceptedCharacterAtTheJag();
    // Two equal-quantity matching stacks whose ID order is the REVERSE of
    // their creation order: the older stack has the lexicographically larger
    // ID. Mission candidate planning must preserve creation metadata so the
    // OLDER stack is consumed first — a regression that drops createdAt would
    // fall through to ID tie-breaking and consume the wrong stack.
    const newerStackId = "00000000-0000-4000-8000-00000000000a";
    const olderStackId = "00000000-0000-4000-8000-00000000000b";
    await db.insert(rune.inventoryStacks).values([
      {
        id: newerStackId,
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 5,
        createdAt: new Date("2026-01-01T01:00:00.000Z"),
      },
      {
        id: olderStackId,
        characterId: character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 5,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const consumeFive = syntheticMission({
      requirements: [
        {
          kind: "carried_stack",
          itemId: ITEM_IDS.ferriteShale,
          quantity: 5,
          turnIn: "consume_required_quantity",
          objective: "Bring {required} {item}",
        },
      ],
      reward: { kind: "skill_xp", skillId: SKILL_IDS.mining, amount: 10 },
    });
    const completed = await missions.completeMissionWithDefinition(
      userId,
      character.id,
      consumeFive,
      NPC_IDS.tansyRusk,
      now,
      deterministicRandom(),
    );
    expect(completed.mission.status).toBe("completed");

    // Exactly one stack remains, and it is the NEWER one: the older stack won
    // consumption before ID tie-breaking could decide.
    const remaining = await db
      .select()
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, character.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(newerStackId);
    expect(remaining[0]?.quantity).toBe(5);
  });
});
