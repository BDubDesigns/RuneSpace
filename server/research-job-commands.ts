import { and, eq, inArray, sql } from "drizzle-orm";
import {
  activeActions,
  characterResearchAssignments,
  characterResearchJobs,
  characters,
  itemInstances,
  type CharacterResearchAssignment,
} from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { getLocation } from "@/game/content/locations";
import { RESEARCH_GIVER, RESEARCH_JOBS, getResearchJob } from "@/game/content/research-jobs";
import {
  availableFieldAction,
  canDeliverPacket,
  planResearchLoan,
  researchOfferStatus,
  researchStage,
  type ResearchAssignmentFacts,
  type ResearchCapacityRefusal,
} from "@/game/domain/research-jobs";
import { withResolvedOwnedCharacter, type DatabaseTransaction } from "@/server/action-resolution";
import { loadCarriedCapacity, loadOwnedItemInstances } from "@/server/carried-inventory";
import { loadCompletedMissionIds } from "@/server/mission-state";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import {
  deleteLoanInstance,
  isResearchFieldAction,
  loadResearchAssignment,
  recordResearchCompletion,
  researchFactsOf,
} from "@/server/research-jobs";

/**
 * The Wise Old Enby's research-job player commands (#406).
 *
 * The browser sends intent only: a job, and for a run in progress the run's own
 * id. Every rule is revalidated inside the character lock after any due work has
 * resolved: where the character stands, that nothing else is running, the run
 * and its stage, the original carried item and the Inventory room. A refusal
 * writes nothing. Each command that ends or advances a run does it with a
 * guarded write on the run's row, so a retry, a second tab or a stale client
 * can never grant an item twice, pay twice, teleport twice or lose progress.
 */

export type ResearchRefusal =
  | "unknown_job"
  | "locked"
  | "blocked"
  | "wrong_place"
  | "not_stationary"
  | "no_assignment"
  | "wrong_job"
  | "wrong_stage"
  | "item_missing"
  | "another_action_active"
  | "capacity";

export type ResearchCommandOutcome =
  | {
      status: "ok";
      kind:
        | "accepted"
        | "already_accepted"
        | "started"
        | "delivered"
        | "paid"
        | "teleported"
        | "abandoned"
        | "acknowledged";
      jobId?: string;
      /** Credits the transaction actually wrote, for the one call that wrote them. */
      creditsPaid?: number;
    }
  | {
      status: "refused";
      reason: ResearchRefusal;
      message: string;
      capacityReason?: ResearchCapacityRefusal;
    };

export type ResearchCommandResult = {
  state: PlayGameplayState;
  research: ResearchCommandOutcome;
};

type Context = {
  transaction: DatabaseTransaction;
  characterId: string;
  currentLocationId: string;
  hasActiveAction: boolean;
  activeActionId: string | undefined;
  now: Date;
};

function stateAfter(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    undefined,
    undefined,
    undefined,
    now,
  );
}

/** Run one research command under the shared lock + lazy reconciliation boundary. */
function runResearchCommand(
  userId: string,
  characterId: string,
  now: Date,
  command: (context: Context) => Promise<ResearchCommandOutcome>,
  options: { allowDuringTrade?: boolean; allowDuringFlight?: boolean } = {},
): Promise<ResearchCommandResult> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action }) => {
      await ensurePlayProvisioning(transaction, character.id);
      // Re-read the position after reconciliation: a due arrival has landed.
      const [row] = await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, character.id))
        .limit(1);
      const research = await command({
        transaction,
        characterId: character.id,
        currentLocationId: row?.currentLocationId ?? character.currentLocationId,
        hasActiveAction: action !== undefined,
        activeActionId: action?.actionId,
        now,
      });
      return { state: await stateAfter(transaction, character.id, now), research };
    },
    now,
    options,
  );
}

const refuse = (
  reason: ResearchRefusal,
  message: string,
  capacityReason?: ResearchCapacityRefusal,
): ResearchCommandOutcome => ({
  status: "refused",
  reason,
  message,
  ...(capacityReason ? { capacityReason } : {}),
});

/** The run named by the request, with the facts the domain decides from. */
async function loadRun(
  context: Context,
  assignmentId: string,
): Promise<
  | { ok: true; row: CharacterResearchAssignment; facts: ResearchAssignmentFacts }
  | { ok: false; outcome: ResearchCommandOutcome }
