import { and, eq, sql } from "drizzle-orm";
import {
  characterResearchAssignments,
  characterResearchJobs,
  itemInstances,
  type ActiveAction,
  type CharacterResearchAssignment,
  type CharacterResearchJob,
} from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { getLocation } from "@/game/content/locations";
import { RESEARCH_JOBS, getResearchJob } from "@/game/content/research-jobs";
import { ticksToMilliseconds } from "@/game/domain/timing";
import {
  availableFieldAction,
  researchFieldActionTicks,
  researchOfferStatus,
  researchProgress,
  researchStage,
  validateResearchJobs,
  type ResearchArrivalProjection,
  type ResearchAssignmentFacts,
  type ResearchProjection,
} from "@/game/domain/research-jobs";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";

// The registry is validated once at module load: an authoring mistake (an
// unknown item, location, FedHex place or unauthored dialogue) fails here, never
// inside a player's transaction.
validateResearchJobs();

/**
 * The Wise Old Enby's research jobs (#406): persistence reads, the projection
 * and the field-action resolver. The player commands that change a run are
 * `server/research-job-commands.ts`; this file never decides a rule the domain
 * owns, and never writes outside a caller's character transaction.
 */

export function isResearchFieldAction(actionId: string | undefined): boolean {
  if (actionId === undefined) return false;
  const balance = getEffectiveGameBalance().researchJobs;
  return (
    actionId === balance.surfaceSampleActionId || actionId === balance.resonanceRecordingActionId
  );
}

export async function loadResearchAssignment(
  transaction: DatabaseTransaction,
  characterId: string,
  options: { lock?: boolean } = {},
): Promise<CharacterResearchAssignment | undefined> {
  const query = transaction
    .select()
    .from(characterResearchAssignments)
    .where(eq(characterResearchAssignments.characterId, characterId));
  const rows = await (options.lock ? query.for("update") : query);
  return rows[0];
}

export async function loadResearchHistory(
  transaction: DatabaseTransaction,
  characterId: string,
  options: { lock?: boolean } = {},
): Promise<CharacterResearchJob[]> {
  const query = transaction
    .select()
    .from(characterResearchJobs)
    .where(eq(characterResearchJobs.characterId, characterId));
  return options.lock ? query.for("update") : query;
}

/**
 * The facts of the run, read against what the character really carries. The
 * loaned instance counts only while it is a carried instance: the database
 * nulls the reference if the item row is ever removed, and a Cargo or stash
 * relation (which no loan can be given) would equally make it not carried.
 */
export function researchFactsOf(
  row: CharacterResearchAssignment,
  carriedInstanceIds: ReadonlySet<string>,
): ResearchAssignmentFacts {
  return {
    assignmentId: row.id,
    jobId: row.jobId,
    loanItemHeld: row.itemInstanceId !== null && carriedInstanceIds.has(row.itemInstanceId),
    delivered: row.deliveredAt !== null,
    recorded: row.recordedAt !== null,
    sampledLocationIds: row.sampledLocationIds,
  };
}

/**
 * The durable arrival receipt, if one is owed: the last confirmed Resonance
 * Calibration passage that the player has not yet dismissed. It is derived from
 * the history row alone, so it survives refresh, reconnect and other devices,
 * and dismissing it (presentation only) is the only thing that clears it.
 */
export function arrivalReceiptOf(
  history: readonly CharacterResearchJob[],
): ResearchArrivalProjection | undefined {
  for (const row of history) {
    const job = getResearchJob(row.jobId);
    if (job?.kind !== "calibration" || !row.lastCompletedAt) continue;
    if (row.arrivalAcknowledgedAt && row.arrivalAcknowledgedAt >= row.lastCompletedAt) continue;
    return {
      jobId: row.jobId,
      arrivedAt: row.lastCompletedAt.toISOString(),
      destinationLocationId: job.destinationLocationId,
      destinationName:
        getLocation(job.destinationLocationId)?.displayName ?? job.destinationLocationId,
    };
  }
  return undefined;
}

/** What the client needs to list the jobs, mark the held one and present arrival. */
export function buildResearchProjection(input: {
  assignment: CharacterResearchAssignment | undefined;
  history: readonly CharacterResearchJob[];
  carriedInstanceIds: ReadonlySet<string>;
  completedMissionIds: ReadonlySet<string>;
}): ResearchProjection {
  const facts = input.assignment
    ? researchFactsOf(input.assignment, input.carriedInstanceIds)
    : undefined;
  const completions = new Map(input.history.map((row) => [row.jobId, row.completions]));
  const arrival = arrivalReceiptOf(input.history);
  const job = facts ? getResearchJob(facts.jobId) : undefined;
  return {
    offers: RESEARCH_JOBS.map((definition) => ({
      jobId: definition.id,
      status: researchOfferStatus(definition, {
        completedMissionIds: input.completedMissionIds,
        ...(facts ? { activeJobId: facts.jobId } : {}),
      }),
      completions: completions.get(definition.id) ?? 0,
    })),
    ...(facts && job && input.assignment
      ? {
          assignment: {
            assignmentId: facts.assignmentId,
            jobId: facts.jobId,
            stage: researchStage(job, facts),
            loanItemHeld: facts.loanItemHeld,
            ...(input.assignment.itemInstanceId && facts.loanItemHeld
              ? { loanItemInstanceId: input.assignment.itemInstanceId }
              : {}),
            delivered: facts.delivered,
            recorded: facts.recorded,
            sampledLocationIds: facts.sampledLocationIds,
            progress: researchProgress(job, facts),
          },
        }
      : {}),
    ...(arrival ? { arrival } : {}),
  };
}

