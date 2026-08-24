import { ContentId } from "@/game/schemas/ids";
import {
  CONVERSATION_BACKGROUNDS,
  getConversationBackground,
} from "@/game/content/conversation-backgrounds";
import {
  DIALOGUE_SEQUENCES,
  type DialogueBeat,
  type DialogueSequence,
} from "@/game/content/dialogue";
import { getLocation } from "@/game/content/locations";
import { NPCS } from "@/game/content/npcs";
import type {
  DialogueAdapter,
  StudioConversationBackground,
  StudioDialogueBeat,
  StudioDialogueSequence,
  StudioNpc,
} from "../../core/types";

function formatStableId(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toStudioBeat(beat: DialogueBeat): StudioDialogueBeat {
  return { ...beat };
}

function toStudioSequence(sequence: DialogueSequence): StudioDialogueSequence {
  return {
    id: sequence.id,
    title: formatStableId(sequence.id),
    npcId: sequence.npcId,
    beats: sequence.beats.map(toStudioBeat),
    ...(sequence.action ? { action: sequence.action } : {}),
  };
}

const studioNpcs: StudioNpc[] = NPCS.map((npc) => ({
  id: npc.id,
  displayName: npc.displayName,
  role: npc.role,
  expressions: Object.entries(npc.expressionAssets).map(([id, asset]) => ({
    id,
    label: formatStableId(id),
    asset,
  })),
}));

const studioBackgrounds: StudioConversationBackground[] = CONVERSATION_BACKGROUNDS.map(
  (background) => {
    const location = getLocation(background.locationId);
    return {
      id: background.id,
      label: location?.displayName ?? formatStableId(background.id),
      asset: background.asset,
      alt: background.alt,
    };
  },
);

export const runespaceDialogueAdapter: DialogueAdapter = {
  adapterId: "runespace",
  displayName: "RuneSpace",
  npcs: studioNpcs,
  backgrounds: studioBackgrounds,
  sequences: DIALOGUE_SEQUENCES.map(toStudioSequence),
  isValidStableId: (value) => ContentId.safeParse(value).success,
};

export function getRuneSpaceSequence(sequenceId: string): StudioDialogueSequence | undefined {
  return runespaceDialogueAdapter.sequences.find((sequence) => sequence.id === sequenceId);
}

export function toRuneSpaceDialogueBeat(beat: StudioDialogueBeat): DialogueBeat {
  return { ...beat };
}

export function getRuneSpaceBackground(backgroundId: string) {
  return getConversationBackground(backgroundId);
}
