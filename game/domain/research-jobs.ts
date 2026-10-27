import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { getDialogue } from "@/game/content/dialogue";
import { getItemPresentation } from "@/game/content/item-presentation";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import { getLocation, getLocationPlanetId } from "@/game/content/locations";
import {
  MISSION_ITEM_DESTROY_POLICIES,
  getMissionItemDestroyPolicy,
} from "@/game/content/mission-item-destroy";
import { getNpc } from "@/game/content/npcs";
import {
  RESEARCH_BLOCKED_DIALOGUE_ID,
  RESEARCH_GIVER,
  RESEARCH_JOBS,
  getResearchJob,
  type ResearchJobDefinition,
} from "@/game/content/research-jobs";
import { formatMassGrams } from "@/game/domain/mass";
import type { MissionGuidance, MissionProjection } from "@/game/domain/missions";
import { isFedhexMailboxPlace } from "@/game/domain/fedhex";

/**
 * The Wise Old Enby's research-job rules (#406): pure, so the server, the
 * projection and the tests ask the same questions. The server loads the stored
 * facts and decides under the character lock; nothing here reads a database, a
 * clock or a browser.
 *
 * One run is one `ResearchAssignmentFacts`. Its stage is derived from those
 * facts alone, never stored, so the dialogue, the objective, the guidance and
 * every command agree by construction.
 */

/** The facts of one active run, as the server reads them under the lock. */
export type ResearchAssignmentFacts = {
  assignmentId: string;
  jobId: string;
  /** The loaned item is still carried in ordinary Inventory. */
  loanItemHeld: boolean;
  /** Courier: FedHex accepted the packet. */
  delivered: boolean;
  /** Calibration: the one fresh reading was recorded. */
  recorded: boolean;
  /** Survey: the sites whose specimen is in the case. */
  sampledLocationIds: readonly string[];
};

/** `field` while work remains; `ready` once only the return to the Enby is left. */
export type ResearchStage = "field" | "ready";

/** Every item a research job lends, derived from the registry. */
const LOAN_ITEM_IDS: ReadonlySet<string> = new Set(RESEARCH_JOBS.map((job) => job.loanItemId));

/**
 * Whether an item is a Wise Old Enby loan. A loan occupies an ordinary
 * Inventory slot and its real mass, but it is not the player's to trade, sell,
 * stash, store in Cargo Hold or mail: it exists only to do the job.
 */
export function isResearchLoanItem(itemId: string): boolean {
  return LOAN_ITEM_IDS.has(itemId);
}

/**
 * The Destroy offered for one carried unique item (#408), or `undefined`. It
 * exists only for an explicitly opted-in item (`MISSION_ITEM_DESTROY_POLICIES`)
 * that is the exact instance the current run holds. The server runs this same
 * match against the stored run inside the character lock.
 */
export function missionItemDestroyOffer(
  assignment: ResearchAssignmentProjection | undefined,
  item: { id: string; itemId: string },
): { assignmentId: string; job: ResearchJobDefinition; forfeits: string } | undefined {
  const policy = getMissionItemDestroyPolicy(item.itemId);
  if (!policy || !assignment?.loanItemHeld) return undefined;
  if (assignment.loanItemInstanceId !== item.id) return undefined;
  if (assignment.jobId !== policy.cancels.jobId) return undefined;
  const job = getResearchJob(assignment.jobId);
  return job
    ? { assignmentId: assignment.assignmentId, job, forfeits: policy.forfeits }
    : undefined;
}

export function researchTotalSteps(job: ResearchJobDefinition): number {
  return job.kind === "survey" ? job.siteLocationIds.length : 1;
}

/** How much of the field work is done, as a count out of its total. */
export function researchProgress(
  job: ResearchJobDefinition,
  facts: ResearchAssignmentFacts,
): { current: number; target: number } {
  const target = researchTotalSteps(job);
  if (job.kind === "survey") {
    const current = job.siteLocationIds.filter((site) =>
      facts.sampledLocationIds.includes(site),
    ).length;
    return { current, target };
  }
  const done = job.kind === "courier" ? facts.delivered : facts.recorded;
  return { current: done ? 1 : 0, target };
}

