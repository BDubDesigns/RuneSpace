import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  DIALOGUE_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  RESEARCH_JOB_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import { getNpc } from "@/game/content/npcs";
import {
  RESEARCH_ARRIVAL_COPY,
  RESEARCH_COPY,
  RESEARCH_GIVER,
  RESEARCH_JOBS,
  RESEARCH_PASSAGE_COPY,
  getResearchJob,
  type ResearchJobDefinition,
} from "@/game/content/research-jobs";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { isItemTransferable } from "@/game/domain/player-trade";
import {
  assignmentFactsOf,
  availableFieldAction,
  canDeliverPacket,
  isResearchLoanItem,
  planResearchLoan,
  projectResearchAssignment,
  researchFieldActionTicks,
  researchObjective,
  researchOfferStatus,
  researchProgress,
  researchRunDialogueId,
  researchStage,
  validateResearchJobs,
  type ResearchAssignmentFacts,
} from "@/game/domain/research-jobs";
import { seconds } from "@/features/shared/duration-copy";

const balance = getEffectiveGameBalance();

function facts(jobId: string, overrides: Partial<ResearchAssignmentFacts> = {}) {
  return {
    assignmentId: "run-1",
    jobId,
    loanItemHeld: true,
    delivered: false,
    recorded: false,
    sampledLocationIds: [],
    ...overrides,
  } satisfies ResearchAssignmentFacts;
}

const COURIER = getResearchJob(RESEARCH_JOB_IDS.researchCourier)!;
const SURVEY = getResearchJob(RESEARCH_JOB_IDS.geologicalFieldSurvey)!;
const CALIBRATION = getResearchJob(RESEARCH_JOB_IDS.resonanceCalibration)!;
if (COURIER.kind !== "courier" || SURVEY.kind !== "survey" || CALIBRATION.kind !== "calibration") {
  throw new Error("research job kinds changed");
}

