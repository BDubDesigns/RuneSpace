import { QC_STUDIO_SCHEMA_VERSION, type DialogueDraft } from "./types";

export type DialogueExportPayload = {
  qcStudio: {
    schemaVersion: typeof QC_STUDIO_SCHEMA_VERSION;
    module: "dialogue";
    adapterId: string;
  };
  source: {
    kind: "authoritative_sequence" | "new_draft";
    sequenceId?: string;
    proposedStableId?: string;
  };
  sequence: {
    title: string;
    npcId: string;
    beats: DialogueDraft["beats"];
    action?: DialogueDraft["action"];
  };
};

export function createDialogueExportPayload(
  adapterId: string,
  draft: DialogueDraft,
): DialogueExportPayload {
  return {
    qcStudio: { schemaVersion: QC_STUDIO_SCHEMA_VERSION, module: "dialogue", adapterId },
    source: draft.sourceSequenceId
      ? { kind: "authoritative_sequence", sequenceId: draft.sourceSequenceId }
      : {
          kind: "new_draft",
          ...(draft.proposedStableId ? { proposedStableId: draft.proposedStableId } : {}),
        },
    sequence: {
      title: draft.title,
      npcId: draft.npcId,
      beats: draft.beats.map((beat) => ({ ...beat })),
      ...(draft.action ? { action: draft.action } : {}),
    },
  };
}