export function researchStage(
  job: ResearchJobDefinition,
  facts: ResearchAssignmentFacts,
): ResearchStage {
  const { current, target } = researchProgress(job, facts);
  return current >= target ? "ready" : "field";
}

/** The ticks a field action takes; the authoritative duration, never seconds. */
export function researchFieldActionTicks(kind: "surface_sample" | "resonance_recording"): number {
  const balance = getEffectiveGameBalance().researchJobs;
  return kind === "surface_sample"
    ? balance.surfaceSampleDurationTicks
    : balance.resonanceRecordingDurationTicks;
}

export type ResearchFieldAction =
  | { kind: "surface_sample"; locationId: string }
  | { kind: "resonance_recording"; locationId: string };

/**
 * The compact field action the player may start where they stand, if any. The
 * server revalidates it with this same function inside the lock; the client
 * shows the control from the same projection. It exists only for the active
 * run, with its original item still carried, at a site whose work is not done.
 */
export function availableFieldAction(
  facts: ResearchAssignmentFacts | undefined,
  locationId: string,
): ResearchFieldAction | undefined {
  if (!facts?.loanItemHeld) return undefined;
  const job = getResearchJob(facts.jobId);
  if (!job) return undefined;
  if (job.kind === "survey") {
    return job.siteLocationIds.includes(locationId as never) &&
      !facts.sampledLocationIds.includes(locationId)
      ? { kind: "surface_sample", locationId }
      : undefined;
  }
  if (job.kind === "calibration") {
    return job.recordingLocationId === locationId && !facts.recorded
      ? { kind: "resonance_recording", locationId }
      : undefined;
  }
  return undefined;
}

/**
 * Whether the Courier's packet may be handed over at this exact place: the run
 * is a Courier run, the original packet is still carried and undelivered, and
 * the character stands in the one authored FedHex Local Place at its parent
 * World Location. Skatboll's FedHex is a different place and never qualifies.
 */
export function canDeliverPacket(
  facts: ResearchAssignmentFacts | undefined,
  position: { locationId: string; localPlaceId: string },
): boolean {
  if (!facts?.loanItemHeld || facts.delivered) return false;
  const job = getResearchJob(facts.jobId);
  return (
    job?.kind === "courier" &&
    job.deliveryLocationId === position.locationId &&
    job.deliveryLocalPlaceId === position.localPlaceId
  );
}

export type ResearchCapacityRefusal = "slots" | "mass" | "slots_and_mass";

/**
 * Whether a loan fits ordinary carried Inventory: it needs one free slot AND its
 * own mass, with no exempt pouch and no mass bypass. A refusal says which limit
 * failed (or both) and changes nothing.
 */
export function planResearchLoan(input: {
  massGrams: number;
  availableSlots: number;
  availableMassGrams: number;
}): { ok: true } | { ok: false; reason: ResearchCapacityRefusal; message: string } {
  const slotShort = input.availableSlots < 1;
  const massShort = input.availableMassGrams < input.massGrams;
  if (!slotShort && !massShort) return { ok: true };
  if (slotShort && massShort) {
    return {
      ok: false,
      reason: "slots_and_mass",
      message: `Your Inventory has no free slot, and you cannot carry ${formatMassGrams(input.massGrams)} more. Make room for one item and ${formatMassGrams(input.massGrams)} of mass, then ask again.`,
    };
  }
  if (slotShort) {
    return {
      ok: false,
      reason: "slots",
      message: "Your Inventory is full. Free one slot, then ask again.",
    };
  }
  return {
    ok: false,
    reason: "mass",
    message: `Free up ${formatMassGrams(input.massGrams - input.availableMassGrams)} more carrying capacity, then ask again.`,
  };
}

export type ResearchOfferStatus = "available" | "locked" | "blocked" | "active";

/**
 * Whether a job can be accepted right now, from the facts the server holds.
 * `locked` is the story gate; `blocked` is another job holding the one slot;
 * `active` is this very job being the held assignment.
 */
export function researchOfferStatus(
  job: ResearchJobDefinition,
  input: { completedMissionIds: ReadonlySet<string>; activeJobId?: string },
): ResearchOfferStatus {
  if (job.gate && !input.completedMissionIds.has(job.gate.completedMissionId)) return "locked";
  if (input.activeJobId === job.id) return "active";
  if (input.activeJobId !== undefined) return "blocked";
  return "available";
}

