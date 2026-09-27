import { and, eq, isNull } from "drizzle-orm";
import { characterMissionProgress, characterMissions } from "@/db/rune-space";
import {
  getMission,
  type MissionDefinition,
  type MissionRequirement,
  type TrackedMissionActivity,
} from "@/game/content/missions";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The closed activity vocabulary Mission progress observes.
 *
 * Practice Welding counts completed welds through this same generic path
 * (#190), and a Work Order counts completed JOBS through it (#207) — there is
 * no Practice-specific or Work-Order-specific Mission table, attempt history,
 * or provenance tracking. `work_order` is credited only by the authoritative
 * Work Order completion transaction, so opening the terminal, accepting a job,
 * committing its materials, starting the weld, or finishing a single section
 * can none of them advance a Mission. Fabrication and Tinkering (#232) count
 * `completions` only — a successful workpiece, a completed Tinkering batch —
 * credited by their own resolution, never by a start or a bust.
 */
export type TrackedActivity = TrackedMissionActivity;

/** Return the narrow durable requirements authored by one mission. */
export function trackedActivityRequirements(
  definition: MissionDefinition,
): readonly Extract<MissionRequirement, { kind: "tracked_activity" }>[] {
  return definition.requirements.filter(
    (requirement): requirement is Extract<MissionRequirement, { kind: "tracked_activity" }> =>
      requirement.kind === "tracked_activity",
  );
}

/** Return the authored conversation requirements owned by one mission. */
export function conversationRequirements(
  definition: MissionDefinition,
): readonly Extract<MissionRequirement, { kind: "npc_conversation" }>[] {
  return definition.requirements.filter(
    (requirement): requirement is Extract<MissionRequirement, { kind: "npc_conversation" }> =>
      requirement.kind === "npc_conversation",
  );
}

/** Every authored requirement that owns a durable progress row, by stable key. */
function progressKeyedRequirements(
  definition: MissionDefinition,
): readonly { progressKey: string }[] {
  return [...trackedActivityRequirements(definition), ...conversationRequirements(definition)];
}

/**
 * Initialize the durable rows owned by an accepted mission. The authored
 * definition remains the source of target/activity semantics; persistence
 * stores only the current value keyed by the stable requirement identity.
 */
export async function ensureMissionProgressRows(
  transaction: DatabaseTransaction,
  characterId: string,
  definition: MissionDefinition,
  now = new Date(),
): Promise<void> {
  const requirements = progressKeyedRequirements(definition);
  if (requirements.length === 0) return;
  await transaction
    .insert(characterMissionProgress)
    .values(
      requirements.map((requirement) => ({
        characterId,
        missionId: definition.id,
        progressKey: requirement.progressKey,
        progress: 0,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Record that one authored mandatory conversation genuinely happened.
 *
 * The row is a satisfied/unsatisfied marker for the authored key, so writing it
 * twice is a no-op: replaying the scene, retrying the command, or racing two
 * requests all converge on the same single satisfied row. The caller owns
 * validating the mission, NPC, dialogue, and position inside its transaction.
 */
export async function recordMissionConversation(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    missionId: string;
    progressKey: string;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await transaction
    .insert(characterMissionProgress)
    .values({
      characterId: input.characterId,
      missionId: input.missionId,
      progressKey: input.progressKey,
      progress: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        characterMissionProgress.characterId,
        characterMissionProgress.missionId,
        characterMissionProgress.progressKey,
      ],
      set: { progress: 1, updatedAt: now },
    });
}

/** One requirement a recorded outcome actually advanced. */
export type TrackedActivityCredit = {
  missionId: string;
  progressKey: string;
  before: number;
  after: number;
};

/**
 * Consume one authoritative activity outcome inside the surrounding character
 * transaction. Activity resolvers provide only the generic activity, the exact
 * resolved count, and — for a family activity like Fabrication — which authored
 * action it was; mission definitions decide which accepted missions care.
 * Returns the requirements it advanced, so a caller can tell which outcome was
 * the one that satisfied an objective.
 */
export async function recordTrackedActivity(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    activity: TrackedActivity;
    metric: "attempts" | "completions";
    attemptCount: number;
    /** The authored action performed; a requirement naming another action ignores it. */
    actionId?: string;
  },
): Promise<readonly TrackedActivityCredit[]> {
  const credits: TrackedActivityCredit[] = [];
  if (!Number.isInteger(input.attemptCount) || input.attemptCount <= 0) return credits;

  const activeRows = await transaction
    .select()
    .from(characterMissions)
    .where(
      and(
        eq(characterMissions.characterId, input.characterId),
        isNull(characterMissions.completedAt),
      ),
    )
    .for("update");

  for (const missionRow of activeRows) {
    const definition = getMission(missionRow.missionId);
    if (!definition) continue;
    const matchingRequirements = trackedActivityRequirements(definition).filter(
      (requirement) =>
        requirement.activity === input.activity &&
        requirement.metric === input.metric &&
        (requirement.actionId === undefined || requirement.actionId === input.actionId),
    );
    for (const requirement of matchingRequirements) {
      const existing = (
        await transaction
          .select()
          .from(characterMissionProgress)
          .where(
            and(
              eq(characterMissionProgress.characterId, input.characterId),
              eq(characterMissionProgress.missionId, definition.id),
              eq(characterMissionProgress.progressKey, requirement.progressKey),
            ),
          )
          .for("update")
      )[0];
      const nextProgress = Math.min(
        (existing?.progress ?? 0) + input.attemptCount,
        requirement.target,
      );
      if (nextProgress > (existing?.progress ?? 0)) {
        credits.push({
          missionId: definition.id,
          progressKey: requirement.progressKey,
          before: existing?.progress ?? 0,
          after: nextProgress,
        });
      }
      if (!existing) {
        await transaction.insert(characterMissionProgress).values({
          characterId: input.characterId,
          missionId: definition.id,
          progressKey: requirement.progressKey,
          progress: nextProgress,
        });
      } else {
        await transaction
          .update(characterMissionProgress)
          .set({ progress: nextProgress, updatedAt: new Date() })
          .where(
            and(
              eq(characterMissionProgress.characterId, input.characterId),
              eq(characterMissionProgress.missionId, definition.id),
              eq(characterMissionProgress.progressKey, requirement.progressKey),
            ),
          );
      }
    }
  }
  return credits;
}

/**
 * Set one Mission-local reactive fact (#232). Idempotent: the fact is a
 * boolean that something happened at least once, so a second occurrence
 * changes nothing and there is nothing to count.
 */
async function setMissionFact(
  transaction: DatabaseTransaction,
  input: { characterId: string; missionId: string; key: string },
): Promise<void> {
  const now = new Date();
  await transaction
    .insert(characterMissionProgress)
    .values({ ...input, progressKey: input.key, progress: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        characterMissionProgress.characterId,
        characterMissionProgress.missionId,
        characterMissionProgress.progressKey,
      ],
      set: { progress: 1, updatedAt: now },
    });
}

/**
 * Credit resolved Fabrication workpieces to Missions, in resolution order,
 * inside the transaction that resolved them (#232).
 *
 * A successful workpiece counts toward `fabrication` completions for its own
 * recipe; a bust counts toward nothing. The two narrow Manual Override facts
 * are set here and only here: a bust of the watched recipe while the Mission
 * is active, and a success that pushed the machine and was the very workpiece
 * that satisfied the watched objective. Nothing else is remembered.
 */
export async function recordFabricationOutcomes(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    actionId: string;
    outcomes: readonly { result: "success" | "bust"; usedOverride: boolean }[];
  },
): Promise<void> {
  if (input.outcomes.length === 0) return;
  const activeRows = await transaction
    .select()
    .from(characterMissions)
    .where(
      and(
        eq(characterMissions.characterId, input.characterId),
        isNull(characterMissions.completedAt),
      ),
    )
    .for("update");
  const watching = activeRows
    .map((row) => getMission(row.missionId))
    .filter((definition): definition is MissionDefinition => definition !== undefined)
    .flatMap((definition) =>
      (definition.reactiveFacts ?? [])
        .filter((fact) => fact.observes.actionId === input.actionId)
        .map((fact) => ({ missionId: definition.id, fact })),
    );
  for (const outcome of input.outcomes) {
    if (outcome.result === "bust") {
      for (const { missionId, fact } of watching) {
        if (fact.observes.kind !== "fabrication_override_bust") continue;
        await setMissionFact(transaction, {
          characterId: input.characterId,
          missionId,
          key: fact.key,
        });
      }
      continue;
    }
    const credits = await recordTrackedActivity(transaction, {
      characterId: input.characterId,
      activity: "fabrication",
      metric: "completions",
      attemptCount: 1,
      actionId: input.actionId,
    });
    if (!outcome.usedOverride) continue;
    for (const { missionId, fact } of watching) {
      if (fact.observes.kind !== "fabrication_override_success") continue;
      const watched = fact.observes.requirementProgressKey;
      const satisfiedNow = credits.some(
        (credit) => credit.missionId === missionId && credit.progressKey === watched,
      );
      if (!satisfiedNow) continue;
      await setMissionFact(transaction, {
        characterId: input.characterId,
        missionId,
        key: fact.key,
      });
    }
  }
}
