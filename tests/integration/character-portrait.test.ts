import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LOCATION_IDS, PORTRAIT_IDS } from "@/game/config/foundations";
import {
  cleanupTestUser,
  createCharacterForUser,
  createLegacyCharacterForUser,
  createTestUser,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/** Short unique token so fixture names never collide with leftovers. */
const token = () => Math.random().toString(36).slice(2, 8);

/**
 * Issues #65 and #98 acceptance, proven against real PostgreSQL: portrait
 * selection is required at creation and persisted atomically; starters are
 * globally available while player-unlockable IDs require account ownership;
 * legacy null characters stay playable and resolve to the neutral placeholder;
 * ownership scopes every change; selections are per character; changes persist
 * across fresh reads; the public profile projection is safe; and concurrent or
 * retried saves leave one valid final selection without corrupting state.
 */
suite("issue #65 character portrait selection (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let portraitUnlocks: typeof import("@/server/player-portrait-unlocks");
  let profile: typeof import("@/server/character-profile");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    portraitUnlocks = await import("@/server/player-portrait-unlocks");
    profile = await import("@/server/character-profile");
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
    return character;
  }

  it("persists a valid selected portrait atomically with new character creation", async () => {
    const userId = await makeUser("Atomic Owner");
    const account = await ownership.ensurePlayerAccount(userId);
    const character = await characters.createCharacter(
      account.id,
      `Atomic ${token()}`,
      PORTRAIT_IDS.gramma,
    );
    expect(character.portraitId).toBe(PORTRAIT_IDS.gramma);

    const fresh = await db
      .select({ portraitId: rune.characters.portraitId })
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(fresh[0]?.portraitId).toBe(PORTRAIT_IDS.gramma);
  });

  it("refuses new character creation without a portrait", async () => {
    const userId = await makeUser("No Portrait Owner");
    const account = await ownership.ensurePlayerAccount(userId);
    await expect(characters.createCharacter(account.id, `Empty ${token()}`, "")).rejects.toThrow(
      /portrait/i,
    );
  });

  it("refuses unknown, npc-only, and reserved portrait IDs at creation", async () => {
    const userId = await makeUser("Refusal Owner");
    const account = await ownership.ensurePlayerAccount(userId);
    for (const id of [
      "portrait_unknown_01",
      PORTRAIT_IDS.baker, // npc-only
      PORTRAIT_IDS.milkman, // npc-only
      PORTRAIT_IDS.unicornMechanic, // reserved
      "!!!not-a-portrait!!!",
    ]) {
      await expect(
        characters.createCharacter(account.id, `Refused ${token()}`, id),
      ).rejects.toThrow(/portrait/i);
    }
  });

  it("grants Von Scavenger idempotently and rejects non-unlockable portraits", async () => {
    const userId = await makeUser("Unlock Operator Owner");
    const account = await ownership.ensurePlayerAccount(userId);

    const first = await portraitUnlocks.grantPlayerPortraitUnlock(
      account.id,
      PORTRAIT_IDS.vonScavenger,
      "operator",
    );
    const replay = await portraitUnlocks.grantPlayerPortraitUnlock(
      account.id,
      PORTRAIT_IDS.vonScavenger,
      "operator",
    );
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.unlock.unlockedAt).toEqual(first.unlock.unlockedAt);

    const rows = await db
      .select()
      .from(rune.playerPortraitUnlocks)
      .where(eq(rune.playerPortraitUnlocks.playerAccountId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      portraitId: PORTRAIT_IDS.vonScavenger,
      source: "operator",
    });

    for (const portraitId of [PORTRAIT_IDS.baker, PORTRAIT_IDS.unicornMechanic]) {
      await expect(
        portraitUnlocks.grantPlayerPortraitUnlock(account.id, portraitId, "operator"),
      ).rejects.toThrow(/not approved/i);
    }
  });

  it("shares an unlock across character slots while refusing an unentitled player's forged selection", async () => {
    const owner = await makeUser("Shared Unlock Owner");
    const ownerAccount = await ownership.ensurePlayerAccount(owner);
    await portraitUnlocks.grantPlayerPortraitUnlock(
      ownerAccount.id,
      PORTRAIT_IDS.vonScavenger,
      "operator",
    );

    const active = await makeCharacterAt(
      owner,
      `Shared Active ${token()}`,
      LOCATION_IDS.crashSite,
      PORTRAIT_IDS.gramma,
    );
    const ownedVon = await makeCharacterAt(
      owner,
      `Shared Von ${token()}`,
      LOCATION_IDS.crashSite,
      PORTRAIT_IDS.vonScavenger,
    );
    const sibling = await createLegacyCharacterForUser(
      db,
      rune,
      ownership,
      owner,
      `Shared Sibling ${token()}`,
      3,
    );
    await characters.changeCharacterPortrait(owner, sibling.id, PORTRAIT_IDS.vonScavenger);

    const ownedProfile = await profile.getCharacterProfile(owner, active.id, ownedVon.displayName);
    const siblingProfile = await profile.getCharacterProfile(owner, active.id, sibling.displayName);
    expect(ownedProfile.portrait).toMatchObject({
      kind: "selected",
      displayName: "Von Scavenger",
    });
    expect(siblingProfile.portrait).toMatchObject({
      kind: "selected",
      displayName: "Von Scavenger",
    });

    const stranger = await makeUser("Unentitled Portrait Owner");
    const strangerCharacter = await makeCharacterAt(
      stranger,
      `Unentitled ${token()}`,
      LOCATION_IDS.crashSite,
      PORTRAIT_IDS.gramma,
    );
    await expect(
      characters.changeCharacterPortrait(stranger, strangerCharacter.id, PORTRAIT_IDS.vonScavenger),
    ).rejects.toThrow(/not available/i);
    await expect(
      characters.createCharacter(
        (await ownership.ensurePlayerAccount(stranger)).id,
        `Forged Create ${token()}`,
        PORTRAIT_IDS.vonScavenger,
      ),
    ).rejects.toThrow(/portrait/i);
  });

  it("keeps a forged stored unlockable portrait on an unentitled account at the placeholder", async () => {
    const viewer = await makeUser("Presentation Viewer");
    const active = await makeCharacterAt(
      viewer,
      `View Active ${token()}`,
      LOCATION_IDS.crashSite,
      PORTRAIT_IDS.gramma,
    );
    const unentitled = await makeUser("Presentation Unentitled");
    const target = await makeCharacterAt(
      unentitled,
      `View Target ${token()}`,
      LOCATION_IDS.crashSite,
      PORTRAIT_IDS.gramma,
    );
    await db
      .update(rune.characters)
      .set({ portraitId: PORTRAIT_IDS.vonScavenger })
      .where(eq(rune.characters.id, target.id));

    const result = await profile.getCharacterProfile(viewer, active.id, target.displayName);
    expect(result.portrait).toEqual({ kind: "placeholder" });
  });

  it("keeps a legacy null-portrait character readable, playable, and placeholder-resolved", async () => {
    const owner = await makeUser("Legacy Owner");
    const legacyName = `Legacy ${token()}`;
    const legacy = await createLegacyCharacterForUser(db, rune, ownership, owner, legacyName);
    expect(legacy.portraitId).toBeNull();

    // Readable and listed through the normal owned-character surface.
    const account = await ownership.ensurePlayerAccount(owner);
    const listed = await characters.listCharacters(account.id);
    expect(listed.some((character) => character.id === legacy.id)).toBe(true);

    // Playable: the same authoritative gameplay-state load the play screen
    // uses succeeds for a null-portrait character (no portrait gate exists).
    const mining = await import("@/server/mining");
    const gameplayState = await mining.getMiningGameplayState(owner, legacy.id);
    expect(gameplayState.characterId).toBe(legacy.id);

    // The public profile projection resolves the null value to the neutral
    // placeholder and never rewrites the stored row.
    const activeName = `Legacy Active ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    const result = await profile.getCharacterProfile(owner, active.id, legacyName);
    expect(result.portrait).toEqual({ kind: "placeholder" });
    const stored = await db
      .select({ portraitId: rune.characters.portraitId })
      .from(rune.characters)
      .where(eq(rune.characters.id, legacy.id));
    expect(stored[0]?.portraitId).toBeNull();
  });

  it("lets an authenticated owner choose a portrait for a legacy character and change it later", async () => {
    const owner = await makeUser("Choose Owner");
    const legacy = await createLegacyCharacterForUser(
      db,
      rune,
      ownership,
      owner,
      `Choose ${token()}`,
    );

    const first = await characters.changeCharacterPortrait(
      owner,
      legacy.id,
      PORTRAIT_IDS.cargoPilot,
    );
    expect(first.portraitId).toBe(PORTRAIT_IDS.cargoPilot);

    const second = await characters.changeCharacterPortrait(
      owner,
      legacy.id,
      PORTRAIT_IDS.stationCaptain,
    );
    expect(second.portraitId).toBe(PORTRAIT_IDS.stationCaptain);
  });

  it("refuses a portrait change for another user's character and leaves it unchanged", async () => {
    const owner = await makeUser("Victim Owner");
    const stranger = await makeUser("Stranger Owner");
    const victim = await makeCharacterAt(owner, `Victim ${token()}`, LOCATION_IDS.crashSite);
    // The stranger has their own account AND character: the refusal must come
    // from the ownership-scoped update, never from a missing account.
    await makeCharacterAt(stranger, `Stranger ${token()}`, LOCATION_IDS.crashSite);

    await expect(
      characters.changeCharacterPortrait(stranger, victim.id, PORTRAIT_IDS.gramma),
    ).rejects.toThrow(/character not found/i);

    const stored = await db
      .select({ portraitId: rune.characters.portraitId })
      .from(rune.characters)
      .where(eq(rune.characters.id, victim.id));
    expect(stored[0]?.portraitId).toBe(PORTRAIT_IDS.evaSalvageWelder);
  });

  it("changes only the requested character; siblings on the same account keep their selection", async () => {
    const owner = await makeUser("Sibling Owner");
    const first = await makeCharacterAt(
      owner,
      `Sibling One ${token()}`,
      LOCATION_IDS.crashSite,
      PORTRAIT_IDS.grampa,
    );
    const second = await createLegacyCharacterForUser(
      db,
      rune,
      ownership,
      owner,
      `Sibling Two ${token()}`,
      2,
    );

    await characters.changeCharacterPortrait(owner, first.id, PORTRAIT_IDS.zeroGGymnast);

    const rows = await db
      .select({ id: rune.characters.id, portraitId: rune.characters.portraitId })
      .from(rune.characters)
      .where(eq(rune.characters.playerAccountId, first.playerAccountId));
    const byId = new Map(rows.map((row) => [row.id, row.portraitId]));
    expect(byId.get(first.id)).toBe(PORTRAIT_IDS.zeroGGymnast);
    expect(byId.get(second.id)).toBeNull();
  });

  it("persists the selection across fresh reads", async () => {
    const owner = await makeUser("Persist Owner");
    const character = await createLegacyCharacterForUser(
      db,
      rune,
      ownership,
      owner,
      `Persist ${token()}`,
    );
    await characters.changeCharacterPortrait(owner, character.id, PORTRAIT_IDS.frontierMedic);

    const reread = await db
      .select({ portraitId: rune.characters.portraitId })
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(reread[0]?.portraitId).toBe(PORTRAIT_IDS.frontierMedic);
  });

  it("projects the selected portrait safely in the public profile, or the placeholder for null", async () => {
    const owner = await makeUser("Projection Owner");
    const activeName = `Projection Active ${token()}`;
    const chosenName = `Projection Chosen ${token()}`;
    const legacyName = `Projection Legacy ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, chosenName, LOCATION_IDS.crashSite, PORTRAIT_IDS.zeroGRockStar);
    await createLegacyCharacterForUser(db, rune, ownership, owner, legacyName, 3);

    const chosen = await profile.getCharacterProfile(owner, active.id, chosenName);
    expect(chosen.portrait).toMatchObject({
      kind: "selected",
      displayName: "Zero-G Rock Star",
      derivativePath: "/character-portraits/portrait-zero-g-rock-star-01.webp",
      derivativeWidth: 512,
      derivativeHeight: 512,
    });

    const legacy = await profile.getCharacterProfile(owner, active.id, legacyName);
    expect(legacy.portrait).toEqual({ kind: "placeholder" });
  });

  it("never exposes private account data or raw internal values in the public projection", async () => {
    const owner = await makeUser("Private Owner");
    const activeName = `Private Active ${token()}`;
    const targetName = `Private Target ${token()}`;
    const active = await makeCharacterAt(owner, activeName, LOCATION_IDS.crashSite);
    await makeCharacterAt(owner, targetName, LOCATION_IDS.crashSite, PORTRAIT_IDS.gramma);

    const result = await profile.getCharacterProfile(owner, active.id, targetName);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("portraitId");
    expect(serialized).not.toContain("category");
    expect(serialized).not.toContain("masterPath");
    expect(serialized).not.toContain("concept");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("account");
  });

  it("concurrent and retried portrait saves leave one valid final selection without corrupting state", async () => {
    const owner = await makeUser("Concurrent Owner");
    const character = await createLegacyCharacterForUser(
      db,
      rune,
      ownership,
      owner,
      `Concurrent ${token()}`,
    );

    const candidates = [
      PORTRAIT_IDS.gramma,
      PORTRAIT_IDS.grampa,
      PORTRAIT_IDS.cargoPilot,
      PORTRAIT_IDS.orbitalBotanist,
      PORTRAIT_IDS.stationCaptain,
    ];
    // Retried identical saves plus concurrent differing saves: every write is
    // a valid selectable ID, so the converged value must be one of them and
    // the character row must remain intact.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        characters.changeCharacterPortrait(owner, character.id, candidates[index % 5]!),
      ),
    );
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const row = (
      await db.select().from(rune.characters).where(eq(rune.characters.id, character.id))
    )[0]!;
    expect(candidates).toContain(row.portraitId);
    expect(row.displayName).toBe(character.displayName);
    expect(row.slot).toBe(character.slot);
    expect(row.currentLocationId).toBe(character.currentLocationId);
  });
});