> {
  const row = await loadResearchAssignment(context.transaction, context.characterId, {
    lock: true,
  });
  if (!row || row.id !== assignmentId) {
    return {
      ok: false,
      outcome: refuse("no_assignment", "That assignment is no longer active."),
    };
  }
  const { carriedInstances } = await loadOwnedItemInstances(
    context.transaction,
    context.characterId,
  );
  return {
    ok: true,
    row,
    facts: researchFactsOf(row, new Set(carriedInstances.map((instance) => instance.id))),
  };
}

function atEnby(context: Context): boolean {
  return context.currentLocationId === RESEARCH_GIVER.locationId;
}

/** Accept one job at Hilltop Workshop and lend its item (all or nothing). */
export function acceptResearchJob(
  userId: string,
  characterId: string,
  request: { jobId: string },
  now = new Date(),
): Promise<ResearchCommandResult> {
  return runResearchCommand(userId, characterId, now, async (context) => {
    const job = getResearchJob(request.jobId);
    if (!job) return refuse("unknown_job", "That is not one of The Wise Old Enby's assignments.");
    if (!atEnby(context)) {
      return refuse("wrong_place", "Take assignments from The Wise Old Enby at Hilltop Workshop.");
    }
    const { transaction } = context;
    const existing = await loadResearchAssignment(transaction, context.characterId, { lock: true });
    // A retried accept of the same job is that job, never a second loan.
    if (existing?.jobId === job.id) {
      return { status: "ok", kind: "already_accepted", jobId: job.id };
    }
    const completedMissionIds = await loadCompletedMissionIds(transaction, context.characterId);
    const offer = researchOfferStatus(job, {
      completedMissionIds,
      ...(existing ? { activeJobId: existing.jobId } : {}),
    });
    if (offer === "locked") return refuse("locked", job.gate?.lockedCopy ?? "Not available yet.");
    if (offer === "blocked") {
      const held = existing ? getResearchJob(existing.jobId) : undefined;
      return refuse(
        "blocked",
        `You are already working on ${held?.title ?? "another assignment"}. Finish or abandon it first.`,
      );
    }
    if (context.hasActiveAction) {
      return refuse("not_stationary", "Finish what you are doing before taking an assignment.");
    }
    const definition = getItemDefinition(job.loanItemId, getEffectiveGameBalance());
    if (definition?.kind !== "unique") throw new Error(`Loan item ${job.loanItemId} is not unique`);
    const capacity = await loadCarriedCapacity(transaction, context.characterId);
    const plan = planResearchLoan({
      massGrams: definition.massGrams,
      availableSlots: capacity.availableSlots,
      availableMassGrams: capacity.availableMassGrams,
    });
    if (!plan.ok) return refuse("capacity", plan.message, plan.reason);

    const [instance] = await transaction
      .insert(itemInstances)
      .values({
        characterId: context.characterId,
        itemId: job.loanItemId,
        currentCharge: null,
        createdAt: context.now,
        updatedAt: context.now,
      })
      .returning({ id: itemInstances.id });
    if (!instance) throw new Error("The research loan item was not created");
    // The primary key is the one-assignment rule; under the character lock this
    // cannot conflict, and if it ever did the whole transaction rolls back with
    // no loaned item left behind.
    await transaction.insert(characterResearchAssignments).values({
      characterId: context.characterId,
      jobId: job.id,
      itemInstanceId: instance.id,
      startedAt: context.now,
    });
    return { status: "ok", kind: "accepted", jobId: job.id };
  });
}

/** Begin the one field action (surface sample or resonance recording) available here. */
export function startResearchField(
  userId: string,
  characterId: string,
  request: { assignmentId: string },
  now = new Date(),
): Promise<ResearchCommandResult> {
  return runResearchCommand(userId, characterId, now, async (context) => {
    const run = await loadRun(context, request.assignmentId);
    if (!run.ok) return run.outcome;
    const field = availableFieldAction(run.facts, context.currentLocationId);
    if (!field) {
      return refuse(
        run.facts.loanItemHeld ? "wrong_place" : "item_missing",
        run.facts.loanItemHeld
          ? "There is nothing to collect here for this assignment."
          : "Your loaned item is no longer in your Inventory. Abandon the assignment to start over.",
      );
    }
    const balance = getEffectiveGameBalance().researchJobs;
    const actionId =
      field.kind === "surface_sample"
        ? balance.surfaceSampleActionId
        : balance.resonanceRecordingActionId;
    // A retried start while this very action runs is that same action.
    if (context.activeActionId === actionId) return { status: "ok", kind: "started" };
    if (context.hasActiveAction) {
      return refuse("another_action_active", "Finish your current activity first.");
    }
    await context.transaction.insert(activeActions).values({
      characterId: context.characterId,
      actionId,
      startedAt: context.now,
      resolvedThroughAt: context.now,
    });
    return { status: "ok", kind: "started" };
  });
}

