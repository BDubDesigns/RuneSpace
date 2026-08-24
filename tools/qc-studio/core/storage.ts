import { cloneDraft } from "./draft";
import {
  QC_STUDIO_SCHEMA_VERSION,
  type DialogueCheckpoint,
  type DialogueDraft,
  type PersistedDialogueStudio,
  type StudioDialogueAction,
  type StudioDialoguePresentationMode,
} from "./types";

export const QC_STUDIO_STORAGE_KEY = "runespace.qc-studio.dialogue.v1";
export const MAX_DURABLE_CHECKPOINTS = 5;

export type PersistedLoadResult =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "loaded"; state: PersistedDialogueStudio };

function isPresentationMode(value: unknown): value is StudioDialoguePresentationMode {
  return value === "local" || value === "comms";
}

function isAction(value: unknown): value is StudioDialogueAction {
  return value === "accept_mission" || value === "complete_mission";
}

function isBeat(value: unknown): value is DialogueDraft["beats"][number] {
  if (!value || typeof value !== "object") return false;
  const beat = value as Record<string, unknown>;
  return (
    typeof beat.speakerNpcId === "string" &&
    typeof beat.expressionId === "string" &&
    typeof beat.backgroundId === "string" &&
    isPresentationMode(beat.presentationMode) &&
    typeof beat.text === "string"
  );
}

function isDraft(value: unknown, adapterId: string): value is DialogueDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    draft.schemaVersion === QC_STUDIO_SCHEMA_VERSION &&
    draft.adapterId === adapterId &&
    typeof draft.draftId === "string" &&
    typeof draft.title === "string" &&
    (draft.proposedStableId === undefined || typeof draft.proposedStableId === "string") &&
    (draft.sourceSequenceId === undefined || typeof draft.sourceSequenceId === "string") &&
    typeof draft.npcId === "string" &&
    Array.isArray(draft.beats) &&
    draft.beats.every(isBeat) &&
    (draft.action === undefined || isAction(draft.action))
  );
}

function isCheckpoint(value: unknown, adapterId: string): value is DialogueCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as Record<string, unknown>;
  return (
    typeof checkpoint.id === "string" &&
    typeof checkpoint.label === "string" &&
    typeof checkpoint.savedAt === "string" &&
    isDraft(checkpoint.draft, adapterId)
  );
}

export function parsePersistedDialogueStudio(
  raw: string | null,
  adapterId: string,
): PersistedLoadResult {
  if (!raw) return { kind: "empty" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (!value || typeof value !== "object") return { kind: "invalid" };
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== QC_STUDIO_SCHEMA_VERSION) return { kind: "unsupported" };
  if (state.adapterId !== adapterId) return { kind: "invalid" };
  if (!isDraft(state.draft, adapterId) || !Array.isArray(state.checkpoints)) {
    return { kind: "invalid" };
  }
  if (!state.checkpoints.every((checkpoint) => isCheckpoint(checkpoint, adapterId))) {
    return { kind: "invalid" };
  }
  return {
    kind: "loaded",
    state: {
      schemaVersion: QC_STUDIO_SCHEMA_VERSION,
      adapterId,
      draft: cloneDraft(state.draft),
      checkpoints: state.checkpoints.slice(-MAX_DURABLE_CHECKPOINTS).map((checkpoint) => ({
        ...checkpoint,
        draft: cloneDraft(checkpoint.draft),
      })),
    },
  };
}

export function createPersistedDialogueStudio(
  draft: DialogueDraft,
  checkpoints: readonly DialogueCheckpoint[] = [],
): PersistedDialogueStudio {
  return {
    schemaVersion: QC_STUDIO_SCHEMA_VERSION,
    adapterId: draft.adapterId,
    draft: cloneDraft(draft),
    checkpoints: checkpoints.map((checkpoint) => ({
      ...checkpoint,
      draft: cloneDraft(checkpoint.draft),
    })),
  };
}

export function addDurableCheckpoint(
  checkpoints: readonly DialogueCheckpoint[],
  draft: DialogueDraft,
  label: string,
  savedAt: string,
  id: string,
): DialogueCheckpoint[] {
  return [...checkpoints, { id, label, savedAt, draft: cloneDraft(draft) }].slice(
    -MAX_DURABLE_CHECKPOINTS,
  );
}

export function serializeDialogueStudio(
  draft: DialogueDraft,
  checkpoints: readonly DialogueCheckpoint[],
): string {
  return JSON.stringify(createPersistedDialogueStudio(draft, checkpoints));
}
