import type { MissionDefinition } from "@/game/content/missions";
import { activeMissionStage, type MissionStageRecord } from "@/game/domain/mission-stages";

/** The activity owns its authorization; the Mission engine knows no workbench. */
export type MissionActivityAccessPolicy = {
  missionId: string;
  supervisedStages: readonly { stageId: string; actionId: string }[];
};
export type MissionActivityAccess =
  | { kind: "locked" }
  | { kind: "supervised"; stageId: string; actionId: string }
  | { kind: "unrestricted" };
export function missionActivityAccess(
  policy: MissionActivityAccessPolicy,
  definition: MissionDefinition,
  record?: MissionStageRecord,
): MissionActivityAccess {
  if (policy.missionId !== definition.id)
    throw new Error("Activity policy references a different Mission");
  const stage = activeMissionStage(definition, record);
  if (!record?.acceptedAt) return { kind: "locked" };
  if (record.completedAt) return { kind: "unrestricted" };
  const lesson = policy.supervisedStages.find((candidate) => candidate.stageId === stage?.id);
  return lesson ? { kind: "supervised", ...lesson } : { kind: "locked" };
}
export function validateMissionActivityAccess(
  policy: MissionActivityAccessPolicy,
  definition: MissionDefinition,
  actionIds: readonly string[],
): void {
  if (policy.missionId !== definition.id || !definition.stages)
    throw new Error("Activity policy needs a staged Mission");
  const seen = new Set<string>();
  for (const lesson of policy.supervisedStages) {
    const stage = definition.stages.find((candidate) => candidate.id === lesson.stageId);
    if (
      !stage ||
      seen.has(lesson.stageId) ||
      !actionIds.includes(lesson.actionId) ||
      !stage.requirements.some(
        (req) =>
          req.kind === "tracked_activity" &&
          req.metric === "completions" &&
          req.target === 1 &&
          req.actionId === lesson.actionId,
      )
    )
      throw new Error("Invalid supervised activity lesson");
    seen.add(lesson.stageId);
  }
}