/** What the client needs to list the jobs and mark which is held. */
export type ResearchOfferProjection = {
  jobId: string;
  status: ResearchOfferStatus;
  /** Runs completed (paid or teleported); abandoned runs never count. */
  completions: number;
};

/** The run in progress, projected for the menu, the field actions and Inventory. */
export type ResearchAssignmentProjection = {
  assignmentId: string;
  jobId: string;
  stage: ResearchStage;
  loanItemHeld: boolean;
  loanItemInstanceId?: string;
  delivered: boolean;
  recorded: boolean;
  sampledLocationIds: readonly string[];
  progress: { current: number; target: number };
};

/** The durable arrival receipt of a confirmed Resonance Calibration passage. */
export type ResearchArrivalProjection = {
  jobId: string;
  arrivedAt: string;
  destinationLocationId: string;
  destinationName: string;
};

export type ResearchProjection = {
  offers: readonly ResearchOfferProjection[];
  assignment?: ResearchAssignmentProjection;
  arrival?: ResearchArrivalProjection;
};

function locationName(locationId: string): string {
  return getLocation(locationId)?.displayName ?? locationId;
}

/** The player-facing current objective of a run, derived from its facts alone. */
export function researchObjective(
  job: ResearchJobDefinition,
  facts: ResearchAssignmentFacts,
): string {
  if (!facts.loanItemHeld && researchStage(job, facts) === "field") {
    return `Abandon this assignment: the ${itemName(job)} is no longer in your Inventory.`;
  }
  const giver = getNpc(RESEARCH_GIVER.npcId)?.displayName ?? "The Wise Old Enby";
  const workshop = locationName(RESEARCH_GIVER.locationId);
  if (researchStage(job, facts) === "ready") {
    return job.kind === "calibration"
      ? `Return to ${giver} at ${workshop} and open the passage`
      : `Return to ${giver} at ${workshop} to collect payment`;
  }
  switch (job.kind) {
    case "courier":
      return `Deliver the ${itemName(job)} to FedHex at ${locationName(job.deliveryLocationId)}`;
    case "survey": {
      const { current, target } = researchProgress(job, facts);
      const remaining = job.siteLocationIds
        .filter((site) => !facts.sampledLocationIds.includes(site))
        .map(locationName)
        .join(", ");
      return `Collect surface samples — ${current} / ${target}. Still to visit: ${remaining}`;
    }
    case "calibration":
      return `Record a resonance signature at ${locationName(job.recordingLocationId)}`;
  }
}

function itemName(job: ResearchJobDefinition): string {
  return getItemPresentation(job.loanItemId)?.displayName ?? job.loanItemId;
}

/**
 * The semantic guidance of a run, in the same vocabulary Mission guidance uses
 * so the Map, Local Place entrances and the Talk control light up with no new
 * consumer: green for field work, blue for the return to the Enby.
 */
export function researchGuidance(
  job: ResearchJobDefinition,
  facts: ResearchAssignmentFacts,
  currentLocationId: string,
): MissionGuidance {
  if (researchStage(job, facts) === "ready") {
    return currentLocationId === RESEARCH_GIVER.locationId
      ? { turnIn: true, npcId: RESEARCH_GIVER.npcId }
      : { turnIn: true, locationId: RESEARCH_GIVER.locationId };
  }
  // With the loan gone nothing but Abandon advances the run.
  if (!facts.loanItemHeld) return {};
  switch (job.kind) {
    case "courier":
      return currentLocationId === job.deliveryLocationId
        ? { localPlaceId: job.deliveryLocalPlaceId }
        : { locationId: job.deliveryLocationId };
    case "survey": {
      const remaining = job.siteLocationIds.filter(
        (site) => !facts.sampledLocationIds.includes(site) && site !== currentLocationId,
      );
      return remaining.length > 0 ? { locationIds: remaining } : {};
    }
    case "calibration":
      return currentLocationId === job.recordingLocationId
        ? {}
        : { locationId: job.recordingLocationId };
  }
}

