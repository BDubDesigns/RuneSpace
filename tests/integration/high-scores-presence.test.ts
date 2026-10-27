import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupTestUser,
  createTestUser,
  grantFixtureEarlyAccess,
  withPublicGameplayClosed,
} from "./fixtures";
import { normalizeCharacterName } from "@/game/domain/character-name";
import { SKILL_IDS } from "@/game/config/foundations";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("public high scores and presence", () => {
  let db: (typeof import("@/db"))["db"];
  let auth: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let scores: typeof import("@/server/high-scores");
  let profiles: typeof import("@/server/public-character-profile");
  let presence: typeof import("@/server/player-presence");
  let route: typeof import("@/app/api/player-presence/route");
  const users: string[] = [];
  beforeAll(async () => {
    db = (await import("@/db")).db;
    auth = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    scores = await import("@/server/high-scores");
    profiles = await import("@/server/public-character-profile");
    presence = await import("@/server/player-presence");
    route = await import("@/app/api/player-presence/route");
  });
  afterEach(async () => {
    for (const id of users.splice(0)) await cleanupTestUser(db, auth, rune, id);
  });
  async function account(name: string, playable = true) {
    const userId = await createTestUser(db, auth, name);
    users.push(userId);
    const player = await ownership.ensurePlayerAccount(userId);
    if (playable) await grantFixtureEarlyAccess(db, rune, player.id);
    return { userId, playerAccountId: player.id };
  }
  async function character(playerAccountId: string, name: string, slot: number) {
    const [row] = await db
      .insert(rune.characters)
      .values({
        playerAccountId,
        slot,
        displayName: name,
        normalizedName: normalizeCharacterName(name),
      })
      .returning();
    return row!;
  }
  it("ranks all characters globally, keeps zero-XP ties across pages and search, and projects only public profile fields", async () => {
    const stamp = Date.now().toString(36);
    const names: string[] = [];
    const characters: Array<Awaited<ReturnType<typeof character>>> = [];
    for (let i = 0; i < 10; i++) {
      const a = await account(`Owner ${stamp} ${i}`);
      for (let slot = 1; slot <= 3; slot++) {
        const name = `Score ${stamp} ${String(i * 3 + slot).padStart(2, "0")}`;
        const c = await character(a.playerAccountId, name, slot);
        names.push(name);
        characters.push(c);
      }
    }
    // Different distributions distinguish overall level, total XP, and equal-score ties.
    await db.insert(rune.characterSkillXp).values([
      { characterId: characters[0]!.id, skillId: SKILL_IDS.mining, totalXp: 500 },
      { characterId: characters[1]!.id, skillId: SKILL_IDS.mining, totalXp: 499 },
      { characterId: characters[1]!.id, skillId: SKILL_IDS.refining, totalXp: 499 },
      { characterId: characters[2]!.id, skillId: SKILL_IDS.mining, totalXp: 500 },
      { characterId: characters[2]!.id, skillId: SKILL_IDS.refining, totalXp: 1 },
    ]);
    // A repeatable snapshot holds the global ranking still while other suites
    // create and remove unrelated characters in the shared integration DB.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      const search = `Score ${stamp}`;
      const page1 = await scores.getHighScores({ board: "overall-level", page: 1, search }, tx);
      const page2 = await scores.getHighScores({ board: "overall-level", page: 2, search }, tx);
      expect(page1.entries.slice(0, 3)).toMatchObject([
        { name: names[2], level: 2, xp: 501 },
        { name: names[0], level: 2, xp: 500 },
        { name: names[1], level: 1, xp: 998 },
      ]);
      expect(page1.entries[0]!.rank).toBeLessThan(page1.entries[1]!.rank);
      expect(page1.entries[1]!.rank).toBeLessThan(page1.entries[2]!.rank);
      const total = await scores.getHighScores({ board: "overall-xp", page: 1, search }, tx);
      expect(total.entries[0]).toMatchObject({ name: names[1], level: 1, xp: 998 });
      const mining = await scores.getHighScores({ board: "mining", page: 1, search }, tx);
      expect(mining.entries.slice(0, 3)).toMatchObject([{ xp: 500 }, { xp: 500 }, { xp: 499 }]);
      expect(mining.entries[0]!.rank).toBe(mining.entries[1]!.rank);
      expect(mining.entries[2]!.rank).toBeGreaterThanOrEqual(mining.entries[0]!.rank + 2);
      expect(page1.hasNext).toBe(true);
      expect(page2.entries).toHaveLength(5);
      expect(new Set([...page1.entries, ...page2.entries].map((r) => r.name)).size).toBe(30);
      expect(
        page2.entries.every(
          (r) => r.rank === page2.entries[0]!.rank && r.xp === 0 && r.level === 1,
        ),
      ).toBe(true);
      const filtered = await scores.getHighScores(
        { board: "mining", page: 1, search: names[29]! },
        tx,
      );
      expect(filtered.entries).toMatchObject([
        { name: names[29], rank: mining.entries[3]!.rank, xp: 0, level: 1 },
      ]);
    });
    const startedAt = new Date("2020-01-01T00:00:00Z");
    await db.insert(rune.activeActions).values({
      characterId: characters[0]!.id,
      actionId: "mining",
      startedAt,
      resolvedThroughAt: startedAt,
    });
    await scores.getHighScores({ board: "overall-xp", search: names[0]!, page: 1 });
    const profile = await profiles.getPublicCharacterProfile(names[0]!);
    expect(profile).toMatchObject({ displayName: names[0], characterLevel: 2 });
    expect(profile).not.toHaveProperty("sameAccount");
    expect(profile).not.toHaveProperty("id");
    expect(profile).not.toHaveProperty("email");
    expect(profile).not.toHaveProperty("currentLocationId");
    expect(await profiles.getPublicCharacterProfile("Unknown Person")).toBeNull();
    const xp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, characters[0]!.id));
    expect(xp).toHaveLength(1);
    expect(xp[0]!.totalXp).toBe(500);
    const action = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characters[0]!.id));
    expect(action[0]!.resolvedThroughAt.toISOString()).toBe(startedAt.toISOString());
  });
  it("orders tied Unicode names with the existing normalized-name comparison", async () => {
    const owner = await account("Unicode Owner");
    const prefix = `Unicode${Date.now().toString(36)}`;
    const astral = await character(owner.playerAccountId, `${prefix} 𐐀`, 1);
    const bmp = await character(owner.playerAccountId, `${prefix} 﨎`, 2);
    const board = await scores.getHighScores({ board: "overall-xp", page: 1, search: prefix });
    expect(board.entries.map((entry) => entry.name)).toEqual([astral.displayName, bmp.displayName]);
    expect(board.entries[0]!.rank).toBe(board.entries[1]!.rank);
  });
  it("matches the canonical progression projection for varied XP and ignores unpresented skills", async () => {
    const { projectCharacterProgression } = await import("@/game/domain/character-progression");
    const { skillLevelThresholds } = await import("@/game/config/balance");
    const { getSkillPresentation } = await import("@/game/content/skill-presentation");
    const a = await account("Projection Owner");
    const c = await character(a.playerAccountId, "Projection Example", 1);
    const skillXp = [
      { skillId: SKILL_IDS.mining, totalXp: 500 },
      { skillId: SKILL_IDS.refining, totalXp: 1049 },
      { skillId: SKILL_IDS.fabrication, totalXp: 2000 },
      { skillId: SKILL_IDS.strength, totalXp: 500000 },
    ];
    await db
      .insert(rune.characterSkillXp)
      .values(skillXp.map((row) => ({ characterId: c.id, ...row })));
    const canonical = projectCharacterProgression({
      skillXp,
      levelThresholds: skillLevelThresholds,
      skillDisplayName: (id) => getSkillPresentation(id)?.displayName,
    });
    const overall = await scores.getHighScores({
      board: "overall-level",
      search: c.displayName,
      page: 1,
    });
    expect(overall.entries[0]).toMatchObject({ level: canonical.characterLevel, xp: 3549 });
    for (const skill of scores.highScoreSkills) {
      const board = await scores.getHighScores({
        board: skill.skillId,
        search: c.displayName,
        page: 1,
      });
      const expected = canonical.skills.find((item) => item.displayName === skill.displayName)!;
      expect(board.entries[0]).toMatchObject({ level: expected.level, xp: expected.totalXp });
    }
  });
  it("counts accounts once, expires stale check-ins, and refuses foreign or gated characters", async () => {
    const a = await account("Presence A");
    const b = await account("Presence B");
    const gated = await account("Presence C", false);
    const a1 = await character(a.playerAccountId, "Presence A1", 1);
    const a2 = await character(a.playerAccountId, "Presence A2", 2);
    const b1 = await character(b.playerAccountId, "Presence B1", 1);
    const c1 = await character(gated.playerAccountId, "Presence C1", 1);
    expect(await presence.getPlayersOnline()).toBe(0);
    await Promise.all([
      presence.checkInPlayer(a.userId, a1.id),
      presence.checkInPlayer(a.userId, a2.id),
    ]);
    expect(await presence.getPlayersOnline()).toBe(1);
    await presence.checkInPlayer(b.userId, b1.id);
    expect(await presence.getPlayersOnline()).toBe(2);
    await expect(presence.checkInPlayer(a.userId, b1.id)).rejects.toThrow();
    await withPublicGameplayClosed(db, rune, async () => {
      await expect(presence.checkInPlayer(gated.userId, c1.id)).rejects.toThrow();
    });
    await db
      .update(rune.playerPresence)
      .set({ lastCheckInAt: sql`clock_timestamp() - interval '2 minutes'` })
      .where(eq(rune.playerPresence.playerAccountId, a.playerAccountId));
    expect(await presence.getPlayersOnline()).toBe(1);
    await presence.checkInPlayer(a.userId, a2.id);
    expect(await presence.getPlayersOnline()).toBe(2);
    const response = await route.POST(
      new Request(`http://localhost/api/player-presence?characterId=${a1.id}`, {
        method: "POST",
        headers: { host: "localhost:3000" },
      }),
    );
    expect(response.status).toBe(401);
    const sameOrigin = await route.POST(
      new Request(`http://localhost:3417/api/player-presence?characterId=${a1.id}`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:3417",
          origin: "http://127.0.0.1:3417",
          "sec-fetch-site": "same-origin",
        },
      }),
    );
    expect(sameOrigin.status).toBe(401); // Origin accepted; authentication still required.
    const crossOrigin = await route.POST(
      new Request(`http://localhost:3417/api/player-presence?characterId=${a1.id}`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:3417",
          origin: "http://other.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });
});
