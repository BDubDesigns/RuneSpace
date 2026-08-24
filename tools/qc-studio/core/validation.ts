import type { DialogueAdapter, DialogueDraft, DialogueValidationResult, StudioNpc } from "./types";

const FALLBACK_STABLE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function findNpc(adapter: DialogueAdapter, npcId: string): StudioNpc | undefined {
  return adapter.npcs.find((npc) => npc.id === npcId);
}

export function validateDialogueDraft(
  adapter: DialogueAdapter,
  draft: DialogueDraft,
): DialogueValidationResult {
  const issues: DialogueValidationResult["issues"] = [];
  if (draft.adapterId !== adapter.adapterId) {
    issues.push({
      path: "sequence",
      message: "This draft belongs to a different project adapter.",
    });
  }
  if (!draft.title.trim()) {
    issues.push({ path: "title", message: "Give the draft a name before export." });
  }
  if (!findNpc(adapter, draft.npcId)) {
    issues.push({
      path: "sequence.speaker",
      message: "The sequence speaker is not in the adapter catalog.",
    });
  }
  if (draft.proposedStableId !== undefined) {
    const isValid = adapter.isValidStableId
      ? adapter.isValidStableId(draft.proposedStableId)
      : FALLBACK_STABLE_ID_PATTERN.test(draft.proposedStableId);
    if (!isValid) {
      issues.push({
        path: "proposedStableId",
        message: "Use lowercase snake_case, starting with a letter.",
      });
    }
  }
  if (draft.beats.length === 0) {
    issues.push({ path: "beats", message: "A dialogue sequence needs at least one beat." });
  }

  draft.beats.forEach((beat, index) => {
    const path = `beats.${index}`;
    const npc = findNpc(adapter, beat.speakerNpcId);
    if (!npc) {
      issues.push({
        path: `${path}.speakerNpcId`,
        message: "Choose a speaker from the adapter catalog.",
      });
    } else if (!npc.expressions.some((expression) => expression.id === beat.expressionId)) {
      issues.push({
        path: `${path}.expressionId`,
        message: "Choose an expression authored for this speaker.",
      });
    }
    if (!adapter.backgrounds.some((background) => background.id === beat.backgroundId)) {
      issues.push({
        path: `${path}.backgroundId`,
        message: "Choose an authored conversation background.",
      });
    }
    if (beat.presentationMode !== "local" && beat.presentationMode !== "comms") {
      issues.push({
        path: `${path}.presentationMode`,
        message: "Choose local or comms presentation.",
      });
    }
    if (!beat.text.trim()) {
      issues.push({ path: `${path}.text`, message: "Dialogue text cannot be empty." });
    }
  });

  return { valid: issues.length === 0, issues };
}