describe("the research job registry", () => {
  it("validates at module load and lists the three approved jobs in order", () => {
    expect(() => validateResearchJobs()).not.toThrow();
    expect(RESEARCH_JOBS.map((job) => job.title)).toEqual([
      "Research Courier",
      "Geological Field Survey",
      "Resonance Calibration",
    ]);
  });

  it("lends one distinct unique loan item per job: 2 kg, 100 g and 100 g", () => {
    const masses = RESEARCH_JOBS.map((job) => {
      const definition = Object.values(balance.items).find(
        (item) => item.itemId === job.loanItemId,
      );
      expect(definition, job.id).toBeDefined();
      expect("stackLimit" in definition!).toBe(false);
      return definition!.massGrams;
    });
    expect(masses).toEqual([2_000, 100, 100]);
    expect(new Set(RESEARCH_JOBS.map((job) => job.loanItemId)).size).toBe(3);
  });

  it("pays 25 and 75 Credits from balance, never XP, and the copy agrees", () => {
    expect(balance.researchJobs.courierRewardCredits).toBe(25);
    expect(balance.researchJobs.surveyRewardCredits).toBe(75);
    expect(COURIER.rewardLabel).toContain("25 Credits");
    expect(SURVEY.rewardLabel).toContain("75 Credits");
    for (const job of RESEARCH_JOBS) expect(job.rewardLabel).toMatch(/No (Credits or )?XP/);
  });

  it("measures field work in whole ticks: 8 ticks is 4.8 seconds at 600 ms", () => {
    expect(GAME_TICK_MS).toBe(600);
    expect(researchFieldActionTicks("surface_sample")).toBe(8);
    expect(researchFieldActionTicks("resonance_recording")).toBe(8);
    expect(seconds(8, GAME_TICK_MS)).toBe("4.8 sec");
  });

  it("uses the existing Stillreach FedHex, three existing Survey sites and the Low Hum", () => {
    expect(COURIER.deliveryLocalPlaceId).toBe(LOCAL_PLACE_IDS.fedhexStillreachLandingStation);
    expect(COURIER.deliveryLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
    expect(SURVEY.siteLocationIds).toEqual([
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.theDrySeam,
      LOCATION_IDS.harmonicWorkings,
    ]);
    expect(CALIBRATION.recordingLocationId).toBe(LOCATION_IDS.theLowHum);
    expect(CALIBRATION.destinationLocationId).toBe(LOCATION_IDS.crashSite);
    expect(RESEARCH_GIVER).toEqual({
      npcId: NPC_IDS.wiseOldEnby,
      locationId: LOCATION_IDS.hilltopWorkshop,
    });
  });

  it("gates only Calibration, on Not From Around Here", () => {
    const gateOf = (job: ResearchJobDefinition) => job.gate;
    expect(gateOf(COURIER)).toBeUndefined();
    expect(gateOf(SURVEY)).toBeUndefined();
    expect(gateOf(CALIBRATION)?.completedMissionId).toBe(MISSION_IDS.notFromAroundHere);
  });
});

describe("loan items", () => {
  it("are recognised by the registry and are never tradable", () => {
    for (const job of RESEARCH_JOBS) {
      expect(isResearchLoanItem(job.loanItemId)).toBe(true);
      expect(isItemTransferable(job.loanItemId)).toBe(false);
    }
    expect(isResearchLoanItem(ITEM_IDS.salvageCutter)).toBe(false);
    expect(isItemTransferable(ITEM_IDS.salvageCutter)).toBe(true);
  });
});

describe("capacity", () => {
  it("needs a slot AND the mass, and says which failed", () => {
    expect(
      planResearchLoan({ massGrams: 2_000, availableSlots: 1, availableMassGrams: 2_000 }),
    ).toEqual({
      ok: true,
    });
    const slots = planResearchLoan({
      massGrams: 100,
      availableSlots: 0,
      availableMassGrams: 5_000,
    });
    expect(slots).toMatchObject({ ok: false, reason: "slots" });
    const mass = planResearchLoan({
      massGrams: 2_000,
      availableSlots: 4,
      availableMassGrams: 1_999,
    });
    expect(mass).toMatchObject({ ok: false, reason: "mass" });
    if (!mass.ok) expect(mass.message).toMatch(/1 g/);
    expect(
      planResearchLoan({ massGrams: 2_000, availableSlots: 0, availableMassGrams: 0 }),
    ).toMatchObject({ ok: false, reason: "slots_and_mass" });
    // Exactly the needed mass fits: capacity is checked for the full 2 kg.
    expect(
      planResearchLoan({ massGrams: 2_000, availableSlots: 1, availableMassGrams: 2_000 }).ok,
    ).toBe(true);
  });
});

describe("offers", () => {
  const none = new Set<string>();
  it("lists all three, blocks the others while one is held, and gates Calibration", () => {
    expect(researchOfferStatus(COURIER, { completedMissionIds: none })).toBe("available");
    expect(researchOfferStatus(CALIBRATION, { completedMissionIds: none })).toBe("locked");
    const story = new Set([MISSION_IDS.notFromAroundHere]);
    expect(researchOfferStatus(CALIBRATION, { completedMissionIds: story })).toBe("available");
    expect(
      researchOfferStatus(SURVEY, { completedMissionIds: story, activeJobId: COURIER.id }),
    ).toBe("blocked");
    expect(
      researchOfferStatus(COURIER, { completedMissionIds: story, activeJobId: COURIER.id }),
    ).toBe("active");
    // A locked job stays locked even with nothing held, and a held job never unlocks one.
    expect(
      researchOfferStatus(CALIBRATION, { completedMissionIds: none, activeJobId: COURIER.id }),
    ).toBe("locked");
  });
});

describe("stages and progress", () => {
  it("derives every stage from the facts alone", () => {
    expect(researchStage(COURIER, facts(COURIER.id))).toBe("field");
    expect(researchStage(COURIER, facts(COURIER.id, { delivered: true }))).toBe("ready");
    expect(researchStage(CALIBRATION, facts(CALIBRATION.id))).toBe("field");
    expect(researchStage(CALIBRATION, facts(CALIBRATION.id, { recorded: true }))).toBe("ready");
    const two = facts(SURVEY.id, { sampledLocationIds: SURVEY.siteLocationIds.slice(0, 2) });
    expect(researchStage(SURVEY, two)).toBe("field");
    expect(researchProgress(SURVEY, two)).toEqual({ current: 2, target: 3 });
    expect(
      researchStage(SURVEY, facts(SURVEY.id, { sampledLocationIds: [...SURVEY.siteLocationIds] })),
    ).toBe("ready");
    // A site that is not part of the survey never counts.
    expect(
      researchProgress(SURVEY, facts(SURVEY.id, { sampledLocationIds: [LOCATION_IDS.theLowHum] })),
    ).toEqual({ current: 0, target: 3 });
  });

  it("chooses the reminder or the return conversation from the run", () => {
    expect(researchRunDialogueId(SURVEY, facts(SURVEY.id))).toBe(
      DIALOGUE_IDS.geologicalSurveyNoProgress,
    );
    expect(
      researchRunDialogueId(
        SURVEY,
        facts(SURVEY.id, { sampledLocationIds: SURVEY.siteLocationIds.slice(0, 1) }),
      ),
    ).toBe(DIALOGUE_IDS.geologicalSurveyPartial);
    expect(
      researchRunDialogueId(
        SURVEY,
        facts(SURVEY.id, { sampledLocationIds: [...SURVEY.siteLocationIds] }),
      ),
    ).toBe(DIALOGUE_IDS.geologicalSurveyTurnIn);
    expect(researchRunDialogueId(COURIER, facts(COURIER.id))).toBe(
      DIALOGUE_IDS.researchCourierReminder,
    );
    expect(researchRunDialogueId(COURIER, facts(COURIER.id, { delivered: true }))).toBe(
      DIALOGUE_IDS.researchCourierTurnIn,
    );
    expect(researchRunDialogueId(CALIBRATION, facts(CALIBRATION.id))).toBe(
      DIALOGUE_IDS.resonanceCalibrationReminder,
    );
    expect(researchRunDialogueId(CALIBRATION, facts(CALIBRATION.id, { recorded: true }))).toBe(
      DIALOGUE_IDS.resonanceCalibrationDeparture,
    );
  });
});

describe("field actions", () => {
  it("offers a Survey specimen only at an unsampled site while the case is carried", () => {
    const run = facts(SURVEY.id, { sampledLocationIds: [LOCATION_IDS.theDrySeam] });
    expect(availableFieldAction(run, LOCATION_IDS.prospectingQuarry)).toEqual({
      kind: "surface_sample",
      locationId: LOCATION_IDS.prospectingQuarry,
    });
    expect(availableFieldAction(run, LOCATION_IDS.theDrySeam)).toBeUndefined();
    expect(availableFieldAction(run, LOCATION_IDS.theLowHum)).toBeUndefined();
    expect(availableFieldAction(run, LOCATION_IDS.hilltopWorkshop)).toBeUndefined();
    expect(
      availableFieldAction({ ...run, loanItemHeld: false }, LOCATION_IDS.prospectingQuarry),
    ).toBeUndefined();
    expect(availableFieldAction(undefined, LOCATION_IDS.prospectingQuarry)).toBeUndefined();
  });

  it("offers the recording only at The Low Hum, once, for Calibration", () => {
    const run = facts(CALIBRATION.id);
    expect(availableFieldAction(run, LOCATION_IDS.theLowHum)).toEqual({
      kind: "resonance_recording",
      locationId: LOCATION_IDS.theLowHum,
    });
    expect(availableFieldAction(run, LOCATION_IDS.prospectingQuarry)).toBeUndefined();
    expect(
      availableFieldAction({ ...run, recorded: true }, LOCATION_IDS.theLowHum),
    ).toBeUndefined();
    // The Courier has no field action anywhere.
    for (const location of Object.values(LOCATION_IDS)) {
      expect(availableFieldAction(facts(COURIER.id), location)).toBeUndefined();
    }
  });

  it("accepts the packet only at the Stillreach FedHex, undelivered and carried", () => {
    const here = {
      locationId: LOCATION_IDS.stillreachLandingStation,
      localPlaceId: LOCAL_PLACE_IDS.fedhexStillreachLandingStation,
    };
    expect(canDeliverPacket(facts(COURIER.id), here)).toBe(true);
    expect(
      canDeliverPacket(facts(COURIER.id), {
        locationId: LOCATION_IDS.holoHollowLanding,
        localPlaceId: LOCAL_PLACE_IDS.fedhexHoloHollowLanding,
      }),
    ).toBe(false);
    expect(
      canDeliverPacket(facts(COURIER.id), {
        ...here,
        localPlaceId: LOCAL_PLACE_IDS.stillreachRefinerToGo,
      }),
    ).toBe(false);
    expect(canDeliverPacket(facts(COURIER.id, { delivered: true }), here)).toBe(false);
    expect(canDeliverPacket(facts(COURIER.id, { loanItemHeld: false }), here)).toBe(false);
    expect(canDeliverPacket(facts(SURVEY.id), here)).toBe(false);
    expect(canDeliverPacket(undefined, here)).toBe(false);
  });
});

describe("the Mission-shaped projection of a run", () => {
  const at = (locationId: string, stationary = true) => ({
    currentLocationId: locationId,
    stationary,
  });

  it("is an active Mission with a field objective and guidance to its work", () => {
    const courier = projectResearchAssignment(facts(COURIER.id), at(LOCATION_IDS.hilltopWorkshop))!;
    expect(courier).toMatchObject({
      missionId: COURIER.id,
      title: "Research Courier",
      state: "active",
      research: { assignmentId: "run-1" },
      stage: { requirementsSatisfied: false, turnInAvailable: false },
      guidance: { locationId: LOCATION_IDS.stillreachLandingStation },
    });
    expect(courier.currentObjective).toMatch(/Sealed Research Packet/);
    // At the station the Local Place entrance carries the guidance.
    expect(
      projectResearchAssignment(facts(COURIER.id), at(LOCATION_IDS.stillreachLandingStation))!
        .guidance,
    ).toEqual({ localPlaceId: LOCAL_PLACE_IDS.fedhexStillreachLandingStation });
  });

  it("turns blue at the return and offers the Talk control once the character is there", () => {
    const delivered = facts(COURIER.id, { delivered: true, loanItemHeld: false });
    const away = projectResearchAssignment(delivered, at(LOCATION_IDS.stillreachLandingStation))!;
    expect(away).toMatchObject({
      state: "ready_for_completion",
      stage: { requirementsSatisfied: true, turnInAvailable: false },
      guidance: { turnIn: true, locationId: LOCATION_IDS.hilltopWorkshop },
    });
    expect(away.currentObjective).toBe(
      "Return to The Wise Old Enby at Hilltop Workshop to collect payment",
    );
    const there = projectResearchAssignment(delivered, at(LOCATION_IDS.hilltopWorkshop))!;
    expect(there.guidance).toEqual({ turnIn: true, npcId: NPC_IDS.wiseOldEnby });
    expect(there.stage?.turnInAvailable).toBe(true);
    expect(
      projectResearchAssignment(delivered, at(LOCATION_IDS.hilltopWorkshop, false))!.stage
        ?.turnInAvailable,
    ).toBe(false);
  });

  it("guides the Survey to every remaining site at once and shows X / 3", () => {
    const run = facts(SURVEY.id, { sampledLocationIds: [LOCATION_IDS.theDrySeam] });
    const projection = projectResearchAssignment(run, at(LOCATION_IDS.hilltopWorkshop))!;
    expect(projection.guidance?.locationIds).toEqual([
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.harmonicWorkings,
    ]);
    expect(projection.requirements?.[0]?.progress).toEqual({ current: 1, target: 3 });
    expect(projection.currentObjective).toMatch(/1 \/ 3/);
    // Standing at an unsampled site, it is no longer a place to travel to.
    expect(
      projectResearchAssignment(run, at(LOCATION_IDS.prospectingQuarry))!.guidance?.locationIds,
    ).toEqual([LOCATION_IDS.harmonicWorkings]);
    // The shared guidance derivation lights each remaining hex.
    const targets = deriveMissionGuidanceTargets([projection]);
    expect([...targets.locationIds].sort()).toEqual(
      [LOCATION_IDS.prospectingQuarry, LOCATION_IDS.harmonicWorkings].sort(),
    );
    expect(targets.turnInLocationIds.size).toBe(0);
  });

  it("directs a recorded Calibration back to the workshop, not to a passage", () => {
    const run = facts(CALIBRATION.id, { recorded: true });
    const projection = projectResearchAssignment(run, at(LOCATION_IDS.theLowHum))!;
    expect(projection.state).toBe("ready_for_completion");
    expect(projection.guidance).toEqual({ turnIn: true, locationId: LOCATION_IDS.hilltopWorkshop });
    expect(projection.currentObjective).toMatch(/Return to The Wise Old Enby/);
    expect(researchObjective(CALIBRATION, facts(CALIBRATION.id))).toBe(
      "Record a resonance signature at The Low Hum",
    );
  });

  it("offers only Abandon when the loaned item is missing", () => {
    const lost = facts(SURVEY.id, { loanItemHeld: false });
    const projection = projectResearchAssignment(lost, at(LOCATION_IDS.hilltopWorkshop))!;
    expect(projection.guidance).toEqual({});
    expect(projection.currentObjective).toMatch(/Abandon/);
  });

  it("rebuilds the same facts from a client projection", () => {
    expect(
      assignmentFactsOf({
        assignmentId: "a",
        jobId: SURVEY.id,
        stage: "field",
        loanItemHeld: true,
        delivered: false,
        recorded: false,
        sampledLocationIds: [LOCATION_IDS.theDrySeam],
        progress: { current: 1, target: 3 },
      }),
    ).toEqual(
      facts(SURVEY.id, { assignmentId: "a", sampledLocationIds: [LOCATION_IDS.theDrySeam] }),
    );
    expect(assignmentFactsOf(undefined)).toBeUndefined();
  });
});

describe("player-facing copy", () => {
  const enby = getNpc(NPC_IDS.wiseOldEnby)!;

  it("always names the character The Wise Old Enby, never Enby alone", () => {
    expect(enby.displayName).toBe("The Wise Old Enby");
    const strings: string[] = [
      ...RESEARCH_JOBS.flatMap((job) => [
        job.title,
        job.pitch,
        job.requirements,
        job.rewardLabel,
        job.summary,
        job.finalActionLabel,
        ...(job.gate ? [job.gate.lockedCopy] : []),
      ]),
      ...Object.values(RESEARCH_COPY),
      ...Object.values(RESEARCH_ARRIVAL_COPY),
      ...Object.values(RESEARCH_PASSAGE_COPY),
    ];
    for (const job of RESEARCH_JOBS) {
      for (const dialogueId of Object.values(job.dialogue)) {
        for (const beat of getDialogue(dialogueId)!.beats)
          if (beat.kind === "npc") strings.push(beat.text);
      }
    }
    strings.push(
      researchObjective(COURIER, facts(COURIER.id)),
      researchObjective(COURIER, facts(COURIER.id, { delivered: true })),
      researchObjective(SURVEY, facts(SURVEY.id)),
      researchObjective(CALIBRATION, facts(CALIBRATION.id, { recorded: true })),
    );
    for (const text of strings) {
      expect(text.replace(/The Wise Old Enby/g, ""), text).not.toMatch(/\bEnby\b/);
    }
  });

  it("speaks every sequence as the Enby, in their authored expressions", () => {
    for (const job of RESEARCH_JOBS) {
      for (const dialogueId of Object.values(job.dialogue)) {
        const sequence = getDialogue(dialogueId)!;
        expect(sequence.npcId, dialogueId).toBe(NPC_IDS.wiseOldEnby);
        for (const beat of sequence.beats) {
          if (beat.kind === "npc") {
            expect(beat.speakerNpcId).toBe(NPC_IDS.wiseOldEnby);
            expect(beat.presentationMode).toBe("local");
            expect(beat.text.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("presents each loan as an item beat when issued, and only then", () => {
    for (const job of RESEARCH_JOBS) {
      const itemBeats = (id: string) =>
        getDialogue(id)!.beats.filter((beat) => beat.kind === "item");
      expect(itemBeats(job.dialogue.accepted)).toEqual([
        expect.objectContaining({ itemId: job.loanItemId, quantity: 1 }),
      ]);
      for (const other of [
        job.dialogue.firstOffer,
        job.dialogue.repeatOffer,
        job.dialogue.capacity,
        job.dialogue.fieldReminder,
        job.dialogue.ready,
      ]) {
        expect(itemBeats(other)).toEqual([]);
      }
    }
  });

  it("plays the whole Calibration farewell before the passage is offered", () => {
    const beats = getDialogue(DIALOGUE_IDS.resonanceCalibrationDeparture)!.beats.filter(
      (beat) => beat.kind === "npc",
    );
    const texts = beats.map((beat) => beat.text);
    expect(texts.at(-1)).toBe(
      "Whenever you're ready, then. Safe travels! And do come back sometime. The universe is much more interesting with company.",
    );
    const normal = texts.indexOf(
      "When the resonance takes hold, you'll feel a slight sensation. Perfectly normal.",
    );
    expect(normal).toBeGreaterThan(-1);
    expect(texts[normal + 1]).toBe("Probably.");
    // Nothing after the farewell: the arrival is system UI, not speech.
    expect(texts.at(-1)).not.toMatch(/Welcome to Skatboll/);
  });

  it("keeps first-time explanations longer than the repeat introductions", () => {
    for (const job of RESEARCH_JOBS) {
      expect(getDialogue(job.dialogue.firstOffer)!.beats.length).toBeGreaterThan(
        getDialogue(job.dialogue.repeatOffer)!.beats.length,
      );
    }
  });

  it("states the passage warnings and arrival copy from the approved canon", () => {
    expect(RESEARCH_PASSAGE_COPY).toMatchObject({
      heading: "RETURN TO SKATBOLL?",
      teleport: "TELEPORT NOW",
      decline: "NOT YET",
      open: "OPEN PASSAGE TO SKATBOLL",
    });
    expect(RESEARCH_ARRIVAL_COPY.heading).toBe("RESONANCE TRANSFER COMPLETE");
    expect(RESEARCH_ARRIVAL_COPY.continueLabel).toBe("CONTINUE");
    expect(RESEARCH_COPY.deliveryAction).toBe("DELIVER RESEARCH PACKET");
    expect(RESEARCH_COPY.surveyAction).toBe("COLLECT SURFACE SAMPLE");
    expect(RESEARCH_COPY.recordingAction).toBe("RECORD RESONANCE SIGNATURE");
  });
});
