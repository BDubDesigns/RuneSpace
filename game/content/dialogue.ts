import {
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  MISSION_IDS,
  NPC_IDS,
  type DialogueId,
  type ExpressionId,
  type NpcId,
} from "@/game/config/foundations";
import { getNpc, resolveNpcExpression } from "./npcs";
import type { MissionState } from "@/game/domain/missions";

export type DialogueBeat = {
  speakerNpcId: NpcId;
  expressionId: ExpressionId;
  text: string;
};

export type DialogueSequence = {
  id: DialogueId;
  npcId: NpcId;
  beats: readonly DialogueBeat[];
  action?: "accept_mission" | "complete_mission";
};

/** Temporary implementation copy. Final Wade/Tansy writing is a product-owner checkpoint. */
const dialogue = {
  [DIALOGUE_IDS.wadeOffer]: {
    id: DIALOGUE_IDS.wadeOffer,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      {
        speakerNpcId: NPC_IDS.wadeRusk,
        expressionId: EXPRESSION_IDS.neutral,
        text: "TEMPORARY COPY — Wade's opening line is pending dialogue approval.",
      },
      {
        speakerNpcId: NPC_IDS.wadeRusk,
        expressionId: EXPRESSION_IDS.neutral,
        text: "TEMPORARY COPY — The Walk It Off offer is pending dialogue approval.",
      },
    ],
    action: "accept_mission",
  },
  [DIALOGUE_IDS.wadeFollowUp]: {
    id: DIALOGUE_IDS.wadeFollowUp,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      {
        speakerNpcId: NPC_IDS.wadeRusk,
        expressionId: EXPRESSION_IDS.neutral,
        text: "TEMPORARY COPY — Wade remains available after the mission changes state.",
      },
    ],
  },
  [DIALOGUE_IDS.tansyBeforeMission]: {
    id: DIALOGUE_IDS.tansyBeforeMission,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      {
        speakerNpcId: NPC_IDS.tansyRusk,
        expressionId: EXPRESSION_IDS.neutral,
        text: "TEMPORARY COPY — Tansy's pre-mission conversation is pending dialogue approval.",
      },
    ],
  },
  [DIALOGUE_IDS.tansyCompletion]: {
    id: DIALOGUE_IDS.tansyCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      {
        speakerNpcId: NPC_IDS.tansyRusk,
        expressionId: EXPRESSION_IDS.neutral,
        text: "TEMPORARY COPY — Tansy's Salvage Cutter handoff is pending dialogue approval.",
      },
    ],
    action: "complete_mission",
  },
  [DIALOGUE_IDS.tansyAfterCompletion]: {
    id: DIALOGUE_IDS.tansyAfterCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      {
        speakerNpcId: NPC_IDS.tansyRusk,
        expressionId: EXPRESSION_IDS.neutral,
        text: "TEMPORARY COPY — Tansy's post-completion conversation is pending approval.",
      },
    ],
  },
} as const satisfies Record<DialogueId, DialogueSequence>;

export function getDialogue(dialogueId: string): DialogueSequence | undefined {
  return dialogue[dialogueId as DialogueId];
}

/** Narrow authored relationship for the first real mission, not a condition DSL. */
export function getWalkItOffDialogue(
  npcId: string,
  state: MissionState,
): DialogueSequence | undefined {
  if (npcId === NPC_IDS.wadeRusk) {
    return getDialogue(
      state === "not_accepted" ? DIALOGUE_IDS.wadeOffer : DIALOGUE_IDS.wadeFollowUp,
    );
  }
  if (npcId !== NPC_IDS.tansyRusk) return undefined;
  if (state === "not_accepted") return getDialogue(DIALOGUE_IDS.tansyBeforeMission);
  if (state === "completed") return getDialogue(DIALOGUE_IDS.tansyAfterCompletion);
  return getDialogue(DIALOGUE_IDS.tansyCompletion);
}

export function resolveDialogueSpeaker(dialogueBeat: DialogueBeat) {
  const npc = getNpc(dialogueBeat.speakerNpcId);
  const expressionAsset = resolveNpcExpression(
    dialogueBeat.speakerNpcId,
    dialogueBeat.expressionId,
  );
  if (!npc || !expressionAsset) return undefined;
  return { npc, expressionAsset };
}

export const WALK_IT_OFF_DIALOGUE_MISSION_ID = MISSION_IDS.walkItOff;
