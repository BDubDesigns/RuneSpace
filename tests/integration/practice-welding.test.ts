import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, practiceSectionXp } from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import type { CleanPassOpportunity } from "@/game/domain/clean-pass";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #190 — Practice Welding and Clean Pass, against real PostgreSQL.
 *
 * What only a database proves: that a cycle's two Scrap leave the inventory
 * exactly once under retries, that the Mission counts only completed welds
 * (including ones resolved lazily while the player was away), that Stop and
 * Travel preserve the partial weld the player paid for while closing an open
 * Clean Pass window, and that a claim advances real work and pays the right XP
 * for Practice and for an authored repair alike.
 */
suite("issue #190 Practice Welding (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let practiceCommands: typeof import("@/server/practice-commands");
  let cleanPass: typeof import("@/server/clean-pass");
  let repairCommands: typeof import("@/server/repair-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-15T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const sectionMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const weldMs = sectionMs * balance.practiceWelding.sectionsPerWeld;
  const sectionXp = practiceSectionXp(balance);

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    practiceCommands = await import("@/server/practice-commands");
    cleanPass = await import("@/server/clean-pass");
    repairCommands = await import("@/server/repair-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** Every roll lands on the authored minimum, so placements are predictable. */
  function deterministicRandom() {
    return { nextBasisPoints: () => 0, nextUnit: () => 0 };
  }

  const at = (msFromStart: number) => new Date(start.getTime() + msFromStart);

  async function apprentice(options: { accepted?: boolean; scrap?: number } = {}) {
    const userId = await createTestUser(db, authSchema, "Practice Welding Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Bench ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, deterministicRandom());
    await db.insert(rune.characterMissions).values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
      ].map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    if (options.accepted !== false) {
      // Acceptance itself grants six Scrap; extra pieces are added on top.
      await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.tenThousandHours,
        "wade_rusk",
        start,
        deterministicRandom(),
      );
    }
    if (options.scrap !== undefined) await setScrap(character.id, options.scrap);
    return { userId, character };
  }

  async function setScrap(characterId: string, pieces: number) {
    await db
      .delete(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, characterId),
          eq(rune.inventoryStacks.itemId, ITEM_IDS.scrapMetal),
        ),
      );
    for (let index = 0; index < pieces; index += 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.scrapMetal, quantity: 1 });
    }
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

  async function practiceRow(characterId: string) {
    return (
      await db
        .select()
        .from(rune.characterPracticeWelds)
        .where(eq(rune.characterPracticeWelds.characterId, characterId))
    )[0];
  }

  async function weldCounter(characterId: string) {
    return (
      await db
        .select({ progress: rune.characterMissionProgress.progress })
        .from(rune.characterMissionProgress)
        .where(
          and(
            eq(rune.characterMissionProgress.characterId, characterId),
            eq(rune.characterMissionProgress.missionId, MISSION_IDS.tenThousandHours),
            eq(rune.characterMissionProgress.progressKey, "practice-welds"),
          ),
        )
    )[0]?.progress;
  }

  async function weldingXp(characterId: string) {
    return (
      (
        await db
          .select({ totalXp: rune.characterSkillXp.totalXp })
          .from(rune.characterSkillXp)
          .where(
            and(
              eq(rune.characterSkillXp.characterId, characterId),
              eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
            ),
          )
      )[0]?.totalXp ?? 0
    );
  }

  const refresh = (userId: string, characterId: string, ms: number) =>
    play.getPlayGameplayState(userId, characterId, at(ms), deterministicRandom());

  const startPractice = (userId: string, characterId: string, ms = 0) =>
    practiceCommands.startPracticeWelding(userId, characterId, at(ms), deterministicRandom());

  it("consumes the cycle's two Scrap exactly once, even under retried starts", async () => {
    const { userId, character } = await apprentice();
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(6);

    await startPractice(userId, character.id);
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(4);

    // A retried Start on a bench that is already running is idempotent.
    await startPractice(userId, character.id, 100);
    await startPractice(userId, character.id, 200);
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(4);
  });

  it("refuses to start without two Scrap, and consumes nothing", async () => {
    const { userId, character } = await apprentice({ scrap: 1 });
    const refused = await startPractice(userId, character.id);
    expect(refused.practiceError).toBe("insufficient_scrap");
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(1);
    expect(await practiceRow(character.id)).toBeUndefined();
  });

  it("refuses to start away from the yard", async () => {
    const { userId, character } = await apprentice();
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.holoHollow })
      .where(eq(rune.characters.id, character.id));
    const refused = await startPractice(userId, character.id);
    expect(refused.practiceError).toBe("practice_unavailable_here");
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(6);
  });

  it("resolves a completed weld into Slag, XP, and one Mission weld", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await startPractice(userId, character.id);
    const state = await refresh(userId, character.id, weldMs);

    expect(state.practice.run.welds).toBe(1);
    expect(await carried(character.id, ITEM_IDS.slag)).toBe(balance.practiceWelding.slagPerWeld);
    expect(await weldingXp(character.id)).toBe(balance.practiceWelding.sectionsPerWeld * sectionXp);
    expect(await weldCounter(character.id)).toBe(1);
    // Out of Scrap, so the run stopped on its own.
    expect(state.practice.active).toBe(false);
    expect(state.practice.lastStopReason).toBe("out_of_scrap");
  });

  it("counts only completed welds, never sections", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await startPractice(userId, character.id);

    await refresh(userId, character.id, sectionMs * 9);
    expect(await weldCounter(character.id)).toBe(0);

    await refresh(userId, character.id, weldMs);
    expect(await weldCounter(character.id)).toBe(1);
  });

  it("counts welds resolved lazily while the player was away", async () => {
    const { userId, character } = await apprentice({ scrap: 6 });
    await startPractice(userId, character.id);

    // One command, long after the fact: the whole run resolves at once.
    const state = await refresh(userId, character.id, weldMs * 3);
    expect(state.practice.run.welds).toBe(3);
    expect(await weldCounter(character.id)).toBe(3);
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    expect(await carried(character.id, ITEM_IDS.slag)).toBe(6);
  });

  it("caps the Mission counter at three however many welds follow", async () => {
    const { userId, character } = await apprentice({ scrap: 10 });
    await startPractice(userId, character.id);
    await refresh(userId, character.id, weldMs * 5);
    expect(await weldCounter(character.id)).toBe(3);
  });

  it("keeps running while the player is away, through the ordinary resolution path", async () => {
    // Scrap, not the clock, is what ends a real Practice run: six pieces is
    // three welds, and a player cannot carry enough to reach the standard
    // one-hour offline cap. So what a long absence must prove is that the whole
    // run resolved on the next command and stopped itself cleanly.
    const { userId, character } = await apprentice({ scrap: 6 });
    await startPractice(userId, character.id);

    const state = await refresh(userId, character.id, 2 * 60 * 60 * 1_000);
    expect(state.practice.run.welds).toBe(3);
    expect(state.practice.active).toBe(false);
    expect(state.practice.lastStopReason).toBe("out_of_scrap");
    expect(await weldCounter(character.id)).toBe(3);
  });

  it("accounts for every Slag a run produces, kept or discarded", async () => {
    const { userId, character } = await apprentice({ scrap: 4 });
    await startPractice(userId, character.id);
    const state = await refresh(userId, character.id, weldMs * 2);
    expect(state.practice.run.welds).toBe(2);
    expect(state.practice.run.slagKept + state.practice.run.slagDiscarded).toBe(
      2 * balance.practiceWelding.slagPerWeld,
    );
    expect(await carried(character.id, ITEM_IDS.slag)).toBe(state.practice.run.slagKept);
  });

  it("discards both Slag when the player has chosen Auto-discard", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await practiceCommands.setPracticeSlagPreference(
      userId,
      character.id,
      true,
      start,
      deterministicRandom(),
    );
    await startPractice(userId, character.id);
    const state = await refresh(userId, character.id, weldMs);

    expect(state.practice.run.slagKept).toBe(0);
    expect(state.practice.run.slagDiscarded).toBe(balance.practiceWelding.slagPerWeld);
    expect(await carried(character.id, ITEM_IDS.slag)).toBe(0);
    // The preference is persistent, not a per-run choice.
    expect(state.practice.autoDiscardSlag).toBe(true);
  });

  it("preserves the partial weld and its Scrap across a manual Stop and Resume", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await startPractice(userId, character.id);
    await practiceCommands.stopPracticeWelding(
      userId,
      character.id,
      at(sectionMs * 4),
      deterministicRandom(),
    );

    const stopped = await practiceRow(character.id);
    expect(stopped?.sectionsCompleted).toBe(4);
    expect(stopped?.cycleActive).toBe(true);
    // Stop never refunds Scrap and never produces Slag early.
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    expect(await carried(character.id, ITEM_IDS.slag)).toBe(0);

    // Resume finishes the same weld with no Scrap left at all.
    const resumed = await startPractice(userId, character.id, sectionMs * 10);
    expect(resumed.practice.active).toBe(true);
    await refresh(userId, character.id, sectionMs * 16);
    expect(await weldCounter(character.id)).toBe(1);
    expect(await carried(character.id, ITEM_IDS.slag)).toBe(balance.practiceWelding.slagPerWeld);
  });

  it("stops the bench on Travel through the same interruption, keeping the partial weld", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await startPractice(userId, character.id);
    await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.holoHollow,
      at(sectionMs * 3),
      deterministicRandom(),
    );

    const row = await practiceRow(character.id);
    expect(row?.sectionsCompleted).toBe(3);
    expect(row?.cycleActive).toBe(true);
    const action = (
      await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, character.id))
    )[0];
    expect(action?.actionId).toBe(ACTION_IDS.travel);
    // No remote welding: the bench is not resolving anything from the road.
    await refresh(userId, character.id, sectionMs * 20);
    expect((await practiceRow(character.id))?.sectionsCompleted).toBe(3);
  });

  it("marks an open Clean Pass missed when Travel interrupts it", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await startPractice(userId, character.id);
    const rolled = await practiceRow(character.id);
    // Deterministic rolls put every opportunity at its window's minimum.
    const opportunities = rolled?.cleanPass as CleanPassOpportunity[];
    expect(opportunities[0]!.section).toBe(balance.welding.cleanPass.windowStartSection);

    // Walk away during that very section.
    await play.beginTravel(
      userId,
      character.id,
      LOCATION_IDS.holoHollow,
      at(sectionMs * (opportunities[0]!.section - 1) + 100),
      deterministicRandom(),
    );
    const interrupted = await practiceRow(character.id);
    const interruptedOpportunities = interrupted?.cleanPass as CleanPassOpportunity[];
    expect(interruptedOpportunities[0]!.outcome).toBe("missed");
    // The later opportunity is untouched and stays scheduled.
    expect(interruptedOpportunities[1]!.outcome).toBeNull();
  });

  it("claims a Clean Pass for one extra section and its Practice XP", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await startPractice(userId, character.id);
    const rolled = await practiceRow(character.id);
    const opportunity = (rolled?.cleanPass as CleanPassOpportunity[])[0]!.section;

    // Stand inside that section: the sections before it have resolved.
    const claimAt = sectionMs * (opportunity - 1) + 100;
    const claimed = await cleanPass.claimCleanPass(
      userId,
      character.id,
      at(claimAt),
      deterministicRandom(),
    );

    expect(claimed.cleanPass).toEqual({ status: "claimed", awardedXp: sectionXp });
    const after = await practiceRow(character.id);
    // One extra section immediately: the sections that resolved on their own,
    // plus the claimed one.
    expect(after?.sectionsCompleted).toBe(opportunity);
    expect((after?.cleanPass as CleanPassOpportunity[])[0]!.outcome).toBe("claimed");
    // The claim's own command reconciled the sections that had elapsed, so the
    // total is those sections plus the claimed one, all at Practice rates.
    expect(await weldingXp(character.id)).toBe(opportunity * sectionXp);
  });

  it("refuses a second claim on the same opportunity", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    await startPractice(userId, character.id);
    const opportunity = ((await practiceRow(character.id))!.cleanPass as CleanPassOpportunity[])[0]!
      .section;
    const claimAt = sectionMs * (opportunity - 1) + 100;
    await cleanPass.claimCleanPass(userId, character.id, at(claimAt), deterministicRandom());

    const again = await cleanPass.claimCleanPass(
      userId,
      character.id,
      at(claimAt + 50),
      deterministicRandom(),
    );
    expect(again.cleanPass).toMatchObject({ status: "refused" });
  });

  it("refuses a claim when no Welding is happening at all", async () => {
    const { userId, character } = await apprentice({ scrap: 2 });
    const refused = await cleanPass.claimCleanPass(
      userId,
      character.id,
      start,
      deterministicRandom(),
    );
    expect(refused.cleanPass).toMatchObject({ status: "refused", reason: "no_welding" });
  });

  it("applies Clean Pass to an authored repair at full Welding XP", async () => {
    const { userId, character } = await apprentice({ accepted: false });
    // Stage a Cargo Hold with its materials in and Hold It Together accepted.
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(rune.characters.id, character.id));
    await db.insert(rune.characterRepairTargets).values({
      characterId: character.id,
      targetId: REPAIR_TARGET_IDS.cargoHold,
      refinedFerriteContributed: balance.repairTargets.cargoHold.refinedFerriteRequired,
      slagContributed: balance.repairTargets.cargoHold.slagRequired,
    });

    await repairCommands.startWelding(
      userId,
      character.id,
      REPAIR_TARGET_IDS.cargoHold,
      start,
      deterministicRandom(),
    );
    const repairRow = (
      await db
        .select()
        .from(rune.characterRepairTargets)
        .where(
          and(
            eq(rune.characterRepairTargets.characterId, character.id),
            eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.cargoHold),
          ),
        )
    )[0];
    const opportunity = (repairRow!.cleanPass as CleanPassOpportunity[])[0]!.section;
    expect(opportunity).toBeGreaterThanOrEqual(2);

    const xpBefore = await weldingXp(character.id);
    const claimed = await cleanPass.claimCleanPass(
      userId,
      character.id,
      at(sectionMs * (opportunity - 1) + 100),
      deterministicRandom(),
    );
    expect(claimed.cleanPass).toEqual({
      status: "claimed",
      awardedXp: balance.welding.xpPerIncrement,
    });
    // A repair section pays full Welding XP, unlike a Practice section: the
    // increments that resolved before the claim plus the claimed one.
    expect(xpBefore).toBe(0);
    expect(await weldingXp(character.id)).toBe(opportunity * balance.welding.xpPerIncrement);
  });

  it("never rerolls a repair's opportunities across Stop and Resume", async () => {
    const { userId, character } = await apprentice({ accepted: false });
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.crashSite })
      .where(eq(rune.characters.id, character.id));
    await db.insert(rune.characterRepairTargets).values({
      characterId: character.id,
      targetId: REPAIR_TARGET_IDS.cargoHold,
      refinedFerriteContributed: balance.repairTargets.cargoHold.refinedFerriteRequired,
      slagContributed: balance.repairTargets.cargoHold.slagRequired,
    });

    const rolls = async () => {
      const row = (
        await db
          .select()
          .from(rune.characterRepairTargets)
          .where(
            and(
              eq(rune.characterRepairTargets.characterId, character.id),
              eq(rune.characterRepairTargets.targetId, REPAIR_TARGET_IDS.cargoHold),
            ),
          )
      )[0];
      const opportunities = row?.cleanPass as CleanPassOpportunity[] | null | undefined;
      return opportunities?.map((entry) => entry.section);
    };

    await repairCommands.startWelding(
      userId,
      character.id,
      REPAIR_TARGET_IDS.cargoHold,
      start,
      deterministicRandom(),
    );
    const first = await rolls();
    await repairCommands.stopWelding(
      userId,
      character.id,
      REPAIR_TARGET_IDS.cargoHold,
      at(sectionMs),
      deterministicRandom(),
    );
    await repairCommands.startWelding(
      userId,
      character.id,
      REPAIR_TARGET_IDS.cargoHold,
      at(sectionMs * 2),
      { nextBasisPoints: () => 2, nextUnit: () => 0 },
    );
    expect(await rolls()).toEqual(first);
  });

  it("starts a fresh run's totals from zero without touching the weld in progress", async () => {
    const { userId, character } = await apprentice({ scrap: 4 });
    await startPractice(userId, character.id);
    await refresh(userId, character.id, weldMs);
    expect((await practiceRow(character.id))?.runWelds).toBe(1);

    await practiceCommands.stopPracticeWelding(
      userId,
      character.id,
      at(weldMs + sectionMs * 2),
      deterministicRandom(),
    );
    const partial = await practiceRow(character.id);
    expect(partial?.cycleActive).toBe(true);

    await startPractice(userId, character.id, weldMs + sectionMs * 3);
    const restarted = await practiceRow(character.id);
    expect(restarted?.runWelds).toBe(0);
    // The partial weld itself survived the new run.
    expect(restarted?.cycleActive).toBe(true);
    expect(restarted?.sectionsCompleted).toBe(partial?.sectionsCompleted);
  });

  it("does not dead-end the Mission when the free Scrap is lost", async () => {
    const { userId, character } = await apprentice();
    await setScrap(character.id, 0);
    await db
      .update(rune.characters)
      .set({ credits: 20 })
      .where(eq(rune.characters.id, character.id));

    const trade = await import("@/server/trade");
    const bought = await trade.tradeWithMerchant(
      userId,
      character.id,
      { itemId: ITEM_IDS.scrapMetal, direction: "buy", quantity: 2 },
      start,
    );
    expect(bought.trade.status).toBe("traded");

    await startPractice(userId, character.id);
    await refresh(userId, character.id, weldMs);
    expect(await weldCounter(character.id)).toBe(1);
  });
});
