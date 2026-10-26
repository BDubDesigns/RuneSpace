import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  ACTION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  RESEARCH_JOB_IDS,
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
 * Issue #406 — The Wise Old Enby's repeatable research jobs, against real
 * PostgreSQL.
 *
 * What only the database proves: that the one-assignment rule holds under
 * concurrent accepts; that a loan is minted with its run in one transaction (and
 * not at all on a capacity refusal, slot or mass); that a field action resolves
 * once however many sessions read it; that the packet is consumed and the
 * payment, the case reclaim and the passage are each exactly-once under retries
 * and races; that abandonment from anywhere leaves no loan, payout or passage;
 * and that a confirmed passage moves only the character.
 */
suite("issue #406 Wise Old Enby research jobs (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let jobs: typeof import("@/server/research-job-commands");
  let cargo: typeof import("@/server/cargo-hold");
  const createdUsers: string[] = [];
  const start = new Date("2026-10-26T12:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const quiet = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const TICKS = balance.researchJobs.surfaceSampleDurationTicks;
  const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
  /** Comfortably after an 8-tick action (4.8 s) has been due. */
  const after = (from: Date) => new Date(from.getTime() + (TICKS + 1) * GAME_TICK_MS);
  const WORKSHOP = LOCATION_IDS.hilltopWorkshop;
  const STATION = LOCATION_IDS.stillreachLandingStation;
  const STILLREACH_FEDHEX = LOCAL_PLACE_IDS.fedhexStillreachLandingStation;
  const HOLLOW_FEDHEX = LOCAL_PLACE_IDS.fedhexHoloHollowLanding;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    jobs = await import("@/server/research-job-commands");
    cargo = await import("@/server/cargo-hold");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  type Who = { userId: string; characterId: string };

  async function makeCharacter(label: string, locationId: string = WORKSHOP): Promise<Who> {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Res ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, quiet());
    await move(character.id, locationId);
    return { userId, characterId: character.id };
  }

  const move = (characterId: string, locationId: string) =>
    db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));

  async function completeStoryGate(who: Who) {
    await db.insert(rune.characterMissions).values({
      characterId: who.characterId,
      missionId: MISSION_IDS.notFromAroundHere,
      acceptedAt: start,
      completedAt: start,
    });
  }

  const read = (who: Who, now = start) =>
    play.getPlayGameplayState(who.userId, who.characterId, now, quiet());
  const accept = (who: Who, jobId: string, now = start) =>
    jobs.acceptResearchJob(who.userId, who.characterId, { jobId }, now);

  async function assignment(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.characterResearchAssignments)
      .where(eq(rune.characterResearchAssignments.characterId, characterId));
    return row;
  }

  async function history(characterId: string, jobId: string) {
    const [row] = await db
      .select()
      .from(rune.characterResearchJobs)
      .where(
        and(
          eq(rune.characterResearchJobs.characterId, characterId),
          eq(rune.characterResearchJobs.jobId, jobId),
        ),
      );
    return row;
  }

  const LOAN_ITEMS: readonly string[] = [
    ITEM_IDS.sealedResearchPacket,
    ITEM_IDS.geologicalSampleCase,
    ITEM_IDS.resonanceSampler,
  ];

  /** A character's unique instances: one item's, or (by default) the research loans. */
  async function instances(characterId: string, itemId?: string) {
    const rows = await db
      .select()
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.characterId, characterId));
    return rows.filter((row) => (itemId ? row.itemId === itemId : LOAN_ITEMS.includes(row.itemId)));
  }

  async function creditsOf(characterId: string) {
    const [row] = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row!.credits;
  }

  async function locationOf(characterId: string) {
    const [row] = await db
      .select({ at: rune.characters.currentLocationId })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row!.at;
  }

  async function activeActionOf(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characterId));
    return row;
  }

  /** Accept a job and return the run id. */
  async function begin(who: Who, jobId: string, now = start) {
    const result = await accept(who, jobId, now);
    expect(result.research).toMatchObject({ status: "ok", kind: "accepted" });
    const row = await assignment(who.characterId);
    return row!.id;
  }

  /** Walk the character to a site, take the field action and let it resolve. */
  async function work(who: Who, locationId: string, assignmentId: string, now: Date) {
    await move(who.characterId, locationId);
    const started = await jobs.startResearchField(
      who.userId,
      who.characterId,
      { assignmentId },
      now,
    );
    expect(started.research).toMatchObject({ status: "ok", kind: "started" });
    return read(who, after(now));
  }

  /** Fill every free Inventory slot with a light stack. */
  async function fillSlots(characterId: string, freeSlots: number, userId: string) {
    const state = await play.getPlayGameplayState(userId, characterId, start, quiet());
    for (let index = state.inventory.slotsAvailable - freeSlots; index > 0; index -= 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.uncutQuartz, quantity: 1 });
    }
  }

  describe("acceptance and the single assignment slot", () => {
    it("lends exactly one bound unique item and records the run, per job", async () => {
      const who = await makeCharacter("Lend");
      await completeStoryGate(who);
      for (const [jobId, itemId, mass] of [
        [RESEARCH_JOB_IDS.researchCourier, ITEM_IDS.sealedResearchPacket, 2_000],
        [RESEARCH_JOB_IDS.geologicalFieldSurvey, ITEM_IDS.geologicalSampleCase, 100],
        [RESEARCH_JOB_IDS.resonanceCalibration, ITEM_IDS.resonanceSampler, 100],
      ] as const) {
        const before = await read(who);
        const result = await accept(who, jobId);
        expect(result.research).toMatchObject({ status: "ok", kind: "accepted", jobId });
        expect(await instances(who.characterId, itemId)).toHaveLength(1);
        expect(result.state.research.assignment).toMatchObject({
          jobId,
          stage: "field",
          loanItemHeld: true,
        });
        // An ordinary carried unique item: one slot and its real mass.
        expect(result.state.inventory.slotsUsed).toBe(before.inventory.slotsUsed + 1);
        expect(result.state.inventory.massGrams).toBe(before.inventory.massGrams + mass);
        const entry = result.state.inventory.uniqueItems.find((item) => item.itemId === itemId);
        expect(entry).toBeDefined();
        // The run shows in the Mission list so the Log, strips and guidance render it.
        const mission = result.state.missions.find((candidate) => candidate.missionId === jobId);
        expect(mission).toMatchObject({ state: "active", research: expect.any(Object) });
        expect(mission!.currentObjective).toBeTruthy();
        const run = (await assignment(who.characterId))!;
        await jobs.abandonResearchJob(who.userId, who.characterId, { assignmentId: run.id }, start);
      }
    });

    it("counts the loan against carrying mass: the Courier packet weighs 2 kg", async () => {
      const who = await makeCharacter("Mass");
      const before = await read(who);
      const after = (await accept(who, RESEARCH_JOB_IDS.researchCourier)).state;
      expect(after.inventory.massGrams - before.inventory.massGrams).toBe(2_000);
    });

    it("refuses a second assignment, naming the held one, and mints nothing", async () => {
      const who = await makeCharacter("Second");
      await completeStoryGate(who);
      await begin(who, RESEARCH_JOB_IDS.researchCourier);
      for (const jobId of [
        RESEARCH_JOB_IDS.geologicalFieldSurvey,
        RESEARCH_JOB_IDS.resonanceCalibration,
      ]) {
        const result = await accept(who, jobId);
        expect(result.research).toMatchObject({ status: "refused", reason: "blocked" });
        if (result.research.status === "refused") {
          expect(result.research.message).toMatch(/Research Courier/);
        }
      }
      expect(await instances(who.characterId)).toHaveLength(1);
      const state = await read(who);
      expect(state.research.offers.map((offer) => [offer.jobId, offer.status])).toEqual([
        [RESEARCH_JOB_IDS.researchCourier, "active"],
        [RESEARCH_JOB_IDS.geologicalFieldSurvey, "blocked"],
        [RESEARCH_JOB_IDS.resonanceCalibration, "blocked"],
      ]);
    });

    it("treats a retried accept of the held job as that job, never a second loan", async () => {
      const who = await makeCharacter("Retry");
      await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      const again = await accept(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      expect(again.research).toMatchObject({ status: "ok", kind: "already_accepted" });
      expect(await instances(who.characterId, ITEM_IDS.geologicalSampleCase)).toHaveLength(1);
    });

    it("lets exactly one of several concurrent accepts win, across all three jobs", async () => {
      const who = await makeCharacter("Race");
      await completeStoryGate(who);
      const results = await Promise.all([
        accept(who, RESEARCH_JOB_IDS.researchCourier),
        accept(who, RESEARCH_JOB_IDS.geologicalFieldSurvey),
        accept(who, RESEARCH_JOB_IDS.resonanceCalibration),
        accept(who, RESEARCH_JOB_IDS.researchCourier),
      ]);
      const winners = results.filter(
        (result) => result.research.status === "ok" && result.research.kind === "accepted",
      );
      expect(winners).toHaveLength(1);
      expect(await instances(who.characterId)).toHaveLength(1);
      const row = await assignment(who.characterId);
      expect(row).toBeDefined();
      expect((await instances(who.characterId))[0]!.id).toBe(row!.itemInstanceId);
    });

    it("keeps Resonance Calibration locked until Not From Around Here is complete", async () => {
      const who = await makeCharacter("Gate");
      expect((await read(who)).research.offers.map((offer) => offer.status)).toEqual([
        "available",
        "available",
        "locked",
      ]);
      expect((await accept(who, RESEARCH_JOB_IDS.resonanceCalibration)).research).toMatchObject({
        status: "refused",
        reason: "locked",
      });
      expect(await instances(who.characterId)).toHaveLength(0);
      await completeStoryGate(who);
      expect((await accept(who, RESEARCH_JOB_IDS.resonanceCalibration)).research.status).toBe("ok");
    });

    it("is only offered at Hilltop Workshop, while idle, for a real job", async () => {
      const who = await makeCharacter("Place", STATION);
      expect((await accept(who, RESEARCH_JOB_IDS.researchCourier)).research).toMatchObject({
        reason: "wrong_place",
      });
      await move(who.characterId, WORKSHOP);
      expect((await accept(who, "not_a_job")).research).toMatchObject({ reason: "unknown_job" });
      await db.insert(rune.activeActions).values({
        characterId: who.characterId,
        actionId: ACTION_IDS.ferriteShaleMining,
        startedAt: start,
        resolvedThroughAt: start,
      });
      expect((await accept(who, RESEARCH_JOB_IDS.researchCourier)).research).toMatchObject({
        reason: "not_stationary",
      });
      expect(await assignment(who.characterId)).toBeUndefined();
      expect(await instances(who.characterId)).toHaveLength(0);
    });

    it("refuses on a full slot count or on mass, naming which, and creates nothing", async () => {
      const who = await makeCharacter("Capacity");
      await fillSlots(who.characterId, 0, who.userId);
      const bySlot = await accept(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      expect(bySlot.research).toMatchObject({
        status: "refused",
        reason: "capacity",
        capacityReason: "slots",
      });
      expect(await assignment(who.characterId)).toBeUndefined();
      expect(await instances(who.characterId)).toHaveLength(0);

      // Free slots, but less than the Courier's 2 kg of capacity left.
      await db
        .delete(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.characterId));
      const slabs = Math.floor((balance.carrying.startingCapacityGrams - 1_999) / 12_000);
      for (let index = 0; index < slabs; index += 1) {
        await db.insert(rune.inventoryStacks).values({
          characterId: who.characterId,
          itemId: ITEM_IDS.motherlodeSlab,
          quantity: 1,
        });
      }
      const state = await read(who);
      expect(state.inventory.slotsAvailable).toBeGreaterThan(0);
      const massLeft = state.inventory.capacityGrams - state.inventory.massGrams;
      expect(massLeft).toBeLessThan(2_000);
      const byMass = await accept(who, RESEARCH_JOB_IDS.researchCourier);
      expect(byMass.research).toMatchObject({
        status: "refused",
        reason: "capacity",
        capacityReason: "mass",
      });
      expect(await assignment(who.characterId)).toBeUndefined();
      expect(await instances(who.characterId)).toHaveLength(0);
      // The same character can still take a 100 g job if it fits.
      if (massLeft >= 100) {
        expect((await accept(who, RESEARCH_JOB_IDS.geologicalFieldSurvey)).research.status).toBe(
          "ok",
        );
      }
    });

    it("succeeds once room is made, with no trace of the earlier refusal", async () => {
      const who = await makeCharacter("Room");
      await fillSlots(who.characterId, 0, who.userId);
      expect((await accept(who, RESEARCH_JOB_IDS.researchCourier)).research).toMatchObject({
        reason: "capacity",
      });
      await db
        .delete(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.characterId));
      expect((await accept(who, RESEARCH_JOB_IDS.researchCourier)).research.status).toBe("ok");
      expect(await instances(who.characterId)).toHaveLength(1);
    });

    it("runs beside an ordinary story Mission, which progresses independently", async () => {
      const who = await makeCharacter("Coexist");
      await db.insert(rune.characterMissions).values({
        characterId: who.characterId,
        missionId: MISSION_IDS.walkItOff,
        acceptedAt: start,
      });
      const before = await read(who);
      const story = before.missions.find((mission) => mission.missionId === MISSION_IDS.walkItOff);
      expect(story?.state).toBe("active");
      const state = (await accept(who, RESEARCH_JOB_IDS.researchCourier)).state;
      const storyAfter = state.missions.find(
        (mission) => mission.missionId === MISSION_IDS.walkItOff,
      );
      expect(storyAfter).toEqual(story);
      expect(
        state.missions.some((mission) => mission.missionId === RESEARCH_JOB_IDS.researchCourier),
      ).toBe(true);
    });
  });

  describe("Geological Field Survey", () => {
    const SITES = [
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.theDrySeam,
      LOCATION_IDS.harmonicWorkings,
    ];

    it("records one specimen per site in any order, in 8 whole ticks, awarding nothing else", async () => {
      const who = await makeCharacter("Survey");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      const xpBefore = await db
        .select()
        .from(rune.characterSkillXp)
        .where(eq(rune.characterSkillXp.characterId, who.characterId));
      const quartzBefore = (await read(who)).inventory.stacks.length;

      let now = at(10);
      await move(who.characterId, SITES[2]!);
      expect(
        (await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, now))
          .research,
      ).toMatchObject({ status: "ok", kind: "started" });
      expect((await activeActionOf(who.characterId))?.actionId).toBe(
        ACTION_IDS.researchSurfaceSample,
      );
      // Before the eighth tick, nothing has been recorded.
      const early = await read(who, new Date(now.getTime() + (TICKS - 1) * GAME_TICK_MS));
      expect(early.research.assignment?.sampledLocationIds).toEqual([]);
      expect(early.activeAction?.nextAttemptDurationTicks).toBe(8);
      // On the eighth tick it resolves.
      const resolved = await read(who, new Date(now.getTime() + TICKS * GAME_TICK_MS));
      expect(resolved.research.assignment).toMatchObject({
        sampledLocationIds: [SITES[2]],
        progress: { current: 1, target: 3 },
      });
      expect(await activeActionOf(who.characterId)).toBeUndefined();

      now = at(100);
      await work(who, SITES[0]!, run, now);
      now = at(200);
      const done = await work(who, SITES[1]!, run, now);
      expect(done.research.assignment).toMatchObject({ stage: "ready", progress: { current: 3 } });
      expect([...done.research.assignment!.sampledLocationIds].sort()).toEqual([...SITES].sort());
      // Nothing else was granted: no ore, gems, XP or extra items.
      expect(
        await db
          .select()
          .from(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, who.characterId)),
      ).toEqual(xpBefore);
      expect(done.inventory.stacks.length).toBe(quartzBefore);
      expect(await instances(who.characterId)).toHaveLength(1);
      expect(
        done.missions.find((m) => m.missionId === RESEARCH_JOB_IDS.geologicalFieldSurvey),
      ).toMatchObject({
        state: "ready_for_completion",
      });
    });

    it("offers no action at a site already sampled, or at a place that is not a site", async () => {
      const who = await makeCharacter("Dup");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      await work(who, SITES[0]!, run, at(10));
      const again = await jobs.startResearchField(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(60),
      );
      expect(again.research).toMatchObject({ status: "refused", reason: "wrong_place" });
      expect(await activeActionOf(who.characterId)).toBeUndefined();
      await move(who.characterId, LOCATION_IDS.theLowHum);
      expect(
        (await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, at(70)))
          .research,
      ).toMatchObject({ status: "refused" });
    });

    it("resolves a due sample exactly once however many sessions read it", async () => {
      const who = await makeCharacter("Once");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      await move(who.characterId, SITES[1]!);
      await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, at(10));
      const later = at(60);
      await Promise.all([read(who, later), read(who, later), read(who, later), read(who, later)]);
      const row = await assignment(who.characterId);
      expect(row!.sampledLocationIds).toEqual([SITES[1]]);
    });

    it("treats a retried start as the same action and refuses while another activity runs", async () => {
      const who = await makeCharacter("Busy");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      await move(who.characterId, SITES[0]!);
      const first = await jobs.startResearchField(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(10),
      );
      const second = await jobs.startResearchField(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(11),
      );
      expect(first.research.status).toBe("ok");
      expect(second.research).toMatchObject({ status: "ok", kind: "started" });
      const actions = await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, who.characterId));
      expect(actions).toHaveLength(1);

      const miner = await makeCharacter("Miner");
      const minerRun = await begin(miner, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      await move(miner.characterId, SITES[0]!);
      await db.insert(rune.activeActions).values({
        characterId: miner.characterId,
        actionId: ACTION_IDS.stoneMining,
        startedAt: start,
        resolvedThroughAt: start,
      });
      expect(
        (
          await jobs.startResearchField(
            miner.userId,
            miner.characterId,
            { assignmentId: minerRun },
            start,
          )
        ).research,
      ).toMatchObject({ status: "refused", reason: "another_action_active" });
    });

    it("records nothing when the case is gone, and abandons cleanly", async () => {
      const who = await makeCharacter("Lost");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      await move(who.characterId, SITES[0]!);
      await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, at(10));
      // The case disappears (the database nulls the reference) before it resolves.
      await db
        .delete(rune.itemInstances)
        .where(eq(rune.itemInstances.id, (await instances(who.characterId))[0]!.id));
      const state = await read(who, at(60));
      expect(state.research.assignment).toMatchObject({
        loanItemHeld: false,
        sampledLocationIds: [],
      });
      const refused = await jobs.startResearchField(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(70),
      );
      expect(refused.research).toMatchObject({ status: "refused", reason: "item_missing" });
      const abandoned = await jobs.abandonResearchJob(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(80),
      );
      expect(abandoned.research).toMatchObject({ status: "ok", kind: "abandoned" });
      expect(await assignment(who.characterId)).toBeUndefined();
    });

    it("pays 75 Credits and reclaims the case exactly once, then allows a fresh run", async () => {
      const who = await makeCharacter("Pay");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      for (const [index, site] of SITES.entries()) await work(who, site, run, at(10 + index * 100));
      await move(who.characterId, WORKSHOP);
      const credits = await creditsOf(who.characterId);
      const paid = await jobs.completeResearchJob(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(500),
      );
      expect(paid.research).toMatchObject({ status: "ok", kind: "paid", creditsPaid: 75 });
      expect(await creditsOf(who.characterId)).toBe(credits + 75);
      expect(await instances(who.characterId)).toHaveLength(0);
      expect(await assignment(who.characterId)).toBeUndefined();
      expect(
        (await history(who.characterId, RESEARCH_JOB_IDS.geologicalFieldSurvey))?.completions,
      ).toBe(1);
      // A second tap, or a stale client, finds nothing to pay.
      const twice = await jobs.completeResearchJob(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(501),
      );
      expect(twice.research).toMatchObject({ status: "refused", reason: "no_assignment" });
      expect(await creditsOf(who.characterId)).toBe(credits + 75);
      // The slot is free: a fresh run starts from scratch with a new checked loaner.
      const fresh = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey, at(600));
      expect(fresh).not.toBe(run);
      expect((await assignment(who.characterId))!.sampledLocationIds).toEqual([]);
      expect(await instances(who.characterId, ITEM_IDS.geologicalSampleCase)).toHaveLength(1);
      // The stale run id cannot act on the new run.
      expect(
        (
          await jobs.completeResearchJob(
            who.userId,
            who.characterId,
            { assignmentId: run },
            at(601),
          )
        ).research,
      ).toMatchObject({ reason: "no_assignment" });
      // The short repeat introduction is owed after one completion.
      expect(
        (await read(who, at(601))).research.offers.find(
          (offer) => offer.jobId === RESEARCH_JOB_IDS.geologicalFieldSurvey,
        )?.completions,
      ).toBe(1);
    });

    it("refuses payment early, away from the workshop, while busy and without the case", async () => {
      const who = await makeCharacter("Early");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      await work(who, SITES[0]!, run, at(10));
      await move(who.characterId, WORKSHOP);
      expect(
        (
          await jobs.completeResearchJob(
            who.userId,
            who.characterId,
            { assignmentId: run },
            at(100),
          )
        ).research,
      ).toMatchObject({ reason: "wrong_stage" });
      await work(who, SITES[1]!, run, at(110));
      await work(who, SITES[2]!, run, at(220));
      expect(
        (
          await jobs.completeResearchJob(
            who.userId,
            who.characterId,
            { assignmentId: run },
            at(400),
          )
        ).research,
      ).toMatchObject({ reason: "wrong_place" });
      await move(who.characterId, WORKSHOP);
      await db
        .delete(rune.itemInstances)
        .where(eq(rune.itemInstances.id, (await instances(who.characterId))[0]!.id));
      expect(
        (
          await jobs.completeResearchJob(
            who.userId,
            who.characterId,
            { assignmentId: run },
            at(410),
          )
        ).research,
      ).toMatchObject({ reason: "item_missing" });
      expect((await assignment(who.characterId))!.sampledLocationIds).toHaveLength(3);
    });

    it("pays once when two sessions collect at the same moment", async () => {
      const who = await makeCharacter("PayRace");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      for (const [index, site] of SITES.entries()) await work(who, site, run, at(10 + index * 100));
      await move(who.characterId, WORKSHOP);
      const credits = await creditsOf(who.characterId);
      const results = await Promise.all([
        jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(500)),
        jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(500)),
        jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(500)),
      ]);
      expect(results.filter((result) => result.research.status === "ok")).toHaveLength(1);
      expect(await creditsOf(who.characterId)).toBe(credits + 75);
      expect(
        (await history(who.characterId, RESEARCH_JOB_IDS.geologicalFieldSurvey))?.completions,
      ).toBe(1);
    });
  });

  describe("Research Courier", () => {
    it("hands the packet over only at the Stillreach FedHex, consuming exactly that packet", async () => {
      const who = await makeCharacter("Courier");
      const run = await begin(who, RESEARCH_JOB_IDS.researchCourier);
      const [packet] = await instances(who.characterId, ITEM_IDS.sealedResearchPacket);
      const credits = await creditsOf(who.characterId);
      await move(who.characterId, STATION);

      // The other FedHex, the right station's wrong place and a stale run all refuse.
      expect(
        (
          await jobs.deliverResearchPacket(
            who.userId,
            who.characterId,
            { assignmentId: run, localPlaceId: HOLLOW_FEDHEX },
            at(10),
          )
        ).research,
      ).toMatchObject({ reason: "wrong_place" });
      expect(
        (
          await jobs.deliverResearchPacket(
            who.userId,
            who.characterId,
            { assignmentId: run, localPlaceId: LOCAL_PLACE_IDS.stillreachRefinerToGo },
            at(10),
          )
        ).research,
      ).toMatchObject({ reason: "wrong_place" });
      expect(
        (
          await jobs.deliverResearchPacket(
            who.userId,
            who.characterId,
            {
              assignmentId: "00000000-0000-4000-8000-000000000000",
              localPlaceId: STILLREACH_FEDHEX,
            },
            at(10),
          )
        ).research,
      ).toMatchObject({ reason: "no_assignment" });
      expect(await instances(who.characterId, ITEM_IDS.sealedResearchPacket)).toHaveLength(1);

      const delivered = await jobs.deliverResearchPacket(
        who.userId,
        who.characterId,
        { assignmentId: run, localPlaceId: STILLREACH_FEDHEX },
        at(20),
      );
      expect(delivered.research).toMatchObject({ status: "ok", kind: "delivered" });
      expect(await instances(who.characterId, ITEM_IDS.sealedResearchPacket)).toHaveLength(0);
      expect((await instances(who.characterId)).some((row) => row.id === packet!.id)).toBe(false);
      const row = (await assignment(who.characterId))!;
      expect(row.deliveredAt).toEqual(at(20));
      expect(row.itemInstanceId).toBeNull();
      // FedHex pays nothing, and the objective is now the return.
      expect(await creditsOf(who.characterId)).toBe(credits);
      expect(delivered.state.research.assignment).toMatchObject({
        stage: "ready",
        delivered: true,
      });
      expect(
        delivered.state.missions.find(
          (mission) => mission.missionId === RESEARCH_JOB_IDS.researchCourier,
        )?.currentObjective,
      ).toMatch(/Return to The Wise Old Enby/);
      // Delivering again finds nothing to hand over.
      expect(
        (
          await jobs.deliverResearchPacket(
            who.userId,
            who.characterId,
            { assignmentId: run, localPlaceId: STILLREACH_FEDHEX },
            at(21),
          )
        ).research,
      ).toMatchObject({ status: "refused", reason: "wrong_stage" });
    });

    it("delivers once when two taps race, and refuses at Skatboll's FedHex", async () => {
      const who = await makeCharacter("DeliverRace");
      const run = await begin(who, RESEARCH_JOB_IDS.researchCourier);
      await move(who.characterId, STATION);
      const results = await Promise.all([
        jobs.deliverResearchPacket(
          who.userId,
          who.characterId,
          { assignmentId: run, localPlaceId: STILLREACH_FEDHEX },
          at(5),
        ),
        jobs.deliverResearchPacket(
          who.userId,
          who.characterId,
          { assignmentId: run, localPlaceId: STILLREACH_FEDHEX },
          at(5),
        ),
      ]);
      expect(results.filter((result) => result.research.status === "ok")).toHaveLength(1);

      const skatboll = await makeCharacter("Skatboll");
      const staged = await begin(skatboll, RESEARCH_JOB_IDS.researchCourier);
      await move(skatboll.characterId, LOCATION_IDS.holoHollowLanding);
      expect(
        (
          await jobs.deliverResearchPacket(
            skatboll.userId,
            skatboll.characterId,
            { assignmentId: staged, localPlaceId: HOLLOW_FEDHEX },
            at(5),
          )
        ).research,
      ).toMatchObject({ status: "refused", reason: "wrong_place" });
      expect(await instances(skatboll.characterId, ITEM_IDS.sealedResearchPacket)).toHaveLength(1);
    });

    it("pays 25 Credits and 0 XP only at the Enby after delivery, exactly once", async () => {
      const who = await makeCharacter("CourierPay");
      const run = await begin(who, RESEARCH_JOB_IDS.researchCourier);
      const credits = await creditsOf(who.characterId);
      // Before delivery there is nothing to collect.
      expect(
        (await jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(5)))
          .research,
      ).toMatchObject({ reason: "wrong_stage" });
      await move(who.characterId, STATION);
      await jobs.deliverResearchPacket(
        who.userId,
        who.characterId,
        { assignmentId: run, localPlaceId: STILLREACH_FEDHEX },
        at(10),
      );
      // Away from the workshop.
      expect(
        (await jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(11)))
          .research,
      ).toMatchObject({ reason: "wrong_place" });
      await move(who.characterId, WORKSHOP);
      const xpBefore = await db
        .select()
        .from(rune.characterSkillXp)
        .where(eq(rune.characterSkillXp.characterId, who.characterId));
      const results = await Promise.all([
        jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(20)),
        jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(20)),
      ]);
      expect(results.filter((result) => result.research.status === "ok")).toHaveLength(1);
      const paid = results.find((result) => result.research.status === "ok")!;
      expect(paid.research).toMatchObject({ kind: "paid", creditsPaid: 25 });
      expect(await creditsOf(who.characterId)).toBe(credits + 25);
      expect(
        await db
          .select()
          .from(rune.characterSkillXp)
          .where(eq(rune.characterSkillXp.characterId, who.characterId)),
      ).toEqual(xpBefore);
      expect(await assignment(who.characterId)).toBeUndefined();
      expect((await history(who.characterId, RESEARCH_JOB_IDS.researchCourier))?.completions).toBe(
        1,
      );
      // Unlimited repeats: the next run is brand new and unpaid.
      const next = await begin(who, RESEARCH_JOB_IDS.researchCourier, at(30));
      expect(next).not.toBe(run);
      expect((await assignment(who.characterId))!.deliveredAt).toBeNull();
    });

    it("pays nothing for a delivered-but-abandoned run and frees the slot", async () => {
      const who = await makeCharacter("CourierAbandon");
      const run = await begin(who, RESEARCH_JOB_IDS.researchCourier);
      await move(who.characterId, STATION);
      await jobs.deliverResearchPacket(
        who.userId,
        who.characterId,
        { assignmentId: run, localPlaceId: STILLREACH_FEDHEX },
        at(10),
      );
      const credits = await creditsOf(who.characterId);
      // Abandon is available from anywhere, with no trip to the workshop.
      const abandoned = await jobs.abandonResearchJob(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(20),
      );
      expect(abandoned.research).toMatchObject({ status: "ok", kind: "abandoned" });
      expect(await assignment(who.characterId)).toBeUndefined();
      await move(who.characterId, WORKSHOP);
      expect(
        (await jobs.completeResearchJob(who.userId, who.characterId, { assignmentId: run }, at(30)))
          .research,
      ).toMatchObject({ reason: "no_assignment" });
      expect(await creditsOf(who.characterId)).toBe(credits);
      expect(await history(who.characterId, RESEARCH_JOB_IDS.researchCourier)).toBeUndefined();
      // A fresh run starts from scratch.
      await begin(who, RESEARCH_JOB_IDS.researchCourier, at(40));
      expect((await assignment(who.characterId))!.deliveredAt).toBeNull();
    });
  });

  describe("Resonance Calibration", () => {
    async function recorded(label: string) {
      const who = await makeCharacter(label);
      await completeStoryGate(who);
      const run = await begin(who, RESEARCH_JOB_IDS.resonanceCalibration);
      await move(who.characterId, LOCATION_IDS.theLowHum);
      const started = await jobs.startResearchField(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(10),
      );
      expect(started.research.status).toBe("ok");
      expect((await activeActionOf(who.characterId))?.actionId).toBe(
        ACTION_IDS.researchResonanceRecording,
      );
      const state = await read(who, after(at(10)));
      expect(state.research.assignment).toMatchObject({ recorded: true, stage: "ready" });
      await move(who.characterId, WORKSHOP);
      return { who, run };
    }

    it("records exactly one reading at The Low Hum, only there, only once", async () => {
      const who = await makeCharacter("Record");
      await completeStoryGate(who);
      const run = await begin(who, RESEARCH_JOB_IDS.resonanceCalibration);
      expect(
        (await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, at(5)))
          .research,
      ).toMatchObject({ status: "refused" });
      await move(who.characterId, LOCATION_IDS.theLowHum);
      await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, at(10));
      await Promise.all([read(who, at(60)), read(who, at(60)), read(who, at(61))]);
      const row = (await assignment(who.characterId))!;
      expect(row.recordedAt).toEqual(new Date(at(10).getTime() + 8 * GAME_TICK_MS));
      // No second recording while the first stands.
      expect(
        (await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, at(70)))
          .research,
      ).toMatchObject({ status: "refused" });
      // The run is still active, the sampler still carried: a recording alone completes nothing.
      expect(await instances(who.characterId, ITEM_IDS.resonanceSampler)).toHaveLength(1);
      expect(await history(who.characterId, RESEARCH_JOB_IDS.resonanceCalibration)).toBeUndefined();
      await move(who.characterId, WORKSHOP);
      expect((await accept(who, RESEARCH_JOB_IDS.researchCourier)).research).toMatchObject({
        reason: "blocked",
      });
    });

    it("will not open the passage before a reading, away from the workshop or while busy", async () => {
      const who = await makeCharacter("TooSoon");
      await completeStoryGate(who);
      const run = await begin(who, RESEARCH_JOB_IDS.resonanceCalibration);
      expect(
        (await jobs.teleportResearchJob(who.userId, who.characterId, { assignmentId: run }, at(5)))
          .research,
      ).toMatchObject({ reason: "wrong_stage" });
      expect(await locationOf(who.characterId)).toBe(WORKSHOP);

      const { who: ready, run: readyRun } = await recorded("Ready");
      await move(ready.characterId, LOCATION_IDS.theLowHum);
      expect(
        (
          await jobs.teleportResearchJob(
            ready.userId,
            ready.characterId,
            { assignmentId: readyRun },
            at(100),
          )
        ).research,
      ).toMatchObject({ reason: "wrong_place" });
      await move(ready.characterId, WORKSHOP);
      await db.insert(rune.activeActions).values({
        characterId: ready.characterId,
        actionId: ACTION_IDS.ferriteShaleMining,
        startedAt: at(100),
        resolvedThroughAt: at(100),
      });
      expect(
        (
          await jobs.teleportResearchJob(
            ready.userId,
            ready.characterId,
            { assignmentId: readyRun },
            at(100),
          )
        ).research,
      ).toMatchObject({ reason: "not_stationary" });
      // Nothing moved, nothing was reclaimed: the sampler and the run stand.
      expect(await locationOf(ready.characterId)).toBe(WORKSHOP);
      expect(await instances(ready.characterId, ITEM_IDS.resonanceSampler)).toHaveLength(1);
      expect(await assignment(ready.characterId)).toBeDefined();
    });

    it("keeps the completed sampler, the run and the exclusivity until the passage is confirmed", async () => {
      const { who, run } = await recorded("Decline");
      // Declining is simply not sending the command: reading state any number of
      // times, and returning later, changes nothing.
      for (const seconds of [20, 400, 100_000]) {
        const state = await read(who, at(seconds));
        expect(state.research.assignment).toMatchObject({
          recorded: true,
          loanItemHeld: true,
          assignmentId: run,
        });
        expect(state.research.arrival).toBeUndefined();
      }
      expect(await locationOf(who.characterId)).toBe(WORKSHOP);
      expect(await instances(who.characterId, ITEM_IDS.resonanceSampler)).toHaveLength(1);
      expect((await accept(who, RESEARCH_JOB_IDS.geologicalFieldSurvey)).research).toMatchObject({
        reason: "blocked",
      });
      // Later, without a new reading, the same run can still be confirmed.
      const go = await jobs.teleportResearchJob(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(200_000),
      );
      expect(go.research).toMatchObject({ status: "ok", kind: "teleported" });
    });

    it("teleports the character only, atomically and exactly once, leaving ship, fuel and Cargo", async () => {
      const { who, run } = await recorded("Teleport");
      // The Rivet is parked at Stillreach with fuel; a Cargo Hold row exists there.
      await db
        .insert(rune.characterShips)
        .values({ characterId: who.characterId, berthLocationId: STATION, fuelUnits: 37 })
        .onConflictDoUpdate({
          target: rune.characterShips.characterId,
          set: { berthLocationId: STATION, fuelUnits: 37 },
        });
      await db
        .insert(rune.cargoHoldStacks)
        .values({ characterId: who.characterId, itemId: ITEM_IDS.stone, quantity: 3 });
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId: who.characterId, itemId: ITEM_IDS.uncutQuartz, quantity: 2 });
      const credits = await creditsOf(who.characterId);
      const before = await read(who, at(100));

      const results = await Promise.all([
        jobs.teleportResearchJob(who.userId, who.characterId, { assignmentId: run }, at(300)),
        jobs.teleportResearchJob(who.userId, who.characterId, { assignmentId: run }, at(300)),
        jobs.teleportResearchJob(who.userId, who.characterId, { assignmentId: run }, at(300)),
      ]);
      expect(results.filter((result) => result.research.status === "ok")).toHaveLength(1);
      expect(results.filter((result) => result.research.status === "refused")).toHaveLength(2);

      expect(await locationOf(who.characterId)).toBe(LOCATION_IDS.crashSite);
      // The sampler is reclaimed, the slot is free and the run is over.
      expect(await instances(who.characterId, ITEM_IDS.resonanceSampler)).toHaveLength(0);
      expect(await assignment(who.characterId)).toBeUndefined();
      const state = await read(who, at(301));
      expect(state.inventory.slotsUsed).toBe(before.inventory.slotsUsed - 1);
      // Carried Inventory comes along untouched.
      expect(
        state.inventory.stacks.find((stack) => stack.itemId === ITEM_IDS.uncutQuartz)?.quantity,
      ).toBe(2);
      // 0 Credits, and the Rivet, its fuel and the Cargo Hold stay where they were.
      expect(await creditsOf(who.characterId)).toBe(credits);
      const [ship] = await db
        .select()
        .from(rune.characterShips)
        .where(eq(rune.characterShips.characterId, who.characterId));
      expect(ship).toMatchObject({ berthLocationId: STATION, fuelUnits: 37 });
      const cargoStacks = await db
        .select()
        .from(rune.cargoHoldStacks)
        .where(eq(rune.cargoHoldStacks.characterId, who.characterId));
      expect(cargoStacks).toMatchObject([{ itemId: ITEM_IDS.stone, quantity: 3 }]);
      expect(
        (await history(who.characterId, RESEARCH_JOB_IDS.resonanceCalibration))?.completions,
      ).toBe(1);

      // A durable arrival receipt, and the slot is free for any job.
      expect(state.location.currentLocationId).toBe(LOCATION_IDS.crashSite);
      expect(state.research.arrival).toMatchObject({
        destinationLocationId: LOCATION_IDS.crashSite,
        destinationName: "Crash Site",
      });
      await move(who.characterId, WORKSHOP);
      expect((await accept(who, RESEARCH_JOB_IDS.researchCourier, at(400))).research.status).toBe(
        "ok",
      );
    });

    it("keeps the arrival receipt across reloads until it is dismissed, and dismissal moves nothing", async () => {
      const { who, run } = await recorded("Arrival");
      await jobs.teleportResearchJob(who.userId, who.characterId, { assignmentId: run }, at(300));
      for (const seconds of [301, 5_000, 90_000]) {
        expect((await read(who, at(seconds))).research.arrival).toBeDefined();
      }
      const credits = await creditsOf(who.characterId);
      const acked = await jobs.acknowledgeResearchArrival(who.userId, who.characterId, at(400));
      expect(acked.research).toMatchObject({ status: "ok", kind: "acknowledged" });
      expect(acked.state.research.arrival).toBeUndefined();
      // Idempotent, still dismissed on later reads, and it replays no movement.
      await jobs.acknowledgeResearchArrival(who.userId, who.characterId, at(401));
      expect((await read(who, at(100_000))).research.arrival).toBeUndefined();
      expect(await locationOf(who.characterId)).toBe(LOCATION_IDS.crashSite);
      expect(await creditsOf(who.characterId)).toBe(credits);
      expect(await instances(who.characterId)).toHaveLength(0);
      // A later passage owes a new receipt.
      await move(who.characterId, WORKSHOP);
      const again = await begin(who, RESEARCH_JOB_IDS.resonanceCalibration, at(500));
      await move(who.characterId, LOCATION_IDS.theLowHum);
      await jobs.startResearchField(who.userId, who.characterId, { assignmentId: again }, at(510));
      await read(who, at(600));
      await move(who.characterId, WORKSHOP);
      await jobs.teleportResearchJob(who.userId, who.characterId, { assignmentId: again }, at(700));
      expect((await read(who, at(701))).research.arrival).toBeDefined();
    });

    it("abandons without a teleport, a payout or a count, from anywhere", async () => {
      const { who, run } = await recorded("CalAbandon");
      await move(who.characterId, LOCATION_IDS.theLowHum);
      const credits = await creditsOf(who.characterId);
      const result = await jobs.abandonResearchJob(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(100),
      );
      expect(result.research).toMatchObject({ status: "ok", kind: "abandoned" });
      expect(await locationOf(who.characterId)).toBe(LOCATION_IDS.theLowHum);
      expect(await creditsOf(who.characterId)).toBe(credits);
      expect(await instances(who.characterId)).toHaveLength(0);
      expect(await history(who.characterId, RESEARCH_JOB_IDS.resonanceCalibration)).toBeUndefined();
      expect(result.state.research.arrival).toBeUndefined();
    });
  });

  describe("abandonment and loan restrictions", () => {
    it("cancels a pending field action with the run, so nothing records afterwards", async () => {
      const who = await makeCharacter("AbandonPending");
      const run = await begin(who, RESEARCH_JOB_IDS.geologicalFieldSurvey);
      await move(who.characterId, LOCATION_IDS.prospectingQuarry);
      await jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, at(10));
      await jobs.abandonResearchJob(who.userId, who.characterId, { assignmentId: run }, at(11));
      expect(await activeActionOf(who.characterId)).toBeUndefined();
      expect(await assignment(who.characterId)).toBeUndefined();
      const state = await read(who, at(100));
      expect(state.research.assignment).toBeUndefined();
      expect(
        state.missions.some(
          (mission) => mission.missionId === RESEARCH_JOB_IDS.geologicalFieldSurvey,
        ),
      ).toBe(false);
    });

    it("abandons idempotently: a repeat finds nothing, and a stale id cannot end a new run", async () => {
      const who = await makeCharacter("AbandonTwice");
      const run = await begin(who, RESEARCH_JOB_IDS.researchCourier);
      const results = await Promise.all([
        jobs.abandonResearchJob(who.userId, who.characterId, { assignmentId: run }, at(5)),
        jobs.abandonResearchJob(who.userId, who.characterId, { assignmentId: run }, at(5)),
      ]);
      expect(results.filter((result) => result.research.status === "ok")).toHaveLength(1);
      expect(await instances(who.characterId)).toHaveLength(0);
      const next = await begin(who, RESEARCH_JOB_IDS.researchCourier, at(10));
      expect(
        (await jobs.abandonResearchJob(who.userId, who.characterId, { assignmentId: run }, at(11)))
          .research,
      ).toMatchObject({ reason: "no_assignment" });
      expect((await assignment(who.characterId))!.id).toBe(next);
      expect(await instances(who.characterId, ITEM_IDS.sealedResearchPacket)).toHaveLength(1);
    });

    it("cannot act on another character's run", async () => {
      const owner = await makeCharacter("Owner");
      const other = await makeCharacter("Other");
      const run = await begin(owner, RESEARCH_JOB_IDS.researchCourier);
      expect(
        (
          await jobs.abandonResearchJob(
            other.userId,
            other.characterId,
            { assignmentId: run },
            at(5),
          )
        ).research,
      ).toMatchObject({ reason: "no_assignment" });
      await expect(
        jobs.abandonResearchJob(other.userId, owner.characterId, { assignmentId: run }, at(5)),
      ).rejects.toThrow();
      expect(await assignment(owner.characterId)).toBeDefined();
    });

    it("cannot be stored in the Cargo Hold", async () => {
      const who = await makeCharacter("Cargo");
      const cargoTarget = getRepairTargetBalance(REPAIR_TARGET_IDS.cargoHold, balance);
      await seedRepairTarget(db, rune, who.characterId, REPAIR_TARGET_IDS.cargoHold, {
        materials: installedMaterials(cargoTarget),
        weldingProgress: cargoTarget.repairIncrements,
        completedAt: start,
        updatedAt: start,
      });
      await begin(who, RESEARCH_JOB_IDS.researchCourier);
      const [packet] = await instances(who.characterId, ITEM_IDS.sealedResearchPacket);
      // The ship is berthed at the Crash Site, where the repaired Hold is reachable.
      await move(who.characterId, LOCATION_IDS.crashSite);
      const refused = await cargo.depositCargoUniqueItem(
        who.userId,
        who.characterId,
        { itemInstanceId: packet!.id },
        start,
        quiet(),
      );
      expect(refused.cargo).toMatchObject({ status: "refused", reason: "loaned_item" });
      const cargoRows = await db
        .select()
        .from(rune.cargoHoldItemInstances)
        .where(eq(rune.cargoHoldItemInstances.characterId, who.characterId));
      expect(cargoRows).toHaveLength(0);
    });
  });
});
