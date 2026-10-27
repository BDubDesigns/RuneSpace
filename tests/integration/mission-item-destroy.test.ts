import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  RESEARCH_JOB_IDS,
} from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #408 — destroying a bound Mission loan from Inventory, against real
 * PostgreSQL. What only the database proves: the instance, the run, a pending
 * field action and the slot go in one transaction; nothing is paid, counted or
 * moved; and a stale, duplicate, forged or racing request ends at most one run
 * and never touches a newer one.
 */
suite("issue #408 Mission item Destroy (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let jobs: typeof import("@/server/research-job-commands");
  const createdUsers: string[] = [];
  const start = new Date("2026-10-26T12:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const quiet = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });
  const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
  const after = (from: Date) =>
    new Date(from.getTime() + (balance.researchJobs.surfaceSampleDurationTicks + 1) * GAME_TICK_MS);
  const COURIER = RESEARCH_JOB_IDS.researchCourier;
  const SURVEY = RESEARCH_JOB_IDS.geologicalFieldSurvey;
  const CALIBRATION = RESEARCH_JOB_IDS.resonanceCalibration;
  const WORKSHOP = LOCATION_IDS.hilltopWorkshop;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    jobs = await import("@/server/research-job-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  type Who = { userId: string; characterId: string };

  /** Instances every new character is provisioned with; tests look only at what they add. */
  const provisioned = new Map<string, Set<string>>();

  async function makeCharacter(label: string): Promise<Who> {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Dst ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, quiet());
    await move(character.id, WORKSHOP);
    await db.insert(rune.characterMissions).values({
      characterId: character.id,
      missionId: MISSION_IDS.notFromAroundHere,
      acceptedAt: start,
      completedAt: start,
    });
    provisioned.set(
      character.id,
      new Set((await instancesIncludingStarter(character.id)).map((row) => row.id)),
    );
    return { userId, characterId: character.id };
  }

  const move = (characterId: string, locationId: string) =>
    db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  const read = (who: Who, now = start) =>
    play.getPlayGameplayState(who.userId, who.characterId, now, quiet());

  async function assignment(characterId: string) {
    const [row] = await db
      .select()
      .from(rune.characterResearchAssignments)
      .where(eq(rune.characterResearchAssignments.characterId, characterId));
    return row;
  }

  const instancesIncludingStarter = (characterId: string) =>
    db.select().from(rune.itemInstances).where(eq(rune.itemInstances.characterId, characterId));
  const instancesOf = async (characterId: string) =>
    (await instancesIncludingStarter(characterId)).filter(
      (row) => !provisioned.get(characterId)?.has(row.id),
    );

  async function creditsOf(characterId: string) {
    const [row] = await db
      .select({ credits: rune.characters.credits, at: rune.characters.currentLocationId })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row!;
  }

  const activeActionOf = async (characterId: string) =>
    (
      await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, characterId))
    )[0];

  const completions = async (characterId: string) =>
    (
      await db
        .select()
        .from(rune.characterResearchJobs)
        .where(eq(rune.characterResearchJobs.characterId, characterId))
    ).reduce((sum, row) => sum + row.completions, 0);

  /** Accept a job; return the run and its exact loan instance. */
  async function begin(who: Who, jobId: string, now = start) {
    const result = await jobs.acceptResearchJob(who.userId, who.characterId, { jobId }, now);
    expect(result.research).toMatchObject({ status: "ok", kind: "accepted" });
    const row = (await assignment(who.characterId))!;
    return { run: row.id, item: row.itemInstanceId! };
  }

  const destroy = (who: Who, itemInstanceId: string, assignmentId: string, now = at(30)) =>
    jobs.destroyMissionItem(who.userId, who.characterId, { itemInstanceId, assignmentId }, now);

  const startField = (who: Who, run: string, now: Date) =>
    jobs.startResearchField(who.userId, who.characterId, { assignmentId: run }, now);

  describe.each([
    [COURIER, ITEM_IDS.sealedResearchPacket, 2_000, undefined],
    [SURVEY, ITEM_IDS.geologicalSampleCase, 100, LOCATION_IDS.prospectingQuarry],
    [CALIBRATION, ITEM_IDS.resonanceSampler, 100, LOCATION_IDS.theLowHum],
  ] as const)("%s", (jobId, itemId, mass, fieldSite) => {
    it("destroys only the loan and its run, with no payout, count, move or grant", async () => {
      const who = await makeCharacter(`Dst${jobId.slice(0, 6)}`);
      const before = await read(who);
      const { run, item } = await begin(who, jobId);
      const ledger = await creditsOf(who.characterId);
      // Real progress to forfeit, resolved before the destroy.
      if (fieldSite) {
        await move(who.characterId, fieldSite);
        await startField(who, run, at(5));
      }
      const resolved = await read(who, after(at(5)));
      const result = await destroy(who, item, run, after(at(5)));
      expect(result.research).toMatchObject({ status: "ok", kind: "destroyed", jobId });
      expect(result.state.research.assignment).toBeUndefined();
      expect(result.state.inventory.uniqueItems.some((entry) => entry.id === item)).toBe(false);
      expect(result.state.inventory.slotsUsed).toBe(before.inventory.slotsUsed);
      expect(result.state.inventory.massGrams).toBe(before.inventory.massGrams);
      expect(resolved.inventory.massGrams).toBe(before.inventory.massGrams + mass);
      expect(result.state.missions.some((mission) => mission.missionId === jobId)).toBe(false);
      expect(await assignment(who.characterId)).toBeUndefined();
      expect(await instancesOf(who.characterId)).toHaveLength(0);
      expect(await activeActionOf(who.characterId)).toBeUndefined();
      expect(await completions(who.characterId)).toBe(0);
      const after_ = await creditsOf(who.characterId);
      expect(after_.credits).toBe(ledger.credits);
      expect(after_.at).toBe(fieldSite ?? WORKSHOP);
      expect(result.state.inventory.stacks).toEqual(before.inventory.stacks);
      // The slot is free: the same job is offered again, from scratch.
      await move(who.characterId, WORKSHOP);
      const again = await begin(who, jobId, at(60));
      expect(again.run).not.toBe(run);
      expect((await read(who, at(61))).research.assignment).toMatchObject({
        progress: { current: 0 },
      });
    });
  });

  it("cancels a still-running field action and revives nothing later", async () => {
    const who = await makeCharacter("DstPending");
    const { run, item } = await begin(who, SURVEY);
    await move(who.characterId, LOCATION_IDS.prospectingQuarry);
    await startField(who, run, at(5));
    expect(await activeActionOf(who.characterId)).toBeDefined();
    const result = await destroy(who, item, run, at(6));
    expect(result.research).toMatchObject({ status: "ok", kind: "destroyed" });
    expect(await activeActionOf(who.characterId)).toBeUndefined();
    const later = await read(who, at(120));
    expect(later.research.assignment).toBeUndefined();
    expect(await assignment(who.characterId)).toBeUndefined();
  });

  it("forfeits a field action that resolved first, even a completed Calibration reading", async () => {
    const who = await makeCharacter("DstRecorded");
    const { run, item } = await begin(who, CALIBRATION);
    await move(who.characterId, LOCATION_IDS.theLowHum);
    await startField(who, run, at(5));
    const recorded = await read(who, after(at(5)));
    expect(recorded.research.assignment).toMatchObject({ recorded: true, stage: "ready" });
    // The request lands after the action is due: reconciliation records it, then it is forfeited.
    const result = await destroy(who, item, run, after(at(5)));
    expect(result.research).toMatchObject({ status: "ok", kind: "destroyed" });
    expect(await completions(who.characterId)).toBe(0);
    expect((await creditsOf(who.characterId)).at).toBe(LOCATION_IDS.theLowHum);
  });

  describe("authorization", () => {
    it("has no packet to destroy after FedHex delivery; Abandon still ends the run unpaid", async () => {
      const who = await makeCharacter("DstDelivered");
      const { run, item } = await begin(who, COURIER);
      await move(who.characterId, LOCATION_IDS.stillreachLandingStation);
      const delivered = await jobs.deliverResearchPacket(
        who.userId,
        who.characterId,
        { assignmentId: run, localPlaceId: LOCAL_PLACE_IDS.fedhexStillreachLandingStation },
        at(5),
      );
      expect(delivered.research).toMatchObject({ status: "ok", kind: "delivered" });
      const refused = await destroy(who, item, run, at(6));
      expect(refused.research).toMatchObject({ status: "refused", reason: "item_missing" });
      expect(await assignment(who.characterId)).toBeDefined();
      const credits = (await creditsOf(who.characterId)).credits;
      const abandoned = await jobs.abandonResearchJob(
        who.userId,
        who.characterId,
        { assignmentId: run },
        at(7),
      );
      expect(abandoned.research).toMatchObject({ status: "ok", kind: "abandoned" });
      expect((await creditsOf(who.characterId)).credits).toBe(credits);
      expect(await completions(who.characterId)).toBe(0);
    });

    it("refuses a forged instance, an orphan lookalike and an ordinary unique item", async () => {
      const who = await makeCharacter("DstForged");
      const { run, item } = await begin(who, COURIER);
      const [orphan] = await db
        .insert(rune.itemInstances)
        .values({ characterId: who.characterId, itemId: ITEM_IDS.sealedResearchPacket })
        .returning();
      const [cutter] = await db
        .insert(rune.itemInstances)
        .values({ characterId: who.characterId, itemId: ITEM_IDS.salvageCutter })
        .returning();
      for (const forged of [crypto.randomUUID(), orphan!.id, cutter!.id]) {
        const result = await destroy(who, forged, run);
        expect(result.research).toMatchObject({ status: "refused", reason: "item_missing" });
      }
      expect((await assignment(who.characterId))!.id).toBe(run);
      expect((await instancesOf(who.characterId)).map((row) => row.id).sort()).toEqual(
        [item, orphan!.id, cutter!.id].sort(),
      );
    });

    it("refuses another character's run and item without touching either", async () => {
      const owner = await makeCharacter("DstOwner");
      const other = await makeCharacter("DstOther");
      const { run, item } = await begin(owner, COURIER);
      const own = await begin(other, COURIER);
      const mixed = await destroy(other, item, run);
      expect(mixed.research).toMatchObject({ status: "refused", reason: "no_assignment" });
      const crossItem = await destroy(other, item, own.run);
      expect(crossItem.research).toMatchObject({ status: "refused", reason: "item_missing" });
      await expect(
        destroy({ ...other, characterId: owner.characterId }, item, run),
      ).rejects.toThrow();
      expect((await assignment(owner.characterId))!.id).toBe(run);
      expect((await assignment(other.characterId))!.id).toBe(own.run);
      expect(await instancesOf(owner.characterId)).toHaveLength(1);
      expect(await instancesOf(other.characterId)).toHaveLength(1);
    });

    it("cannot end a newer run of the same job with a stale request", async () => {
      const who = await makeCharacter("DstStale");
      const first = await begin(who, COURIER);
      await destroy(who, first.item, first.run, at(5));
      const second = await begin(who, COURIER, at(10));
      const stale = await destroy(who, first.item, first.run, at(11));
      expect(stale.research).toMatchObject({ status: "refused", reason: "no_assignment" });
      // The new run's id with the old instance is just as dead.
      const mixed = await destroy(who, first.item, second.run, at(12));
      expect(mixed.research).toMatchObject({ status: "refused", reason: "item_missing" });
      expect((await assignment(who.characterId))!.id).toBe(second.run);
      expect((await instancesOf(who.characterId)).map((row) => row.id)).toEqual([second.item]);
    });
  });

  describe("concurrency", () => {
    it("lets exactly one of duplicate destroys win", async () => {
      const who = await makeCharacter("DstDouble");
      const { run, item } = await begin(who, SURVEY);
      const results = await Promise.all([
        destroy(who, item, run, at(5)),
        destroy(who, item, run, at(5)),
        destroy(who, item, run, at(5)),
      ]);
      expect(results.filter((result) => result.research.status === "ok")).toHaveLength(1);
      for (const result of results.filter((entry) => entry.research.status === "refused")) {
        expect(result.research).toMatchObject({ reason: "no_assignment" });
      }
      expect(await assignment(who.characterId)).toBeUndefined();
      expect(await instancesOf(who.characterId)).toHaveLength(0);
    });

    it("lets exactly one of Destroy and Mission Log Abandon end the run", async () => {
      const who = await makeCharacter("DstVsAbandon");
      const { run, item } = await begin(who, CALIBRATION);
      const [destroyed, abandoned] = await Promise.all([
        destroy(who, item, run, at(5)),
        jobs.abandonResearchJob(who.userId, who.characterId, { assignmentId: run }, at(5)),
      ]);
      expect(
        [destroyed, abandoned].filter((result) => result.research.status === "ok"),
      ).toHaveLength(1);
      expect(await assignment(who.characterId)).toBeUndefined();
      expect(await instancesOf(who.characterId)).toHaveLength(0);
      expect(await completions(who.characterId)).toBe(0);
    });

    it("never pays, or leaves a run holding a deleted packet, when racing FedHex delivery", async () => {
      const who = await makeCharacter("DstVsDeliver");
      const { run, item } = await begin(who, COURIER);
      await move(who.characterId, LOCATION_IDS.stillreachLandingStation);
      const credits = (await creditsOf(who.characterId)).credits;
      const [destroyed, delivered] = await Promise.all([
        destroy(who, item, run, at(5)),
        jobs.deliverResearchPacket(
          who.userId,
          who.characterId,
          { assignmentId: run, localPlaceId: LOCAL_PLACE_IDS.fedhexStillreachLandingStation },
          at(5),
        ),
      ]);
      const row = await assignment(who.characterId);
      if (destroyed.research.status === "ok") {
        expect(delivered.research).toMatchObject({ status: "refused", reason: "no_assignment" });
        expect(row).toBeUndefined();
      } else {
        expect(delivered.research).toMatchObject({ status: "ok", kind: "delivered" });
        expect(row).toMatchObject({ id: run, itemInstanceId: null });
      }
      expect(await instancesOf(who.characterId)).toHaveLength(0);
      expect((await creditsOf(who.characterId)).credits).toBe(credits);
      expect(await completions(who.characterId)).toBe(0);
    });
  });
});
