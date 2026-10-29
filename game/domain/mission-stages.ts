import type { MissionDefinition, MissionRequirement, MissionStage } from "@/game/content/missions";

export type MissionStageRecord = {
  acceptedAt?: Date | null;
  completedAt?: Date | null;
  completedStageIds?: readonly string[];
};

/** Exact authored prefix, never an index or stage selected by a client. */
export function activeMissionStage(
  definition: MissionDefinition,
  record?: MissionStageRecord,
): MissionStage | undefined {
  if (!definition.stages) return undefined;
  const history = record?.completedStageIds ?? [];
  if (
    history.length > definition.stages.length ||
    history.some((id, index) => definition.stages![index]?.id !== id)
  )
    throw new Error(`Invalid stage history for ${definition.id}`);
  if (record?.completedAt) {
    if (history.length !== definition.stages.length)
      throw new Error(`Incomplete stage history for completed ${definition.id}`);
    return undefined;
  }
  if (history.length === definition.stages.length)
    throw new Error(`Missing completion for ${definition.id}`);
  return definition.stages[history.length];
}

/** Legacy keys are unchanged. Stage and progress identities cannot collide. */
export function missionProgressKey(stage: MissionStage | undefined, key: string): string {
  return stage ? `${stage.id}/${key}` : key;
}

/** Every authored requirement, for reference/validation rather than runtime credit. */
export function allMissionRequirements(
  definition: Pick<MissionDefinition, "requirements" | "stages">,
): readonly MissionRequirement[] {
  return definition.stages
    ? definition.stages.flatMap((stage) => stage.requirements)
    : definition.requirements;
}

/** Same existing requirement/projection vocabulary, scoped to exactly one phase. */
export function missionAtStage(
  definition: MissionDefinition,
  stage: MissionStage | undefined,
): MissionDefinition {
  if (!definition.stages) return definition;
  return {
    ...definition,
    requirements: stage?.requirements ?? [],
    dialogue: { ...definition.dialogue, ...stage?.dialogue },
  };
}

/** Local authored keys for the existing requirement evaluator; persistence stays scoped. */
export function stageProgress(
  stage: MissionStage | undefined,
  progress?: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> | undefined {
  if (!stage || !progress) return progress;
  const prefix = `${stage.id}/`;
  return new Map(
    [...progress]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}
