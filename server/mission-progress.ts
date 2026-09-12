import { and, eq, isNull } from "drizzle-orm";
import { characterMissionProgress, characterMissions } from "@/db/rune-space";
import {
  getMission,
  type MissionDefinition,
  type MissionRequirement,
} from "@/game/content/missions";
import type { DatabaseTransaction } from "@/server/action-resolution";

export type TrackedActivity = "mining" | "refining";

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

/**
 * Consume one authoritative activity outcome inside the surrounding character
 * transaction. Activity resolvers provide only the generic activity and exact
 * resolved-attempt count; mission definitions decide which accepted missions
 * care about that fact.
 */
export async function recordTrackedActivity(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    activity: TrackedActivity;
    metric: "attempts";
    attemptCount: number;
  },
): Promise<void> {
  if (!Number.isInteger(input.attemptCount) || input.attemptCount <= 0) return;

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
        requirement.activity === input.activity && requirement.metric === input.metric,
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
}
