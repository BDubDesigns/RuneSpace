import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  MISSION_IDS,
  NPC_IDS,
  type ConversationBackgroundId,
  type DialogueId,
  type ExpressionId,
  type NpcId,
} from "@/game/config/foundations";
import type { MissionState } from "@/game/domain/missions";
import { getNpc, resolveNpcExpression } from "./npcs";

export type DialoguePresentationMode = "local" | "comms";

export type DialogueBeat = {
  speakerNpcId: NpcId;
  expressionId: ExpressionId;
  backgroundId: ConversationBackgroundId;
  presentationMode: DialoguePresentationMode;
  text: string;
};

export type DialogueSequence = {
  id: DialogueId;
  npcId: NpcId;
  beats: readonly DialogueBeat[];
  action?: "accept_mission" | "complete_mission";
};

const crash = CONVERSATION_BACKGROUND_IDS.crashSiteExterior;
const jag = CONVERSATION_BACKGROUND_IDS.theJagExterior;

function wadeLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    speakerNpcId: NPC_IDS.wadeRusk,
    expressionId,
    backgroundId: crash,
    presentationMode: "local",
    text,
  };
}

function wadeComms(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    speakerNpcId: NPC_IDS.wadeRusk,
    expressionId,
    backgroundId: crash,
    presentationMode: "comms",
    text,
  };
}

function tansyLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    speakerNpcId: NPC_IDS.tansyRusk,
    expressionId,
    backgroundId: jag,
    presentationMode: "local",
    text,
  };
}

