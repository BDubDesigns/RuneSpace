import { cloneDraft } from "./draft";
import {
  QC_STUDIO_MIGRATABLE_SCHEMA_VERSION,
  QC_STUDIO_SCHEMA_VERSION,
  type DialogueCheckpoint,
  type DialogueDraft,
  type PersistedDialogueStudio,
  type StudioDialogueAction,
  type StudioDialogueBeat,
  type StudioDialoguePresentationMode,
} from "./types";

export const MAX_DURABLE_CHECKPOINTS = 5;

export function getDialogueStudioStorageKey(adapterId: string): string {
  return `qc-studio:${adapterId}:dialogue:v2`;
}

/** Legacy key from schema v1; checked so old drafts migrate instead of stranding. */
export function getLegacyDialogueStudioStorageKey(adapterId: string): string {
  return `qc-studio:${adapterId}:dialogue:v1`;
}

export type PersistedLoadResult =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "migrated"; state: PersistedDialogueStudio }
  | { kind: "loaded"; state: PersistedDialogueStudio };

function isPresentationMode(value: unknown): value is StudioDialoguePresentationMode {
  return value === "local" || value === "comms";
}

function isAction(value: unknown): value is StudioDialogueAction {
  return value === "accept_mission" || value === "complete_mission";
}

function isItemBeat(beat: Record<string, unknown>): boolean {
  return (
    typeof beat.itemId === "string" &&
    typeof beat.quantity === "number" &&
    Number.isInteger(beat.quantity) &&
    beat.quantity >= 1
  );
}

/**
 * Accepts either subject kind. NPC fields are required for npc beats only, so a
 * stored item beat never needs fake speaker data. Structural validation of the
 * item catalog/quantity range happens against the live adapter at load time.
 */
function isBeat(value: unknown): value is StudioDialogueBeat {
  if (!value || typeof value !== "object") return false;
  const beat = value as Record<string, unknown>;
  if (typeof beat.backgroundId !== "string" || typeof beat.text !== "string") return false;
  if (beat.kind === "npc") {
    return (
      typeof beat.speakerNpcId === "string" &&
      typeof beat.expressionId === "string" &&
      isPresentationMode(beat.presentationMode)
    );
  }
  if (beat.kind === "item") {
    return isItemBeat(beat);
  }
  // v1 beats had no kind discriminator; they were all NPC beats.
  if (beat.kind === undefined) {
    return (
      typeof beat.speakerNpcId === "string" &&
      typeof beat.expressionId === "string" &&
      isPresentationMode(beat.presentationMode)
    );
  }
  return false;
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

/** Migrates a schema-v1 payload to the current version by tagging every beat as an NPC beat. */
function migrateV1State(
  state: Record<string, unknown>,
  adapterId: string,
): PersistedDialogueStudio | null {
  let copied: Record<string, unknown>;
  try {
    copied = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const tagBeats = (draft: Record<string, unknown>) => {
    if (Array.isArray(draft.beats)) {
      draft.beats = (draft.beats as unknown[]).map((beat) => ({
        ...(beat as Record<string, unknown>),
        kind: "npc",
      }));
    }
    draft.schemaVersion = QC_STUDIO_SCHEMA_VERSION;
  };
  const legacyDraft = copied.draft;
  if (!legacyDraft || typeof legacyDraft !== "object") return null;
  tagBeats(legacyDraft as Record<string, unknown>);
  if (Array.isArray(copied.checkpoints)) {
    for (const checkpoint of copied.checkpoints) {
      if (!checkpoint || typeof checkpoint !== "object") continue;
      const checkpointDraft = (checkpoint as Record<string, unknown>).draft;
      if (checkpointDraft && typeof checkpointDraft === "object") {
        tagBeats(checkpointDraft as Record<string, unknown>);
      }
    }
  }
  if (
    !isDraft(copied.draft, adapterId) ||
    !Array.isArray(copied.checkpoints) ||
    !(copied.checkpoints as unknown[]).every((checkpoint) => isCheckpoint(checkpoint, adapterId))
  ) {
    return null;
  }
  return {
    schemaVersion: QC_STUDIO_SCHEMA_VERSION,
    adapterId,
    draft: cloneDraft(copied.draft as DialogueDraft),
    checkpoints: (copied.checkpoints as DialogueCheckpoint[])
      .slice(-MAX_DURABLE_CHECKPOINTS)
      .map((checkpoint) => ({ ...checkpoint, draft: cloneDraft(checkpoint.draft) })),
  };
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
  if (state.adapterId !== adapterId) return { kind: "invalid" };
  if (
    state.schemaVersion !== QC_STUDIO_SCHEMA_VERSION ||
    !isDraft(state.draft, adapterId) ||
    !Array.isArray(state.checkpoints)
  ) {
    if (state.schemaVersion === QC_STUDIO_MIGRATABLE_SCHEMA_VERSION) {
      const migrated = migrateV1State(state, adapterId);
      if (migrated) return { kind: "migrated", state: migrated };
    }
    if (state.schemaVersion !== QC_STUDIO_SCHEMA_VERSION) {
      return { kind: "unsupported" };
    }
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
