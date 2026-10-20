import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GAME_TICK_MS, LOCATION_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Stillreach Slice A (#373), against real PostgreSQL: the eight-location planet is
 * reachable only through the admin teleport, walks only its seven authored edges,
 * and no Skatboll command can carry a character to it.
 */
suite("issue #373 Stillreach walking and planet isolation (real PostgreSQL)", () => {
  const ADMIN = "stillreach-test-admin";
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let adminCommands: typeof import("@/server/admin-command-seams");
  let travelCommands: typeof import("@/server/travel-commands");
  const createdUsers: string[] = [];
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const WALK_TICKS = getEffectiveGameBalance().travel.adjacentWalkDurationTicks;
  const at = (tick: number) => new Date(startedAt.getTime() + tick * GAME_TICK_MS);

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    adminCommands = await import("@/server/admin-command-seams");
    travelCommands = await import("@/server/travel-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Stillreach Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Still ${userId.slice(0, 6)}`,
    );
    return { userId, character };
  }

  async function storedLocation(characterId: string) {
    const [row] = await db
      .select({ currentLocationId: rune.characters.currentLocationId })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row?.currentLocationId;
  }

  async function teleportToLanding(characterId: string) {
    const result = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      characterId,
      LOCATION_IDS.stillreachLandingStation,
      startedAt,
    );
    expect(result.outcome.kind).toBe("teleported");
    return result.state;
  }

  it("lets the admin teleport place a character on Stillreach and back, persisting across a reload", async () => {
    const { userId, character } = await makeCharacter();
    const state = await teleportToLanding(character.id);
    expect(state.location.currentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
    expect(await storedLocation(character.id)).toBe(LOCATION_IDS.stillreachLandingStation);
    // The projection carries every authored location, with nothing to do or buy at the Landing.
    expect(state.locationStates[LOCATION_IDS.stillreachLandingStation]).toMatchObject({
      availableActionIds: [],
      travelable: true,
    });
    expect(state.locationStates[LOCATION_IDS.stillreachLandingStation]?.mapStatus).toBeUndefined();

    const reloaded = await play.getPlayGameplayState(userId, character.id, at(1));
    expect(reloaded.location.currentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);

    const back = await adminCommands.teleportCharacterAsAdmin(
      ADMIN,
      character.id,
      LOCATION_IDS.crashSite,
      at(2),
    );
    expect(back.outcome.kind).toBe("teleported");
    expect(await storedLocation(character.id)).toBe(LOCATION_IDS.crashSite);
  });

  it("walks each authored leg in the 24-second baseline, persisting through a reload", async () => {
    const { userId, character } = await makeCharacter();
    await teleportToLanding(character.id);

    const walking = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.windwardTrack,
      startedAt,
    );
    expect(walking.travelError).toBeUndefined();
    expect(walking.travelState).toMatchObject({
      originLocationId: LOCATION_IDS.stillreachLandingStation,
      destinationLocationId: LOCATION_IDS.windwardTrack,
      mode: "walk",
    });
    const startedMs = new Date(walking.travelState!.startedAt).getTime();
    const arrivesMs = new Date(walking.travelState!.arrivesAt).getTime();
    expect(arrivesMs - startedMs).toBe(24_000);

    // Mid-walk the origin holds; at arrival the character is on the Track.
    const mid = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS / 2));
    expect(mid.location.currentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
    const arrived = await play.getPlayGameplayState(userId, character.id, at(WALK_TICKS + 1));
    expect(arrived.location.currentLocationId).toBe(LOCATION_IDS.windwardTrack);
    expect(arrived.travelState).toBeUndefined();
    expect(await storedLocation(character.id)).toBe(LOCATION_IDS.windwardTrack);
  });

  it("walks the longest path (Landing to The Dry Seam) in four ordinary legs, refusing any shortcut", async () => {
    const { userId, character } = await makeCharacter();
    await teleportToLanding(character.id);
    const path = [
      LOCATION_IDS.windwardTrack,
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.theSurveyLine,
      LOCATION_IDS.theDrySeam,
    ];
    let tick = 0;
    // Skipping straight to the end of the line is not an authored edge.
    const shortcut = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.theDrySeam,
      at(tick),
    );
    expect(shortcut.travelError).toBe("not_adjacent");
    for (const destination of path) {
      const begun = await play.beginTravel(userId, character.id, destination, at(tick));
      expect(begun.travelError, destination).toBeUndefined();
      tick += WALK_TICKS + 1;
      const arrived = await play.getPlayGameplayState(userId, character.id, at(tick));
      expect(arrived.location.currentLocationId).toBe(destination);
    }
  });

  it("refuses a Skatboll character a walk to Stillreach, on every Skatboll location it could forge from", async () => {
    const { userId, character } = await makeCharacter();
    const forged = await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.stillreachLandingStation,
      startedAt,
    );
    expect(forged.travelError).toBe("not_adjacent");
    expect(forged.travelState).toBeUndefined();
    expect(await storedLocation(character.id)).toBe(LOCATION_IDS.crashSite);

    const toTrack = await play.beginTravel(userId, character.id, LOCATION_IDS.windwardTrack, at(1));
    expect(toTrack.travelError).toBe("not_adjacent");
    const rows = await db
      .select()
      .from(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, character.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses a Stillreach character a walk back to Skatboll", async () => {
    const { userId, character } = await makeCharacter();
    await teleportToLanding(character.id);
    for (const destination of [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.holoHollowLanding,
      LOCATION_IDS.holoHollow,
    ]) {
      const refused = await play.beginTravel(userId, character.id, destination, startedAt);
      expect(refused.travelError, destination).toBe("not_adjacent");
    }
    expect(await storedLocation(character.id)).toBe(LOCATION_IDS.stillreachLandingStation);
  });

  it("offers no transport ride or ship flight into or out of Stillreach", async () => {
    const { userId, character } = await makeCharacter();
    const intoStillreach = await play.beginTransportTravel(
      userId,
      character.id,
      LOCATION_IDS.stillreachLandingStation,
      startedAt,
    );
    expect(intoStillreach.travelError).toBe("unknown_route");
    expect(intoStillreach.travelState).toBeUndefined();

    await teleportToLanding(character.id);
    const outOfStillreach = await play.beginTransportTravel(
      userId,
      character.id,
      LOCATION_IDS.crashSite,
      at(1),
    );
    expect(outOfStillreach.travelError).toBe("unknown_route");
    // The Rivet stays berthed where it was; nothing on Stillreach carries a flight.
    const state = await play.getPlayGameplayState(userId, character.id, at(2));
    expect(state.ship.berthLocationId).toBe(LOCATION_IDS.crashSite);
    expect(state.ship.flight).toBeUndefined();
  });

  it("turns back a Stillreach walk to the origin with no halfway place", async () => {
    const { userId, character } = await makeCharacter();
    await teleportToLanding(character.id);
    await play.beginTravel(userId, character.id, LOCATION_IDS.windwardTrack, startedAt);
    const turned = await travelCommands.turnBackTravel(userId, character.id, at(WALK_TICKS / 2));
    expect(turned.travelState).toBeUndefined();
    expect(turned.location.currentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
    expect(await storedLocation(character.id)).toBe(LOCATION_IDS.stillreachLandingStation);
  });
});
