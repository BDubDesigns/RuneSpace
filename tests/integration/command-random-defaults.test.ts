import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
} from "@/game/config/foundations";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  seedRepairTarget,
} from "./fixtures";
import { rollCleanPassSections } from "@/game/domain/clean-pass";

/**
 * Issue #289: Cargo Hold and repair commands defaulted to a fixed-zero random
 * source instead of the production one. Every one of them reconciles a due
 * Mining/Refining action before its own refusals, so a zero source forced
 * every reconciled roll low, and `startWelding` also placed each newly rolled
 * Clean Pass opportunity at the first section of its window.
 *
 * The production boundary, `defaultMiningRandom`, is stubbed here with a fixed
 * HIGH draw so its use is observable: a reconciled Refining batch fails under
 * it where a zero draw would succeed, and a Clean Pass roll lands on the last
 * section of each three-section window (9_998 % 3 === 2) instead of the first.
 */
const PRODUCTION_DRAW = 9_998;

vi.mock("@/server/mining", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/mining")>()),
  defaultMiningRandom: () => ({
    nextBasisPoints: () => PRODUCTION_DRAW,
    nextUnit: () => 0.5,
  }),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite(
  "issue #289 Cargo Hold and repair commands use production randomness (real PostgreSQL)",
  () => {
    let db: (typeof import("@/db"))["db"];
    let authSchema: typeof import("@/db/auth-schema");
    let rune: typeof import("@/db/rune-space");
    let ownership: typeof import("@/server/ownership");
    let characters: typeof import("@/server/characters");
    let play: typeof import("@/server/play");
    let cargo: typeof import("@/server/cargo-hold");
    let repairs: typeof import("@/server/repair-commands");
    let refiningCommands: typeof import("@/server/refining-commands");
    const createdUsers: string[] = [];
    const balance = getEffectiveGameBalance();
    const cargoTarget = getRepairTargetBalance(REPAIR_TARGET_IDS.cargoHold, balance);
    const refiningBatchMs =
      balance.refining.recipes.refinedFerrite.attemptDurationTicks * GAME_TICK_MS;
    const zeroRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

    beforeAll(async () => {
      db = (await import("@/db")).db;
      authSchema = await import("@/db/auth-schema");
      rune = await import("@/db/rune-space");
      ownership = await import("@/server/ownership");
      characters = await import("@/server/characters");
      play = await import("@/server/play");
      cargo = await import("@/server/cargo-hold");
      repairs = await import("@/server/repair-commands");
      refiningCommands = await import("@/server/refining-commands");
    });

    afterEach(async () => {
      for (const userId of createdUsers.splice(0))
        await cleanupTestUser(db, authSchema, rune, userId);
    });

    async function makeCharacter() {
      const userId = await createTestUser(db, authSchema, "RNG Default Tester");
      createdUsers.push(userId);
      const character = await createCharacterForUser(
        db,
        rune,
        ownership,
        characters,
        userId,
        `Rng ${userId.slice(0, 8)}`,
      );
      const now = new Date("2026-10-01T12:00:00.000Z");
      await play.getPlayGameplayState(userId, character.id, now, zeroRandom);
      return { userId, characterId: character.id, now };
    }

    async function moveTo(characterId: string, locationId: string) {
      await db
        .update(rune.characters)
        .set({ currentLocationId: locationId })
        .where(eq(rune.characters.id, characterId));
    }

    /**
     * Leave one rolled Refining batch due at Crash Site, and return the moment it
     * is due. The run is one batch long, so reconciling it also ends the action
     * and lets a valid command proceed afterwards.
     */
    async function dueRefiningBatchAtCrashSite(userId: string, characterId: string, now: Date) {
      await moveTo(characterId, LOCATION_IDS.abandonedProcessingYard);
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 2 });
      const started = await refiningCommands.startRefining(
        userId,
        characterId,
        ACTION_IDS.refining,
        now,
        zeroRandom,
        1,
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.refining);
      await moveTo(characterId, LOCATION_IDS.crashSite);
      return new Date(now.getTime() + refiningBatchMs + 1);
    }

    async function refiningRun(characterId: string) {
      const [state] = await db
        .select()
        .from(rune.characterRefiningState)
        .where(eq(rune.characterRefiningState.characterId, characterId));
      return { attempts: state?.runAttempts, successes: state?.runSuccesses };
    }

    async function activeAction(characterId: string) {
      const [row] = await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, characterId));
      return row?.actionId;
    }

    /** The reconciled batch was rolled by the production source, not a zero one. */
    async function expectProductionSettlement(characterId: string) {
      expect(await refiningRun(characterId)).toEqual({ attempts: 1, successes: 0 });
    }

    async function restoreCargoHold(characterId: string, now: Date) {
      await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.cargoHold, {
        materials: installedMaterials(cargoTarget),
        weldingProgress: cargoTarget.repairIncrements,
        completedAt: now,
        updatedAt: now,
      });
    }

    async function acceptHoldItTogether(characterId: string, now: Date) {
      await db.insert(rune.characterMissions).values([
        { characterId, missionId: MISSION_IDS.wasteNot, acceptedAt: now, completedAt: now },
        { characterId, missionId: MISSION_IDS.holdItTogether, acceptedAt: now },
      ]);
    }

    async function carriedStack(characterId: string, itemId: string, quantity: number) {
      const [stack] = await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId, quantity })
        .returning();
      return stack!;
    }

    async function cargoStack(characterId: string, itemId: string, quantity: number) {
      const [stack] = await db
        .insert(rune.cargoHoldStacks)
        .values({ characterId, itemId, quantity })
        .returning();
      return stack!;
    }

    async function looseCutter(characterId: string) {
      const [instance] = await db
        .insert(rune.itemInstances)
        .values({ characterId, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 })
        .returning();
      return instance!;
    }

    describe("refused commands settle the prior action with production randomness", () => {
      // The Cargo Hold is never restored and Hold It Together never accepted, so
      // every command below refuses after reconciliation.
      const refusedCommands: ReadonlyArray<
        [string, (userId: string, characterId: string, at: Date) => Promise<unknown>]
      > = [
        [
          "depositCargoStack",
          async (userId, characterId, at) => {
            const stack = await carriedStack(characterId, ITEM_IDS.scrapMetal, 1);
            const result = await cargo.depositCargoStack(
              userId,
              characterId,
              { stackId: stack.id, mode: "stack", expectedQuantity: 1 },
              at,
            );
            expect(result.cargo).toMatchObject({ status: "refused", reason: "repair_incomplete" });
          },
        ],
        [
          "withdrawCargoStack",
          async (userId, characterId, at) => {
            const stack = await cargoStack(characterId, ITEM_IDS.scrapMetal, 1);
            const result = await cargo.withdrawCargoStack(
              userId,
              characterId,
              { stackId: stack.id, mode: "stack", expectedQuantity: 1 },
              at,
            );
            expect(result.cargo).toMatchObject({ status: "refused", reason: "repair_incomplete" });
          },
        ],
        [
          "depositCargoUniqueItem",
          async (userId, characterId, at) => {
            const instance = await looseCutter(characterId);
            const result = await cargo.depositCargoUniqueItem(
              userId,
              characterId,
              { itemInstanceId: instance.id },
              at,
            );
            expect(result.cargo).toMatchObject({ status: "refused", reason: "repair_incomplete" });
          },
        ],
        [
          "withdrawCargoUniqueItem",
          async (userId, characterId, at) => {
            const instance = await looseCutter(characterId);
            await db.insert(rune.cargoHoldItemInstances).values({
              characterId,
              itemInstanceId: instance.id,
              storedAt: at,
            });
            const result = await cargo.withdrawCargoUniqueItem(
              userId,
              characterId,
              { itemInstanceId: instance.id },
              at,
            );
            expect(result.cargo).toMatchObject({ status: "refused", reason: "repair_incomplete" });
          },
        ],
        [
          "contributeRepairMaterials",
          async (userId, characterId, at) => {
            const result = await repairs.contributeRepairMaterials(
              userId,
              characterId,
              {
                targetId: REPAIR_TARGET_IDS.cargoHold,
                expectedMaterials: { [ITEM_IDS.refinedFerrite]: 1 },
              },
              at,
            );
            expect(result.repair).toMatchObject({ status: "refused" });
          },
        ],
        [
          "startWelding",
          async (userId, characterId, at) => {
            const state = await repairs.startWelding(
              userId,
              characterId,
              REPAIR_TARGET_IDS.cargoHold,
              at,
            );
            expect(state.activeAction).toBeUndefined();
            expect(state.weldingError).toBe("welding_locked");
          },
        ],
        [
          "stopWelding",
          async (userId, characterId, at) => {
            const state = await repairs.stopWelding(
              userId,
              characterId,
              REPAIR_TARGET_IDS.cargoHold,
              at,
            );
            expect(state.activeAction).toBeUndefined();
          },
        ],
      ];

      it.each(refusedCommands)("%s", async (_name, command) => {
        const { userId, characterId, now } = await makeCharacter();
        const due = await dueRefiningBatchAtCrashSite(userId, characterId, now);

        await command(userId, characterId, due);

        await expectProductionSettlement(characterId);
        expect(await activeAction(characterId)).toBeUndefined();
      });
    });

    describe("valid commands settle the prior action with production randomness", () => {
      it("depositCargoStack", async () => {
        const { userId, characterId, now } = await makeCharacter();
        await restoreCargoHold(characterId, now);
        const due = await dueRefiningBatchAtCrashSite(userId, characterId, now);
        const stack = await carriedStack(characterId, ITEM_IDS.scrapMetal, 2);

        const result = await cargo.depositCargoStack(
          userId,
          characterId,
          { stackId: stack.id, mode: "stack", expectedQuantity: 2 },
          due,
        );

        expect(result.cargo).toMatchObject({ status: "transferred", quantity: 2 });
        await expectProductionSettlement(characterId);
      });

      it("contributeRepairMaterials", async () => {
        const { userId, characterId, now } = await makeCharacter();
        await acceptHoldItTogether(characterId, now);
        const due = await dueRefiningBatchAtCrashSite(userId, characterId, now);
        // Exactly the recipe, in stacks within each item's limit, so the
        // reconciled batch can add its own output beside them.
        for (let stack = 0; stack < 3; stack += 1) {
          await carriedStack(characterId, ITEM_IDS.refinedFerrite, 5);
        }
        await carriedStack(characterId, ITEM_IDS.slag, 6);

        const result = await repairs.contributeRepairMaterials(
          userId,
          characterId,
          {
            targetId: REPAIR_TARGET_IDS.cargoHold,
            expectedMaterials: { [ITEM_IDS.refinedFerrite]: 15, [ITEM_IDS.slag]: 6 },
          },
          due,
        );

        expect(result.repair).toMatchObject({ status: "committed" });
        await expectProductionSettlement(characterId);
      });

      it("startWelding", async () => {
        const { userId, characterId, now } = await makeCharacter();
        await acceptHoldItTogether(characterId, now);
        await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.cargoHold, {
          materials: installedMaterials(cargoTarget),
          updatedAt: now,
        });
        const due = await dueRefiningBatchAtCrashSite(userId, characterId, now);

        const state = await repairs.startWelding(
          userId,
          characterId,
          REPAIR_TARGET_IDS.cargoHold,
          due,
        );

        expect(state.activeAction?.actionId).toBe(ACTION_IDS.cargoHoldWelding);
        await expectProductionSettlement(characterId);
      });
    });

    describe("first-time repair Clean Pass placement", () => {
      async function cleanPassSections(characterId: string) {
        const [row] = await db
          .select({ cleanPass: rune.characterRepairTargets.cleanPass })
          .from(rune.characterRepairTargets)
          .where(eq(rune.characterRepairTargets.characterId, characterId));
        return (row?.cleanPass as { section: number }[] | null)?.map((entry) => entry.section);
      }

      async function readyToWeld() {
        const character = await makeCharacter();
        await acceptHoldItTogether(character.characterId, character.now);
        await seedRepairTarget(db, rune, character.characterId, REPAIR_TARGET_IDS.cargoHold, {
          materials: installedMaterials(cargoTarget),
          updatedAt: character.now,
        });
        return character;
      }

      const firstOfEachWindow = rollCleanPassSections(zeroRandom, cargoTarget.repairIncrements);
      const productionPlacement = rollCleanPassSections(
        { nextBasisPoints: () => PRODUCTION_DRAW },
        cargoTarget.repairIncrements,
      );

      it("rolls with the production source when Welding starts by default", async () => {
        // Guard the premise: the two sources must disagree for this test to mean anything.
        expect(productionPlacement).not.toEqual(firstOfEachWindow);
        const { userId, characterId, now } = await readyToWeld();

        await repairs.startWelding(userId, characterId, REPAIR_TARGET_IDS.cargoHold, now);

        expect(await cleanPassSections(characterId)).toEqual(productionPlacement);
      });

      it("keeps an explicitly injected source deterministic", async () => {
        const { userId, characterId, now } = await readyToWeld();

        await repairs.startWelding(
          userId,
          characterId,
          REPAIR_TARGET_IDS.cargoHold,
          now,
          zeroRandom,
        );

        expect(await cleanPassSections(characterId)).toEqual(firstOfEachWindow);
      });
    });

    it("keeps an explicitly injected source deterministic during prior-action settlement", async () => {
      const { userId, characterId, now } = await makeCharacter();
      const due = await dueRefiningBatchAtCrashSite(userId, characterId, now);

      await repairs.stopWelding(userId, characterId, REPAIR_TARGET_IDS.cargoHold, due, zeroRandom);

      expect(await refiningRun(characterId)).toEqual({ attempts: 1, successes: 1 });
    });
  },
);