const dialogue = {
  [DIALOGUE_IDS.wadeOffer]: {
    id: DIALOGUE_IDS.wadeOffer,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(EXPRESSION_IDS.concerned, "*Startled* Ahh!"),
      wadeLocal(EXPRESSION_IDS.concerned, "You're... You're alive."),
      wadeLocal(EXPRESSION_IDS.neutral, "That's good. I guess."),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Before you climbed out, I was looking at the nicest salvage claim Holo Hollow's seen in years.",
      ),
      wadeLocal(EXPRESSION_IDS.neutral, "I guess a repair job is something, at least."),
      wadeLocal(EXPRESSION_IDS.neutral, "You have credits?"),
      wadeLocal(EXPRESSION_IDS.scowl, "Of course you don't."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Name's Wade Rusk. Recovery, salvage, field repairs. If something around here quits moving, I either make it move again or sell the parts that still do.",
      ),
      wadeLocal(EXPRESSION_IDS.concerned, "Your ship's ugly, but it isn't beyond repair. Not yet."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Hull's one problem. Cargo section's another. You're going to need local material, tools, and more work than you can afford.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Yes. I noticed the problem with that sentence too. Don't worry, I'm sure we can work something out.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "My niece Tansy's working The Jag. She knows ferrite, and she can make useful things out of junk that I would've had the sense to throw away.",
      ),
      wadeLocal(EXPRESSION_IDS.neutral, "Go find her. Tell her I sent you."),
    ],
    action: "accept_mission",
  },
  [DIALOGUE_IDS.wadeFollowUp]: {
    id: DIALOGUE_IDS.wadeFollowUp,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(EXPRESSION_IDS.concerned, "Tansy give you the Cutter?"),
      wadeLocal(EXPRESSION_IDS.neutral, "Good."),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "I suggest you put it to use. Mine some Ferrite Shale at The Jag and show it to Tansy. She will show you what to do next.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyBeforeMission]: {
    id: DIALOGUE_IDS.tansyBeforeMission,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "Well. You're not from around here."),
      tansyLocal(EXPRESSION_IDS.concerned, "You the one who came down in that wreck?"),
      tansyLocal(EXPRESSION_IDS.neutral, "...Wade didn't talk to you first, did he."),
      tansyLocal(EXPRESSION_IDS.smile, "Of course he didn't. Hold on."),
      wadeComms(EXPRESSION_IDS.scowl, "What now? You know I'm busy, Tansy."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Your crash survivor walked all the way to The Jag without talking to you.",
      ),
      wadeComms(EXPRESSION_IDS.neutral, "That seems inefficient."),
      tansyLocal(EXPRESSION_IDS.concerned, "You were supposed to talk to them!"),
      wadeComms(EXPRESSION_IDS.scowl, "I was busy revising the salvage estimate."),
      tansyLocal(EXPRESSION_IDS.neutral, "Because they survived."),
      wadeComms(EXPRESSION_IDS.scowl, "Exactly."),
      wadeComms(
        EXPRESSION_IDS.neutral,
        "Might as well introduce myself now, then. Name's Wade Rusk. Recovery, salvage, field repairs. If something around here quits moving, I either make it move again or sell the parts that still do.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "He's friendlier after lunch."),
      wadeComms(EXPRESSION_IDS.concerned, "Your ship's ugly, but it isn't beyond repair. Not yet."),
      tansyLocal(EXPRESSION_IDS.neutral, "I can get you started."),
      wadeComms(
        EXPRESSION_IDS.scowl,
        "Good. Since you're already standing in front of her, let's all pretend this was the plan all along.",
      ),
    ],
    action: "accept_mission",
  },
  [DIALOGUE_IDS.tansyAfterRemoteAcceptance]: {
    id: DIALOGUE_IDS.tansyAfterRemoteAcceptance,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "Works for me."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Wade said you'd need local material and a way to cut it.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "I threw this together from spare parts and stubbornness."),
      tansyLocal(EXPRESSION_IDS.neutral, "It's not pretty, but pretty doesn't cut shale."),
    ],
    action: "complete_mission",
  },
  [DIALOGUE_IDS.tansyCompletion]: {
    id: DIALOGUE_IDS.tansyCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "Hey, you must be Wade's crash survivor!"),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "He said your ship's in bad shape, but still salvageable.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "You got pretty lucky. Most things that hit the ground that hard aren't worth the effort to try to fix.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "If you're going to repair your ship, you're going to need Ferrite.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "And if you're mining Ferrite, you're going to need this."),
      tansyLocal(EXPRESSION_IDS.neutral, "I threw it together from parts I had lying around."),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Nothing matches, it's not very fast, and half of it probably violates a regulation Wade already hates, but it'll cut shale.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Keep your finger out of the moving bits and try not to point the hot end at anything you're emotionally attached to.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "You'll figure it out."),
    ],
    action: "complete_mission",
  },
  [DIALOGUE_IDS.tansyAfterClaim]: {
    id: DIALOGUE_IDS.tansyAfterClaim,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "When you get that ship flying again, you're going to have to tell me where you were headed.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "For now, learn how to use the Cutter without removing any of your limbs.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyCapacitySlots]: {
    id: DIALOGUE_IDS.tansyCapacitySlots,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.concerned, "Hold up. You've got nowhere to put this."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "I'm not handing you a cutter just so you can balance it on top of everything else.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "Make some room. It'll still be here."),
    ],
  },
  [DIALOGUE_IDS.tansyCapacityMass]: {
    id: DIALOGUE_IDS.tansyCapacityMass,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.concerned, "Nope. You're already carrying too much."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "This thing isn't light, and I'm not adding ‘crushed by own inventory’ to today's problems.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "Free up some weight and come back. I'll hold onto it."),
    ],
  },
  [DIALOGUE_IDS.tansyAfterCompletion]: {
    id: DIALOGUE_IDS.tansyAfterCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.concerned, "Still have all your fingers?"),
      tansyLocal(EXPRESSION_IDS.smile, "Good! We'll make a miner out of you yet!"),
      tansyLocal(EXPRESSION_IDS.smile, "Come back once something interesting has happened."),
    ],
  },
} as const satisfies Record<DialogueId, DialogueSequence>;

/** Ordered authoritative dialogue catalog consumed by the RuneSpace adapter. */
export const DIALOGUE_SEQUENCES = Object.values(dialogue);

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
