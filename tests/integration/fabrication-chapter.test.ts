import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import {
  ACTION_IDS,
  DIALOGUE_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getResidentNpcs } from "@/game/content/npcs";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import type { OverrideRandom } from "@/game/domain/manual-override";
import type { PlayGameplayState } from "@/server/play";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #232 — Tansy's Fabrication teaching chapter against real PostgreSQL,
 * through the real Mission, Fabrication and Tinkering commands:
 *
 * 10,000 Hours → Tansy at Rusk beside Wade → Return the Favor (a deliberate
 * pickup) → a genuinely fabricated Salvage Cutter → any unequipped Cutter
 * handed in → Tinkering unlocked → Break It Down (automatic) → one Tinkering
 * batch → Tansy home at The Jag → Brace Yourself on offer.
 */
suite("issue #232 Tansy's Fabrication chapter (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let missions: typeof import("@/server/missions");
  let progression: typeof import("@/server/progression");
  let fabrication: typeof import("@/server/fabrication-commands");
  let tinkering: typeof import("@/server/tinkering-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-09-20T00:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const cutterTicks = balance.fabrication.recipes.salvageCutter.durationTicks;
  const at = (tick: number) => new Date(start.getTime() + tick * GAME_TICK_MS);
  const certain = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  /** Every Override draw is the lowest: Load 2 trending HIGHER, each push rolling up by one. */
  const lowest: OverrideRandom = { nextInt: () => 0 };

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    missions = await import("@/server/missions");
    progression = await import("@/server/progression");
    fabrication = await import("@/server/fabrication-commands");
    tinkering = await import("@/server/tinkering-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A character who has just finished 10,000 Hours, standing in Wade's yard. */
  async function apprentice(label: string) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Chapter ${userId.slice(0, 6)}`,
    );
    await play.getPlayGameplayState(userId, character.id, start, certain());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.ruskRecovery })
      .where(eq(rune.characters.id, character.id));
    await db.insert(rune.characterMissions).values(
      [
        MISSION_IDS.walkItOff,
        MISSION_IDS.cutYourTeeth,
        MISSION_IDS.wasteNot,
        MISSION_IDS.holdItTogether,
        MISSION_IDS.keepTheChange,
        MISSION_IDS.tenThousandHours,
      ].map((missionId) => ({
        characterId: character.id,
        missionId,
        acceptedAt: start,
        completedAt: start,
      })),
    );
    return { userId, character };
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

  async function cutters(characterId: string) {
    return db
      .select()
      .from(rune.itemInstances)
      .where(
        and(
          eq(rune.itemInstances.characterId, characterId),
          eq(rune.itemInstances.itemId, ITEM_IDS.salvageCutter),
        ),
      );
  }

  async function fabricationXp(characterId: string) {
    const [row] = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.fabrication),
        ),
      );
    return row?.totalXp ?? 0;
  }

  const mission = (state: PlayGameplayState, missionId: string) =>
    state.missions.find((candidate) => candidate.missionId === missionId)!;

  const tansyEntry = (state: PlayGameplayState, missionId: string) =>
    resolveNpcConversation(NPC_IDS.tansyRusk, state.missions).find(
      (entry) => entry.kind === "mission" && entry.missionId === missionId,
    );

  const residentsAt = (state: PlayGameplayState, locationId: string) =>
    getResidentNpcs({
      locationId,
      completedMissionIds: deriveCompletedMissionIds(state.missions),
    }).map((npc) => npc.id);

  /** Accept Return the Favor and fabricate one Cutter, optionally pushing it once first. */
  async function fabricateCutter(
    userId: string,
    characterId: string,
    tick: number,
    options: { push?: number } = {},
  ) {
    await give(characterId, ITEM_IDS.refinedFerrite, 5);
    await give(characterId, ITEM_IDS.powerCell, 1);
    await fabrication.startFabrication(
      userId,
      characterId,
      ACTION_IDS.salvageCutterFabrication,
      1,
      at(tick),
      certain(),
      lowest,
    );
    if (options.push !== undefined) {
      const state = await play.getPlayGameplayState(userId, characterId, at(tick));
      const sequence = state.fabricationStation.workpiece!.sequence;
      await fabrication.pushFabricationOverride(
        userId,
        characterId,
        options.push,
        sequence,
        0,
        at(tick + 1),
        certain(),
        lowest,
      );
      const after = await play.getPlayGameplayState(userId, characterId, at(tick + 1));
      if (after.fabricationStation.workpiece?.override) {
        await fabrication.lockInFabricationOverride(
          userId,
          characterId,
          sequence,
          at(tick + 2),
          certain(),
          lowest,
        );
      }
    }
    return play.getPlayGameplayState(userId, characterId, at(tick + cutterTicks + 5));
  }

  it("runs the whole chapter, in order, exactly once", async () => {
    const { userId, character } = await apprentice("Whole chapter");
    let state = await play.getPlayGameplayState(userId, character.id, start, certain());

    // Tansy has come to the yard; Wade is still here; the offer is a pickup.
    expect(residentsAt(state, LOCATION_IDS.ruskRecovery)).toEqual([
      NPC_IDS.wadeRusk,
      NPC_IDS.tansyRusk,
    ]);
    expect(residentsAt(state, LOCATION_IDS.theJag)).not.toContain(NPC_IDS.tansyRusk);
    expect(mission(state, MISSION_IDS.returnTheFavor).state).toBe("not_accepted");
    expect(mission(state, MISSION_IDS.returnTheFavor).guidance?.availableNpcIds).toEqual([
      NPC_IDS.tansyRusk,
    ]);
    expect(tansyEntry(state, MISSION_IDS.returnTheFavor)).toMatchObject({
      role: "offer",
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorOffer,
    });
    expect(state.fabricationStation.unlocked).toBe(false);

    const accepted = await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.returnTheFavor,
      NPC_IDS.tansyRusk,
      at(1),
      certain(),
    );
    expect(accepted.mission.status).toBe("accepted");
    expect(accepted.state.fabricationStation.unlocked).toBe(true);
    expect(accepted.state.tinkering.unlocked).toBe(false);

    state = await fabricateCutter(userId, character.id, 2);
    const rtf = mission(state, MISSION_IDS.returnTheFavor);
    expect(rtf.requirements?.[0]).toMatchObject({
      satisfied: true,
      progress: { current: 1, target: 1 },
    });
    expect(rtf.stage?.turnInAvailable).toBe(true);
    expect(rtf.facts).toEqual([]);
    // No Override facts: the ordinary opening.
    expect(tansyEntry(state, MISSION_IDS.returnTheFavor)).toMatchObject({
      role: "turn_in",
      dialogueId: DIALOGUE_IDS.tansyReturnTheFavorTurnIn,
      action: { kind: "complete_mission" },
    });
    const xpBefore = await fabricationXp(character.id);
    const equippedCutter = (await cutters(character.id)).find((row) => row.currentCharge === null);

    const completed = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.returnTheFavor,
      NPC_IDS.tansyRusk,
      at(100),
      certain(),
    );
    expect(completed.mission.status).toBe("completed");
    expect((await fabricationXp(character.id)) - xpBefore).toBe(100);
    // Tansy took one unequipped Cutter; the tool in the player's hand stays.
    const remaining = await cutters(character.id);
    expect(remaining).toHaveLength(1);
    if (equippedCutter) expect(remaining[0]!.id).toBe(equippedCutter.id);
    // Her demonstration Scrap is illustrative: nothing was granted.
    expect(await carried(character.id, ITEM_IDS.scrapMetal)).toBe(0);
    // Tinkering opens, and Break It Down continues automatically.
    expect(completed.state.tinkering.unlocked).toBe(true);
    expect(mission(completed.state, MISSION_IDS.breakItDown).state).toBe("active");
    const retried = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.returnTheFavor,
      NPC_IDS.tansyRusk,
      at(101),
      certain(),
    );
    expect(retried.mission.status).toBe("already_completed");
    expect((await fabricationXp(character.id)) - xpBefore).toBe(100);

    // Break It Down: one genuinely completed Tinkering batch of anything eligible.
    expect(tansyEntry(completed.state, MISSION_IDS.breakItDown)).toMatchObject({
      role: "active",
      dialogueId: DIALOGUE_IDS.tansyBreakItDownReminder,
    });
    await give(character.id, ITEM_IDS.mountingBracket, 1);
    await tinkering.startTinkering(
      userId,
      character.id,
      ACTION_IDS.mountingBracketTinkering,
      1,
      at(200),
    );
    const midway = await play.getPlayGameplayState(userId, character.id, at(210));
    expect(mission(midway, MISSION_IDS.breakItDown).requirements?.[0]?.satisfied).toBe(false);
    state = await play.getPlayGameplayState(userId, character.id, at(200 + 24));
    expect(mission(state, MISSION_IDS.breakItDown).stage?.turnInAvailable).toBe(true);
    const xpBeforeBreak = await fabricationXp(character.id);
    const closed = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.breakItDown,
      NPC_IDS.tansyRusk,
      at(300),
      certain(),
    );
    expect(closed.mission.status).toBe("completed");
    expect((await fabricationXp(character.id)) - xpBeforeBreak).toBe(250);

    // Tansy goes home; Wade stays; the Deep Jag becomes the next story gate.
    expect(residentsAt(closed.state, LOCATION_IDS.theJag)).toEqual([NPC_IDS.tansyRusk]);
    expect(residentsAt(closed.state, LOCATION_IDS.ruskRecovery)).toEqual([NPC_IDS.wadeRusk]);
    expect(mission(closed.state, MISSION_IDS.braceYourself).prerequisiteSatisfied).toBe(false);
    for (const skillId of [SKILL_IDS.mining, SKILL_IDS.welding]) {
      await db.transaction(async (transaction) => {
        await progression.grantCharacterSkillXp(transaction, {
          characterId: character.id,
          skillId,
          awardedXp: 2_320,
          thresholds: standardSkillLevelThresholds(balance),
        });
      });
    }
    const gate = await play.getPlayGameplayState(userId, character.id, at(301));
    expect(mission(gate, MISSION_IDS.braceYourself).prerequisiteSatisfied).toBe(true);
    // 10,001 Hours stays independent of the whole chapter.
    expect(mission(gate, MISSION_IDS.tenThousandOneHours).state).toBe("not_accepted");
  });

  it("cannot be satisfied by a Cutter that was bought, given or already owned", async () => {
    const { userId, character } = await apprentice("Pre-owned");
    await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.returnTheFavor,
      NPC_IDS.tansyRusk,
      at(1),
      certain(),
    );
    await db.insert(rune.itemInstances).values([
      { characterId: character.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 },
      { characterId: character.id, itemId: ITEM_IDS.salvageCutter, currentCharge: 0 },
    ]);
    const state = await play.getPlayGameplayState(userId, character.id, at(2));
    const rtf = mission(state, MISSION_IDS.returnTheFavor);
    expect(rtf.requirements?.[0]?.satisfied).toBe(false);
    expect(rtf.requirements?.[1]?.satisfied).toBe(true);
    const refused = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.returnTheFavor,
      NPC_IDS.tansyRusk,
      at(3),
      certain(),
    );
    expect(refused.mission.status).toBe("refused");
    expect(await cutters(character.id)).toHaveLength(3);
  });

  it("never takes an equipped Cutter at the turn-in", async () => {
    const { userId, character } = await apprentice("Equipped only");
    await missions.acceptMission(
      userId,
      character.id,
      MISSION_IDS.returnTheFavor,
      NPC_IDS.tansyRusk,
      at(1),
      certain(),
    );
    await fabricateCutter(userId, character.id, 2);
    // Put the new Cutter in the Cargo Hold: now only the equipped one is carried.
    const [made] = (await cutters(character.id)).filter((row) => row.currentCharge === 0);
    await db
      .insert(rune.cargoHoldItemInstances)
      .values({ characterId: character.id, itemInstanceId: made!.id });
    const state = await play.getPlayGameplayState(userId, character.id, at(40));
    const rtf = mission(state, MISSION_IDS.returnTheFavor);
    expect(rtf.requirements?.[1]?.satisfied).toBe(false);
    expect(tansyEntry(state, MISSION_IDS.returnTheFavor)).not.toHaveProperty("action");
    const refused = await missions.completeMission(
      userId,
      character.id,
      MISSION_IDS.returnTheFavor,
      NPC_IDS.tansyRusk,
      at(41),
      certain(),
    );
    expect(refused.mission.status).toBe("refused");
    expect(await cutters(character.id)).toHaveLength(2);
  });

  describe("Tansy reacts to what she watched", () => {
    it("remembers a bust: the amused reminder, then the bust-aware opening over a clean Override", async () => {
      const { userId, character } = await apprentice("Busted");
      await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.returnTheFavor,
        NPC_IDS.tansyRusk,
        at(1),
        certain(),
      );
      await fabrication.setManualOverride(userId, character.id, true, at(1));
      // Load 2 HIGHER; the next Load rolls 3, so a Feed of 10 busts.
      const busted = await fabricateCutter(userId, character.id, 2, { push: 10 });
      const afterBust = mission(busted, MISSION_IDS.returnTheFavor);
      expect(afterBust.facts).toEqual(["override-bust"]);
      expect(afterBust.requirements?.[0]?.satisfied).toBe(false);
      expect(await carried(character.id, ITEM_IDS.refinedFerrite)).toBe(0);
      expect(tansyEntry(busted, MISSION_IDS.returnTheFavor)).toMatchObject({
        role: "active",
        dialogueId: DIALOGUE_IDS.tansyReturnTheFavorBustReminder,
      });

      // Then a clean Override success: Feed 3 lands exactly on the rolled 3.
      const made = await fabricateCutter(userId, character.id, 100, { push: 3 });
      const both = mission(made, MISSION_IDS.returnTheFavor);
      expect([...(both.facts ?? [])].sort()).toEqual(["override-bust", "override-success"]);
      expect(tansyEntry(made, MISSION_IDS.returnTheFavor)).toMatchObject({
        role: "turn_in",
        dialogueId: DIALOGUE_IDS.tansyReturnTheFavorBustTurnIn,
        action: { kind: "complete_mission" },
      });
    });

    it("approves a clean Override success when nothing busted", async () => {
      const { userId, character } = await apprentice("Pushed");
      await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.returnTheFavor,
        NPC_IDS.tansyRusk,
        at(1),
        certain(),
      );
      await fabrication.setManualOverride(userId, character.id, true, at(1));
      const made = await fabricateCutter(userId, character.id, 2, { push: 3 });
      const rtf = mission(made, MISSION_IDS.returnTheFavor);
      expect(rtf.facts).toEqual(["override-success"]);
      expect(tansyEntry(made, MISSION_IDS.returnTheFavor)).toMatchObject({
        role: "turn_in",
        dialogueId: DIALOGUE_IDS.tansyReturnTheFavorOverrideTurnIn,
      });
      // Enabling Override but locking in without a push is not "using" it.
      const { userId: other, character: plain } = await apprentice("Locked at once");
      await missions.acceptMission(
        other,
        plain.id,
        MISSION_IDS.returnTheFavor,
        NPC_IDS.tansyRusk,
        at(1),
        certain(),
      );
      await fabrication.setManualOverride(other, plain.id, true, at(1));
      await give(plain.id, ITEM_IDS.refinedFerrite, 5);
      await give(plain.id, ITEM_IDS.powerCell, 1);
      await fabrication.startFabrication(
        other,
        plain.id,
        ACTION_IDS.salvageCutterFabrication,
        1,
        at(2),
        certain(),
        lowest,
      );
      await fabrication.lockInFabricationOverride(other, plain.id, 1, at(3));
      const unpushed = await play.getPlayGameplayState(other, plain.id, at(2 + cutterTicks + 1));
      expect(mission(unpushed, MISSION_IDS.returnTheFavor).facts).toEqual([]);
    });

    it("keeps the facts Mission-local: they are gone once the Mission is reset", async () => {
      const { userId, character } = await apprentice("Local");
      await missions.acceptMission(
        userId,
        character.id,
        MISSION_IDS.returnTheFavor,
        NPC_IDS.tansyRusk,
        at(1),
        certain(),
      );
      await fabrication.setManualOverride(userId, character.id, true, at(1));
      await fabricateCutter(userId, character.id, 2, { push: 10 });
      await db
        .delete(rune.characterMissions)
        .where(
          and(
            eq(rune.characterMissions.characterId, character.id),
            eq(rune.characterMissions.missionId, MISSION_IDS.returnTheFavor),
          ),
        );
      const facts = await db
        .select()
        .from(rune.characterMissionProgress)
        .where(eq(rune.characterMissionProgress.characterId, character.id));
      expect(facts.filter((row) => row.missionId === MISSION_IDS.returnTheFavor)).toEqual([]);
    });
  });
});
