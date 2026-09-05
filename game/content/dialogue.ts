import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  NPC_IDS,
  SKILL_IDS,
  type ConversationBackgroundId,
  type DialogueId,
  type ExpressionId,
  type ItemId,
  type NpcId,
  type SkillId,
} from "@/game/config/foundations";
import type { MissionState } from "@/game/domain/missions";
import {
  MISSIONS,
  getMission,
  type MissionDefinition,
  type MissionRequirementKind,
} from "./missions";
import { getItemPresentation } from "./item-presentation";
import { getSkillPresentation } from "./skill-presentation";
import { getNpc, resolveNpcExpression } from "./npcs";

export type DialoguePresentationMode = "local" | "comms";

/**
 * A dialogue beat presents exactly one visual subject over a conversation
 * background: an NPC portrait, an item reveal, or a skill-XP reward tile.
 * Item and skill-XP beats are presentation only — they never grant, remove,
 * or mutate inventory or progression.
 */
export type DialogueBeat =
  | {
      kind: "npc";
      speakerNpcId: NpcId;
      expressionId: ExpressionId;
      backgroundId: ConversationBackgroundId;
      presentationMode: DialoguePresentationMode;
      text: string;
    }
  | {
      kind: "item";
      itemId: ItemId;
      /** Display quantity only; constrained by the item's authoritative definition. */
      quantity: number;
      backgroundId: ConversationBackgroundId;
      text: string;
    }
  | {
      kind: "skill_xp";
      skillId: SkillId;
      /** Display amount only; the authoritative command already granted it. */
      amount: number;
      backgroundId: ConversationBackgroundId;
      text: string;
    };

export type DialogueSequence = {
  id: DialogueId;
  npcId: NpcId;
  beats: readonly DialogueBeat[];
  action?: "accept_mission" | "complete_mission";
  /**
   * Mission-specific action copy shown on the terminal control when the
   * sequence has an action. Authored per sequence (e.g. "Claim Cutter" for
   * Walk It Off's Cutter claim, "SHOW SHALE" for Cut Your Teeth's turn-in).
   * Falls back to a generic label only when omitted.
   */
  actionLabel?: string;
};

const crash = CONVERSATION_BACKGROUND_IDS.crashSiteExterior;
const jag = CONVERSATION_BACKGROUND_IDS.theJagExterior;

function wadeLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.wadeRusk,
    expressionId,
    backgroundId: crash,
    presentationMode: "local",
    text,
  };
}

function wadeComms(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.wadeRusk,
    expressionId,
    backgroundId: crash,
    presentationMode: "comms",
    text,
  };
}

function tansyLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.tansyRusk,
    expressionId,
    backgroundId: jag,
    presentationMode: "local",
    text,
  };
}

/** Item beats present an already-owned/already-granted item; they never mutate inventory. */
function itemBeat(itemId: ItemId, quantity: number, text = ""): DialogueBeat {
  return { kind: "item", itemId, quantity, backgroundId: jag, text };
}

/**
 * Skill-XP beats present an already-awarded XP amount; they never grant
 * progression. The tile reuses the production Mining/Refining VisualTile
 * presentation (XP fallback, skill nameplate, +N badge).
 */
function tansySkillXpBeat(skillId: SkillId, amount: number): DialogueBeat {
  return { kind: "skill_xp", skillId, amount, backgroundId: jag, text: "" };
}

