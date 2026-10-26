import {
  DIALOGUE_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  RESEARCH_JOB_IDS,
  type DialogueId,
  type ItemId,
  type LocalPlaceId,
  type LocationId,
  type MissionId,
  type NpcId,
  type ResearchJobId,
} from "@/game/config/foundations";

/**
 * The Wise Old Enby's repeatable research jobs, as authored content (#406).
 *
 * Three jobs share one exclusive assignment slot per character. This file owns
 * what each job IS: its copy, its loaned item, where its field work happens and
 * the dialogue sequences that present it. How a run is persisted and decided is
 * `server/research-jobs.ts`; what stage a run is in is `game/domain/research-jobs`.
 * No client or server code names a job, an item or a location of its own.
 *
 * Speaker copy always reads "The Wise Old Enby" (the NPC's display name).
 */

/** Player-facing button copy, shared by every job. */
export const RESEARCH_ACCEPT_LABEL = "ACCEPT ASSIGNMENT";
export const RESEARCH_DECLINE_LABEL = "NOT RIGHT NOW";
export const RESEARCH_ABANDON_LABEL = "Abandon Assignment";

/** The one NPC and the one place the jobs are offered, accepted and turned in. */
export const RESEARCH_GIVER: { npcId: NpcId; locationId: LocationId } = {
  npcId: NPC_IDS.wiseOldEnby,
  locationId: LOCATION_IDS.hilltopWorkshop,
};

/** The sequences a job presents, by moment. All are Wise Old Enby sequences. */
export type ResearchJobDialogue = {
  /** The full first-time briefing; replayable on its own from Research Jobs. */
  firstOffer: DialogueId;
  /** The short offer after the job has been completed at least once. */
  repeatOffer: DialogueId;
  /** Played right after a successful acceptance; ends on the item beat. */
  accepted: DialogueId;
  /** Played when acceptance was refused for lack of a slot or mass. */
  capacity: DialogueId;
  /** The reminder while the field work has not started, or is all there is. */
  fieldReminder: DialogueId;
  /** The reminder after some, but not all, of the field work (Survey only). */
  fieldPartial?: DialogueId;
  /** The return conversation that carries the job's final action. */
  ready: DialogueId;
  /** Played after a confirmed payout; absent when the job ends in a teleport. */
  completion?: DialogueId;
};

type ResearchJobBase = {
  id: ResearchJobId;
  /** The job's name everywhere: the menu, the Mission Log and the strips. */
  title: string;
  /** The short pre-accept pitch beside the requirements and reward. */
  pitch: string;
  /** What the player needs, in one line. */
  requirements: string;
  /** What finishing it pays, in one line. */
  rewardLabel: string;
  /** The Mission Log's briefing for the running assignment. */
  summary: string;
  loanItemId: ItemId;
  /** The final action's label at the Enby. */
  finalActionLabel: string;
  /** When set, the job is offered only after this Mission is complete. */
  gate?: { completedMissionId: MissionId; lockedCopy: string };
  dialogue: ResearchJobDialogue;
};

export type CourierJobDefinition = ResearchJobBase & {
  kind: "courier";
  /** The Local Place whose terminal accepts the packet, and its World Location. */
  deliveryLocalPlaceId: LocalPlaceId;
  deliveryLocationId: LocationId;
  payoutCredits: "courierRewardCredits";
};

export type SurveyJobDefinition = ResearchJobBase & {
  kind: "survey";
  /** One surface specimen at each, in any order. */
  siteLocationIds: readonly LocationId[];
  payoutCredits: "surveyRewardCredits";
};

export type CalibrationJobDefinition = ResearchJobBase & {
  kind: "calibration";
  /** Where the one fresh reading is recorded. */
  recordingLocationId: LocationId;
  /** Where a confirmed passage puts the character. */
  destinationLocationId: LocationId;
};

export type ResearchJobDefinition =
  | CourierJobDefinition
  | SurveyJobDefinition
  | CalibrationJobDefinition;

