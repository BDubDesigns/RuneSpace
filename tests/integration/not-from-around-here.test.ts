import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issues #369 and #389 — Not From Around Here, against real PostgreSQL.
 *
 * The rules a pure unit test cannot prove: that a carried Rune Fragment offers
 * and accepts the Mission atomically and exactly once under retries and
 * concurrency, without consuming anything; that an absent, stale, foreign,
 * wrong-item or Cargo-Hold-only stack is refused and writes nothing; that an
 * optional hint records one durable idempotent fact only at the place the lead
 * NPC actually stands for THAT character; that Toll's acknowledgement is the
 * only thing that records Toll; and (#389) that the Wise Old Enby offers the
 * same Mission in person only to a visitor carrying a stone, and completes it
 * exactly once at Hilltop Workshop — with or without Toll, with or without the
 * stone — paying, consuming and recording nothing else.
 */
suite("issues #369 and #389 Not From Around Here (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-19T00:00:00.000Z");
  const MISSION = MISSION_IDS.notFromAroundHere;

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

  const random = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  async function makeCharacter(label = "Fragment Tester") {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Frag ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, random());
    return { userId, character };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function giveStack(characterId: string, itemId: string, quantity = 3) {
    const [row] = await db
      .insert(rune.inventoryStacks)
      .values({ characterId, itemId, quantity })
      .returning({ id: rune.inventoryStacks.id });
    return row!.id;
  }

  async function missionRows(characterId: string) {
    return db
      .select()
      .from(rune.characterMissions)
      .where(
        and(
          eq(rune.characterMissions.characterId, characterId),
          eq(rune.characterMissions.missionId, MISSION),
        ),
      );
  }

  async function progress(characterId: string) {
    const rows = await db
      .select()
      .from(rune.characterMissionProgress)
      .where(
        and(
          eq(rune.characterMissionProgress.characterId, characterId),
          eq(rune.characterMissionProgress.missionId, MISSION),
        ),
      );
    return Object.fromEntries(rows.map((row) => [row.progressKey, row.progress]));
  }

  async function snapshot(characterId: string) {
    const [character] = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    const stacks = await db
      .select({ itemId: rune.inventoryStacks.itemId, quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    return {
      credits: character?.credits,
      stacks: stacks.sort((a, b) => a.itemId.localeCompare(b.itemId)),
    };
  }

  const acceptOffer = (userId: string, characterId: string, stackId: string) =>
    missions.acceptItemOfferMission(userId, characterId, MISSION, stackId, now, random());

  const ack = (
    userId: string,
    characterId: string,
    npcId: string,
    dialogueId: string,
    missionId: string = MISSION,
  ) =>
    missions.acknowledgeMissionConversation(
      userId,
      characterId,
      missionId,
      npcId,
      dialogueId,
      now,
      random(),
    );

  const hintWade = (userId: string, characterId: string) =>
    ack(userId, characterId, NPC_IDS.wadeRusk, DIALOGUE_IDS.wadeNotFromAroundHereHint);
  const hintTansy = (userId: string, characterId: string) =>
    ack(userId, characterId, NPC_IDS.tansyRusk, DIALOGUE_IDS.tansyNotFromAroundHereHint);
  const meetToll = (userId: string, characterId: string) =>
    ack(userId, characterId, NPC_IDS.tollKade, DIALOGUE_IDS.tollNotFromAroundHere);

  async function projection(userId: string, characterId: string) {
    const state = await play.getPlayGameplayState(userId, characterId, now, random());
    return state.missions.find((mission) => mission.missionId === MISSION)!;
  }

  async function acceptedCharacter() {
    const made = await makeCharacter();
    const stackId = await giveStack(made.character.id, ITEM_IDS.runeFragment);
    expect((await acceptOffer(made.userId, made.character.id, stackId)).mission.status).toBe(
      "accepted",
    );
    return made;
  }

  describe("accepting from a carried Fragment", () => {
    it("offers the Mission while a Fragment or an intact Runestone is carried", async () => {
      const { userId, character } = await makeCharacter();
      expect((await projection(userId, character.id)).itemOffer).toBeUndefined();
      await giveStack(character.id, ITEM_IDS.ferriteShale);
      expect((await projection(userId, character.id)).itemOffer).toBeUndefined();
      await giveStack(character.id, ITEM_IDS.runestone);
      expect((await projection(userId, character.id)).itemOffer).toEqual({
        itemIds: [ITEM_IDS.runestone],
      });
      await giveStack(character.id, ITEM_IDS.runeFragment);
      expect((await projection(userId, character.id)).itemOffer).toEqual({
        itemIds: [ITEM_IDS.runeFragment, ITEM_IDS.runestone],
      });
    });

    it("accepts through an intact Runestone, consuming neither, and clears the offer from both", async () => {
      const { userId, character } = await makeCharacter();
      const stone = await giveStack(character.id, ITEM_IDS.runestone, 2);
      await giveStack(character.id, ITEM_IDS.runeFragment, 3);
      const before = await snapshot(character.id);
      expect((await acceptOffer(userId, character.id, stone)).mission.status).toBe("accepted");
      expect(await snapshot(character.id)).toEqual(before);
      expect((await missionRows(character.id)).length).toBe(1);
      const projected = await projection(userId, character.id);
      expect(projected.state).toBe("active");
      expect(projected.itemOffer).toBeUndefined();
      expect(projected.guidance?.availableItemIds).toBeUndefined();
      // The other item route now only converges on the same accepted record.
      const fragment = await giveStack(character.id, ITEM_IDS.runeFragment);
      expect((await acceptOffer(userId, character.id, fragment)).mission.status).toBe(
        "already_accepted",
      );
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
    });

    it("accepts atomically, consumes nothing, and pays nothing", async () => {
      const { userId, character } = await makeCharacter();
      const stackId = await giveStack(character.id, ITEM_IDS.runeFragment, 4);
      const before = await snapshot(character.id);

      const result = await acceptOffer(userId, character.id, stackId);
      expect(result.mission.status).toBe("accepted");
      // A free acceptance carries no Credits receipt.
      expect(result.mission).not.toHaveProperty("creditsPaid");

      expect(await snapshot(character.id)).toEqual(before);
      const [row] = await missionRows(character.id);
      expect(row?.acceptedAt).toEqual(now);
      expect(row?.completedAt).toBeNull();
      // Both durable keys exist at zero, so a later extension has stable rows to read.
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });

      const projected = await projection(userId, character.id);
      expect(projected.state).toBe("active");
      expect(projected.itemOffer).toBeUndefined();
      expect(projected.currentObjective).toBe(
        "Find someone who might recognize the unusual fragment",
      );
    });

    it("is idempotent on a retry", async () => {
      const { userId, character } = await makeCharacter();
      const stackId = await giveStack(character.id, ITEM_IDS.runeFragment);
      expect((await acceptOffer(userId, character.id, stackId)).mission.status).toBe("accepted");
      expect((await acceptOffer(userId, character.id, stackId)).mission.status).toBe(
        "already_accepted",
      );
      expect(await missionRows(character.id)).toHaveLength(1);
    });

    it("accepts exactly once under concurrent requests and double-clicks", async () => {
      const { userId, character } = await makeCharacter();
      const stackId = await giveStack(character.id, ITEM_IDS.runeFragment);
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() => acceptOffer(userId, character.id, stackId)),
      );
      expect(results.map((result) => result.mission.status).sort()).toEqual([
        "accepted",
        "already_accepted",
        "already_accepted",
        "already_accepted",
        "already_accepted",
      ]);
      expect(await missionRows(character.id)).toHaveLength(1);
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
    });

    it("refuses an absent or stale stack and writes nothing", async () => {
      const { userId, character } = await makeCharacter();
      const before = await snapshot(character.id);
      const absent = await acceptOffer(
        userId,
        character.id,
        "00000000-0000-4000-8000-000000000000",
      );
      expect(absent.mission).toMatchObject({ status: "refused" });
      // A stack the player inspected and has since spent entirely.
      const stackId = await giveStack(character.id, ITEM_IDS.runeFragment);
      await db.delete(rune.inventoryStacks).where(eq(rune.inventoryStacks.id, stackId));
      const stale = await acceptOffer(userId, character.id, stackId);
      expect(stale.mission).toMatchObject({ status: "refused" });
      expect(await missionRows(character.id)).toHaveLength(0);
      expect(await progress(character.id)).toEqual({});
      expect(await snapshot(character.id)).toEqual(before);
    });

    it("refuses a stack of an item that does not offer it", async () => {
      const { userId, character } = await makeCharacter();
      const stackId = await giveStack(character.id, ITEM_IDS.ferriteShale);
      const refused = await acceptOffer(userId, character.id, stackId);
      expect(refused.mission).toMatchObject({ status: "refused" });
      expect(await missionRows(character.id)).toHaveLength(0);
    });

    it("refuses another character's Fragment", async () => {
      const owner = await makeCharacter("Owner");
      const thief = await makeCharacter("Thief");
      const foreignStack = await giveStack(owner.character.id, ITEM_IDS.runeFragment);
      const refused = await acceptOffer(thief.userId, thief.character.id, foreignStack);
      expect(refused.mission).toMatchObject({ status: "refused" });
      expect(await missionRows(thief.character.id)).toHaveLength(0);
      expect(await missionRows(owner.character.id)).toHaveLength(0);
    });

    it("refuses a Fragment that is only in the Cargo Hold", async () => {
      const { userId, character } = await makeCharacter();
      const [stored] = await db
        .insert(rune.cargoHoldStacks)
        .values({ characterId: character.id, itemId: ITEM_IDS.runeFragment, quantity: 2 })
        .returning({ id: rune.cargoHoldStacks.id });
      const refused = await acceptOffer(userId, character.id, stored!.id);
      expect(refused.mission).toMatchObject({ status: "refused" });
      expect(await missionRows(character.id)).toHaveLength(0);
      // Nor does the projection offer it: the offer comes from a carried stack.
      expect((await projection(userId, character.id)).itemOffer).toBeUndefined();
    });

    it("cannot be accepted through Toll, and the item route accepts no other Mission", async () => {
      const { userId, character } = await makeCharacter();
      const fragment = await giveStack(character.id, ITEM_IDS.runeFragment);
      const viaNpc = await missions.acceptMission(
        userId,
        character.id,
        MISSION,
        NPC_IDS.tollKade,
        now,
        random(),
      );
      expect(viaNpc.mission).toMatchObject({ status: "refused" });
      const otherMission = await missions.acceptItemOfferMission(
        userId,
        character.id,
        MISSION_IDS.walkItOff,
        fragment,
        now,
        random(),
      );
      expect(otherMission.mission).toMatchObject({ status: "refused" });
      expect(await missionRows(character.id)).toHaveLength(0);
    });

    it("keeps the Mission after the Fragments are used up, and never re-offers it", async () => {
      const { userId, character } = await acceptedCharacter();
      await db
        .delete(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id));
      const projected = await projection(userId, character.id);
      expect(projected.state).toBe("active");
      expect(projected.itemOffer).toBeUndefined();
      await giveStack(character.id, ITEM_IDS.runeFragment);
      expect((await projection(userId, character.id)).itemOffer).toBeUndefined();
    });
  });

  describe("the optional hints", () => {
    it("refuses a hint before the Mission is accepted and writes nothing", async () => {
      const { userId, character } = await makeCharacter();
      const refused = await hintWade(userId, character.id);
      expect(refused.mission.status).toBe("refused");
      expect(await progress(character.id)).toEqual({});
    });

    it("records one durable fact when Wade is spoken to, and narrows guidance to Toll", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.crashSite);
      const before = await projection(userId, character.id);
      expect(before.guidance?.candidates).toHaveLength(3);

      expect((await hintWade(userId, character.id)).mission.status).toBe("acknowledged");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 1 });

      const after = await projection(userId, character.id);
      expect(after.state).toBe("active");
      expect(after.currentObjective).toBe(
        "Ask Tolliver Kade at Last Leg Trading about the fragment",
      );
      expect(after.guidance).toEqual({
        npcId: NPC_IDS.tollKade,
        locationId: LOCATION_IDS.holoHollowLanding,
      });
      expect(after.requirements![0]!.satisfied).toBe(false);
    });

    it("converges: a replay, a concurrent request, or the other lead add nothing", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.crashSite);
      const results = await Promise.all([
        hintWade(userId, character.id),
        hintWade(userId, character.id),
        hintWade(userId, character.id),
      ]);
      expect(results.map((result) => result.mission.status).sort()).toEqual([
        "acknowledged",
        "already_acknowledged",
        "already_acknowledged",
      ]);
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 1 });

      // Tansy's scene converges on the same single fact.
      await move(character.id, LOCATION_IDS.theJag);
      expect((await hintTansy(userId, character.id)).mission.status).toBe("already_acknowledged");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 1 });
    });

    it("works through Tansy alone, at The Jag", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.theJag);
      expect((await hintTansy(userId, character.id)).mission.status).toBe("acknowledged");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 1 });
    });

    it("needs the person in front of the player: the wrong place records nothing", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.holoHollowLanding);
      const refused = await hintWade(userId, character.id);
      expect(refused.mission.status).toBe("refused");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
    });

    it("follows Wade's and Tansy's relocations for this character only", async () => {
      const { userId, character } = await acceptedCharacter();
      await db.insert(rune.characterMissions).values(
        [MISSION_IDS.keepTheChange, MISSION_IDS.tenThousandHours].map((missionId) => ({
          characterId: character.id,
          missionId,
          acceptedAt: now,
          completedAt: now,
        })),
      );
      // Both now stand in Wade's yard, so the old places no longer count.
      await move(character.id, LOCATION_IDS.crashSite);
      expect((await hintWade(userId, character.id)).mission.status).toBe("refused");
      await move(character.id, LOCATION_IDS.theJag);
      expect((await hintTansy(userId, character.id)).mission.status).toBe("refused");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });

      await move(character.id, LOCATION_IDS.ruskRecovery);
      expect((await hintTansy(userId, character.id)).mission.status).toBe("acknowledged");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 1 });

      // A different character who has done none of that story is unaffected.
      const other = await acceptedCharacter();
      await move(other.character.id, LOCATION_IDS.theJag);
      expect((await hintTansy(other.userId, other.character.id)).mission.status).toBe(
        "acknowledged",
      );
    });

    it("rejects an unauthored NPC or scene claim", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.crashSite);
      // Wade claiming Tansy's scene, and Wade claiming Toll's.
      expect(
        (await ack(userId, character.id, NPC_IDS.wadeRusk, DIALOGUE_IDS.tansyNotFromAroundHereHint))
          .mission.status,
      ).toBe("refused");
      expect(
        (await ack(userId, character.id, NPC_IDS.wadeRusk, DIALOGUE_IDS.tollNotFromAroundHere))
          .mission.status,
      ).toBe("refused");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
    });
  });

  describe("Toll, on Skatboll", () => {
    it("advances the Mission directly, with no hint, before Thrust Issues or Trade", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.holoHollowLanding);
      expect((await meetToll(userId, character.id)).mission.status).toBe("acknowledged");
      expect(await progress(character.id)).toEqual({ "toll-lead": 1, "toll-hint": 0 });
    });

    it("refuses Toll anywhere but the Landing, and records nothing", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.holoHollow);
      expect((await meetToll(userId, character.id)).mission.status).toBe("refused");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
    });

    it("is idempotent and converges under concurrency", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.holoHollowLanding);
      const results = await Promise.all([1, 2, 3, 4].map(() => meetToll(userId, character.id)));
      expect(results.filter((result) => result.mission.status === "acknowledged")).toHaveLength(1);
      expect(
        results.filter((result) => result.mission.status === "already_acknowledged"),
      ).toHaveLength(3);
      expect(await progress(character.id)).toEqual({ "toll-lead": 1, "toll-hint": 0 });
    });

    it("points the same Active Mission at the Enby on Stillreach, completable only there", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.holoHollowLanding);
      const before = await snapshot(character.id);
      await meetToll(userId, character.id);

      const projected = await projection(userId, character.id);
      expect(projected.state).toBe("active");
      expect(projected.currentObjective).toBe(
        "Find the researcher at Hilltop Workshop on Stillreach",
      );
      expect(projected.stage?.turnInAvailable).toBe(false);
      // The only target is off this planet's map: no Skatboll pin at all.
      expect(projected.guidance).toEqual({
        npcId: NPC_IDS.wiseOldEnby,
        locationId: LOCATION_IDS.hilltopWorkshop,
        turnIn: true,
      });
      expect(projected.completedAt).toBeUndefined();

      // Toll is not the turn-in, and the Enby cannot be reached from the Landing.
      for (const npcId of [NPC_IDS.tollKade, NPC_IDS.wiseOldEnby]) {
        const forged = await missions.completeMission(
          userId,
          character.id,
          MISSION,
          npcId,
          now,
          random(),
        );
        expect(forged.mission).toMatchObject({ status: "refused" });
      }
      const [row] = await missionRows(character.id);
      expect(row?.completedAt).toBeNull();
      // No Credits, XP or item for the hint, the lead, or the attempt to finish.
      expect(await snapshot(character.id)).toEqual(before);
    });

    it("is the same after a reload or a fresh login", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.crashSite);
      await hintWade(userId, character.id);
      await move(character.id, LOCATION_IDS.holoHollowLanding);
      await meetToll(userId, character.id);
      const first = await projection(userId, character.id);
      const reloaded = await projection(userId, character.id);
      expect(reloaded).toEqual(first);
      expect(await progress(character.id)).toEqual({ "toll-lead": 1, "toll-hint": 1 });
    });

    it("ignores a hint once Toll has been met", async () => {
      const { userId, character } = await acceptedCharacter();
      await move(character.id, LOCATION_IDS.holoHollowLanding);
      await meetToll(userId, character.id);
      await move(character.id, LOCATION_IDS.crashSite);
      expect((await hintWade(userId, character.id)).mission.status).toBe("already_acknowledged");
      expect(await progress(character.id)).toEqual({ "toll-lead": 1, "toll-hint": 0 });
    });
  });

  describe("the Wise Old Enby at Hilltop Workshop (#389)", () => {
    const enby = NPC_IDS.wiseOldEnby;
    const acceptAtEnby = (userId: string, characterId: string) =>
      missions.acceptMission(userId, characterId, MISSION, enby, now, random());
    const finish = (userId: string, characterId: string) =>
      missions.completeMission(userId, characterId, MISSION, enby, now, random());

    async function skillXp(characterId: string) {
      const rows = await db
        .select({ skillId: rune.characterSkillXp.skillId, xp: rune.characterSkillXp.totalXp })
        .from(rune.characterSkillXp)
        .where(eq(rune.characterSkillXp.characterId, characterId));
      return rows.sort((a, b) => a.skillId.localeCompare(b.skillId));
    }

    /** Completes at the Enby and proves it was exactly that, and nothing else. */
    async function completesCleanly(userId: string, characterId: string) {
      const progressBefore = await progress(characterId);
      const before = await snapshot(characterId);
      const xpBefore = await skillXp(characterId);
      const ready = await projection(userId, characterId);
      expect(ready.state).toBe("ready_for_completion");
      expect(ready.requirements).toEqual([]);

      const result = await finish(userId, characterId);
      // Nothing paid; its continuation (the lesson) is accepted, which grants nothing.
      expect(result.mission).toEqual({
        status: "completed",
        continuation: { missionId: MISSION_IDS.firstRuneworkingLesson, status: "accepted" },
      });
      const [row] = await missionRows(characterId);
      expect(row?.completedAt).toEqual(now);
      // Nothing paid, granted, consumed or recorded beyond the completion stamp.
      expect(await snapshot(characterId)).toEqual(before);
      expect(await skillXp(characterId)).toEqual(xpBefore);
      expect(await progress(characterId)).toEqual(progressBefore);

      const done = await projection(userId, characterId);
      expect(done.state).toBe("completed");
      expect(done.earnedReward).toBeUndefined();
      expect(done.guidance).toBeUndefined();
      expect(done.itemOffer).toBeUndefined();
      // A refresh or a fresh login reads the same durable completion.
      expect(await projection(userId, characterId)).toEqual(done);
      expect((await finish(userId, characterId)).mission.status).toBe("already_completed");
    }

    describe("offering it in person", () => {
      it("accepts the same Mission from a carried Fragment, consuming nothing", async () => {
        const { userId, character } = await makeCharacter();
        await giveStack(character.id, ITEM_IDS.runeFragment, 2);
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        const before = await snapshot(character.id);
        const result = await acceptAtEnby(userId, character.id);
        expect(result.mission).toEqual({ status: "accepted" });
        expect(await snapshot(character.id)).toEqual(before);
        expect(await missionRows(character.id)).toHaveLength(1);
        expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
        // The same hub now offers the revelation: no Inventory, Toll or walk needed.
        const projected = await projection(userId, character.id);
        expect(projected.state).toBe("ready_for_completion");
        expect(projected.itemOffer).toBeUndefined();
      });

      it("accepts from an intact Runestone too", async () => {
        const { userId, character } = await makeCharacter();
        await giveStack(character.id, ITEM_IDS.runestone, 1);
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        expect((await acceptAtEnby(userId, character.id)).mission.status).toBe("accepted");
      });

      it("refuses a visitor with no carried stone, writing nothing", async () => {
        const { userId, character } = await makeCharacter();
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        await giveStack(character.id, ITEM_IDS.ferriteShale);
        await db
          .insert(rune.cargoHoldStacks)
          .values({ characterId: character.id, itemId: ITEM_IDS.runeFragment, quantity: 2 });
        const other = await makeCharacter("Other");
        await giveStack(other.character.id, ITEM_IDS.runestone);
        const refused = await acceptAtEnby(userId, character.id);
        expect(refused.mission).toMatchObject({ status: "refused" });
        expect(await missionRows(character.id)).toHaveLength(0);
        expect(await progress(character.id)).toEqual({});
      });

      it("refuses anywhere but the hill", async () => {
        const { userId, character } = await makeCharacter();
        await giveStack(character.id, ITEM_IDS.runeFragment);
        for (const locationId of [LOCATION_IDS.windwardTrack, LOCATION_IDS.holoHollowLanding]) {
          await move(character.id, locationId);
          expect((await acceptAtEnby(userId, character.id)).mission.status).toBe("refused");
        }
        expect(await missionRows(character.id)).toHaveLength(0);
      });

      it("accepts exactly once under concurrent requests, and never after", async () => {
        const { userId, character } = await makeCharacter();
        await giveStack(character.id, ITEM_IDS.runeFragment);
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        const results = await Promise.all(
          [1, 2, 3, 4].map(() => acceptAtEnby(userId, character.id)),
        );
        expect(results.map((result) => result.mission.status).sort()).toEqual([
          "accepted",
          "already_accepted",
          "already_accepted",
          "already_accepted",
        ]);
        expect(await missionRows(character.id)).toHaveLength(1);
        await completesCleanly(userId, character.id);
        expect((await acceptAtEnby(userId, character.id)).mission.status).toBe("already_completed");
      });
    });

    describe("finishing it at the Enby", () => {
      it("(i) accepted on Skatboll with no hint and no Toll", async () => {
        const { userId, character } = await acceptedCharacter();
        await move(character.id, LOCATION_IDS.stillreachLandingStation);
        const away = await projection(userId, character.id);
        expect(away.currentObjective).toBe("Find the researcher at Hilltop Workshop on Stillreach");
        expect(away.guidance).toEqual({
          npcId: NPC_IDS.wiseOldEnby,
          locationId: LOCATION_IDS.hilltopWorkshop,
          turnIn: true,
        });
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        await completesCleanly(userId, character.id);
        // Toll's fact was never recorded by the direct route.
        expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
      });

      it("(ii) after a Wade hint, without Toll", async () => {
        const { userId, character } = await acceptedCharacter();
        await move(character.id, LOCATION_IDS.crashSite);
        await hintWade(userId, character.id);
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        await completesCleanly(userId, character.id);
        expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 1 });
      });

      it("(iii) after Toll, opening with Toll", async () => {
        const { userId, character } = await acceptedCharacter();
        await move(character.id, LOCATION_IDS.holoHollowLanding);
        await meetToll(userId, character.id);
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        expect((await projection(userId, character.id)).facts).toEqual(["toll-sent"]);
        await completesCleanly(userId, character.id);
        expect(await progress(character.id)).toEqual({ "toll-lead": 1, "toll-hint": 0 });
      });

      it("(iv, v) accepted in person with either stone", async () => {
        for (const itemId of [ITEM_IDS.runeFragment, ITEM_IDS.runestone]) {
          const { userId, character } = await makeCharacter();
          await giveStack(character.id, itemId);
          await move(character.id, LOCATION_IDS.hilltopWorkshop);
          await acceptAtEnby(userId, character.id);
          await completesCleanly(userId, character.id);
        }
      });

      it("(vi) after the stone was sold, used or put in the Cargo Hold", async () => {
        const { userId, character } = await acceptedCharacter();
        await db
          .delete(rune.inventoryStacks)
          .where(eq(rune.inventoryStacks.characterId, character.id));
        await db
          .insert(rune.cargoHoldStacks)
          .values({ characterId: character.id, itemId: ITEM_IDS.runestone, quantity: 1 });
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        await completesCleanly(userId, character.id);
      });

      it("(vii) an old save parked at the end of Toll's lead upgrades in place", async () => {
        // Exactly the rows a pre-#389 character holds: accepted, both facts set.
        const { userId, character } = await makeCharacter();
        await db
          .insert(rune.characterMissions)
          .values({ characterId: character.id, missionId: MISSION, acceptedAt: now });
        await db.insert(rune.characterMissionProgress).values(
          ["toll-lead", "toll-hint"].map((progressKey) => ({
            characterId: character.id,
            missionId: MISSION,
            progressKey,
            progress: 1,
            updatedAt: now,
          })),
        );
        await move(character.id, LOCATION_IDS.holoHollowLanding);
        expect((await projection(userId, character.id)).currentObjective).toBe(
          "Find the researcher at Hilltop Workshop on Stillreach",
        );
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        await completesCleanly(userId, character.id);
        expect(await progress(character.id)).toEqual({ "toll-lead": 1, "toll-hint": 1 });
      });

      it("completes exactly once under concurrent clicks and clients", async () => {
        const { userId, character } = await acceptedCharacter();
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        const before = await snapshot(character.id);
        const results = await Promise.all([1, 2, 3, 4, 5].map(() => finish(userId, character.id)));
        expect(results.map((result) => result.mission.status).sort()).toEqual([
          "already_completed",
          "already_completed",
          "already_completed",
          "already_completed",
          "completed",
        ]);
        expect(await missionRows(character.id)).toHaveLength(1);
        expect(await snapshot(character.id)).toEqual(before);
      });

      it("is never finished from elsewhere on Stillreach, by someone else, or unaccepted", async () => {
        const { userId, character } = await acceptedCharacter();
        await move(character.id, LOCATION_IDS.windwardTrack);
        expect((await finish(userId, character.id)).mission).toMatchObject({
          status: "refused",
          reason: "not_stationary",
        });
        await move(character.id, LOCATION_IDS.hilltopWorkshop);
        const wrongNpc = await missions.completeMission(
          userId,
          character.id,
          MISSION,
          NPC_IDS.tollKade,
          now,
          random(),
        );
        expect(wrongNpc.mission).toMatchObject({ status: "refused", reason: "wrong_npc" });
        const [row] = await missionRows(character.id);
        expect(row?.completedAt).toBeNull();

        const stranger = await makeCharacter("Stranger");
        await move(stranger.character.id, LOCATION_IDS.hilltopWorkshop);
        expect((await finish(stranger.userId, stranger.character.id)).mission).toMatchObject({
          status: "refused",
          reason: "not_accepted",
        });
        expect(await missionRows(stranger.character.id)).toHaveLength(0);
      });
    });

    it("never records Toll by travelling, standing at the hill, or claiming his scene there", async () => {
      const { userId, character } = await acceptedCharacter();
      for (const locationId of [
        LOCATION_IDS.stillreachLandingStation,
        LOCATION_IDS.hilltopWorkshop,
        LOCATION_IDS.crashSite,
      ]) {
        await move(character.id, locationId);
        await projection(userId, character.id);
      }
      await move(character.id, LOCATION_IDS.hilltopWorkshop);
      expect((await meetToll(userId, character.id)).mission.status).toBe("refused");
      expect(await progress(character.id)).toEqual({ "toll-lead": 0, "toll-hint": 0 });
      // Back on Skatboll, the investigation is exactly where it was.
      await move(character.id, LOCATION_IDS.holoHollow);
      const back = await projection(userId, character.id);
      expect(back.currentObjective).toBe("Find someone who might recognize the unusual fragment");
      expect(back.guidance?.candidates).toHaveLength(3);
    });
  });
});