function wadeSkillXpBeat(skillId: SkillId, amount: number): DialogueBeat {
  return { kind: "skill_xp", skillId, amount, backgroundId: crash, text: "" };
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
  [DIALOGUE_IDS.wadeWalkItOffActiveFollowUp]: {
    id: DIALOGUE_IDS.wadeWalkItOffActiveFollowUp,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "She's at The Jag. That's past The Long Scramble — it'll take you a bit to get there.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Keep an eye out while you walk. Scavenging turns up useful finds on the way, if you pay attention.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Don't get distracted. Tansy doesn't like waiting, and I'm not getting any younger.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadePostCutYourTeeth]: {
    id: DIALOGUE_IDS.wadePostCutYourTeeth,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "So Tansy taught you how to run the Cutter. Good."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "If you can pull Ferrite on your own, you're past the hardest part of the early work. The ship still needs a lot, but at least you're not starting from zero.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Don't get comfortable. There's more ahead — we'll get to it when you're ready.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyPostCutYourTeeth]: {
    id: DIALOGUE_IDS.tansyPostCutYourTeeth,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "You kept the shale? Good. You'll need it soon enough."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "You know how to handle the Cutter now — that's the basics sorted. The rest builds on that.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "Stick around. There'll be more work when you want it."),
    ],
  },
  [DIALOGUE_IDS.wadePostWasteNot]: {
    id: DIALOGUE_IDS.wadePostWasteNot,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Waste Not was a good first pass. You saw the process through.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Keep the basics close. There is plenty of wreck work left, but the next job can wait until it is clear.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyPostWasteNot]: {
    id: DIALOGUE_IDS.tansyPostWasteNot,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "You finished the Cutter lesson and the hopper run."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "The basics are in place now. Keep what you learned close; the wreck will still be here when there is another useful job.",
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
    actionLabel: "Claim Cutter",
  },
  [DIALOGUE_IDS.tansyAfterClaim]: {
    id: DIALOGUE_IDS.tansyAfterClaim,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      // Presentation only: the Cutter has already been granted by the
      // authoritative completion transaction when this sequence becomes visible.
      itemBeat(ITEM_IDS.salvageCutter, 1),
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
  [DIALOGUE_IDS.tansyCutYourTeethOffer]: {
    id: DIALOGUE_IDS.tansyCutYourTeethOffer,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      // Issue #110 amendment: Tansy's useful post-Walk-It-Off beats lead into
      // this offer instead of surviving as a separate dead-end idle branch.
      tansyLocal(EXPRESSION_IDS.concerned, "Still have all your fingers?"),
      tansyLocal(EXPRESSION_IDS.smile, "Good! We'll make a miner out of you yet!"),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "All right. First lesson: that Cutter does more work equipped than it does sitting in your Inventory.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Put it in your mining-tool slot, then bring me a full stack of Ferrite Shale.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "Ten pieces, if you're counting."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Before you bring it back, make five real Mining attempts at The Jag. A miss still counts; I need you to learn the loop, not win five times.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "The Shale itself is source-agnostic. If you scavenge some along the way, it can fill the stack, but it does not replace those five Mining attempts.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Bring me a full stack after the practice. Keep your fingers attached and I'll call it a pass.",
      ),
    ],
    action: "accept_mission",
  },
  [DIALOGUE_IDS.tansyCutYourTeethEquipReminder]: {
    id: DIALOGUE_IDS.tansyCutYourTeethEquipReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Cutter's still in your Inventory. Equip it first. Tools work better when they're not in a bag.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyCutYourTeethMiningReminder]: {
    id: DIALOGUE_IDS.tansyCutYourTeethMiningReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "The Cutter is equipped. Now make five real Mining attempts at The Jag. Misses still teach the lesson.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyCutYourTeethStackReminder]: {
    id: DIALOGUE_IDS.tansyCutYourTeethStackReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "I need to see one full stack. Ten pieces of Ferrite Shale.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Put that Salvage Cutter in your Mining Tool slot and work The Jag until you've got them.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "You'll miss plenty at first. Keep at it. The better you get at Mining, the more often the Cutter bites.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "If you scavenge a few along the way, they still count. Won't teach you much about Mining, though.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Bring me ten. I only need to see them — you keep the shale.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyCutYourTeethBusy]: {
    id: DIALOGUE_IDS.tansyCutYourTeethBusy,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "You've got the full stack on you already. Finish what you're doing and I'll take a look.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyCutYourTeethTurnIn]: {
    id: DIALOGUE_IDS.tansyCutYourTeethTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [tansyLocal(EXPRESSION_IDS.neutral, "Got the full stack? Let me see.")],
    action: "complete_mission",
    actionLabel: "SHOW SHALE",
  },
  [DIALOGUE_IDS.tansyCutYourTeethCompletion]: {
    id: DIALOGUE_IDS.tansyCutYourTeethCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      // Presentation only: the authoritative completion transaction has
      // already awarded the Mining XP when this sequence becomes visible.
      // Neither beat consumes shale or grants XP.
      itemBeat(ITEM_IDS.ferriteShale, 10),
      tansySkillXpBeat(SKILL_IDS.mining, 100),
      tansyLocal(EXPRESSION_IDS.smile, "Yep. That's shale."),
      tansyLocal(EXPRESSION_IDS.neutral, "Keep it. You're going to need it."),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "You can run a Cutter. Next we'll teach you what to do with the stuff that comes out.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Mining pulls the raw material out. Refining is what turns the useful parts into something Wade can work with.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Take the shale to the Abandoned Processing Yard. The hopper uses two pieces per attempt, and I want five attempts.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "A success makes Refined Ferrite. A failure makes Slag. Both count, and you keep the Slag — it is still useful material.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeWasteNotTrackedActivityReminder]: {
    id: DIALOGUE_IDS.wadeWasteNotTrackedActivityReminder,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Tansy sent you to the Abandoned Processing Yard. Finish five Refining attempts, then come back and report.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeWasteNotBusy]: {
    id: DIALOGUE_IDS.wadeWasteNotBusy,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Finish what you are doing first. I will hear the Processing Yard report when you are stationary.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeWasteNotTurnIn]: {
    id: DIALOGUE_IDS.wadeWasteNotTurnIn,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "Tansy says you made the Processing Yard run."),
      wadeLocal(EXPRESSION_IDS.neutral, "All right. Tell me what came out of the hopper."),
    ],
    action: "complete_mission",
    actionLabel: "REPORT TO WADE",
  },
  [DIALOGUE_IDS.wadeWasteNotCompletion]: {
    id: DIALOGUE_IDS.wadeWasteNotCompletion,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeSkillXpBeat(SKILL_IDS.refining, 100),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Tansy taught you the hopper, and you brought the results back without wasting the useful material.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Keep the Slag. If it came out of the process, it has a use somewhere on a wreck like this.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "The Refined Ferrite will help when we get back to the ship. For now, that is a solid start on the wreck work ahead.",
      ),
    ],
  },
} as const satisfies Record<DialogueId, DialogueSequence>;

