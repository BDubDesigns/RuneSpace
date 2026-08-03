import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/** Short unique token so fixture names never collide with leftovers. */
const token = () => Math.random().toString(36).slice(2, 8);

/**
 * Issue #62 acceptance: the narrow authenticated read boundary for characters
 * at the active character's authoritative location, proven against real
 * PostgreSQL. The browser can never enumerate a location directly: every read
 * is scoped by the owned active character and the server resolves the
 * location, the owner name, and the derived level.
 */
suite("issue #62 location population read boundary (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let population: typeof import("@/server/location-population");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    population = await import("@/server/location-population");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeUser(displayName: string) {
    const userId = await createTestUser(db, authSchema, displayName);
    createdUsers.push(userId);
    return userId;
  }

  async function makeCharacterAt(
    userId: string,
    name: string,
    locationId: string,
    miningXp?: number,
  ) {
    const character = await createCharacterForUser(db, rune, ownership, characters, userId, name);
    if (locationId !== LOCATION_IDS.crashSite) {
      await db
        .update(rune.characters)
        .set({ currentLocationId: locationId })
        .where(eq(rune.characters.id, character.id));
    }
    if (miningXp !== undefined) {
      await db.insert(rune.characterSkillXp).values({
        characterId: character.id,
        skillId: SKILL_IDS.mining,
        totalXp: miningXp,
      });
    }
    return character;
  }

  it("refuses an unauthenticated request at the auth boundary", async () => {
    // A request with no session cookie and a resolvable loopback host must be
    // refused by the auth boundary before any read can happen.
    await expect(
      ownership.requireCurrentUser(new Headers({ host: "localhost:3000" })),
    ).rejects.toMatchObject({
      name: "OwnershipError",
      status: 401,
    });
    // A user without a player account cannot reach the read boundary either.
    const ghost = await makeUser("Ghost User");
    await expect(population.getLocationPopulation(ghost, "any-character")).rejects.toThrow(
      /account not found/i,
    );
  });

  it("cannot enumerate a location through another player's active character", async () => {
    const victim = await makeUser("Victim Owner");
    const victimName = `Victim ${token()}`;
    const victimCharacter = await makeCharacterAt(victim, victimName, LOCATION_IDS.crashSite);
    const outsider = await makeUser("Outsider Owner");
    const outsiderName = `Outsider ${token()}`;
    const outsiderCharacter = await makeCharacterAt(outsider, outsiderName, LOCATION_IDS.crashSite);
    await expect(population.getLocationPopulation(outsider, victimCharacter.id)).rejects.toThrow(
      /character not found/i,
    );
    // The outsider's own character still resolves normally: the victim appears,
    // the outsider's own active character never lists itself.
    const result = await population.getLocationPopulation(outsider, outsiderCharacter.id);
    const names = result.characters.map((entry) => entry.displayName);
    expect(names).toContain(victimName);
    expect(names).not.toContain(outsiderName);
  });

  it("returns only characters matching the active character's authoritative location", async () => {
    const owner = await makeUser("Hub Owner");
    const ghostOwner = await makeUser("Ghost Owner");
    const activeName = `Hub Active ${token()}`;
    const mateName = `Hub Mate ${token()}`;
    const yardGhostName = `Yard Ghost ${token()}`;
    const annexGhostName = `Annex Ghost ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, mateName, LOCATION_IDS.crashSite);
    await makeCharacterAt(ghostOwner, yardGhostName, LOCATION_IDS.abandonedProcessingYard);
    await makeCharacterAt(ghostOwner, annexGhostName, LOCATION_IDS.emergencyPowerAnnex);

    const result = await population.getLocationPopulation(owner, active.id);
    const names = result.characters.map((entry) => entry.displayName);
    expect(names).toContain(mateName);
    expect(names).not.toContain(activeName);
    expect(names).not.toContain(yardGhostName);
    expect(names).not.toContain(annexGhostName);
  });

  it("excludes the active character and includes the owner's other same-location characters", async () => {
    const owner = await makeUser("Twin Owner");
    const activeName = `Twin Active ${token()}`;
    const twinName = `Twin Second ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, twinName, LOCATION_IDS.crashSite);
    const result = await population.getLocationPopulation(owner, active.id);
    const names = result.characters.map((entry) => entry.displayName);
    expect(names).toContain(twinName);
    expect(names).not.toContain(activeName);
  });

  it("returns multiple characters of one owner as separate entries", async () => {
    const owner = await makeUser("Many Owner");
    const activeName = `Many Active ${token()}`;
    const oneName = `Many One ${token()}`;
    const twoName = `Many Two ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, oneName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, twoName, LOCATION_IDS.crashSite);
    const other = await makeUser("Other Owner");
    await makeCharacterAt(other, `Other One ${token()}`, LOCATION_IDS.crashSite);

    const result = await population.getLocationPopulation(owner, active.id);
    const ownerEntries = result.characters.filter((entry) => entry.ownerName === "Many Owner");
    // Both of the owner's other characters appear separately; the outsider's
    // character does not inflate this owner's entries.
    expect(ownerEntries.map((entry) => entry.displayName).sort()).toEqual(
      [oneName, twoName].sort(),
    );
  });

  it("exposes only owner name plus character name and derived level", async () => {
    const owner = await makeUser("Narrow Owner");
    const activeName = `Narrow Active ${token()}`;
    const mateName = `Narrow Mate ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, mateName, LOCATION_IDS.crashSite, 500);

    const result = await population.getLocationPopulation(owner, active.id);
    expect(result.characters).toContainEqual({
      displayName: mateName,
      level: 2,
      ownerName: "Narrow Owner",
    });
    // Every entry carries exactly the approved public fields — no email,
    // account ID, character database ID, XP, or timestamp.
    for (const entry of result.characters) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "level", "ownerName"]);
    }
  });

  it("derives levels from persisted skill XP through the existing boundary", async () => {
    const owner = await makeUser("Level Owner");
    const activeName = `Level Active ${token()}`;
    const oneName = `Level One ${token()}`;
    const twoName = `Level Two ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    // Absent XP rows are authoritative zero (level 1); 500 XP is the
    // level-1→2 threshold in the typed balance.
    await makeCharacterAt(owner, oneName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, twoName, LOCATION_IDS.crashSite, 500);

    const result = await population.getLocationPopulation(owner, active.id);
    const one = result.characters.find((entry) => entry.displayName === oneName);
    const two = result.characters.find((entry) => entry.displayName === twoName);
    expect(one).toEqual({ displayName: oneName, level: 1, ownerName: "Level Owner" });
    expect(two).toEqual({ displayName: twoName, level: 2, ownerName: "Level Owner" });
  });

  it("orders deterministically by character name", async () => {
    const owner = await makeUser("Order Owner");
    const fillerOwner = await makeUser("Filler Owner");
    const activeName = `Order Active ${token()}`;
    const zuluName = `Zulu Mate ${token()}`;
    const alphaName = `Alpha Mate ${token()}`;
    const mikeName = `Mike Mate ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(fillerOwner, zuluName, LOCATION_IDS.crashSite);
    await makeCharacterAt(fillerOwner, alphaName, LOCATION_IDS.crashSite);
    await makeCharacterAt(fillerOwner, mikeName, LOCATION_IDS.crashSite);

    const first = await population.getLocationPopulation(owner, active.id);
    const second = await population.getLocationPopulation(owner, active.id);
    // The full read is stable across calls, and this suite's fixtures appear
    // in deterministic name order regardless of pre-existing rows.
    expect(first.characters.map((entry) => entry.displayName)).toEqual(
      second.characters.map((entry) => entry.displayName),
    );
    const ordered = first.characters
      .map((entry) => entry.displayName)
      .filter((name) => [alphaName, mikeName, zuluName].includes(name));
    expect(ordered).toEqual([alphaName, mikeName, zuluName]);
  });
});
