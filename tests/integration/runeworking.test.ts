import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  BOUNDED_RUN_MAX,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import type { BoundedRunSelection } from "@/game/domain/bounded-run";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #391 — Runeworking at the Resonance Rig, against real PostgreSQL.
 *
 * What only the database proves: that Start is binding and revalidated in the
 * character lock at Hilltop Workshop once Not From Around Here is complete;
 * that a cycle's Fragment stays in the real rows, reserved, until the cycle
 * commits as one transaction; that numeric and Max runs decide each next cycle
 * from what the last one actually left, including a full inventory; that a run
 * resolves the same way lazily after reconnecting; and that nothing about a
 * cycle can be travelled away from, dropped out from under it, or doubled.
 */
suite("issue #391 Runeworking (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let commands: typeof import("@/server/runeworking-commands");
  let inventory: typeof import("@/server/inventory");
  let reservation: typeof import("@/server/fabrication-reservation");
  let admin: typeof import("@/server/admin-command-seams");
  const createdUsers: string[] = [];
  const start = new Date("2026-10-23T00:00:00.000Z");
  const seeker = getEffectiveGameBalance().runeworking.recipes.beginnerEchoSeeker;
  const ACTION = ACTION_IDS.beginnerEchoSeekerRuneworking;
  const FRAGMENT = ITEM_IDS.runeFragment;
  const SEEKER = ITEM_IDS.beginnerEchoSeeker;
  const ticks = (count: number) => count * GAME_TICK_MS;
  const at = (ms: number) => new Date(start.getTime() + ms);
  const cycles = (count: number) => at(ticks(seeker.durationTicks * count));

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    commands = await import("@/server/runeworking-commands");
    inventory = await import("@/server/inventory");
    reservation = await import("@/server/fabrication-reservation");
    admin = await import("@/server/admin-command-seams");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  const certain = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  /** A character standing at Hilltop Workshop, with the mystery solved unless asked. */
  async function rig(label: string, options: { unlocked?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, label);
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
    await play.getPlayGameplayState(userId, character.id, start, certain());
    await move(character.id, LOCATION_IDS.hilltopWorkshop);
    if (options.unlocked !== false) {
      await db.insert(rune.characterMissions).values({
        characterId: character.id,
        missionId: MISSION_IDS.notFromAroundHere,
        acceptedAt: start,
        completedAt: start,
      });
    }
    return { userId, character };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  async function setCarried(characterId: string, itemId: string, quantities: readonly number[]) {
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    for (const quantity of quantities) {
      await db.insert(rune.inventoryStacks).values({ characterId, itemId, quantity });
    }
  }

  async function stacks(characterId: string, itemId: string) {
    const rows = await db
      .select({ id: rune.inventoryStacks.id, quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.sort((a, b) => b.quantity - a.quantity);
  }

  const carried = async (characterId: string, itemId: string) =>
    (await stacks(characterId, itemId)).reduce((sum, row) => sum + row.quantity, 0);

  async function runeworkingXp(characterId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.runeworking),
        ),
      );
    return row?.totalXp ?? 0;
  }

  async function action(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characterId));
    return row;
  }

  async function rigRow(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.characterRuneworkingState)
      .where(eq(rune.characterRuneworkingState.characterId, characterId));
    return row;
  }

  /** Fill every free carried slot with single Ferrite Shale pieces. */
  async function fillSlots(userId: string, characterId: string) {
    const state = await play.getPlayGameplayState(userId, characterId, start, certain());
    for (let slot = 0; slot < state.inventory.slotsAvailable; slot += 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 1 });
    }
  }

  const startRun = (
    userId: string,
    characterId: string,
    selection: BoundedRunSelection,
    when = start,
  ) => commands.startRuneworking(userId, characterId, ACTION, selection, when);

  describe("Start is authoritative", () => {
    it("is closed until Not From Around Here is complete", async () => {
      const { userId, character } = await rig("Closed", { unlocked: false });
      await setCarried(character.id, FRAGMENT, [3]);
      const before = await play.getPlayGameplayState(userId, character.id, start, certain());
      expect(before.resonanceRig.unlocked).toBe(false);
      const state = await startRun(userId, character.id, 1);
      expect(state.runeworkingError).toBe("runeworking_locked");
      expect(await action(character.id)).toBeUndefined();
      expect(await rigRow(character.id)).toBeUndefined();
    });

    it("only happens at Hilltop Workshop", async () => {
      const { userId, character } = await rig("Elsewhere");
      await setCarried(character.id, FRAGMENT, [3]);
      await move(character.id, LOCATION_IDS.stillreachLandingStation);
      const state = await startRun(userId, character.id, 1);
      expect(state.runeworkingError).toBe("runeworking_unavailable_here");
      expect(await carried(character.id, FRAGMENT)).toBe(3);
      expect(await action(character.id)).toBeUndefined();
    });

    it("refuses with no Fragment, even for Max, and an unknown recipe", async () => {
      const { userId, character } = await rig("Empty");
      expect((await startRun(userId, character.id, 1)).runeworkingError).toBe(
        "runeworking_insufficient_inputs",
      );
      expect((await startRun(userId, character.id, BOUNDED_RUN_MAX)).runeworkingError).toBe(
        "runeworking_insufficient_inputs",
      );
      const unknown = await commands.startRuneworking(
        userId,
        character.id,
        ACTION_IDS.refining,
        1,
        start,
      );
      expect(unknown.runeworkingError).toBe("runeworking_unknown_recipe");
      expect(await action(character.id)).toBeUndefined();
    });

    it("refuses a stale or forged number rather than shortening it", async () => {
      const { userId, character } = await rig("Forged");
      await setCarried(character.id, FRAGMENT, [2]);
      const forged = await startRun(userId, character.id, 3);
      expect(forged.runeworkingError).toBe("runeworking_quantity_unavailable");
      expect(forged.resonanceRig.recipes[0]?.affordableCycles).toBe(2);
      expect(await action(character.id)).toBeUndefined();
      expect(await rigRow(character.id)).toBeUndefined();
    });

    it("refuses when the Seeker would have nowhere to go, and allows it when the last Fragment frees its slot", async () => {
      const { userId, character } = await rig("Full");
      await setCarried(character.id, FRAGMENT, [2]);
      await fillSlots(userId, character.id);
      const full = await startRun(userId, character.id, 1);
      expect(full.runeworkingError).toBe("runeworking_no_room");
      expect(await action(character.id)).toBeUndefined();

      await setCarried(character.id, FRAGMENT, [1]);
      const freed = await startRun(userId, character.id, 1);
      expect(freed.runeworkingError).toBeUndefined();
      const done = await play.getPlayGameplayState(userId, character.id, cycles(1), certain());
      expect(done.carriedByItemId[FRAGMENT]).toBeUndefined();
      expect(done.carriedByItemId[SEEKER]).toBe(1);
    });

    it("is idempotent for a retried Start and refuses a second activity", async () => {
      const { userId, character } = await rig("Retried");
      await setCarried(character.id, FRAGMENT, [4]);
      const [first, second] = await Promise.all([
        startRun(userId, character.id, 2),
        startRun(userId, character.id, 2),
      ]);
      expect(first.runeworkingError).toBeUndefined();
      expect(second.runeworkingError).toBeUndefined();
      const rows = await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, character.id));
      expect(rows.map((row) => row.actionId)).toEqual([ACTION]);
      const travel = await play.beginTravel(
        userId,
        character.id,
        LOCATION_IDS.theLowHum,
        at(ticks(2)),
      );
      expect(travel.commandError).toBe("another_action_active");
      expect(travel.location.currentLocationId).toBe(LOCATION_IDS.hilltopWorkshop);
    });
  });

  describe("a cycle resolves atomically", () => {
    it("reserves the Fragment in place, then consumes it and makes the Seeker together", async () => {
      const { userId, character } = await rig("Atomic");
      await setCarried(character.id, FRAGMENT, [3]);
      const started = await startRun(userId, character.id, 2);
      expect(await carried(character.id, FRAGMENT)).toBe(3);
      expect(started.resonanceRig.cycle).toMatchObject({ recipeActionId: ACTION, sequence: 1 });
      expect(started.activeAction?.actionId).toBe(ACTION);

      const midway = await play.getPlayGameplayState(
        userId,
        character.id,
        at(ticks(seeker.durationTicks) - 1),
        certain(),
      );
      expect(midway.carriedByItemId[FRAGMENT]).toBe(3);
      expect(midway.carriedByItemId[SEEKER]).toBeUndefined();

      const done = await play.getPlayGameplayState(userId, character.id, cycles(2), certain());
      expect(done.carriedByItemId[FRAGMENT]).toBe(1);
      expect(done.carriedByItemId[SEEKER]).toBe(2);
      expect(await runeworkingXp(character.id)).toBe(2 * seeker.baseXp);
      expect(await action(character.id)).toBeUndefined();
      expect(done.resonanceRig.lastStopReason).toBe("run_completed");
      expect(done.resonanceRig.run).toMatchObject({
        cycles: 2,
        inputsConsumed: { [FRAGMENT]: 2 },
        outputsGained: { [SEEKER]: 2 },
        xpGained: 2 * seeker.baseXp,
      });
      expect(done.resonanceRig.run.recentCycles.map((cycle) => cycle.sequence)).toEqual([1, 2]);
    });

    it("starts Runeworking XP at Level 1 on the shared curve", async () => {
      const { userId, character } = await rig("Curve");
      await setCarried(character.id, FRAGMENT, [1]);
      await startRun(userId, character.id, 1);
      const done = await play.getPlayGameplayState(userId, character.id, cycles(1), certain());
      expect(done.skillTotalXp[SKILL_IDS.runeworking]).toBe(seeker.baseXp);
      expect(seeker.baseXp).toBeLessThan(standardSkillLevelThresholds()[1]!.totalXp);
      expect(
        done.progression.skills.find((skill) => skill.displayName === "Runeworking"),
      ).toMatchObject({ level: 1 });
    });
  });

  describe("numeric and Max runs decide each next cycle from real state", () => {
    it("runs Max until the Fragments run out, filling a partial stack before a new one", async () => {
      const { userId, character } = await rig("Max");
      await setCarried(character.id, FRAGMENT, [7]);
      await setCarried(character.id, SEEKER, [3]);
      await startRun(userId, character.id, BOUNDED_RUN_MAX);
      expect((await rigRow(character.id))?.runSelectedCycles).toBeNull();
      const done = await play.getPlayGameplayState(userId, character.id, cycles(20), certain());
      expect(done.carriedByItemId[FRAGMENT]).toBeUndefined();
      expect((await stacks(character.id, SEEKER)).map((row) => row.quantity)).toEqual([5, 5]);
      expect(done.resonanceRig.lastStopReason).toBe("insufficient_inputs");
      expect(done.resonanceRig.run).toMatchObject({ selection: BOUNDED_RUN_MAX, cycles: 7 });
      expect(await runeworkingXp(character.id)).toBe(7 * seeker.baseXp);
    });

    it("stops Max when the next Seeker has nowhere to go, consuming nothing for it", async () => {
      const { userId, character } = await rig("Capacity");
      await setCarried(character.id, FRAGMENT, [3]);
      await setCarried(character.id, SEEKER, [4]);
      await fillSlots(userId, character.id);
      await startRun(userId, character.id, BOUNDED_RUN_MAX);
      const done = await play.getPlayGameplayState(userId, character.id, cycles(10), certain());
      // One Seeker tops up the partial stack; the next has no slot while a
      // Fragment still occupies its own.
      expect(done.carriedByItemId[SEEKER]).toBe(5);
      expect(done.carriedByItemId[FRAGMENT]).toBe(2);
      expect(done.resonanceRig.lastStopReason).toBe("inventory_slots_full");
      expect(await action(character.id)).toBeUndefined();
    });

    it("reserves only the cycle on the Rig: a numeric run stops early when spare Fragments are dropped", async () => {
      const { userId, character } = await rig("Spare");
      await setCarried(character.id, FRAGMENT, [1, 1]);
      await startRun(userId, character.id, 2);
      // One Fragment is the cycle's; the other is not reserved yet.
      const [, spare] = await stacks(character.id, FRAGMENT);
      const dropped = await inventory.discardInventoryStack(
        userId,
        character.id,
        { stackId: spare!.id, mode: "stack", expectedQuantity: 1 },
        at(ticks(1)),
      );
      expect(dropped.discard.status).toBe("discarded");
      const done = await play.getPlayGameplayState(userId, character.id, cycles(5), certain());
      expect(done.resonanceRig.run.cycles).toBe(1);
      expect(done.carriedByItemId[SEEKER]).toBe(1);
      expect(done.resonanceRig.lastStopReason).toBe("insufficient_inputs");
    });

    it("Finish Current completes the cycle on the Rig, pays for it, and starts no other", async () => {
      const { userId, character } = await rig("Finish");
      await setCarried(character.id, FRAGMENT, [6]);
      await startRun(userId, character.id, BOUNDED_RUN_MAX);
      const asked = await commands.finishCurrentRuneworking(userId, character.id, at(ticks(3)));
      expect(asked.resonanceRig.cycle?.finishCurrent).toBe(true);
      const done = await play.getPlayGameplayState(userId, character.id, cycles(10), certain());
      expect(done.carriedByItemId[SEEKER]).toBe(1);
      expect(done.carriedByItemId[FRAGMENT]).toBe(5);
      expect(await runeworkingXp(character.id)).toBe(seeker.baseXp);
      expect(done.resonanceRig.lastStopReason).toBe("finished_current");
      expect((await rigRow(character.id))?.finishCurrent).toBe(false);
      // A late retry after the run ended changes nothing.
      const late = await commands.finishCurrentRuneworking(userId, character.id, cycles(11));
      expect(late.runeworkingError).toBeUndefined();
      expect(late.carriedByItemId[SEEKER]).toBe(1);
    });

    it("resolves the same way lazily after reconnecting, with the cycle's identity intact", async () => {
      const { userId, character } = await rig("Offline");
      await setCarried(character.id, FRAGMENT, [5]);
      await startRun(userId, character.id, 3);
      const partway = at(ticks(seeker.durationTicks + 4));
      const first = await play.getPlayGameplayState(userId, character.id, partway, certain());
      const second = await play.getPlayGameplayState(userId, character.id, partway, certain());
      expect(second.resonanceRig.cycle).toEqual(first.resonanceRig.cycle);
      expect(second.resonanceRig.cycle?.sequence).toBe(2);
      expect(second.carriedByItemId[SEEKER]).toBe(1);
      const done = await play.getPlayGameplayState(userId, character.id, cycles(1_000), certain());
      expect(done.carriedByItemId[SEEKER]).toBe(3);
      expect(done.carriedByItemId[FRAGMENT]).toBe(2);
      expect(await runeworkingXp(character.id)).toBe(3 * seeker.baseXp);
    });
  });

  describe("a started cycle is binding", () => {
    it("keeps its reserved Fragment: dropping it is refused and rolled back, spare units are not", async () => {
      const { userId, character } = await rig("Reserved");
      await setCarried(character.id, FRAGMENT, [2]);
      await startRun(userId, character.id, 1);
      const [stack] = await stacks(character.id, FRAGMENT);
      await expect(
        inventory.discardInventoryStack(
          userId,
          character.id,
          { stackId: stack!.id, mode: "stack", expectedQuantity: 2 },
          at(ticks(1)),
        ),
      ).rejects.toBeInstanceOf(reservation.RuneworkingReservationError);
      expect(await carried(character.id, FRAGMENT)).toBe(2);
      const dropped = await inventory.discardInventoryStack(
        userId,
        character.id,
        { stackId: stack!.id, mode: "one", expectedQuantity: 2 },
        at(ticks(2)),
      );
      expect(dropped.discard.status).toBe("discarded");
      const done = await play.getPlayGameplayState(userId, character.id, cycles(1), certain());
      expect(done.carriedByItemId[SEEKER]).toBe(1);
      expect(done.carriedByItemId[FRAGMENT]).toBeUndefined();
    });

    it("gives operators the same answer, and their Stop clears it without consuming anything", async () => {
      const { userId, character } = await rig("Operator");
      await setCarried(character.id, FRAGMENT, [1]);
      await startRun(userId, character.id, 1);
      const [stack] = await stacks(character.id, FRAGMENT);
      const adminUserId = await createTestUser(db, authSchema, "Rig Operator");
      createdUsers.push(adminUserId);
      await expect(
        admin.removeCarriedStackQuantityAsAdmin(
          adminUserId,
          character.id,
          stack!.id,
          "stack",
          1,
          at(ticks(1)),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const stopped = await admin.stopCurrentActionAsAdmin(adminUserId, character.id, at(ticks(2)));
      expect(stopped.outcome).toEqual({ kind: "interrupted", actionId: ACTION });
      expect(await carried(character.id, FRAGMENT)).toBe(1);
      expect(await carried(character.id, SEEKER)).toBe(0);
      expect(await runeworkingXp(character.id)).toBe(0);
      const later = await play.getPlayGameplayState(userId, character.id, cycles(5), certain());
      expect(later.resonanceRig.cycle).toBeUndefined();
      expect(later.carriedByItemId[SEEKER]).toBeUndefined();
    });
  });
});