/** Hand the Courier's packet over at the Stillreach FedHex terminal. */
export function deliverResearchPacket(
  userId: string,
  characterId: string,
  request: { assignmentId: string; localPlaceId: string },
  now = new Date(),
): Promise<ResearchCommandResult> {
  return runResearchCommand(userId, characterId, now, async (context) => {
    const run = await loadRun(context, request.assignmentId);
    if (!run.ok) return run.outcome;
    if (context.hasActiveAction) {
      return refuse("not_stationary", "Finish what you are doing before making a delivery.");
    }
    if (
      !canDeliverPacket(run.facts, {
        locationId: context.currentLocationId,
        localPlaceId: request.localPlaceId,
      })
    ) {
      const job = getResearchJob(run.facts.jobId);
      if (job?.kind !== "courier") return refuse("wrong_job", "This is not a delivery assignment.");
      if (run.facts.delivered)
        return refuse("wrong_stage", "The packet has already been delivered.");
      if (!run.facts.loanItemHeld) {
        return refuse(
          "item_missing",
          "The Sealed Research Packet is not in your Inventory. Abandon the assignment to start over.",
        );
      }
      return refuse(
        "wrong_place",
        "Only the FedHex terminal at Stillreach Landing Station accepts this packet.",
      );
    }
    // Consume exactly that packet and mark delivery in one guarded write.
    const delivered = await context.transaction
      .update(characterResearchAssignments)
      .set({ deliveredAt: context.now, itemInstanceId: null })
      .where(
        and(
          eq(characterResearchAssignments.characterId, context.characterId),
          eq(characterResearchAssignments.id, run.row.id),
          sql`${characterResearchAssignments.deliveredAt} IS NULL`,
        ),
      )
      .returning({ id: characterResearchAssignments.id });
    if (delivered.length !== 1) throw new Error("The research packet was delivered concurrently");
    await deleteLoanInstance(context.transaction, context.characterId, run.row.itemInstanceId);
    return { status: "ok", kind: "delivered", jobId: run.facts.jobId };
  });
}

/** End a run: the guarded delete is the exactly-once stamp. */
async function endRun(context: Context, row: CharacterResearchAssignment): Promise<void> {
  const ended = await context.transaction
    .delete(characterResearchAssignments)
    .where(
      and(
        eq(characterResearchAssignments.characterId, context.characterId),
        eq(characterResearchAssignments.id, row.id),
      ),
    )
    .returning({ id: characterResearchAssignments.id });
  if (ended.length !== 1) throw new Error("The research assignment ended concurrently");
  await deleteLoanInstance(context.transaction, context.characterId, row.itemInstanceId);
}

/**
 * The paid return for the Courier and the Survey: COLLECT PAYMENT at the Enby.
 * It reclaims the Survey's case and awards the job's Credits (never XP) exactly
 * once, counts the run, and frees the assignment slot.
 */
export function completeResearchJob(
  userId: string,
  characterId: string,
  request: { assignmentId: string },
  now = new Date(),
): Promise<ResearchCommandResult> {
  return runResearchCommand(userId, characterId, now, async (context) => {
    const run = await loadRun(context, request.assignmentId);
    if (!run.ok) return run.outcome;
    const job = getResearchJob(run.facts.jobId);
    if (!job || job.kind === "calibration") {
      return refuse(
        "wrong_job",
        "This assignment is finished by opening the passage, not by payment.",
      );
    }
    if (!atEnby(context)) {
      return refuse("wrong_place", "Return to The Wise Old Enby at Hilltop Workshop.");
    }
    if (context.hasActiveAction) {
      return refuse("not_stationary", "Finish what you are doing first.");
    }
    if (researchStage(job, run.facts) !== "ready") {
      return refuse("wrong_stage", "The work is not finished yet.");
    }
    if (job.kind === "survey" && !run.facts.loanItemHeld) {
      return refuse("item_missing", "The Geological Sample Case is not in your Inventory.");
    }
    const credits = getEffectiveGameBalance().researchJobs[job.payoutCredits];
    await endRun(context, run.row);
    await context.transaction
      .update(characters)
      .set({ credits: sql`${characters.credits} + ${credits}` })
      .where(eq(characters.id, context.characterId));
    await recordResearchCompletion(context.transaction, {
      characterId: context.characterId,
      jobId: job.id,
      at: context.now,
    });
    return { status: "ok", kind: "paid", jobId: job.id, creditsPaid: credits };
  });
}

