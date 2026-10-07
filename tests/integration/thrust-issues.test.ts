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
  type LocationId,
} from "@/game/config/foundations";
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
 * Issue #330 — Thrust Issues, against real PostgreSQL.
 *
 * Wade's propulsion job is an ordinary Mission-authorized repair target with one
 * addition the generic access predicate enforces: personal Welding 8, on top of
 * the Mission's acceptance. It takes exactly two Drive Mounts, a Galvaferrite,
 * two Mounting Brackets and a Galvanic Wire Spool, needs sixteen real Welding
 * sections, and finishes durably in the generic repair-target row. None of it
 * depends on the character's own Fabrication or Refining level: the parts here
 * are simply given, which is exactly what a trade leaves behind. The repair is
 * its own reward, so the Wade turn-in pays nothing.
 */
suite("issue #330 Thrust Issues (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let progression: typeof import("@/server/progression");
  let missions: typeof import("@/server/missions");
  let repairs: typeof import("@/server/repair-commands");
  let fabrication: typeof import("@/server/fabrication-commands");
  let tinkering: typeof import("@/server/tinkering-commands");
  const createdUsers: string[] = [];
  const now = new Date("2026-10-07T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const propulsion = getRepairTargetBalance(REPAIR_TARGET_IDS.propulsionSystem, balance);
  const mount = balance.fabrication.recipes.driveMount;
  const thresholds = standardSkillLevelThresholds(balance);
  const WELD_TICKS = balance.welding.attemptDurationTicks;

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
    fabrication = await import("@/server/fabrication-commands");
    tinkering = await import("@/server/tinkering-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const deterministicRandom = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const tick = (from: Date, ticks: number) => new Date(from.getTime() + ticks * GAME_TICK_MS);

  /** Everything through Wheel Be Right Back, which is Thrust Issues' prerequisite. */
  const STORY = [
    MISSION_IDS.walkItOff,
    MISSION_IDS.cutYourTeeth,
    MISSION_IDS.wasteNot,
    MISSION_IDS.holdItTogether,
    MISSION_IDS.keepTheChange,
    MISSION_IDS.tenThousandHours,
    MISSION_IDS.returnTheFavor,
    MISSION_IDS.breakItDown,
    MISSION_IDS.braceYourself,
  ];

  /**
   * A character with the lowest possible Fabrication and Refining and, unless
   * asked otherwise, personal Welding 8: nothing in this job may ask for more.
   */
  async function makeCharacter(
    options: {
      wheel?: boolean;
      welding?: number;
      location?: LocationId;
      fabrication?: number;
    } = {},
  ) {
    const userId = await createTestUser(db, authSchema, "Thrust Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Thrust ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, now, deterministicRandom());
    await db.insert(rune.characterMissions).values(
      [...STORY, ...(options.wheel === false ? [] : [MISSION_IDS.wheelBeRightBack])].map(
        (missionId) => ({
          characterId: character.id,
          missionId,
          acceptedAt: now,
          completedAt: now,
        }),
      ),
    );
    await move(character.id, options.location ?? LOCATION_IDS.ruskRecovery);
    const welding = options.welding ?? 8;
    if (welding > 1) await grantLevel(character.id, SKILL_IDS.welding, welding);
    if (options.fabrication && options.fabrication > 1) {
      await grantLevel(character.id, SKILL_IDS.fabrication, options.fabrication);
    }
    return { userId, characterId: character.id };
  }

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

  async function xp(characterId: string, skillId: string) {
    return (
      (
        await db
          .select({ totalXp: rune.characterSkillXp.totalXp })
          .from(rune.characterSkillXp)
          .where(
            and(
              eq(rune.characterSkillXp.characterId, characterId),
              eq(rune.characterSkillXp.skillId, skillId),
            ),
          )
      )[0]?.totalXp ?? 0
    );
  }

  async function credits(characterId: string) {
    return (
      await db
        .select({ credits: rune.characters.credits })
        .from(rune.characters)
        .where(eq(rune.characters.id, characterId))
    )[0]!.credits;
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

  async function inventoryTotal(characterId: string) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, characterId));
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function give(characterId: string, itemId: string, quantities: readonly number[]) {
    for (const quantity of quantities) {
      await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    }
  }

  /** The complete shopping list, as a trade or a purchase would leave it. */
  async function givePropulsionParts(characterId: string) {
    await give(characterId, ITEM_IDS.driveMount, [2]);
    await give(characterId, ITEM_IDS.galvaferrite, [1]);
    await give(characterId, ITEM_IDS.mountingBracket, [2]);
    await give(characterId, ITEM_IDS.galvanicWireSpool, [1]);
  }

  async function propulsionRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, characterId),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.propulsionSystem),
          ),
        )
    )[0];
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

  const accept = (userId: string, characterId: string) =>
    missions.acceptMission(
      userId,
      characterId,
      MISSION_IDS.thrustIssues,
      NPC_IDS.wadeRusk,
      now,
      deterministicRandom(),
    );

  const complete = (userId: string, characterId: string, at = now) =>
    missions.completeMission(
      userId,
      characterId,
      MISSION_IDS.thrustIssues,
      NPC_IDS.wadeRusk,
      at,
      deterministicRandom(),
    );

  const contribute = (userId: string, characterId: string, expected: Record<string, number>) =>
    repairs.contributeRepairMaterials(
      userId,
      characterId,
      { targetId: REPAIR_TARGET_IDS.propulsionSystem, expectedMaterials: expected },
      now,
      deterministicRandom(),
    );

  const startWelding = (userId: string, characterId: string, at = now) =>
    repairs.startWelding(
      userId,
      characterId,
      REPAIR_TARGET_IDS.propulsionSystem,
      at,
      deterministicRandom(),
    );

  const stateAt = (userId: string, characterId: string, at = now) =>
    play.getPlayGameplayState(userId, characterId, at, deterministicRandom());

  const fullContribution = {
    [ITEM_IDS.driveMount]: 2,
    [ITEM_IDS.galvaferrite]: 1,
    [ITEM_IDS.mountingBracket]: 2,
    [ITEM_IDS.galvanicWireSpool]: 1,
  };

  async function installPropulsion(characterId: string, completedAt: Date | null = now) {
    await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.propulsionSystem, {
      materials: installedMaterials(propulsion),
      weldingProgress: completedAt ? propulsion.repairIncrements : 0,
      completedAt,
      updatedAt: now,
    });
  }

  describe("Wade offers it by hand, after Wheel Be Right Back and at Welding 8", () => {
    it("refuses acceptance until Wheel Be Right Back is complete", async () => {
      const { userId, characterId } = await makeCharacter({ wheel: false });
      const refused = await accept(userId, characterId);
      expect(refused.mission.status).toBe("refused");
      expect(await missionRow(characterId, MISSION_IDS.thrustIssues)).toBeUndefined();
    });

    it("rejects forged acceptance below personal Welding 8", async () => {
      for (const welding of [1, 5, 7]) {
        const { userId, characterId } = await makeCharacter({ welding });
        const refused = await accept(userId, characterId);
        expect(refused.mission.status, `Welding ${welding}`).toBe("refused");
        expect(await missionRow(characterId, MISSION_IDS.thrustIssues)).toBeUndefined();
      }
    });

    it("accepts at Rusk Recovery at Welding 8 with Fabrication 1, Refining 1 and no A Cut Above", async () => {
      const { userId, characterId } = await makeCharacter();
      expect(await missionRow(characterId, MISSION_IDS.aCutAbove)).toBeUndefined();
      const state = await stateAt(userId, characterId);
      expect(state.refining.level).toBe(1);
      expect(state.missions.find((m) => m.missionId === MISSION_IDS.thrustIssues)).toMatchObject({
        state: "not_accepted",
        prerequisiteSatisfied: true,
      });

      const accepted = await accept(userId, characterId);
      expect(accepted.mission.status).toBe("accepted");
      expect(await missionRow(characterId, MISSION_IDS.thrustIssues)).toMatchObject({
        completedAt: null,
      });
      // Accepting hands over nothing and starts nothing else.
      expect(await inventoryTotal(characterId)).toBe(0);
      expect((await accept(userId, characterId)).mission.status).toBe("already_accepted");
    });

    it("does not advertise the offer below Welding 8", async () => {
      const { userId, characterId } = await makeCharacter({ welding: 7 });
      const entry = (await stateAt(userId, characterId)).missions.find(
        (m) => m.missionId === MISSION_IDS.thrustIssues,
      );
      expect(entry?.prerequisiteSatisfied).toBe(false);
    });

    it("refuses acceptance away from Rusk Recovery", async () => {
      const { userId, characterId } = await makeCharacter({ location: LOCATION_IDS.crashSite });
      expect((await accept(userId, characterId)).mission.status).toBe("refused");
      expect(await missionRow(characterId, MISSION_IDS.thrustIssues)).toBeUndefined();
    });

    it("is not started by completing Wheel Be Right Back", async () => {
      const { userId, characterId } = await makeCharacter({ wheel: false });
      await db.insert(rune.characterMissions).values({
        characterId,
        missionId: MISSION_IDS.wheelBeRightBack,
        acceptedAt: now,
      });
      const gear = getRepairTargetBalance(REPAIR_TARGET_IDS.landingGear, balance);
      await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.landingGear, {
        materials: installedMaterials(gear),
        weldingProgress: gear.repairIncrements,
        completedAt: now,
        updatedAt: now,
      });
      const finished = await missions.completeMission(
        userId,
        characterId,
        MISSION_IDS.wheelBeRightBack,
        NPC_IDS.wadeRusk,
        now,
        deterministicRandom(),
      );
      expect(finished.mission.status).toBe("completed");
      // Wade has to be spoken to: nothing was auto-accepted.
      expect(await missionRow(characterId, MISSION_IDS.thrustIssues)).toBeUndefined();
    });
  });

  describe("the Propulsion System is a Mission-authorized repair at the Crash Site", () => {
    it("refuses every repair command before the job is taken", async () => {
      const { userId, characterId } = await makeCharacter({ location: LOCATION_IDS.crashSite });
      await givePropulsionParts(characterId);
      const refused = await contribute(userId, characterId, fullContribution);
      expect(refused.repair).toMatchObject({ status: "refused", reason: "repair_locked" });
      expect((await startWelding(userId, characterId)).weldingError).toBe("welding_locked");
      expect(await propulsionRow(characterId)).toBeUndefined();
      expect(await carried(characterId, ITEM_IDS.driveMount)).toBe(2);
      expect(
        (await stateAt(userId, characterId)).repairs[REPAIR_TARGET_IDS.propulsionSystem],
      ).toMatchObject({ repairAvailable: false, complete: false });
    });

    it("refuses repair commands below Welding 8 even when the Mission row was forged", async () => {
      const { userId, characterId } = await makeCharacter({
        welding: 7,
        location: LOCATION_IDS.crashSite,
      });
      // A row a forged or stale client could never write; the access predicate
      // is what refuses, not the acceptance command.
      await db
        .insert(rune.characterMissions)
        .values({ characterId, missionId: MISSION_IDS.thrustIssues, acceptedAt: now });
      await givePropulsionParts(characterId);

      const refused = await contribute(userId, characterId, fullContribution);
      expect(refused.repair).toMatchObject({ status: "refused", reason: "repair_locked" });
      expect(await propulsionRow(characterId)).toBeUndefined();
      expect(await carried(characterId, ITEM_IDS.driveMount)).toBe(2);

      // Nor can welding start on a kit that somehow got installed.
      await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.propulsionSystem, {
        materials: installedMaterials(propulsion),
        updatedAt: now,
      });
      expect((await startWelding(userId, characterId)).weldingError).toBe("welding_locked");
      expect(
        (await stateAt(userId, characterId)).repairs[REPAIR_TARGET_IDS.propulsionSystem],
      ).toMatchObject({ repairAvailable: false });

      // Reaching Welding 8 is the only thing that opens it.
      await grantLevel(characterId, SKILL_IDS.welding, 8);
      expect(
        (await stateAt(userId, characterId)).repairs[REPAIR_TARGET_IDS.propulsionSystem],
      ).toMatchObject({ repairAvailable: true });
      expect((await startWelding(userId, characterId)).weldingError).toBeUndefined();
    });

    it("works only at the Crash Site", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await givePropulsionParts(characterId);
      // Still standing in Rusk Recovery.
      expect((await contribute(userId, characterId, fullContribution)).repair).toMatchObject({
        status: "refused",
        reason: "wrong_location",
      });
      expect(await carried(characterId, ITEM_IDS.driveMount)).toBe(2);
    });

    it("installs exactly the recipe from parts that were only ever given", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      // Spare brackets and wire beyond what the job needs.
      await give(characterId, ITEM_IDS.driveMount, [2]);
      await give(characterId, ITEM_IDS.galvaferrite, [3]);
      await give(characterId, ITEM_IDS.mountingBracket, [5]);
      await give(characterId, ITEM_IDS.galvanicWireSpool, [2]);

      const committed = await contribute(userId, characterId, fullContribution);
      expect(committed.repair).toMatchObject({ status: "committed" });
      expect(await propulsionRow(characterId)).toMatchObject({
        materials: installedMaterials(propulsion),
      });
      expect(await carried(characterId, ITEM_IDS.driveMount)).toBe(0);
      // Only what the recipe asked for was taken.
      expect(await carried(characterId, ITEM_IDS.galvaferrite)).toBe(2);
      expect(await carried(characterId, ITEM_IDS.mountingBracket)).toBe(3);
      expect(await carried(characterId, ITEM_IDS.galvanicWireSpool)).toBe(1);
      expect(committed.state.repairs[REPAIR_TARGET_IDS.propulsionSystem]).toMatchObject({
        materialComplete: true,
        complete: false,
      });
    });

    it("takes the parts in stages, keeps progress across reloads and revisits", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await give(characterId, ITEM_IDS.driveMount, [1]);
      await contribute(userId, characterId, { [ITEM_IDS.driveMount]: 1 });

      const rows = (state: Awaited<ReturnType<typeof stateAt>>) =>
        state.repairs[REPAIR_TARGET_IDS.propulsionSystem]!.materials.map((material) => [
          material.itemId,
          material.contributed,
          material.required,
        ]);
      const partial = await stateAt(userId, characterId);
      expect(partial.repairs[REPAIR_TARGET_IDS.propulsionSystem]).toMatchObject({
        materialComplete: false,
        weldingIncrements: 16,
      });
      expect(rows(partial)).toEqual([
        [ITEM_IDS.driveMount, 1, 2],
        [ITEM_IDS.galvaferrite, 0, 1],
        [ITEM_IDS.mountingBracket, 0, 2],
        [ITEM_IDS.galvanicWireSpool, 0, 1],
      ]);
      // Welding cannot start on an unfinished kit.
      expect((await startWelding(userId, characterId)).weldingError).toBe("welding_locked");

      // Leave, come back and reload: nothing was lost or reset.
      await move(characterId, LOCATION_IDS.ruskRecovery);
      await move(characterId, LOCATION_IDS.crashSite);
      expect(rows(await stateAt(userId, characterId, tick(now, 50)))).toEqual(rows(partial));

      // The rest follows later, and the first mount is not asked for twice.
      await give(characterId, ITEM_IDS.driveMount, [1]);
      await give(characterId, ITEM_IDS.galvaferrite, [1]);
      await give(characterId, ITEM_IDS.mountingBracket, [2]);
      await give(characterId, ITEM_IDS.galvanicWireSpool, [1]);
      const rest = await contribute(userId, characterId, {
        [ITEM_IDS.driveMount]: 1,
        [ITEM_IDS.galvaferrite]: 1,
        [ITEM_IDS.mountingBracket]: 2,
        [ITEM_IDS.galvanicWireSpool]: 1,
      });
      expect(rest.repair).toMatchObject({ status: "committed" });
      expect(await propulsionRow(characterId)).toMatchObject({
        materials: installedMaterials(propulsion),
      });
    });

    it("cannot over-contribute or double-remove the parts under a concurrent retry", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await givePropulsionParts(characterId);
      const [first, second] = await Promise.all([
        contribute(userId, characterId, fullContribution),
        contribute(userId, characterId, fullContribution),
      ]);
      expect([first.repair.status, second.repair.status].sort()).toEqual(["committed", "refused"]);
      for (const itemId of Object.keys(fullContribution)) {
        expect(await carried(characterId, itemId), itemId).toBe(0);
      }
      expect(await propulsionRow(characterId)).toMatchObject({
        materials: installedMaterials(propulsion),
      });
    });

    it("welds sixteen real sections for 800 base Welding XP and restores the ship at once", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await givePropulsionParts(characterId);
      await contribute(userId, characterId, fullContribution);

      const before = await xp(characterId, SKILL_IDS.welding);
      const started = await startWelding(userId, characterId);
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.propulsionWelding);

      // Fifteen sections in, the ship is still the wreck.
      const midway = await stateAt(userId, characterId, tick(now, 15 * WELD_TICKS));
      expect(midway.repairs[REPAIR_TARGET_IDS.propulsionSystem]).toMatchObject({
        weldingProgress: 15,
        complete: false,
      });
      expect(midway.locationStates[LOCATION_IDS.crashSite]?.scene.asset).toBe(
        "/location-scenes/crash-site-crashed.webp",
      );
      expect(midway.locationStates[LOCATION_IDS.crashSite]?.variantId).toBeUndefined();

      // The sixteenth section physically restores it, with no Mission turn-in.
      const finishedAt = tick(now, propulsion.repairIncrements * WELD_TICKS);
      const finished = await stateAt(userId, characterId, finishedAt);
      expect(finished.repairs[REPAIR_TARGET_IDS.propulsionSystem]).toMatchObject({
        weldingProgress: 16,
        weldingIncrements: 16,
        complete: true,
      });
      expect(finished.activeAction).toBeUndefined();
      expect(finished.locationStates[LOCATION_IDS.crashSite]).toMatchObject({
        variantId: "crash_site_ship_restored",
        scene: { asset: "/location-scenes/crash-site-repaired.webp" },
      });
      // 16 x 50 base Welding XP; Clean Pass is the only thing that may add to it,
      // and the deterministic roll here awards the plain base.
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(800);

      // Durable: the generic repair row is complete, and a later reload agrees.
      expect((await propulsionRow(characterId))?.completedAt).not.toBeNull();
      const reloaded = await stateAt(userId, characterId, tick(finishedAt, 1_000));
      expect(reloaded.repairs[REPAIR_TARGET_IDS.propulsionSystem]).toMatchObject({
        complete: true,
        weldingProgress: 16,
      });
      expect(reloaded.locationStates[LOCATION_IDS.crashSite]?.variantId).toBe(
        "crash_site_ship_restored",
      );
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(800);
      // And a finished system takes no further parts or welding.
      await give(characterId, ITEM_IDS.driveMount, [2]);
      expect((await contribute(userId, characterId, fullContribution)).repair.status).toBe(
        "refused",
      );
      expect((await startWelding(userId, characterId, tick(finishedAt, 2_000))).weldingError).toBe(
        "repair_complete",
      );
    });

    it("completes exactly once when offline resolution sees the final section twice", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await givePropulsionParts(characterId);
      await contribute(userId, characterId, fullContribution);
      await startWelding(userId, characterId);
      const before = await xp(characterId, SKILL_IDS.welding);
      // Far past the end, read three times, two of them concurrently.
      const late = tick(now, 10 * propulsion.repairIncrements * WELD_TICKS);
      await Promise.all([stateAt(userId, characterId, late), stateAt(userId, characterId, late)]);
      await stateAt(userId, characterId, tick(late, 100));
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(800);
      expect((await propulsionRow(characterId))?.weldingProgress).toBe(16);
    });
  });

  describe("the ship is each character's own", () => {
    it("shows another character its own wreck, and the repaired one only after its own repair", async () => {
      const a = await makeCharacter();
      const b = await makeCharacter();
      for (const character of [a, b]) {
        await accept(character.userId, character.characterId);
        await move(character.characterId, LOCATION_IDS.crashSite);
      }
      // Character A has finished the weld; character B has not even brought parts.
      await installPropulsion(a.characterId);

      const sceneOf = async (character: typeof a) =>
        (await stateAt(character.userId, character.characterId)).locationStates[
          LOCATION_IDS.crashSite
        ]!;
      expect(await sceneOf(a)).toMatchObject({
        variantId: "crash_site_ship_restored",
        scene: { asset: "/location-scenes/crash-site-repaired.webp" },
      });
      expect(await sceneOf(b)).toMatchObject({
        scene: { asset: "/location-scenes/crash-site-crashed.webp" },
      });
      expect((await sceneOf(b)).variantId).toBeUndefined();
      expect(
        (await stateAt(b.userId, b.characterId)).repairs[REPAIR_TARGET_IDS.propulsionSystem]
          ?.complete,
      ).toBe(false);
    });

    it("keeps the crashed scene through Cargo Hold and Landing Gear restoration", async () => {
      const { userId, characterId } = await makeCharacter({ location: LOCATION_IDS.crashSite });
      for (const targetId of [REPAIR_TARGET_IDS.cargoHold, REPAIR_TARGET_IDS.landingGear]) {
        const recipe = getRepairTargetBalance(targetId, balance);
        await seedRepairTarget(db, rune, characterId, targetId, {
          materials: installedMaterials(recipe),
          weldingProgress: recipe.repairIncrements,
          completedAt: now,
          updatedAt: now,
        });
      }
      const state = await stateAt(userId, characterId);
      expect(state.locationStates[LOCATION_IDS.crashSite]?.scene.asset).toBe(
        "/location-scenes/crash-site-crashed.webp",
      );
      expect(state.repairs[REPAIR_TARGET_IDS.landingGear]?.complete).toBe(true);
      expect(state.repairs[REPAIR_TARGET_IDS.propulsionSystem]?.complete).toBe(false);
    });
  });

  describe("Wade's turn-in", () => {
    it("refuses the report until the Propulsion System is finished", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installPropulsion(characterId, null);
      const refused = await complete(userId, characterId);
      expect(refused.mission).toMatchObject({
        status: "refused",
        reason: "repair_target_complete",
      });
      expect(await missionRow(characterId, MISSION_IDS.thrustIssues)).toMatchObject({
        completedAt: null,
      });
    });

    it("pays no XP, Credits or item, and only records the narrative completion", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installPropulsion(characterId);
      const xpBefore = await xp(characterId, SKILL_IDS.welding);
      const creditsBefore = await credits(characterId);
      const inventoryBefore = await inventoryTotal(characterId);

      const first = await complete(userId, characterId);
      expect(first.mission.status).toBe("completed");
      expect(await xp(characterId, SKILL_IDS.welding)).toBe(xpBefore);
      expect(await credits(characterId)).toBe(creditsBefore);
      expect(await inventoryTotal(characterId)).toBe(inventoryBefore);
      expect(await missionRow(characterId, MISSION_IDS.thrustIssues)).toMatchObject({
        completedAt: expect.any(Date),
      });
    });

    it("cannot repeat the completion, and replay never restores offline status", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installPropulsion(characterId);
      await complete(userId, characterId);
      const again = await complete(userId, characterId);
      expect(again.mission.status).not.toBe("completed");
      expect((await accept(userId, characterId)).mission.status).not.toBe("accepted");

      const state = await stateAt(userId, characterId, tick(now, 500));
      expect(state.repairs[REPAIR_TARGET_IDS.propulsionSystem]).toMatchObject({
        complete: true,
        repairAvailable: true,
      });
      expect(state.locationStates[LOCATION_IDS.crashSite]?.variantId).toBe(
        "crash_site_ship_restored",
      );
      expect(state.missions.find((m) => m.missionId === MISSION_IDS.thrustIssues)?.state).toBe(
        "completed",
      );
    });

    it("completes once under concurrent duplicate reports", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installPropulsion(characterId);
      const results = await Promise.all([
        complete(userId, characterId),
        complete(userId, characterId),
        complete(userId, characterId),
      ]);
      expect(results.filter((result) => result.mission.status === "completed")).toHaveLength(1);
    });

    it("refuses the report away from Rusk Recovery", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installPropulsion(characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      expect((await complete(userId, characterId)).mission.status).toBe("refused");
    });

    it("adds up to exactly 800 ordinary Welding XP across the repair and the report", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await move(characterId, LOCATION_IDS.crashSite);
      await givePropulsionParts(characterId);
      await contribute(userId, characterId, fullContribution);
      await startWelding(userId, characterId);
      const before = await xp(characterId, SKILL_IDS.welding);
      await stateAt(userId, characterId, tick(now, propulsion.repairIncrements * WELD_TICKS));
      await move(characterId, LOCATION_IDS.ruskRecovery);
      const reported = await complete(userId, characterId, tick(now, 1_000));
      expect(reported.mission.status).toBe("completed");
      expect((await xp(characterId, SKILL_IDS.welding)) - before).toBe(800);
    });

    it("opens no flight and starts no further job", async () => {
      const { userId, characterId } = await makeCharacter();
      await accept(userId, characterId);
      await installPropulsion(characterId);
      await complete(userId, characterId);
      const rows = await db
        .select({ missionId: rune.characterMissions.missionId })
        .from(rune.characterMissions)
        .where(eq(rune.characterMissions.characterId, characterId));
      // Only the seeded story, plus these two: nothing was auto-accepted after it.
      expect(rows.map((row) => row.missionId).sort()).toEqual(
        [...STORY, MISSION_IDS.wheelBeRightBack, MISSION_IDS.thrustIssues].sort(),
      );
      const state = await stateAt(userId, characterId);
      // The Crash Site keeps its ordinary map presence and walking edges.
      expect(state.locationStates[LOCATION_IDS.crashSite]?.mapStatus).toBeUndefined();
      expect(state.locationStates[LOCATION_IDS.crashSite]?.travelable).toBe(true);
      expect(state.locationStates[LOCATION_IDS.crashSite]?.availableActionIds).toEqual([
        ACTION_IDS.cargoHoldWelding,
        ACTION_IDS.landingGearWelding,
        ACTION_IDS.propulsionWelding,
      ]);
    });
  });

  describe("the Drive Mount on the Fabrication Station", () => {
    const giveMountInputs = async (characterId: string) => {
      await give(characterId, ITEM_IDS.galvaferrite, [2]);
      await give(characterId, ITEM_IDS.galvanicWireSpool, [1]);
    };

    it("is locked below Fabrication 8 and open at it, with no Mission or Refining requirement", async () => {
      const seven = await makeCharacter({ fabrication: 7 });
      await giveMountInputs(seven.characterId);
      const refused = await fabrication.startFabrication(
        seven.userId,
        seven.characterId,
        ACTION_IDS.driveMountFabrication,
        1,
        now,
      );
      expect(refused.fabricationError).toBe("fabrication_recipe_locked");

      // Fabrication 8 alone: Thrust Issues is neither accepted nor offered.
      const eight = await makeCharacter({ fabrication: 8, welding: 1 });
      expect(await missionRow(eight.characterId, MISSION_IDS.thrustIssues)).toBeUndefined();
      const state = await stateAt(eight.userId, eight.characterId);
      const entry = state.fabricationStation.recipes.find(
        (recipe) => recipe.actionId === ACTION_IDS.driveMountFabrication,
      );
      expect(entry).toMatchObject({ unlocked: true, minimumLevel: 8, outputQuantity: 1 });
      expect(state.refining.level).toBe(1);
    });

    it("turns 2 Galvaferrite + 1 Wire Spool into one Drive Mount in 48 ticks for 200 XP", async () => {
      const { userId, characterId } = await makeCharacter({ fabrication: 8, welding: 1 });
      await give(characterId, ITEM_IDS.galvaferrite, [2]);
      await give(characterId, ITEM_IDS.galvanicWireSpool, [1]);
      const before = await xp(characterId, SKILL_IDS.fabrication);

      const started = await fabrication.startFabrication(
        userId,
        characterId,
        ACTION_IDS.driveMountFabrication,
        1,
        now,
      );
      expect(started.fabricationError).toBeUndefined();
      // Not done one tick early.
      await play.getPlayGameplayState(userId, characterId, tick(now, mount.durationTicks - 1));
      expect(await carried(characterId, ITEM_IDS.driveMount)).toBe(0);

      await play.getPlayGameplayState(userId, characterId, tick(now, mount.durationTicks));
      expect(await carried(characterId, ITEM_IDS.driveMount)).toBe(1);
      expect(await carried(characterId, ITEM_IDS.galvaferrite)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.galvanicWireSpool)).toBe(0);
      expect((await xp(characterId, SKILL_IDS.fabrication)) - before).toBe(200);
    });

    it("batches, stacking two Drive Mounts to a slot and no more", async () => {
      const { userId, characterId } = await makeCharacter({ fabrication: 8, welding: 1 });
      await give(characterId, ITEM_IDS.galvaferrite, [3, 3]);
      await give(characterId, ITEM_IDS.galvanicWireSpool, [3]);
      await fabrication.startFabrication(
        userId,
        characterId,
        ACTION_IDS.driveMountFabrication,
        3,
        now,
      );
      await play.getPlayGameplayState(userId, characterId, tick(now, mount.durationTicks * 3));
      const stacks = await db
        .select({ quantity: rune.inventoryStacks.quantity })
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, characterId),
            eq(rune.inventoryStacks.itemId, ITEM_IDS.driveMount),
          ),
        );
      expect(stacks.map((stack) => stack.quantity).sort()).toEqual([1, 2]);
    });

    it("dismantles through ordinary Tinkering: base XP and ceil(3 / 2) Scrap", async () => {
      const { userId, characterId } = await makeCharacter({ fabrication: 8, welding: 1 });
      await give(characterId, ITEM_IDS.driveMount, [1]);
      const state = await play.getPlayGameplayState(userId, characterId, now);
      const target = state.tinkering.targets.find(
        (candidate) => candidate.actionId === ACTION_IDS.driveMountTinkering,
      );
      expect(target).toMatchObject({
        affordableBatches: 1,
        durationTicks: mount.durationTicks * 2,
        xp: mount.baseXp,
        scrap: 2,
      });
      const before = await xp(characterId, SKILL_IDS.fabrication);
      await tinkering.startTinkering(userId, characterId, ACTION_IDS.driveMountTinkering, 1, now);
      await play.getPlayGameplayState(userId, characterId, tick(now, mount.durationTicks * 2));
      expect(await carried(characterId, ITEM_IDS.driveMount)).toBe(0);
      expect(await carried(characterId, ITEM_IDS.scrapMetal)).toBe(2);
      expect((await xp(characterId, SKILL_IDS.fabrication)) - before).toBe(200);
    });
  });
});
