import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LOCATION_IDS, MISSION_IDS, NPC_IDS } from "@/game/config/foundations";
import { getResidentNpcs } from "@/game/content/npcs";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #231 — resident placement derived from the durable Mission record,
 * against real PostgreSQL.
 *
 * Residents are resolved from the same authoritative play projection the
 * location surface reads, so this proves that Wade's migrated relocation still
 * follows the stored Keep the Change completion (and nothing else), that Tansy
 * has not moved, and that the resident projection never becomes authority: a
 * Mission command is still refused wherever the server says the player is.
 */
suite("issue #231 Mission-derived residents (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  const createdUsers: string[] = [];
  const now = new Date("2026-09-26T00:00:00.000Z");

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

  const STORY_BEFORE_KEEP_THE_CHANGE = [
    MISSION_IDS.walkItOff,
    MISSION_IDS.cutYourTeeth,
    MISSION_IDS.wasteNot,
    MISSION_IDS.holdItTogether,
  ];

  async function newCharacter() {
    const userId = await createTestUser(db, authSchema, "Resident Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Resident ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    return { userId, character };
  }

  async function record(
    characterId: string,
    missionIds: readonly string[],
    completed: boolean,
  ): Promise<void> {
    await db.insert(rune.characterMissions).values(
      missionIds.map((missionId) => ({
        characterId,
        missionId,
        acceptedAt: now,
        completedAt: completed ? now : null,
      })),
    );
  }

  /** Who the location surface would present, read from the real projection. */
  async function residentsBy(userId: string, characterId: string) {
    const state = await play.getPlayGameplayState(userId, characterId, now, deterministicRandom());
    const completedMissionIds = deriveCompletedMissionIds(state.missions);
    const at = (locationId: string) =>
      getResidentNpcs({ locationId, completedMissionIds }).map((npc) => npc.id);
    return {
      crashSite: at(LOCATION_IDS.crashSite),
      ruskRecovery: at(LOCATION_IDS.ruskRecovery),
      theJag: at(LOCATION_IDS.theJag),
    };
  }

  it("keeps Wade at the Crash Site until Keep the Change is durably completed", async () => {
    const { userId, character } = await newCharacter();
    expect(await residentsBy(userId, character.id)).toEqual({
      crashSite: [NPC_IDS.wadeRusk],
      ruskRecovery: [],
      theJag: [NPC_IDS.tansyRusk],
    });

    await record(character.id, STORY_BEFORE_KEEP_THE_CHANGE, true);
    // Accepted is not completed: an in-progress Keep the Change moves nobody.
    await record(character.id, [MISSION_IDS.keepTheChange], false);
    expect(await residentsBy(userId, character.id)).toEqual({
      crashSite: [NPC_IDS.wadeRusk],
      ruskRecovery: [],
      theJag: [NPC_IDS.tansyRusk],
    });
  });

  it("moves Wade to Rusk Recovery from the completion record alone, and not Tansy", async () => {
    const { userId, character } = await newCharacter();
    await record(character.id, [...STORY_BEFORE_KEEP_THE_CHANGE, MISSION_IDS.keepTheChange], true);
    expect(await residentsBy(userId, character.id)).toEqual({
      crashSite: [],
      ruskRecovery: [NPC_IDS.wadeRusk],
      theJag: [NPC_IDS.tansyRusk],
    });
  });

  it("still refuses Wade's Mission wherever the server says the player is not", async () => {
    const { userId, character } = await newCharacter();
    await record(character.id, [...STORY_BEFORE_KEEP_THE_CHANGE, MISSION_IDS.keepTheChange], true);
    // Wade now presents at Rusk Recovery, but the character is standing at
    // the Crash Site; the server's own location check decides, not who the
    // client would show.
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(rune.characters.id, character.id));
    const refused = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.tenThousandHours,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );
    expect(refused.mission).toMatchObject({
      status: "refused",
      message: expect.stringContaining("stationary at Rusk Recovery"),
    });
  });
});