/**
 * The confirmed Resonance Calibration passage (TELEPORT NOW): reclaim the
 * sampler, finish the run, free the slot and move the character (with their
 * carried Inventory and Equipment, which belong to them) to the Crash Site, as
 * one atomic outcome. Nothing is banked: the run ends in this transaction.
 */
export function teleportResearchJob(
  userId: string,
  characterId: string,
  request: { assignmentId: string },
  now = new Date(),
): Promise<ResearchCommandResult> {
  return runResearchCommand(userId, characterId, now, async (context) => {
    const run = await loadRun(context, request.assignmentId);
    if (!run.ok) return run.outcome;
    const job = getResearchJob(run.facts.jobId);
    if (job?.kind !== "calibration") {
      return refuse("wrong_job", "This assignment does not open a passage.");
    }
    if (!atEnby(context)) {
      return refuse("wrong_place", "The passage opens from The Wise Old Enby's workshop.");
    }
    if (context.hasActiveAction) {
      return refuse("not_stationary", "Finish what you are doing first.");
    }
    if (researchStage(job, run.facts) !== "ready") {
      return refuse("wrong_stage", "The sampler has not recorded a signature yet.");
    }
    if (!run.facts.loanItemHeld) {
      return refuse("item_missing", "The Resonance Sampler is not in your Inventory.");
    }
    if (!getLocation(job.destinationLocationId))
      throw new Error("Calibration destination is unknown");
    await endRun(context, run.row);
    await recordResearchCompletion(context.transaction, {
      characterId: context.characterId,
      jobId: job.id,
      at: context.now,
    });
    // Only the character moves. The Rivet, its fuel and the Cargo Hold are keyed
    // to the ship and stay exactly where they are parked.
    await context.transaction
      .update(characters)
      .set({ currentLocationId: job.destinationLocationId })
      .where(eq(characters.id, context.characterId));
    return { status: "ok", kind: "teleported", jobId: job.id };
  });
}

/**
 * Abandon the held assignment from anywhere, at any stage. Forfeits all
 * progress, the still-carried loan and any payout or passage, and frees the
 * slot. It is not a completion: nothing is counted and nothing is paid.
 */
export function abandonResearchJob(
  userId: string,
  characterId: string,
  request: { assignmentId: string },
  now = new Date(),
): Promise<ResearchCommandResult> {
  return runResearchCommand(userId, characterId, now, async (context) => {
    const run = await loadRun(context, request.assignmentId);
    if (!run.ok) return run.outcome;
    // A field action pending for this run has nothing left to record.
    if (isResearchFieldAction(context.activeActionId)) {
      await context.transaction
        .delete(activeActions)
        .where(eq(activeActions.characterId, context.characterId));
    }
    await endRun(context, run.row);
    return { status: "ok", kind: "abandoned", jobId: run.facts.jobId };
  });
}

/**
 * Dismiss the Calibration arrival receipt. Presentation only and idempotent: it
 * moves nothing, pays nothing and cannot replay the passage.
 */
export function acknowledgeResearchArrival(
  userId: string,
  characterId: string,
  now = new Date(),
): Promise<ResearchCommandResult> {
  return runResearchCommand(
    userId,
    characterId,
    now,
    async (context) => {
      await context.transaction
        .update(characterResearchJobs)
        .set({ arrivalAcknowledgedAt: context.now })
        .where(
          and(
            eq(characterResearchJobs.characterId, context.characterId),
            inArray(
              characterResearchJobs.jobId,
              RESEARCH_JOBS.filter((job) => job.kind === "calibration").map((job) => job.id),
            ),
            sql`${characterResearchJobs.lastCompletedAt} IS NOT NULL`,
            sql`(${characterResearchJobs.arrivalAcknowledgedAt} IS NULL OR ${characterResearchJobs.arrivalAcknowledgedAt} < ${characterResearchJobs.lastCompletedAt})`,
          ),
        );
      return { status: "ok", kind: "acknowledged" };
    },
    { allowDuringTrade: true, allowDuringFlight: true },
  );
}