export const RESEARCH_JOBS: readonly ResearchJobDefinition[] = [
  {
    id: RESEARCH_JOB_IDS.researchCourier,
    kind: "courier",
    title: "Research Courier",
    pitch:
      "A sealed research packet needs to reach FedHex at the landing station. Take it to their terminal, hand it over, and come back.",
    requirements: "One free Inventory slot and 2 kg of carrying capacity. No tools or skills.",
    rewardLabel: "25 Credits · No XP",
    summary:
      "Carry The Wise Old Enby's sealed research packet to the FedHex terminal at Stillreach Landing Station, then return to Hilltop Workshop for payment.",
    loanItemId: ITEM_IDS.sealedResearchPacket,
    finalActionLabel: "COLLECT PAYMENT — 25 CR",
    deliveryLocalPlaceId: LOCAL_PLACE_IDS.fedhexStillreachLandingStation,
    deliveryLocationId: LOCATION_IDS.stillreachLandingStation,
    payoutCredits: "courierRewardCredits",
    dialogue: {
      firstOffer: DIALOGUE_IDS.researchCourierOffer,
      repeatOffer: DIALOGUE_IDS.researchCourierRepeatOffer,
      accepted: DIALOGUE_IDS.researchCourierAccepted,
      capacity: DIALOGUE_IDS.researchCourierCapacity,
      fieldReminder: DIALOGUE_IDS.researchCourierReminder,
      ready: DIALOGUE_IDS.researchCourierTurnIn,
      completion: DIALOGUE_IDS.researchCourierCompletion,
    },
  },
  {
    id: RESEARCH_JOB_IDS.geologicalFieldSurvey,
    kind: "survey",
    title: "Geological Field Survey",
    pitch:
      "Collect one surface specimen each at Prospecting Quarry, The Dry Seam and Harmonic Workings, in any order, then bring the case back.",
    requirements:
      "One free Inventory slot and 100 g of carrying capacity. No tools, Mining or Runeworking.",
    rewardLabel: "75 Credits · No XP",
    summary:
      "Collect a surface specimen at Prospecting Quarry, The Dry Seam and Harmonic Workings with The Wise Old Enby's sample case, then return to Hilltop Workshop for payment.",
    loanItemId: ITEM_IDS.geologicalSampleCase,
    finalActionLabel: "COLLECT PAYMENT — 75 CR",
    siteLocationIds: [
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.theDrySeam,
      LOCATION_IDS.harmonicWorkings,
    ],
    payoutCredits: "surveyRewardCredits",
    dialogue: {
      firstOffer: DIALOGUE_IDS.geologicalSurveyOffer,
      repeatOffer: DIALOGUE_IDS.geologicalSurveyRepeatOffer,
      accepted: DIALOGUE_IDS.geologicalSurveyAccepted,
      capacity: DIALOGUE_IDS.geologicalSurveyCapacity,
      fieldReminder: DIALOGUE_IDS.geologicalSurveyNoProgress,
      fieldPartial: DIALOGUE_IDS.geologicalSurveyPartial,
      ready: DIALOGUE_IDS.geologicalSurveyTurnIn,
      completion: DIALOGUE_IDS.geologicalSurveyCompletion,
    },
  },
  {
    id: RESEARCH_JOB_IDS.resonanceCalibration,
    kind: "calibration",
    title: "Resonance Calibration",
    pitch:
      "Record a fresh resonance signature at The Low Hum, bring the sampler back, and The Wise Old Enby will open a passage to Skatboll's Crash Site.",
    requirements:
      "One free Inventory slot and 100 g of carrying capacity. Your ship and Cargo Hold stay where they are.",
    rewardLabel: "Passage to Skatboll Crash Site · No Credits or XP",
    summary:
      "Record a resonance signature at The Low Hum with The Wise Old Enby's sampler, then return to Hilltop Workshop. Nothing happens until you confirm the passage.",
    loanItemId: ITEM_IDS.resonanceSampler,
    finalActionLabel: "OPEN PASSAGE TO SKATBOLL",
    recordingLocationId: LOCATION_IDS.theLowHum,
    destinationLocationId: LOCATION_IDS.crashSite,
    gate: {
      completedMissionId: MISSION_IDS.notFromAroundHere,
      lockedCopy: "Available after The Wise Old Enby has introduced you to RuneSpace.",
    },
    dialogue: {
      firstOffer: DIALOGUE_IDS.resonanceCalibrationOffer,
      repeatOffer: DIALOGUE_IDS.resonanceCalibrationRepeatOffer,
      accepted: DIALOGUE_IDS.resonanceCalibrationAccepted,
      capacity: DIALOGUE_IDS.resonanceCalibrationCapacity,
      fieldReminder: DIALOGUE_IDS.resonanceCalibrationReminder,
      ready: DIALOGUE_IDS.resonanceCalibrationDeparture,
    },
  },
];

const jobById = new Map<string, ResearchJobDefinition>(RESEARCH_JOBS.map((job) => [job.id, job]));

export function getResearchJob(jobId: string): ResearchJobDefinition | undefined {
  return jobById.get(jobId);
}

/** The shared dialogue played when another research job already holds the slot. */
export const RESEARCH_BLOCKED_DIALOGUE_ID: DialogueId = DIALOGUE_IDS.researchJobBlocked;

/**
 * Terminal and field copy. System text, never Enby speech: the FedHex terminal
 * and the field actions speak for themselves.
 */
export const RESEARCH_COPY = {
  deliveryHeading: "Research Delivery",
  deliveryAction: "DELIVER RESEARCH PACKET",
  deliveryDone: "Research packet accepted. Delivery recorded.",
  deliveryNext: "Return to The Wise Old Enby at Hilltop Workshop to collect your payment.",
  surveyAction: "COLLECT SURFACE SAMPLE",
  recordingAction: "RECORD RESONANCE SIGNATURE",
  recordingDone: "Resonance signature recorded.",
  recordingNext: "The sampler hums softly. Return it to The Wise Old Enby at Hilltop Workshop.",
} as const;

/** The Calibration arrival modal's copy: system text over the destination, not NPC speech. */
export const RESEARCH_ARRIVAL_COPY = {
  heading: "RESONANCE TRANSFER COMPLETE",
  atmosphere: "The passage closes behind you. The familiar wreckage looks reassuringly solid.",
  completed: "Resonance Calibration completed.",
  continueLabel: "CONTINUE",
} as const;

/** The final-confirmation modal's copy (#406): warnings first, then TELEPORT NOW / NOT YET. */
export const RESEARCH_PASSAGE_COPY = {
  heading: "RETURN TO SKATBOLL?",
  teleport: "TELEPORT NOW",
  decline: "NOT YET",
  open: "OPEN PASSAGE TO SKATBOLL",
} as const;
