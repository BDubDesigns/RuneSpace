import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LOCATION_IDS, MISSION_IDS, NPC_IDS } from "@/game/config/foundations";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Mission pinning (#325): a per-character, per-Mission presentation preference.
 * Absence is pinned, so acceptance writes nothing; only an explicit unpin is
 * stored, and nothing about the Mission itself reads it.
 */
suite("issue #325 Mission pinning persistence (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let pins: typeof import("@/server/mission-pin-commands");
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
    pins = await import("@/server/mission-pin-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeUser() {
    const userId = await createTestUser(db, authSchema, "Mission Pin Tester");
    createdUsers.push(userId);
    return userId;
  }

  async function makeCharacter(userId: string, suffix = "") {
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Pin ${userId.slice(0, 5)}${suffix}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    return character;
  }

  async function acceptWalkItOff(userId: string, characterId: string) {
    const accepted = await missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.walkItOff,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );
    expect(accepted.mission.status).toBe("accepted");
    return accepted;
  }

  function setPinned(userId: string, characterId: string, missionId: string, pinned: boolean) {
    return pins.setMissionPinned(
      userId,
      characterId,
      missionId,
      pinned,
      now,
      deterministicRandom(),
    );
  }

  function unpinRows(characterId: string) {
    return db
      .select()
      .from(rune.characterMissionUnpins)
      .where(eq(rune.characterMissionUnpins.characterId, characterId));
  }

  it("starts a manually accepted Mission pinned without writing a preference", async () => {
    const userId = await makeUser();
    const character = await makeCharacter(userId);
    const accepted = await acceptWalkItOff(userId, character.id);
    expect(accepted.state.unpinnedMissionIds).toEqual([]);
    expect(await unpinRows(character.id)).toEqual([]);
  });

  it("unpins and re-pins one Mission, leaving its projection and guidance untouched", async () => {
    const userId = await makeUser();
    const character = await makeCharacter(userId);
    const accepted = await acceptWalkItOff(userId, character.id);

    const unpinned = await setPinned(userId, character.id, MISSION_IDS.walkItOff, false);
    expect(unpinned.pin).toEqual({ status: "unpinned" });
    expect(unpinned.state.unpinnedMissionIds).toEqual([MISSION_IDS.walkItOff]);
    // Presentation only: the Mission and every guidance target are identical.
    expect(unpinned.state.missions).toEqual(accepted.state.missions);
    expect(deriveMissionGuidanceTargets(unpinned.state.missions)).toEqual(
      deriveMissionGuidanceTargets(accepted.state.missions),
    );
    expect(await unpinRows(character.id)).toMatchObject([
      { missionId: MISSION_IDS.walkItOff, unpinnedAt: now },
    ]);

    // Idempotent both ways: a repeated press reports what the player asked for.
    expect((await setPinned(userId, character.id, MISSION_IDS.walkItOff, false)).pin).toEqual({
      status: "unpinned",
    });
    expect(await unpinRows(character.id)).toHaveLength(1);

    const repinned = await setPinned(userId, character.id, MISSION_IDS.walkItOff, true);
    expect(repinned.pin).toEqual({ status: "pinned" });
    expect(repinned.state.unpinnedMissionIds).toEqual([]);
    expect(repinned.state.missions).toEqual(accepted.state.missions);
    expect((await setPinned(userId, character.id, MISSION_IDS.walkItOff, true)).pin).toEqual({
      status: "pinned",
    });
    expect(await unpinRows(character.id)).toEqual([]);
  });

  it("survives a fresh read and stays on the character that set it", async () => {
    const userId = await makeUser();
    const first = await makeCharacter(userId, "a");
    const second = await makeCharacter(userId, "b");
    await acceptWalkItOff(userId, first.id);
    await acceptWalkItOff(userId, second.id);
    await setPinned(userId, first.id, MISSION_IDS.walkItOff, false);

    const reread = await play.getPlayGameplayState(userId, first.id, now, deterministicRandom());
    expect(reread.unpinnedMissionIds).toEqual([MISSION_IDS.walkItOff]);
    const other = await play.getPlayGameplayState(userId, second.id, now, deterministicRandom());
    expect(other.unpinnedMissionIds).toEqual([]);
  });

  it("refuses another player's character", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const character = await makeCharacter(owner);
    await acceptWalkItOff(owner, character.id);
    await expect(setPinned(outsider, character.id, MISSION_IDS.walkItOff, false)).rejects.toThrow(
      /not found/i,
    );
    expect(await unpinRows(character.id)).toEqual([]);
  });

  it("refuses unknown, unaccepted, and completed Missions without writing anything", async () => {
    const userId = await makeUser();
    const character = await makeCharacter(userId);

    const unknown = await setPinned(userId, character.id, "not_a_mission", false);
    expect(unknown.pin).toEqual({ status: "refused", message: "Unknown mission." });
    const unaccepted = await setPinned(userId, character.id, MISSION_IDS.walkItOff, false);
    expect(unaccepted.pin).toMatchObject({ status: "refused" });
    expect(await unpinRows(character.id)).toEqual([]);

    await acceptWalkItOff(userId, character.id);
    await moveTo(character.id, LOCATION_IDS.theJag);
    await completeWalkItOff(userId, character.id);
    const completed = await setPinned(userId, character.id, MISSION_IDS.walkItOff, false);
    expect(completed.pin).toMatchObject({ status: "refused" });
    expect(await unpinRows(character.id)).toEqual([]);
  });

  it("progresses and completes an unpinned Mission normally, and its continuation starts pinned", async () => {
    const userId = await makeUser();
    const character = await makeCharacter(userId);
    await acceptWalkItOff(userId, character.id);
    await setPinned(userId, character.id, MISSION_IDS.walkItOff, false);

    // Arriving satisfies the requirement while unpinned: the turn-in phase and
    // its guidance appear exactly as they would for a pinned Mission.
    await moveTo(character.id, LOCATION_IDS.theJag);
    const arrived = await play.getPlayGameplayState(
      userId,
      character.id,
      now,
      deterministicRandom(),
    );
    expect(arrived.missions.find((m) => m.missionId === MISSION_IDS.walkItOff)).toMatchObject({
      state: "ready_for_completion",
    });
    expect(deriveMissionGuidanceTargets(arrived.missions).turnInNpcIds.has(NPC_IDS.tansyRusk)).toBe(
      true,
    );

    const completed = await completeWalkItOff(userId, character.id);
    expect(completed.mission).toMatchObject({ status: "completed", reward: { quantity: 1 } });
    expect(
      completed.state.missions.find((m) => m.missionId === MISSION_IDS.walkItOff),
    ).toMatchObject({ state: "completed" });
    // Walk It Off's continuation, Cut Your Teeth, arrives accepted and pinned.
    expect(
      completed.state.missions.find((m) => m.missionId === MISSION_IDS.cutYourTeeth),
    ).toMatchObject({ state: "active" });
    expect(completed.state.unpinnedMissionIds).not.toContain(MISSION_IDS.cutYourTeeth);
  });

  it("forgets the preference when the Mission record is reset", async () => {
    const userId = await makeUser();
    const character = await makeCharacter(userId);
    await acceptWalkItOff(userId, character.id);
    await setPinned(userId, character.id, MISSION_IDS.walkItOff, false);
    await db
      .delete(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, character.id),
          eq(rune.characterMissions.missionId, MISSION_IDS.walkItOff),
        ),
      );
    expect(await unpinRows(character.id)).toEqual([]);
    const again = await acceptWalkItOff(userId, character.id);
    expect(again.state.unpinnedMissionIds).toEqual([]);
  });

  async function moveTo(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  function completeWalkItOff(userId: string, characterId: string) {
    return missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.walkItOff,
      NPC_IDS.tansyRusk,
      new Date(now.getTime() + 1_000),
      deterministicRandom(),
    );
  }
});

function deterministicRandom() {
  return { nextBasisPoints: () => 0, nextUnit: () => 0 };
}
