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
  const background = adapter.backgrounds[0];
  const title = npc
    ? `${npc.displayName} — ${background?.label ?? "New"} Dialogue`
    : "New Dialogue";
  return {
    schemaVersion: QC_STUDIO_SCHEMA_VERSION,
    adapterId: adapter.adapterId,
    draftId,
    title,
    ...(npc ? { npcId: npc.id } : { npcId: "" }),
    beats: [createBeatForSubject(adapter, "npc", background?.id ?? "")],
  };
}

/**
 * Builds a complete beat of the requested subject kind. Used by subject
 * switching so the new shape REPLACES the old one wholesale — stale fields
 * from the previous kind can never survive a switch.
 */
export function createBeatForSubject(
  adapter: DialogueAdapter,
  kind: "npc" | "item" | "skill_xp",
  backgroundId: string,
): StudioDialogueBeat {
  if (kind === "item") {
    const item = adapter.items?.[0];
    if (!item) {
      throw new Error("This project adapter exposes no canonical items.");
    }
    return { kind: "item", itemId: item.id, quantity: 1, backgroundId, text: "" };
  }
  if (kind === "skill_xp") {
    const skill = adapter.skills?.[0];
    if (!skill) {
      throw new Error("This project adapter exposes no canonical skills.");
    }
    return { kind: "skill_xp", skillId: skill.id, amount: 100, backgroundId, text: "" };
  }
  const npc = adapter.npcs[0];
  return {
    kind: "npc",
    speakerNpcId: npc?.id ?? "",
    expressionId: npc?.expressions[0]?.id ?? "",
    backgroundId,
    presentationMode: "local",
    text: "",
  };
}

export function withAdapterId(draft: DialogueDraft, adapterId: string): DialogueDraft {
  return { ...cloneDraft(draft), adapterId };
}