/** The run as Mission-shaped steps, so the Log and strips render it generically. */
function researchSteps(job: ResearchJobDefinition, facts: ResearchAssignmentFacts) {
  const giver = getNpc(RESEARCH_GIVER.npcId)?.displayName ?? "The Wise Old Enby";
  const returnStep = {
    kind: "research_step" as const,
    objective:
      job.kind === "calibration"
        ? `Return to ${giver} and open the passage`
        : `Return to ${giver} to collect payment`,
    satisfied: false,
    npcId: RESEARCH_GIVER.npcId,
    locationId: RESEARCH_GIVER.locationId,
  };
  switch (job.kind) {
    case "courier":
      return [
        {
          kind: "research_step" as const,
          objective: `Deliver the ${itemName(job)} to FedHex, ${locationName(job.deliveryLocationId)}`,
          satisfied: facts.delivered,
          locationId: job.deliveryLocationId,
        },
        returnStep,
      ];
    case "survey":
      return [
        ...job.siteLocationIds.map((site) => ({
          kind: "research_step" as const,
          objective: `Surface sample: ${locationName(site)}`,
          satisfied: facts.sampledLocationIds.includes(site),
          locationId: site,
        })),
        returnStep,
      ];
    case "calibration":
      return [
        {
          kind: "research_step" as const,
          objective: `Record a resonance signature at ${locationName(job.recordingLocationId)}`,
          satisfied: facts.recorded,
          locationId: job.recordingLocationId,
        },
        returnStep,
      ];
  }
}

/**
 * The active run as the Mission-shaped projection the Mission Log, Current
 * Missions strips and guidance already render (#406). It is derived from the
 * assignment row on every read; it is not a Mission definition, so no Mission
 * row, pin, prerequisite or reward exists behind it.
 */
export function projectResearchAssignment(
  facts: ResearchAssignmentFacts,
  position: { currentLocationId: string; stationary: boolean },
): MissionProjection | undefined {
  const job = getResearchJob(facts.jobId);
  if (!job) return undefined;
  const stage = researchStage(job, facts);
  const progress = researchProgress(job, facts);
  const steps = researchSteps(job, facts);
  const requirements = steps.map((step, index) => ({
    ...step,
    // The survey's per-site rows carry the numeric progress on the first row only.
    ...(job.kind === "survey" && index === 0 ? { progress } : {}),
  }));
  return {
    missionId: job.id,
    title: job.title,
    summary: job.summary,
    state: stage === "ready" ? "ready_for_completion" : "active",
    currentObjective: researchObjective(job, facts),
    requirements,
    prerequisiteSatisfied: true,
    stage: {
      requirementsSatisfied: stage === "ready",
      turnInAvailable:
        stage === "ready" &&
        position.stationary &&
        position.currentLocationId === RESEARCH_GIVER.locationId,
    },
    guidance: researchGuidance(job, facts, position.currentLocationId),
    research: { assignmentId: facts.assignmentId },
  };
}

/** The feedback line after a surface specimen is recorded. */
export function surfaceSampleFeedback(
  locationId: string,
  collected: number,
  total: number,
): string {
  return `Surface specimen collected: ${locationName(locationId)}. ${collected}/${total} samples collected.`;
}

/**
 * Startup validation for the research registry (#406). An authoring mistake
 * fails here, at module load, never inside a player's transaction.
 */
