import pg from "pg";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { miningLevelThresholds } from "@/game/config/balance";
import { LOCATION_IDS, PORTRAIT_IDS, SKILL_IDS } from "@/game/config/foundations";
import { getPortrait } from "@/game/content/portrait-catalog";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/** Short unique token so fixture names never collide with leftovers. */
const token = () => Math.random().toString(36).slice(2, 8);

/**
 * Issue #64 acceptance: the narrow authenticated public-character-profile read
 * boundary, proven against real PostgreSQL. Every read is scoped by the owned
 * active character; the target is revalidated as visible at the active
 * character's authoritative location within the same statement; only approved
 * public identity and progression fields leave the server; and the read stays
 * set-based (no per-skill round trips).
 */
suite("issue #64 character profile read boundary (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let profile: typeof import("@/server/character-profile");
  let thresholds: ReturnType<typeof miningLevelThresholds>;
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    profile = await import("@/server/character-profile");
    thresholds = miningLevelThresholds();
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
    portraitId?: string,
  ) {
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      name,
      portraitId,
    );
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

  async function setSkillXp(characterId: string, skillId: string, totalXp: number) {
    await db.insert(rune.characterSkillXp).values({ characterId, skillId, totalXp });
  }

  it("refuses an unauthenticated request at the auth boundary", async () => {
    await expect(
      ownership.requireCurrentUser(new Headers({ host: "localhost:3000" })),
    ).rejects.toMatchObject({
      name: "OwnershipError",
      status: 401,
    });
    // A user without a player account cannot reach the read boundary either.
    const ghost = await makeUser("Ghost User");
    await expect(profile.getCharacterProfile(ghost, "any-character", "Any Name")).rejects.toThrow(
      /account not found/i,
    );
  });

  it("cannot inspect a character through another player's active character", async () => {
    const victim = await makeUser("Victim Owner");
    const victimName = `Victim ${token()}`;
    const victimCharacter = await makeCharacterAt(victim, victimName, LOCATION_IDS.crashSite);
    const outsider = await makeUser("Outsider Owner");
    // The outsider has their own account and character; a foreign character ID
    // is still refused at the ownership boundary without revealing anything.
    await makeCharacterAt(outsider, `Outsider ${token()}`, LOCATION_IDS.crashSite);
    await expect(
      profile.getCharacterProfile(outsider, victimCharacter.id, victimName),
    ).rejects.toThrow(/character not found/i);
  });

  it("refuses targets that fail the same-location visibility rule", async () => {
    const owner = await makeUser("Scope Owner");
    const activeName = `Scope Active ${token()}`;
    const yardName = `Scope Yard ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, yardName, LOCATION_IDS.abandonedProcessingYard);

    // A character at another location is refused.
    await expect(profile.getCharacterProfile(owner, active.id, yardName)).rejects.toThrow(
      /character not found/i,
    );
    // Unknown names, malformed names, and overlong names get the same generic
    // refusal — a guessed name reveals nothing.
    await expect(profile.getCharacterProfile(owner, active.id, "Nobody Here")).rejects.toThrow(
      /character not found/i,
    );
    await expect(profile.getCharacterProfile(owner, active.id, "!!!")).rejects.toThrow(
      /character not found/i,
    );
    await expect(profile.getCharacterProfile(owner, active.id, "X".repeat(25))).rejects.toThrow(
      /character not found/i,
    );
    await expect(profile.getCharacterProfile(owner, active.id, "")).rejects.toThrow(
      /character not found/i,
    );
  });

  it("refuses the active character as a target", async () => {
    const owner = await makeUser("Self Owner");
    const activeName = `Self Active ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await expect(profile.getCharacterProfile(owner, active.id, activeName)).rejects.toThrow(
      /character not found/i,
    );
  });

  it("returns only approved public identity and progression for a visible target", async () => {
    const owner = await makeUser("Narrow Owner");
    const activeName = `Narrow Active ${token()}`;
    const targetName = `Narrow Target ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    // The target deliberately chose Gramma; the read must return exactly that
    // portrait's safe catalog presentation — not a default and not a raw ID.
    await makeCharacterAt(owner, targetName, LOCATION_IDS.crashSite, 500, PORTRAIT_IDS.gramma);

    const gramma = getPortrait(PORTRAIT_IDS.gramma)!;
    const result = await profile.getCharacterProfile(owner, active.id, targetName);
    expect(result).toEqual({
      displayName: targetName,
      ownerName: "Narrow Owner",
      overallLevel: 2,
      skills: [
        {
          displayName: "Mining",
          level: 2,
          totalXp: 500,
          xpIntoLevel: 0,
          xpToNextLevel: 550,
          atMaximumLevel: false,
        },
      ],
      portrait: {
        kind: "selected",
        displayName: gramma.displayName,
        derivativePath: gramma.derivativePath,
        derivativeWidth: gramma.derivativeWidth,
        derivativeHeight: gramma.derivativeHeight,
        accessibleDescription: gramma.accessibleDescription,
      },
    });
    // No email, account ID, character database ID, skill ID, category, master
    // path, timestamp, or raw portrait ID may leave the server.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("skillId");
    expect(serialized).not.toContain("portraitId");
    expect(serialized).not.toContain("category");
    expect(serialized).not.toContain("masterPath");
  });

  it("derives Mining level and next-level progress from persisted XP", async () => {
    const owner = await makeUser("Level Owner");
    const activeName = `Level Active ${token()}`;
    const edgeName = `Level Edge ${token()}`;
    const midName = `Level Mid ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, edgeName, LOCATION_IDS.crashSite, 500);
    await makeCharacterAt(owner, midName, LOCATION_IDS.crashSite, 750);

    const edge = await profile.getCharacterProfile(owner, active.id, edgeName);
    expect(edge.skills[0]).toMatchObject({ level: 2, xpIntoLevel: 0, xpToNextLevel: 550 });
    const mid = await profile.getCharacterProfile(owner, active.id, midName);
    expect(mid.skills[0]).toMatchObject({ level: 2, xpIntoLevel: 250, xpToNextLevel: 300 });
  });

  it("is truthful at the maximum level", async () => {
    const maxXp = thresholds[thresholds.length - 1]!.totalXp;
    const owner = await makeUser("Max Owner");
    const activeName = `Max Active ${token()}`;
    const maxName = `Max Target ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, maxName, LOCATION_IDS.crashSite, maxXp);

    const result = await profile.getCharacterProfile(owner, active.id, maxName);
    expect(result.overallLevel).toBe(99);
    expect(result.skills[0]).toMatchObject({
      level: 99,
      totalXp: maxXp,
      atMaximumLevel: true,
    });
    expect(result.skills[0]?.xpToNextLevel).toBeUndefined();
  });

  it("presents only skills with an approved curve and defaults absent XP to zero", async () => {
    const owner = await makeUser("Curve Owner");
    const activeName = `Curve Active ${token()}`;
    const playedName = `Curve Played ${token()}`;
    const freshName = `Curve Fresh ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    const played = await makeCharacterAt(owner, playedName, LOCATION_IDS.crashSite, 500);
    // Strength has a persisted row but no approved level curve: it must not be
    // published, no matter how much XP it holds.
    await setSkillXp(played.id, SKILL_IDS.strength, 9_999_999);
    // A never-played character has no XP rows at all: Mining still appears at
    // authoritative zero XP (level 1), the same convention as issue #62.
    await makeCharacterAt(owner, freshName, LOCATION_IDS.crashSite);

    const playedProfile = await profile.getCharacterProfile(owner, active.id, playedName);
    expect(playedProfile.skills.map((skill) => skill.displayName)).toEqual(["Mining"]);
    expect(playedProfile.skills[0]).toMatchObject({ level: 2, totalXp: 500 });
    const freshProfile = await profile.getCharacterProfile(owner, active.id, freshName);
    expect(freshProfile.skills.map((skill) => skill.displayName)).toEqual(["Mining"]);
    expect(freshProfile.skills[0]).toMatchObject({ level: 1, totalXp: 0 });
    expect(freshProfile.overallLevel).toBe(1);
  });

  it("performs a bounded number of queries (no per-skill round trips)", async () => {
    const owner = await makeUser("Query Owner");
    const activeName = `Query Active ${token()}`;
    const targetName = `Query Target ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    const target = await makeCharacterAt(owner, targetName, LOCATION_IDS.crashSite, 500);
    // Multiple skill rows (including an unpresented skill) must not add round
    // trips: the profile read is one set-based statement.
    await setSkillXp(target.id, SKILL_IDS.strength, 100);
    await setSkillXp(target.id, SKILL_IDS.welding, 100);

    // Count every query executed through the pg clients during the read. The
    // read itself must stay within: player account lookup (1) + owned
    // character lookup (1) + the single profile statement (1).
    const clientPrototype = pg.Client.prototype as unknown as {
      query: (...args: unknown[]) => unknown;
    };
    const originalQuery = clientPrototype.query;
    const spy = vi.spyOn(clientPrototype, "query");
    let queries = 0;
    spy.mockImplementation(function (this: unknown, ...args: unknown[]) {
      queries += 1;
      return originalQuery.apply(this, args);
    });

    try {
      const result = await profile.getCharacterProfile(owner, active.id, targetName);
      expect(result.skills).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    expect(queries).toBeLessThanOrEqual(3);
  });
});