/** Ordered authoritative dialogue catalog consumed by the RuneSpace adapter. */
export const DIALOGUE_SEQUENCES = Object.values(dialogue);

export function getDialogue(dialogueId: string): DialogueSequence | undefined {
  return dialogue[dialogueId as DialogueId];
}

/**
 * The semantic mission-state surface the dialogue router consumes. Projections
 * arrive in authored registry order; routing scans newest-first. Routing is
 * driven exclusively by this semantic state — never by parsing objective copy
 * and never by hard-coded mission-ID chains in UI code.
 */
export type NpcDialogueProjection = {
  missionId: string;
  state: MissionState;
  prerequisiteSatisfied: boolean;
  stage?: {
    requirementsSatisfied: boolean;
    turnInAvailable: boolean;
    nextObjectiveKind?: MissionRequirementKind;
  };
};

export type NpcDialogueResolution = {
  sequence: DialogueSequence;
  /** The mission whose accept/complete command this conversation drives. */
  missionId: string;
  /**
   * Offer-only: authored continuation shown immediately after acceptance at
   * this offer (e.g. the remote-acceptance follow-up that leads straight to
   * the Cutter claim).
   */
  acceptedContinuationDialogueId?: DialogueId;
};

/**
 * One generic semantic router for every ordinary mission's NPC conversations.
 * Authored sequences stay content; this mapping keys them off projected
 * mission state:
 *
 * 1. OFFERS (newest mission first): a not-yet-accepted mission whose
 *    prerequisite is satisfied and which authors an offer at this NPC offers
 *    that sequence. This is how the chain advances — the next mission's offer
 *    appears as soon as the previous one completes.
 * 2. ACTIVE (newest first): for the turn-in NPC, stage branches select the
 *    turn-in, busy, or requirement-reminder sequences; for other offer NPCs,
 *    their authored activeDialogueId is used.
 * 3. COMPLETED (newest first): ordinary post-completion story dialogue wins
 *    over the one-shot completion presentation. The newest completed mission
 *    that authors dialogue for this NPC via completedNpcDialogue is selected;
 *    presentation is shown only via the transient override immediately after success.
 */
export function resolveNpcMissionDialogue(
  npcId: string,
  projections: readonly NpcDialogueProjection[],
): NpcDialogueResolution | undefined {
  return resolveNpcMissionDialogueWithDefinitions(npcId, projections, MISSIONS);
}

/**
 * Pure routing helper that resolves against an explicit ordered definition
 * list. Production callers use `resolveNpcMissionDialogue` (which injects
 * `MISSIONS`); tests inject synthetic ordered definitions to prove generic
 * fallback/win semantics without adding player-visible fake missions.
 */