export function validateResearchJobs(jobs: readonly ResearchJobDefinition[] = RESEARCH_JOBS): void {
  const ids = new Set<string>();
  const items = new Set<string>();
  const balance = getEffectiveGameBalance();
  if (!getNpc(RESEARCH_GIVER.npcId)) throw new Error("Research giver NPC is unknown.");
  if (!getLocation(RESEARCH_GIVER.locationId))
    throw new Error("Research giver location is unknown.");
  if (!getDialogue(RESEARCH_BLOCKED_DIALOGUE_ID)) {
    throw new Error("The research blocked dialogue is not authored.");
  }
  for (const policy of MISSION_ITEM_DESTROY_POLICIES) {
    const owner = jobs.find((job) => job.id === policy.cancels.jobId);
    if (owner?.loanItemId !== policy.itemId) {
      throw new Error(`Destroy policy for ${policy.itemId} names a job that does not lend it.`);
    }
    if (!policy.forfeits.trim())
      throw new Error(`Destroy policy for ${policy.itemId} has no copy.`);
  }
  for (const job of jobs) {
    if (ids.has(job.id)) throw new Error(`Duplicate research job "${job.id}".`);
    ids.add(job.id);
    if (items.has(job.loanItemId))
      throw new Error(`Research jobs share loan item ${job.loanItemId}.`);
    items.add(job.loanItemId);
    const definition = getItemDefinition(job.loanItemId, balance);
    if (definition?.kind !== "unique") {
      throw new Error(`Research job "${job.id}" loan item must be a unique inventory item.`);
    }
    for (const [moment, dialogueId] of Object.entries(job.dialogue)) {
      const sequence = getDialogue(dialogueId);
      if (!sequence) throw new Error(`Research job "${job.id}" ${moment} dialogue is unauthored.`);
      if (sequence.npcId !== RESEARCH_GIVER.npcId) {
        throw new Error(`Research job "${job.id}" ${moment} dialogue is not the giver's.`);
      }
    }
    if (
      !job.title.trim() ||
      !job.pitch.trim() ||
      !job.rewardLabel.trim() ||
      !job.requirements.trim()
    ) {
      throw new Error(`Research job "${job.id}" is missing player-facing copy.`);
    }
    if (job.kind === "courier") {
      const place = getLocalPlaceInLocation(job.deliveryLocationId, job.deliveryLocalPlaceId);
      if (!place || !isFedhexMailboxPlace(place)) {
        throw new Error(
          `Courier delivery place "${job.deliveryLocalPlaceId}" is not a FedHex there.`,
        );
      }
      if (
        getLocationPlanetId(job.deliveryLocationId) !==
        getLocationPlanetId(RESEARCH_GIVER.locationId)
      ) {
        throw new Error("The Courier delivers on the giver's own planet.");
      }
    } else if (job.kind === "survey") {
      if (
        new Set(job.siteLocationIds).size !== job.siteLocationIds.length ||
        job.siteLocationIds.length < 1
      ) {
        throw new Error(`Survey "${job.id}" needs distinct sites.`);
      }
      for (const site of job.siteLocationIds) {
        if (!getLocation(site)) throw new Error(`Survey site "${site}" is unknown.`);
      }
    } else {
      if (!getLocation(job.recordingLocationId) || !getLocation(job.destinationLocationId)) {
        throw new Error(`Calibration "${job.id}" names an unknown location.`);
      }
      if (
        getLocationPlanetId(job.destinationLocationId) ===
        getLocationPlanetId(RESEARCH_GIVER.locationId)
      ) {
        throw new Error("Calibration must send the character to another planet.");
      }
    }
  }
  // The Credits shown in copy are the authoritative balance, never a literal.
  const courier = jobs.find((job) => job.kind === "courier");
  const survey = jobs.find((job) => job.kind === "survey");
  if (courier && !courier.rewardLabel.includes(String(balance.researchJobs.courierRewardCredits))) {
    throw new Error("The Courier reward copy disagrees with balance.");
  }
  if (survey && !survey.rewardLabel.includes(String(balance.researchJobs.surveyRewardCredits))) {
    throw new Error("The Survey reward copy disagrees with balance.");
  }
}

/** The facts the pure rules decide from, rebuilt from the projection a client holds. */
export function assignmentFactsOf(
  assignment: ResearchAssignmentProjection | undefined,
): ResearchAssignmentFacts | undefined {
  return assignment
    ? {
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        loanItemHeld: assignment.loanItemHeld,
        delivered: assignment.delivered,
        recorded: assignment.recorded,
        sampledLocationIds: assignment.sampledLocationIds,
      }
    : undefined;
}

/**
 * Which of the job's dialogue moments the Enby plays for a held run: the
 * partial or empty field reminder, or the return conversation that carries the
 * final action.
 */
export function researchRunDialogueId(
  job: ResearchJobDefinition,
  facts: ResearchAssignmentFacts,
): string {
  if (researchStage(job, facts) === "ready") return job.dialogue.ready;
  const { current } = researchProgress(job, facts);
  return current > 0 && job.dialogue.fieldPartial
    ? job.dialogue.fieldPartial
    : job.dialogue.fieldReminder;
}
