import type {
  DialogueAdapter,
  DialogueDraft,
  DialogueValidationResult,
  StudioDialogueBeat,
  StudioItem,
  StudioNpc,
} from "./types";

const FALLBACK_STABLE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function findNpc(adapter: DialogueAdapter, npcId: string): StudioNpc | undefined {
  return adapter.npcs.find((npc) => npc.id === npcId);
}

function findItem(adapter: DialogueAdapter, itemId: string): StudioItem | undefined {
  return adapter.items?.find((item) => item.id === itemId);
}

function findSkill(adapter: DialogueAdapter, skillId: string) {
  return adapter.skills?.find((skill) => skill.id === skillId);
}

/** The authoritative quantity range for an item beat, straight from the item definition. */
export function getStudioItemQuantityRange(item: StudioItem): { min: number; max: number } {
  return item.kind === "stack" ? { min: 1, max: item.stackLimit } : { min: 1, max: 1 };
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

  draft.beats.forEach((beat: StudioDialogueBeat, index: number) => {
    const path = `beats.${index}`;
    const record = beat as unknown as Record<string, unknown>;
    if (beat.kind === "item") {
      // Reject mixed shapes outright: an item beat carrying NPC-only or
      // skill-only fields is malformed even if its own fields look valid.
      const staleFields = [
        "speakerNpcId",
        "expressionId",
        "presentationMode",
        "skillId",
        "amount",
      ].filter((field) => field in record);
      if (staleFields.length > 0) {
        issues.push({
          path: `${path}.subject`,
          message: `Item beats cannot contain foreign subject fields (${staleFields.join(", ")}).`,
        });
      }
      const item = findItem(adapter, beat.itemId);
      if (!item) {
        issues.push({
          path: `${path}.itemId`,
          message: "Choose an item from the adapter's canonical inventory definitions.",
        });
      } else {
        const { min, max } = getStudioItemQuantityRange(item);
        if (!Number.isInteger(beat.quantity) || beat.quantity < min || beat.quantity > max) {
          issues.push({
            path: `${path}.quantity`,
            message:
              max === min
                ? "This item is unique; its quantity must be exactly 1."
                : `Quantity must be a whole number between ${min} and ${max}.`,
          });
        }
      }
      if (!adapter.backgrounds.some((background) => background.id === beat.backgroundId)) {
        issues.push({
          path: `${path}.backgroundId`,
          message: "Choose an authored conversation background.",
        });
      }
      // Caption is optional for item beats; it never implies the item speaks.
      return;
    }

    if (beat.kind === "skill_xp") {
      // Reject mixed shapes outright: a skill-XP beat carrying NPC-only or
      // item-only fields is malformed even if its own fields look valid.
      const staleFields = [
        "speakerNpcId",
        "expressionId",
        "presentationMode",
        "itemId",
        "quantity",
      ].filter((field) => field in record);
      if (staleFields.length > 0) {
        issues.push({
          path: `${path}.subject`,
          message: `Skill XP beats cannot contain foreign subject fields (${staleFields.join(", ")}).`,
        });
      }
      const skill = findSkill(adapter, beat.skillId);
      if (!skill) {
        issues.push({
          path: `${path}.skillId`,
          message: "Choose a skill from the adapter's canonical skill registry.",
        });
      }
      if (!Number.isInteger(beat.amount) || beat.amount < 1) {
        issues.push({
          path: `${path}.amount`,
          message: "Amount must be a positive whole number of XP.",
        });
      }
      if (!adapter.backgrounds.some((background) => background.id === beat.backgroundId)) {
        issues.push({
          path: `${path}.backgroundId`,
          message: "Choose an authored conversation background.",
        });
      }
      // Caption is optional for skill-XP beats; presentation never grants XP.
      return;
    }

    const npc = findNpc(adapter, beat.speakerNpcId);
    // Reject mixed shapes outright: an NPC beat carrying item-only or
    // skill-only fields is malformed even if its own fields look valid.
    const staleFields = ["itemId", "quantity", "skillId", "amount"].filter(
      (field) => field in record,
    );
    if (staleFields.length > 0) {
      issues.push({
        path: `${path}.subject`,
        message: `NPC beats cannot contain foreign subject fields (${staleFields.join(", ")}).`,
      });
    }
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
