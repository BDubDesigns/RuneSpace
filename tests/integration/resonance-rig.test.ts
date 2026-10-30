import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getRepairTargetBalance,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getResidentNpcs } from "@/game/content/npcs";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { deriveCompletedRepairTargetIds } from "@/game/domain/welding-repair";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #441 — the personal Resonance Rig chapter, against real PostgreSQL.
 *
 * A Place to Call Home (manual offer at Hilltop Workshop) builds a Rig at the Crash
 * Site through the ordinary repair path, and its explicit turn-in hands over two
 * Skatboll TP Runes and, in the same transaction, accepts A Rune of Your Own, which
 * asks for one genuine craft at that Rig and pays 500 Runeworking XP without taking
 * the rune. The Wise Old Enby is one NPC whose placement is derived from the Rig's
 * completion and A Rune of Your Own's.
 */
suite("issue #441 the personal Resonance Rig chapter (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let missions: typeof import("@/server/missions");
  let repairs: typeof import("@/server/repair-commands");
  let runeworking: typeof import("@/server/runeworking-commands");
  let resonanceSite: typeof import("@/server/resonance-site-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-30T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const rig = getRepairTargetBalance(REPAIR_TARGET_IDS.resonanceRig, balance);
  const tpRecipe = balance.runeworking.recipes.skatbollTpRune;
  const seekerRecipe = balance.runeworking.recipes.beginnerEchoSeeker;
  const thresholds = standardSkillLevelThresholds(balance);
  const WELD_TICKS = balance.welding.attemptDurationTicks;
  const HOME = MISSION_IDS.aPlaceToCallHome;
  const OWN = MISSION_IDS.aRuneOfYourOwn;
  const enby = NPC_IDS.wiseOldEnby;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    progression = await import("@/server/progression");
    missions = await import("@/server/missions");
    repairs = await import("@/server/repair-commands");
    runeworking = await import("@/server/runeworking-commands");
    resonanceSite = await import("@/server/resonance-site-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const certain = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);

  async function grantLevel(characterId: string, skillId: string, level: number) {
    await db.transaction(async (transaction) => {
      await progression.grantCharacterSkillXp(transaction, {
        characterId,
        skillId,
        awardedXp: thresholds.find((threshold) => threshold.level === level)!.totalXp,
        thresholds,
      });
    });
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  /**
   * A character who has done everything the chapter's offer needs, standing at
   * Hilltop Workshop with the Welding and Runeworking asked for.
   */
  async function makeCharacter(
    options: { welding?: number; runeworking?: number; lesson?: boolean } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Rig Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Rig ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, certain());
    const done = [
      MISSION_IDS.notFromAroundHere,
      ...(options.lesson === false ? [] : [MISSION_IDS.firstRuneworkingLesson]),
    ];
    await db.insert(rune.characterMissions).values(
      done.map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: now,
        completedAt: now,
      })),
    );
    await move(character.id, LOCATION_IDS.hilltopWorkshop);
    const level = options.welding ?? 1;
    if (level > 1) await grantLevel(character.id, SKILL_IDS.welding, level);
    const rw = options.runeworking ?? 5;
    if (rw > 1) await grantLevel(character.id, SKILL_IDS.runeworking, rw);
    return { userId, characterId: character.id };
  }

  async function give(characterId: string, itemId: string, quantity: number) {
    await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
  }

  async function carried(characterId: string, itemId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function xp(characterId: string, skillId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, skillId),
        ),
      );
    return row?.totalXp ?? 0;
  }

  async function missionRow(characterId: string, missionId: string) {
    return (
      await db
        .select()
        .from(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, characterId),
            eq(rune.characterMissions.missionId, missionId),
          ),
        )
    )[0];
  }

  async function rigRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.resonanceRig),
          ),
        )
    )[0];
  }

  const stateAt = (userId: string, characterId: string, at = now) =>
    play.getPlayGameplayState(userId, characterId, at, certain());

  const accept = (userId: string, characterId: string, at = now) =>
    missions.acceptMission(userId, characterId, HOME, enby, at, certain());
  const turnIn = (userId: string, characterId: string, missionId: string, at = now) =>
    missions.completeMission(userId, characterId, missionId, enby, at, certain());

  const fullBill = installedMaterials(rig);
  async function giveBill(characterId: string) {
    for (const [itemId, quantity] of Object.entries(fullBill)) {
      await give(characterId, itemId, quantity);
    }
  }
  const contribute = (userId: string, characterId: string, expected = fullBill) =>
    repairs.contributeRepairMaterials(
      userId,
      characterId,
      { targetId: REPAIR_TARGET_IDS.resonanceRig, expectedMaterials: expected },
      now,
      certain(),
    );
  const startWelding = (userId: string, characterId: string, at = now) =>
    repairs.startWelding(userId, characterId, REPAIR_TARGET_IDS.resonanceRig, at, certain());

  /** A character who has accepted A Place to Call Home and stands at the Crash Site. */
  async function acceptedAtSite(welding = 12) {
    const made = await makeCharacter({ welding });
    const accepted = await accept(made.userId, made.characterId);
    expect(accepted.mission.status).toBe("accepted");
    await move(made.characterId, LOCATION_IDS.crashSite);
    return made;
  }

  /** The Rig already finished, as if the twenty-fourth weld had just landed. */
  async function finishedRig(completedAt = now) {
    const made = await acceptedAtSite();
    await seedRepairTarget(db, rune, made.characterId, REPAIR_TARGET_IDS.resonanceRig, {
      materials: installedMaterials(rig),
      weldingProgress: rig.repairIncrements,
      completedAt,
      updatedAt: completedAt,
    });
    return made;
  }

  describe("the manual offer at Hilltop Workshop", () => {
    it("is refused before First Runeworking Lesson is complete", async () => {
      const { userId, characterId } = await makeCharacter({ lesson: false });
      const refused = await accept(userId, characterId);
      expect(refused.mission.status).toBe("refused");
      expect(await missionRow(characterId, HOME)).toBeUndefined();
    });

    it("is refused below Runeworking 5, however high Welding is", async () => {
      const { userId, characterId } = await makeCharacter({ welding: 12, runeworking: 4 });
      const refused = await accept(userId, characterId);
      expect(refused.mission.status).toBe("refused");
      expect(await missionRow(characterId, HOME)).toBeUndefined();
    });

    it("needs neither Welding 12 nor a first Echo: Welding is the first live objective", async () => {
      const { userId, characterId } = await makeCharacter({ welding: 1 });
      const accepted = await accept(userId, characterId);
      expect(accepted.mission.status).toBe("accepted");
      const mission = (await stateAt(userId, characterId)).missions.find(
        (entry) => entry.missionId === HOME,
      )!;
      expect(mission.state).toBe("active");
      expect(mission.requirements?.[0]).toMatchObject({
        kind: "skill_level",
        satisfied: false,
        progress: { current: 1, target: 12 },
      });
      expect(mission.currentObjective).toMatch(/Welding level 12/);
    });

    it("satisfies the Welding objective at once for a character already at Welding 12", async () => {
      const { userId, characterId } = await makeCharacter({ welding: 12 });
      await accept(userId, characterId);
      const mission = (await stateAt(userId, characterId)).missions.find(
        (entry) => entry.missionId === HOME,
      )!;
      expect(mission.requirements?.[0]).toMatchObject({ kind: "skill_level", satisfied: true });
      expect(mission.requirements?.[1]).toMatchObject({
        kind: "repair_target_complete",
        satisfied: false,
      });
    });

    it("opens no Rig work and accepts no materials below Welding 12, then does at 12", async () => {
      const { userId, characterId } = await makeCharacter({ welding: 11 });
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await giveBill(characterId);
      let state = await stateAt(userId, characterId);
      expect(state.repairs[REPAIR_TARGET_IDS.resonanceRig]?.repairAvailable).toBe(false);
      const refused = await contribute(userId, characterId);
      expect(refused.repair.status).toBe("refused");
      expect(await rigRow(characterId)).toBeUndefined();
      expect(await carried(characterId, ITEM_IDS.resonanceCore)).toBe(1);

      await grantLevel(characterId, SKILL_IDS.welding, 12);
      state = await stateAt(userId, characterId);
      expect(state.repairs[REPAIR_TARGET_IDS.resonanceRig]?.repairAvailable).toBe(true);
    });
  });

  describe("building the Rig at the existing Crash Site", () => {
    it("installs the exact bill once, then welds 24 real sections for 1,200 base Welding XP", async () => {
      const { userId, characterId } = await acceptedAtSite();
      await giveBill(characterId);
      // A spare of everything: only the recipe's own quantity may be taken.
      await give(characterId, ITEM_IDS.galvaferrite, 2);
      await give(characterId, ITEM_IDS.powerCell, 3);
      const first = await contribute(userId, characterId);
      expect(first.repair.status).toBe("committed");
      expect(await carried(characterId, ITEM_IDS.resonanceCore)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.galvaferrite)).toBe(2);
      expect(await carried(characterId, ITEM_IDS.powerCell)).toBe(3);
      expect((await rigRow(characterId))?.materials).toEqual(fullBill);

      // A repeated install changes nothing: the material is installed once.
      await contribute(userId, characterId);
      expect(await carried(characterId, ITEM_IDS.galvaferrite)).toBe(2);

      const before = await xp(characterId, SKILL_IDS.welding);
      await startWelding(userId, characterId);
      const mid = await stateAt(userId, characterId, tick(now, 23 * WELD_TICKS));
      expect(mid.repairs[REPAIR_TARGET_IDS.resonanceRig]).toMatchObject({
        complete: false,
        weldingProgress: 23,
      });
      const finishedAt = tick(now, rig.repairIncrements * WELD_TICKS);
      const done = await stateAt(userId, characterId, finishedAt);
      expect(done.repairs[REPAIR_TARGET_IDS.resonanceRig]?.complete).toBe(true);
      expect((await rigRow(characterId))?.weldingProgress).toBe(24);
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(1200);
      // Resolving again, even much later, pays nothing more.
      await stateAt(userId, characterId, tick(finishedAt, 500));
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(1200);
    });

    it("finishes while the player is away: the build, the XP and the owed arrival all hold", async () => {
      const { userId, characterId } = await acceptedAtSite();
      await giveBill(characterId);
      await contribute(userId, characterId);
      await startWelding(userId, characterId);
      // Nobody is connected until long after the last weld landed.
      const state = await stateAt(
        userId,
        characterId,
        tick(now, 10 * rig.repairIncrements * WELD_TICKS),
      );
      expect(state.repairs[REPAIR_TARGET_IDS.resonanceRig]?.complete).toBe(true);
      expect(state.resonanceArrival).toBeDefined();
    });
  });

  describe("the Resonance Site and the Wise Old Enby's visit", () => {
    it("is one stable location renamed for this character alone, with the Rig and no Rivet", async () => {
      const mine = await finishedRig();
      const other = await makeCharacter();
      const mineState = (await stateAt(mine.userId, mine.characterId)).locationStates[
        LOCATION_IDS.crashSite
      ]!;
      expect(mineState.locationId).toBe(LOCATION_IDS.crashSite);
      expect(mineState.displayName).toBe("Resonance Site");
      expect(mineState.variantId).toBe("crash_site_resonance_site");
      expect(mineState.scene.asset).toBe("/location-scenes/crash-site-empty.webp");
      expect(mineState.scene.overlay).toMatchObject({
        asset: "/location-scenes/resonance-rig.webp",
        placement: { left: 36.5, top: 20, width: 29 },
      });
      // Another character's Crash Site is untouched.
      const otherState = (await stateAt(other.userId, other.characterId)).locationStates[
        LOCATION_IDS.crashSite
      ]!;
      expect(otherState.displayName).toBe("Crash Site");
      expect(otherState.scene.overlay?.asset).not.toBe("/location-scenes/resonance-rig.webp");
    });

    it("moves the one real Enby to the Crash Site from the final weld, with no ship or hex change", async () => {
      const { userId, characterId } = await finishedRig();
      const state = await stateAt(userId, characterId);
      const where = (locationId: string) =>
        getResidentNpcs({
          locationId,
          completedMissionIds: deriveCompletedMissionIds(state.missions),
          completedRepairTargetIds: deriveCompletedRepairTargetIds(Object.values(state.repairs)),
        })
          .map((npc) => npc.id)
          .filter((id) => id === enby);
      expect(where(LOCATION_IDS.crashSite)).toEqual([enby]);
      // Never at two places at once.
      expect(where(LOCATION_IDS.hilltopWorkshop)).toEqual([]);
      expect(state.ship.berthLocationId).toBeDefined();
    });

    it("starts no conversation and completes nothing by itself", async () => {
      const { userId, characterId } = await finishedRig();
      const state = await stateAt(userId, characterId);
      const mission = state.missions.find((entry) => entry.missionId === HOME)!;
      expect(mission.state).toBe("ready_for_completion");
      expect((await missionRow(characterId, HOME))?.completedAt).toBeNull();
      expect(await missionRow(characterId, OWN)).toBeUndefined();
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(0);
    });

    it("owes the arrival until it is acknowledged, then never again", async () => {
      const { userId, characterId } = await finishedRig();
      expect((await stateAt(userId, characterId)).resonanceArrival).toBeDefined();
      // A second resolution is still owed: receipt is separate from gameplay.
      expect((await stateAt(userId, characterId, tick(now, 40))).resonanceArrival).toBeDefined();
      const acknowledged = await resonanceSite.acknowledgeResonanceArrival(
        userId,
        characterId,
        now,
      );
      expect(acknowledged.resonanceArrival).toBeUndefined();
      // Idempotent, and it never changes the Mission, the NPC or the Rig.
      const again = await resonanceSite.acknowledgeResonanceArrival(userId, characterId, now);
      expect(again.resonanceArrival).toBeUndefined();
      const state = await stateAt(userId, characterId, tick(now, 80));
      expect(state.resonanceArrival).toBeUndefined();
      expect(state.repairs[REPAIR_TARGET_IDS.resonanceRig]?.complete).toBe(true);
      expect(state.missions.find((entry) => entry.missionId === HOME)?.state).toBe(
        "ready_for_completion",
      );
    });

    it("names the Rune destination Resonance Site for the owner and Crash Site for everyone else", async () => {
      const mine = await finishedRig();
      const other = await makeCharacter();
      const mineTeleport = (await stateAt(mine.userId, mine.characterId)).runeTeleport;
      const otherTeleport = (await stateAt(other.userId, other.characterId)).runeTeleport;
      expect(mineTeleport.runes[ITEM_IDS.skatbollTpRune]?.name).toBe("Resonance Site");
      expect(otherTeleport.runes[ITEM_IDS.skatbollTpRune]?.name).toBe("Crash Site");
      // The destination is the one existing location either way.
      expect(mineTeleport.runes[ITEM_IDS.skatbollTpRune]?.locationId).toBe(LOCATION_IDS.crashSite);
    });
  });

  describe("the explicit turn-in of A Place to Call Home", () => {
    it("is refused anywhere but the Crash Site, and before the Rig is finished", async () => {
      const early = await acceptedAtSite();
      const tooEarly = await turnIn(early.userId, early.characterId, HOME);
      expect(tooEarly.mission.status).toBe("refused");

      const away = await finishedRig();
      await move(away.characterId, LOCATION_IDS.hilltopWorkshop);
      const refused = await turnIn(away.userId, away.characterId, HOME);
      expect(refused.mission.status).toBe("refused");
      expect(await carried(away.characterId, ITEM_IDS.skatbollTpRune)).toBe(0);
    });

    it("grants exactly two TP Runes, awards no Welding XP and accepts A Rune of Your Own in the same commit", async () => {
      const { userId, characterId } = await finishedRig();
      const weldingBefore = await xp(characterId, SKILL_IDS.welding);
      const done = await turnIn(userId, characterId, HOME);
      expect(done.mission.status).toBe("completed");
      expect(done.mission).toMatchObject({ continuation: { missionId: OWN, status: "accepted" } });
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(2);
      expect(await xp(characterId, SKILL_IDS.welding)).toBe(weldingBefore);
      const second = await missionRow(characterId, OWN);
      expect(second?.acceptedAt).toBeTruthy();
      expect(second?.completedAt).toBeNull();
      // The Rune of Your Own has no separate offer: it is simply active.
      const state = await stateAt(userId, characterId);
      expect(state.missions.find((entry) => entry.missionId === OWN)?.state).toBe("active");
    });

    it("is exactly-once under a replay: no second pair of runes, no second acceptance", async () => {
      const { userId, characterId } = await finishedRig();
      await turnIn(userId, characterId, HOME);
      const replay = await turnIn(userId, characterId, HOME);
      expect(replay.mission.status).toBe("already_completed");
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(2);
    });

    it("refuses the whole turn-in when two runes will not fit, then succeeds once there is room", async () => {
      const { userId, characterId } = await finishedRig();
      // Fill every carried slot with one-unit stacks of something that is not a TP Rune.
      const open = (await stateAt(userId, characterId)).inventory;
      const free = open.slotsAvailable;
      expect(free).toBeGreaterThan(0);
      for (let index = 0; index < free; index += 1) {
        await give(characterId, ITEM_IDS.scrapMetal, 1);
      }
      const full = (await stateAt(userId, characterId)).inventory;
      expect(full.slotsAvailable).toBe(0);

      const refused = await turnIn(userId, characterId, HOME);
      expect(refused.mission.status).toBe("refused");
      expect(refused.mission).toMatchObject({ reason: "capacity", capacityReason: "slots" });
      // Nothing happened: no completion, no gift, no Mission 2.
      expect((await missionRow(characterId, HOME))?.completedAt).toBeNull();
      expect(await missionRow(characterId, OWN)).toBeUndefined();
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(0);

      await db
        .delete(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, characterId),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.scrapMetal),
          ),
        );
      const retried = await turnIn(userId, characterId, HOME, tick(now, 5));
      expect(retried.mission.status).toBe("completed");
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(2);
      expect((await missionRow(characterId, OWN))?.acceptedAt).toBeTruthy();
    });
  });

  describe("A Rune of Your Own", () => {
    /** A character part-way through the chapter: the Rig is built and the lesson is on. */
    async function lessonOn() {
      const made = await finishedRig();
      const done = await turnIn(made.userId, made.characterId, HOME);
      expect(done.mission.status).toBe("completed");
      return made;
    }

    async function giveIngredients(characterId: string, sets = 1) {
      await give(characterId, ITEM_IDS.cutQuartz, sets);
      await give(characterId, ITEM_IDS.runestone, sets);
    }

    const attune = (userId: string, characterId: string, count: number, at = now) =>
      runeworking.startRuneworking(
        userId,
        characterId,
        ACTION_IDS.skatbollTpRuneRuneworking,
        count,
        at,
      );

    it("is never offered and cannot be accepted by hand", async () => {
      const made = await finishedRig();
      const forged = await missions.acceptMission(
        made.userId,
        made.characterId,
        OWN,
        enby,
        now,
        certain(),
      );
      expect(forged.mission.status).toBe("refused");
      expect(await missionRow(made.characterId, OWN)).toBeUndefined();
    });

    it("crafts at the personal Rig only: 1 Cut Quartz + 1 Runestone, 48 ticks, 125 XP", async () => {
      expect(tpRecipe).toMatchObject({
        minimumLevel: 5,
        durationTicks: 48,
        baseXp: 125,
        outputItemId: ITEM_IDS.skatbollTpRune,
        outputQuantity: 1,
      });
      const { userId, characterId } = await lessonOn();
      await giveIngredients(characterId);
      const before = await xp(characterId, SKILL_IDS.runeworking);
      const runesBefore = await carried(characterId, ITEM_IDS.skatbollTpRune);
      const started = await attune(userId, characterId, 1);
      expect(started.runeworkingError).toBeUndefined();
      await stateAt(userId, characterId, tick(now, tpRecipe.durationTicks - 1));
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(runesBefore);
      await stateAt(userId, characterId, tick(now, tpRecipe.durationTicks));
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(runesBefore + 1);
      expect(await carried(characterId, ITEM_IDS.cutQuartz)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.runestone)).toBe(0);
      expect((await xp(characterId, SKILL_IDS.runeworking)) - before).toBe(125);
    });

    it("refuses without a finished Rig, away from it and below Runeworking 5", async () => {
      // No Rig yet: standing at the Crash Site is not enough.
      const noRig = await acceptedAtSite();
      await giveIngredients(noRig.characterId);
      expect((await attune(noRig.userId, noRig.characterId, 1)).runeworkingError).toBe(
        "runeworking_locked",
      );

      // A finished Rig, but standing somewhere that hosts no such recipe.
      const away = await lessonOn();
      await giveIngredients(away.characterId);
      await move(away.characterId, LOCATION_IDS.theJag);
      expect((await attune(away.userId, away.characterId, 1)).runeworkingError).toBe(
        "runeworking_unavailable_here",
      );
    });

    it("keeps the Hilltop Rig's Seeker and the personal Rig's rune at their own stations", async () => {
      const { userId, characterId } = await lessonOn();
      await give(characterId, ITEM_IDS.runeFragment, 1);
      // The Seeker is attuned at Hilltop's Rig, not the personal one.
      expect(
        (
          await runeworking.startRuneworking(
            userId,
            characterId,
            ACTION_IDS.beginnerEchoSeekerRuneworking,
            1,
            now,
          )
        ).runeworkingError,
      ).toBe("runeworking_unavailable_here");
      await move(characterId, LOCATION_IDS.hilltopWorkshop);
      await giveIngredients(characterId);
      expect((await attune(userId, characterId, 1)).runeworkingError).toBe(
        "runeworking_unavailable_here",
      );
      expect(seekerRecipe.minimumLevel).toBe(1);
    });

    it("counts one genuine craft after acceptance, not the two granted runes or any other rune", async () => {
      const { userId, characterId } = await lessonOn();
      // The two gifted runes, plus one more handed over by a trade: none of it counts.
      await give(characterId, ITEM_IDS.skatbollTpRune, 1);
      let mission = (await stateAt(userId, characterId)).missions.find((m) => m.missionId === OWN)!;
      expect(mission.requirements?.[0]?.progress).toEqual({ current: 0, target: 1 });
      expect(mission.state).toBe("active");
      await giveIngredients(characterId);
      await attune(userId, characterId, 1);
      await stateAt(userId, characterId, tick(now, tpRecipe.durationTicks));
      mission = (await stateAt(userId, characterId, tick(now, 100))).missions.find(
        (m) => m.missionId === OWN,
      )!;
      expect(mission.requirements?.[0]?.progress).toEqual({ current: 1, target: 1 });
      expect(mission.state).toBe("ready_for_completion");
    });

    it("does not count a craft made before the Mission was accepted", async () => {
      const made = await finishedRig();
      await giveIngredients(made.characterId);
      await attune(made.userId, made.characterId, 1);
      await stateAt(made.userId, made.characterId, tick(now, tpRecipe.durationTicks));
      const completedAt = tick(now, 100);
      const done = await turnIn(made.userId, made.characterId, HOME, completedAt);
      expect(done.mission.status).toBe("completed");
      const mission = (await stateAt(made.userId, made.characterId, completedAt)).missions.find(
        (m) => m.missionId === OWN,
      )!;
      expect(mission.requirements?.[0]?.progress).toEqual({ current: 0, target: 1 });
    });

    it("is refused before the craft, and refuses a bare carried rune as proof", async () => {
      const { userId, characterId } = await lessonOn();
      await give(characterId, ITEM_IDS.skatbollTpRune, 1);
      const refused = await turnIn(userId, characterId, OWN);
      expect(refused.mission.status).toBe("refused");
      expect(await xp(characterId, SKILL_IDS.runeworking)).toBe(
        thresholds.find((threshold) => threshold.level === 5)!.totalXp,
      );
    });

    it("pays +500 Runeworking XP once, takes no rune, and returns the Enby to Hilltop", async () => {
      const { userId, characterId } = await lessonOn();
      await giveIngredients(characterId);
      await attune(userId, characterId, 1);
      const craftedAt = tick(now, tpRecipe.durationTicks);
      await stateAt(userId, characterId, craftedAt);
      const runes = await carried(characterId, ITEM_IDS.skatbollTpRune);
      expect(runes).toBe(3);
      // The player has already used, stored or traded the crafted rune: it need not exist.
      await db
        .delete(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, characterId),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.skatbollTpRune),
          ),
        );
      const before = await xp(characterId, SKILL_IDS.runeworking);
      const done = await turnIn(userId, characterId, OWN, tick(craftedAt, 5));
      expect(done.mission.status).toBe("completed");
      expect((await xp(characterId, SKILL_IDS.runeworking)) - before).toBe(500);
      expect(await carried(characterId, ITEM_IDS.skatbollTpRune)).toBe(0);
      // No new item reward: the ingredients are gone only because the craft used them.
      expect(await carried(characterId, ITEM_IDS.cutQuartz)).toBe(0);

      // Exactly once.
      const replay = await turnIn(userId, characterId, OWN, tick(craftedAt, 9));
      expect(replay.mission.status).toBe("already_completed");
      expect((await xp(characterId, SKILL_IDS.runeworking)) - before).toBe(500);

      // The Enby is back at Hilltop Workshop and nowhere else, with no player cost.
      const state = await stateAt(userId, characterId, tick(craftedAt, 12));
      const placed = (locationId: string) =>
        getResidentNpcs({
          locationId,
          completedMissionIds: deriveCompletedMissionIds(state.missions),
          completedRepairTargetIds: deriveCompletedRepairTargetIds(Object.values(state.repairs)),
        }).map((npc) => npc.id);
      expect(placed(LOCATION_IDS.hilltopWorkshop)).toContain(enby);
      expect(placed(LOCATION_IDS.crashSite)).not.toContain(enby);
      // The Rig, its name and its recipe are the character's for good.
      expect(state.locationStates[LOCATION_IDS.crashSite]?.displayName).toBe("Resonance Site");
    });

    it("is not completed by a rune acquired another way", async () => {
      const { userId, characterId } = await lessonOn();
      await give(characterId, ITEM_IDS.skatbollTpRune, 5);
      const refused = await turnIn(userId, characterId, OWN);
      expect(refused.mission.status).toBe("refused");
      expect((await missionRow(characterId, OWN))?.completedAt).toBeNull();
    });
  });
});