/** Delete the run's loaned instance, if it still exists. Idempotent. */
export async function deleteLoanInstance(
  transaction: DatabaseTransaction,
  characterId: string,
  itemInstanceId: string | null,
): Promise<void> {
  if (!itemInstanceId) return;
  await transaction
    .delete(itemInstances)
    .where(and(eq(itemInstances.id, itemInstanceId), eq(itemInstances.characterId, characterId)));
}

/** Count one finished run (paid or teleported). The row is created on first use. */
export async function recordResearchCompletion(
  transaction: DatabaseTransaction,
  input: { characterId: string; jobId: string; at: Date },
): Promise<void> {
  await transaction
    .insert(characterResearchJobs)
    .values({
      characterId: input.characterId,
      jobId: input.jobId,
      completions: 1,
      lastCompletedAt: input.at,
    })
    .onConflictDoUpdate({
      target: [characterResearchJobs.characterId, characterResearchJobs.jobId],
      set: {
        completions: sql`${characterResearchJobs.completions} + 1`,
        lastCompletedAt: input.at,
      },
    });
}

type FieldSnapshot = {
  assignment: CharacterResearchAssignment | undefined;
  facts: ResearchAssignmentFacts | undefined;
  locationId: string;
};

export type PersistedResearchField =
  | { kind: "pending" }
  | {
      kind: "recorded";
      characterId: string;
      assignmentId: string;
      field: "surface_sample" | "resonance_recording";
      locationId: string;
      at: Date;
    }
  | { kind: "void" };

/**
 * The field-action resolver: a single-shot, stationary, 8-tick action. A window
 * shorter than the action resolves nothing; once its ticks have passed (live, on
 * refresh or in an offline catch-up) it resolves exactly once and stops. It
 * records progress only if the run, the original carried item and the site still
 * hold when it resolves; anything else (an abandoned run, a moved character)
 * simply ends the action with nothing written.
 */
export function createResearchFieldResolver(): ActionResolver<
  FieldSnapshot,
  PersistedResearchField
> {
  return {
    supports: (action: ActiveAction) => isResearchFieldAction(action.actionId),
    load: async (transaction, { character }) => {
      const assignment = await loadResearchAssignment(transaction, character.id, { lock: true });
      if (!assignment) {
        return { assignment, facts: undefined, locationId: character.currentLocationId };
      }
      const carried = await transaction
        .select({ id: itemInstances.id })
        .from(itemInstances)
        .where(eq(itemInstances.characterId, character.id));
      return {
        assignment,
        facts: researchFactsOf(assignment, new Set(carried.map((row) => row.id))),
        locationId: character.currentLocationId,
      };
    },
    resolve: ({ action, snapshot, window }) => {
      const field =
        action.actionId === getEffectiveGameBalance().researchJobs.surfaceSampleActionId
          ? "surface_sample"
          : "resonance_recording";
      const ticks = researchFieldActionTicks(field);
      if (window.elapsedTicks < ticks) {
        return { outcome: { kind: "pending" }, transition: { kind: "continue", consumedTicks: 0 } };
      }
      const available = availableFieldAction(snapshot.facts, snapshot.locationId);
      const outcome: PersistedResearchField =
        snapshot.facts && available?.kind === field
          ? {
              kind: "recorded",
              characterId: action.characterId,
              assignmentId: snapshot.facts.assignmentId,
              field,
              locationId: snapshot.locationId,
              at: new Date(window.startsAt.getTime() + ticksToMilliseconds(ticks)),
            }
          : { kind: "void" };
      return { outcome, transition: { kind: "stop", consumedTicks: ticks } };
    },
    persist: async (transaction, outcome) => {
      if (outcome.kind !== "recorded") return;
      if (outcome.field === "surface_sample") {
        // Guarded by the run's id and by the site not already being recorded, so
        // a replay can never add a second specimen for the same compartment.
        await transaction
          .update(characterResearchAssignments)
          .set({
            sampledLocationIds: sql`array_append(${characterResearchAssignments.sampledLocationIds}, ${outcome.locationId})`,
          })
          .where(
            and(
              eq(characterResearchAssignments.characterId, outcome.characterId),
              eq(characterResearchAssignments.id, outcome.assignmentId),
              sql`NOT (${outcome.locationId} = ANY(${characterResearchAssignments.sampledLocationIds}))`,
            ),
          );
        return;
      }
      await transaction
        .update(characterResearchAssignments)
        .set({ recordedAt: outcome.at })
        .where(
          and(
            eq(characterResearchAssignments.characterId, outcome.characterId),
            eq(characterResearchAssignments.id, outcome.assignmentId),
            sql`${characterResearchAssignments.recordedAt} IS NULL`,
          ),
        );
    },
  };
}