export function resolveNpcMissionDialogueWithDefinitions(
  npcId: string,
  projections: readonly NpcDialogueProjection[],
  definitions: readonly MissionDefinition[],
): NpcDialogueResolution | undefined {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const newestFirst = [...projections].reverse();

  // 1. Offers.
  for (const projection of newestFirst) {
    if (projection.state !== "not_accepted" || !projection.prerequisiteSatisfied) continue;
    const definition = byId.get(projection.missionId);
    const offer = definition?.offers.find((candidate) => candidate.npcId === npcId);
    if (!definition || !offer) continue;
    const sequence = getDialogue(offer.dialogueId);
    if (!sequence) continue;
    return {
      sequence,
      missionId: definition.id,
      acceptedContinuationDialogueId: offer.acceptedContinuationDialogueId,
    };
  }

  // 2. Active missions.
  for (const projection of newestFirst) {
    if (projection.state !== "active" && projection.state !== "ready_for_completion") continue;
    const definition = byId.get(projection.missionId);
    if (!definition) continue;
    if (definition.turnIn.npcId === npcId) {
      const sequence = turnInStageSequence(definition, projection.stage);
      if (sequence) return { sequence, missionId: definition.id };
      continue;
    }
    const offer = definition.offers.find((candidate) => candidate.npcId === npcId);
    const activeId = offer?.activeDialogueId;
    const sequence = activeId ? getDialogue(activeId) : undefined;
    if (sequence) return { sequence, missionId: definition.id };
  }

  // 3. Completed missions — ordinary story-state dialogue (newest authored win).
  for (const projection of newestFirst) {
    if (projection.state !== "completed") continue;
    const definition = byId.get(projection.missionId);
    if (!definition) continue;
    const entry = definition.completedNpcDialogue?.find((candidate) => candidate.npcId === npcId);
    if (entry) {
      const sequence = getDialogue(entry.dialogueId);
      if (sequence) return { sequence, missionId: definition.id };
      continue;
    }
  }

  return undefined;
}

/** Selects the turn-in NPC's authored sequence from semantic stage data. */
function turnInStageSequence(
  definition: NonNullable<ReturnType<typeof getMission>>,
  stage: NpcDialogueProjection["stage"],
): DialogueSequence | undefined {
  const turnIn = getDialogue(definition.turnIn.dialogueId);
  if (!stage) return turnIn;
  if (stage.turnInAvailable) return turnIn;
  if (stage.requirementsSatisfied) {
    return dialogueOr(definition.dialogue.busyDialogueId, turnIn);
  }
  if (stage.nextObjectiveKind === "equipped_item") {
    return dialogueOr(definition.dialogue.equipmentReminderDialogueId, turnIn);
  }
  if (stage.nextObjectiveKind === "carried_stack") {
    return dialogueOr(definition.dialogue.carriedReminderDialogueId, turnIn);
  }
  if (stage.nextObjectiveKind === "tracked_activity") {
    return dialogueOr(definition.dialogue.trackedActivityReminderDialogueId, turnIn);
  }
  return turnIn;
}

function dialogueOr(dialogueId: DialogueId | undefined, fallback?: DialogueSequence) {
  return (dialogueId ? getDialogue(dialogueId) : undefined) ?? fallback;
}

/** Authored item-reward capacity refusal dialogue, if any. */
export function getMissionCapacityRefusalDialogue(
  missionId: string,
  capacityReason: "slots" | "mass",
): DialogueSequence | undefined {
  const definition = getMission(missionId);
  const dialogueId =
    capacityReason === "slots"
      ? definition?.dialogue.capacitySlotsDialogueId
      : definition?.dialogue.capacityMassDialogueId;
  return dialogueId ? getDialogue(dialogueId) : undefined;
}

/** Authored presentation-only completion beats revealed after authoritative success. */
export function getMissionCompletionPresentation(missionId: string): DialogueSequence | undefined {
  const definition = getMission(missionId);
  const dialogueId = definition?.dialogue.completionPresentationDialogueId;
  return dialogueId ? getDialogue(dialogueId) : undefined;
}

export function resolveDialogueSpeaker(dialogueBeat: DialogueBeat) {
  if (dialogueBeat.kind !== "npc") return undefined;
  const npc = getNpc(dialogueBeat.speakerNpcId);
  const expressionAsset = resolveNpcExpression(
    dialogueBeat.speakerNpcId,
    dialogueBeat.expressionId,
  );
  if (!npc || !expressionAsset) return undefined;
  return { npc, expressionAsset };
}

/**
 * Resolves an item beat against the authoritative item presentation catalog.
 * Returns undefined for other subject kinds or unknown item IDs so callers
 * fail safe.
 */
export function resolveDialogueItem(dialogueBeat: DialogueBeat) {
  if (dialogueBeat.kind !== "item") return undefined;
  const presentation = getItemPresentation(dialogueBeat.itemId);
  if (!presentation) return undefined;
  return { itemId: dialogueBeat.itemId, quantity: dialogueBeat.quantity, presentation };
}

/**
 * Resolves a skill-XP beat against the authoritative skill presentation
 * registry. Returns undefined for other subject kinds or unknown skill IDs so
 * callers fail safe.
 */
export function resolveDialogueSkillXp(dialogueBeat: DialogueBeat) {
  if (dialogueBeat.kind !== "skill_xp") return undefined;
  const presentation = getSkillPresentation(dialogueBeat.skillId);
  if (!presentation) return undefined;
  return { skillId: dialogueBeat.skillId, amount: dialogueBeat.amount, presentation };
}
