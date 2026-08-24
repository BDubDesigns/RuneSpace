import {
  QC_STUDIO_SCHEMA_VERSION,
  type DialogueAdapter,
  type DialogueDraft,
  type StudioDialogueBeat,
  type StudioDialogueSequence,
} from "./types";

function cloneBeat(beat: StudioDialogueBeat): StudioDialogueBeat {
  return { ...beat };
}

export function cloneDraft(draft: DialogueDraft): DialogueDraft {
  return {
    ...draft,
    ...(draft.proposedStableId !== undefined ? { proposedStableId: draft.proposedStableId } : {}),
    ...(draft.sourceSequenceId !== undefined ? { sourceSequenceId: draft.sourceSequenceId } : {}),
    beats: draft.beats.map(cloneBeat),
  };
}

export function createDraftFromSequence(
  sequence: StudioDialogueSequence,
  draftId: string,
  title = sequence.title,
): DialogueDraft {
  return {
    schemaVersion: QC_STUDIO_SCHEMA_VERSION,
    adapterId: "",
    draftId,
    title,
    sourceSequenceId: sequence.id,
    npcId: sequence.npcId,
    beats: sequence.beats.map(cloneBeat),
    ...(sequence.action ? { action: sequence.action } : {}),
  };
}

export function createDraftFromAdapterSequence(
  adapter: DialogueAdapter,
  sequence: StudioDialogueSequence,
  draftId: string,
  title = sequence.title,
): DialogueDraft {
  return { ...createDraftFromSequence(sequence, draftId, title), adapterId: adapter.adapterId };
}

export function createBlankDraft(adapter: DialogueAdapter, draftId: string): DialogueDraft {
  const npc = adapter.npcs[0];
  const expression = npc?.expressions[0];
  const background = adapter.backgrounds[0];
  return {
    schemaVersion: QC_STUDIO_SCHEMA_VERSION,
    adapterId: adapter.adapterId,
    draftId,
    title: npc ? `${npc.displayName} — Dialogue` : "New Dialogue",
    ...(npc ? { npcId: npc.id } : { npcId: "" }),
    beats: [
      {
        speakerNpcId: npc?.id ?? "",
        expressionId: expression?.id ?? "",
        backgroundId: background?.id ?? "",
        presentationMode: "local",
        text: "",
      },
    ],
  };
}

export function withAdapterId(draft: DialogueDraft, adapterId: string): DialogueDraft {
  return { ...cloneDraft(draft), adapterId };
}
