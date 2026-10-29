import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  MERCHANT_IDS,
  NPC_IDS,
  SKILL_IDS,
  SKILL_LEVEL_DIALOGUE_IDS,
  type ConversationBackgroundId,
  type DialogueId,
  type ExpressionId,
  type ItemId,
  type NpcId,
  type SkillId,
  type SkillLevelDialogueId,
} from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { tinkeringScrapYield } from "@/game/domain/tinkering";
import { getItemPresentation } from "./item-presentation";
import { merchantBuybackPrice, merchantRetailPrice } from "./merchants";
import {
  FIRST_RESONANCE_ECHO_GIFT_SEEKERS,
  FIRST_RESONANCE_ECHO_REWARD_XP,
  KEEP_THE_CHANGE_BUDGET_CREDITS,
} from "./missions";
import { spelledNumber, spelledNumberCapitalized } from "./spelled-numbers";
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
      /**
       * This beat presents a reward's full awarded total, aggregated across
       * however many carried stacks Inventory's own stack limit actually split
       * it into (#207 follow-up) — never one beat per persisted stack. Set only
       * by `rewardItemBeats`. Inventory persistence still obeys the real stack
       * limit exactly as before; this only relaxes the authoring-time sanity
       * ceiling on displayed quantity, since the number here is a reward total
       * rather than one physical stack's worth.
       */
      isRewardTotal?: true;
    }
  | {
      kind: "skill_xp";
      skillId: SkillId;
      /** Display amount only; the authoritative command already granted it. */
      amount: number;
      backgroundId: ConversationBackgroundId;
      text: string;
    };

/**
 * An authored dialogue sequence is presentation content and nothing else: an
 * ordered list of beats spoken/presented by one NPC. Mission action semantics
 * (accept / turn in, and the authored control copy) are NOT stored here — they
 * belong to the Mission-derived conversation metadata resolved in
 * `game/domain/conversation.ts`, so a social topic can never accidentally carry
 * a Mission command and dialogue prose can never determine gameplay truth.
 */
export type DialogueSequence = {
  id: DialogueId;
  npcId: NpcId;
  /**
   * Set when this conversation is the NPC standing in front of the player right
   * now rather than a scene that happened somewhere specific (#190).
   *
   * An authored beat always carries the background it was written against, and
   * that stays true for every scene and every comms call: a person moving must
   * never retroactively relocate the beats they already spoke. But a replayable
   * topic or a post-Mission follow-up is a conversation the player is having
   * here, today — so when the speaker has moved, its local beats present against
   * the venue that person is actually in. Nothing is persisted: the venue is
   * resolved from the same Mission-derived placement that decides where they
   * stand (`resolveNpcVenueBackgroundId`).
   */
  presentsAtCurrentVenue?: true;
  /**
   * How many opening beats play before a confirmed Credits receipt that leads
   * this sequence (#292). Placement only: it can never create a payout tile,
   * which still exists solely from the server's `creditsPaid` receipt (#290).
   * Absent means the tile opens the sequence. Curly hands the money over in
   * his first line, so his tile follows it.
   */
  creditsReceiptAfterBeats?: number;
  /**
   * Skill-level-dependent dialogue (#391): after this sequence's own beats, the
   * conversation continues with the one variant of this authored choice that the
   * character's current level selects (`SKILL_LEVEL_DIALOGUES`). Presentation
   * only. A sequence that is nothing but the choice — a topic whose whole subject
   * is the level-dependent advice — authors no beats of its own.
   */
  skillLevelDialogueId?: SkillLevelDialogueId;
  beats: readonly DialogueBeat[];
};

/**
 * Skill-level-dependent dialogue (#391): one authored choice between ordinary
 * sequences by the character's level in one skill. It is a content decision,
 * not a scripting language — one skill, ascending thresholds, nothing else — and
 * it changes no game state: it only picks which already-authored lines are
 * spoken. `docs/npc-conversations.md` ("Skill-level-dependent dialogue") is the
 * authoring recipe.
 *
 * - `variants` are ordinary sequences of the same NPC, lowest threshold first.
 *   The first is `minimumLevel: 1`: the fallback for every level, including a
 *   character with no XP row in the skill (which is Level 1).
 * - A variant applies from its `minimumLevel` up to the next variant's.
 * - Any sequence invokes the choice with `skillLevelDialogueId`; several may
 *   invoke the same one, so the lines are authored once.
 * - The server selects the variant from the character's authoritative level on
 *   every Play state (`PlayGameplayState.skillLevelDialogue`), so reopening the
 *   conversation after levelling up plays the new variant.
 */
export type SkillLevelDialogue = {
  id: SkillLevelDialogueId;
  npcId: NpcId;
  skillId: SkillId;
  variants: readonly { minimumLevel: number; dialogueId: DialogueId }[];
};

// Tansy's Tinkering demonstration (#232) shows what one Salvage Cutter breaks
// down into, from the same universal rule the player's own Tinkering uses, so
// the teaching number can never disagree with the station.
const DEMONSTRATION_SCRAP = tinkeringScrapYield(
  getEffectiveGameBalance().fabrication.recipes.salvageCutter,
);

// Shop prices quoted in dialogue (#230) are read from the merchant registry and
// spelled out here, never restated: a price change updates every line that
// names it, and no line can keep quoting a price the shop no longer charges.
const CELL_PRICE = merchantRetailPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.powerCell);
const CELL_BUYBACK = merchantBuybackPrice(MERCHANT_IDS.bixWeller, ITEM_IDS.powerCell);
const SCRAP_PRICE = merchantRetailPrice(MERCHANT_IDS.wadeRusk, ITEM_IDS.scrapMetal);

const crash = CONVERSATION_BACKGROUND_IDS.crashSiteExterior;
const jag = CONVERSATION_BACKGROUND_IDS.theJagExterior;
const bixShop = CONVERSATION_BACKGROUND_IDS.holoHollowSouvenirsInterior;
const assistanceCenter = CONVERSATION_BACKGROUND_IDS.holoHollowAssistanceCenterInterior;
const bnb = CONVERSATION_BACKGROUND_IDS.hhBnbInterior;
const ruskYard = CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard;
const lastLegShop = CONVERSATION_BACKGROUND_IDS.lastLegTradingInterior;
const hilltopWorkshop = CONVERSATION_BACKGROUND_IDS.hilltopWorkshopInterior;
const wernersLab = CONVERSATION_BACKGROUND_IDS.wernersLabInterior;
// Curly's room before and after his mount is installed (#292). The unfinished
// room resolves to the finished one from the mount's own completion, so a beat
// authored against it always shows the room as it currently is.
const curlyRoom = CONVERSATION_BACKGROUND_IDS.curlyRoomBefore;
const curlyRoomFinished = CONVERSATION_BACKGROUND_IDS.curlyRoomAfter;

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

/**
 * Wade at his own yard (#190). His Crash Site beats keep the Crash Site
 * background: where a conversation happened is authored per beat, so a person
 * moving is simply new beats in the new place — never a dynamic background
 * system that would retroactively relocate the beats he already spoke.
 */
function wadeAtYard(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.wadeRusk,
    expressionId,
    backgroundId: ruskYard,
    presentationMode: "local",
    text,
  };
}

/** Wade calling in from the yard, shown against his own place. */
function wadeCommsFromYard(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.wadeRusk,
    expressionId,
    backgroundId: ruskYard,
    presentationMode: "comms",
    text,
  };
}

function tollLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.tollKade,
    expressionId,
    backgroundId: lastLegShop,
    presentationMode: "local",
    text,
  };
}

function wernerLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.werner,
    expressionId,
    backgroundId: wernersLab,
    presentationMode: "local",
    text,
  };
}

function enbyLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.wiseOldEnby,
    expressionId,
    backgroundId: hilltopWorkshop,
    presentationMode: "local",
    text,
  };
}

/** Something the Enby hands over, shown at their workshop (#393). Presentation only. */
function enbyItem(itemId: ItemId, quantity: number): DialogueBeat {
  return { kind: "item", itemId, quantity, backgroundId: hilltopWorkshop, text: "" };
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

/**
 * Tansy at Wade's yard, for her Fabrication chapter (#232). Where a
 * conversation happened is authored per beat, so her scenes at Rusk Recovery
 * carry the yard and her Jag beats keep The Jag.
 */
function tansyAtYard(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.tansyRusk,
    expressionId,
    backgroundId: ruskYard,
    presentationMode: "local",
    text,
  };
}

function bixLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.bixWeller,
    expressionId,
    backgroundId: bixShop,
    presentationMode: "local",
    text,
  };
}

/**
 * Tansy calling in remotely from the seam. Like `wadeComms`, a remote caller is
 * shown against their own location — The Jag — with the comms treatment
 * carrying the distance.
 */
function tansyComms(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.tansyRusk,
    expressionId,
    backgroundId: jag,
    presentationMode: "comms",
    text,
  };
}

/**
 * Mara during her authored appearance in Bix's shop (#170). She is a guest in
 * his scene — one authored beat speaker, not a second resident of the shop.
 */
function maraAtBixShop(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.maraKells,
    expressionId,
    backgroundId: bixShop,
    presentationMode: "local",
    text,
  };
}

function maraLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.maraKells,
    expressionId,
    backgroundId: bnb,
    presentationMode: "local",
    text,
  };
}

function curlyLocal(
  expressionId: ExpressionId,
  text: string,
  backgroundId: ConversationBackgroundId = curlyRoom,
): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.curly,
    expressionId,
    backgroundId,
    presentationMode: "local",
    text,
  };
}

function curlyFinished(expressionId: ExpressionId, text: string): DialogueBeat {
  return curlyLocal(expressionId, text, curlyRoomFinished);
}

function rennLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.rennCalder,
    expressionId,
    backgroundId: assistanceCenter,
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
 * progression. The tile is the shared `SkillXpTile` the Mining and Refining
 * results also use (XP medallion, skill nameplate and accent, +N badge).
 */
function tansySkillXpBeat(skillId: SkillId, amount: number): DialogueBeat {
  return { kind: "skill_xp", skillId, amount, backgroundId: jag, text: "" };
}

function wadeSkillXpBeat(skillId: SkillId, amount: number): DialogueBeat {
  return { kind: "skill_xp", skillId, amount, backgroundId: crash, text: "" };
}

/** Wade's reward tile at his own yard (#322), against the place he is standing in. */
function wadeAtYardSkillXpBeat(skillId: SkillId, amount: number): DialogueBeat {
  return { kind: "skill_xp", skillId, amount, backgroundId: ruskYard, text: "" };
}

/**
 * One item beat per distinct item in a reward, showing the true awarded
 * total regardless of how many carried stacks Inventory's own stack limit
 * actually split it into (#207 follow-up). A ten-Ferrite reward is one
 * beat reading ×10, never two beats of ×5 because Refined Ferrite's stack
 * limit happens to be five — that split is Inventory's business, and the
 * player should never have to click through it twice for one reward.
 *
 * Reusable for any multi-item reward reveal, not a Wade-only special case:
 * a future author lists what was actually granted and this aggregates it,
 * rather than hand-splitting beats to match persistence.
 */
function rewardItemBeats(
  backgroundId: ConversationBackgroundId,
  items: readonly { itemId: ItemId; quantity: number }[],
): DialogueBeat[] {
  const totals = new Map<ItemId, number>();
  for (const item of items) {
    totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + item.quantity);
  }
  return Array.from(totals, ([itemId, quantity]) => ({
    kind: "item" as const,
    itemId,
    quantity,
    backgroundId,
    text: "",
    isRewardTotal: true as const,
  }));
}

function rennSkillXpBeat(skillId: SkillId, amount: number): DialogueBeat {
  return { kind: "skill_xp", skillId, amount, backgroundId: assistanceCenter, text: "" };
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
    // Wade says this wherever Wade currently is (#190).
    presentsAtCurrentVenue: true,
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
  [DIALOGUE_IDS.wadeCutYourTeethActive]: {
    id: DIALOGUE_IDS.wadeCutYourTeethActive,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "You're a long way from The Jag."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Unless you're wandering on purpose. Scavenging. Loose parts turn up in strange places.",
      ),
      wadeLocal(EXPRESSION_IDS.scowl, "...No. You're lost."),
      wadeLocal(EXPRESSION_IDS.neutral, "Yeah. That's probably it."),
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
    // Wade says this wherever Wade currently is (#190).
    presentsAtCurrentVenue: true,
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
        "I don't care where the Shale comes from. If you scavenge some along the way, it can fill the stack, but it does not replace those five Mining attempts.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Bring me a full stack after the practice. Keep your fingers attached and I'll call it a pass.",
      ),
    ],
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
  [DIALOGUE_IDS.tansyWasteNotActive]: {
    id: DIALOGUE_IDS.tansyWasteNotActive,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "The hopper's at the Abandoned Processing Yard. Make five Refining attempts, then report back to Wade.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyHoldItTogetherActive]: {
    id: DIALOGUE_IDS.tansyHoldItTogetherActive,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Heard Wade put you on the Cargo Hold. Don't get cute with the welds. Clean seams, steady heat, and let the Ferrite do its job.",
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
        "The Refined Ferrite and Slag are ready for the next job. Hold It Together is yours now: get the Cargo Hold sealed, then report back.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeHoldItTogetherRepairReminder]: {
    id: DIALOGUE_IDS.wadeHoldItTogetherRepairReminder,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "The Cargo Hold is still buckled. Install the repair materials at the crash site, then weld the frame until it locks.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "The repair system records the exact material contribution and each Welding pass. Get the Hold operational, then report back to me.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeHoldItTogetherBusy]: {
    id: DIALOGUE_IDS.wadeHoldItTogetherBusy,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Finish the active work first. I will take the Cargo Hold report when you are stationary.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeHoldItTogetherTurnIn]: {
    id: DIALOGUE_IDS.wadeHoldItTogetherTurnIn,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "The Hold is back together? Let me see the repair status."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "All right. That storage is ready for the wreck work ahead.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeHoldItTogetherCompletion]: {
    id: DIALOGUE_IDS.wadeHoldItTogetherCompletion,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeSkillXpBeat(SKILL_IDS.welding, 100),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "The Cargo Hold is operational. You installed the material, learned the timing, and finished the job cleanly.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadePostHoldItTogether]: {
    id: DIALOGUE_IDS.wadePostHoldItTogether,
    npcId: NPC_IDS.wadeRusk,
    // Wade says this wherever Wade currently is (#190).
    presentsAtCurrentVenue: true,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "The Cargo Hold is holding. That gives us room to work."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Keep the Welding lesson in mind. Wreck work gets easier when the basics stay reliable.",
      ),
    ],
  },

  // ---- Keep the Change (#170) ----------------------------------------------
  // Wade's apprenticeship job. The opening scene carries the post-repair beat
  // itself — Wade acknowledges the Cargo Hold worked and makes the player his
  // apprentice — so nothing forces a separate conversation between the two.

  [DIALOGUE_IDS.wadeKeepTheChangeOffer]: {
    id: DIALOGUE_IDS.wadeKeepTheChangeOffer,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "Cargo Hold's still holding. I checked the seams myself."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "You showed up, you listened, and you finished it. That is rarer than it ought to be.",
      ),
      wadeLocal(EXPRESSION_IDS.neutral, "So you're my apprentice now. I'm not asking."),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Don't look pleased. It mostly means you get the jobs I don't want to do twice.",
      ),
      tansyComms(EXPRESSION_IDS.concerned, "Wade. Wade, pick up."),
      tansyComms(
        EXPRESSION_IDS.concerned,
        "I'm dry on Power Cells. Completely dry. The Cutter's a very heavy stick out here.",
      ),
      tansyComms(EXPRESSION_IDS.neutral, "Three would get me through the rest of this seam."),
      wadeLocal(EXPRESSION_IDS.neutral, "I've got none in the crate. I checked this morning."),
      tansyComms(
        EXPRESSION_IDS.smile,
        "Oh. Okay. Could someone bring me three? I'd really rather not lose the afternoon walking back.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        `Tansy needs three Power Cells. Bix charges ${spelledNumber(CELL_PRICE)} Credits each. Here's ${spelledNumber(KEEP_THE_CHANGE_BUDGET_CREDITS)} Credits.`,
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "If you've already got some, or you know a cheaper way, good. Keep what you don't spend.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Still go see Bix. You're working out of Holo Hollow now. You ought to know who keeps the useful stuff on a shelf.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Cells go to Tansy at The Jag. She's the one sitting on a dead tool, not me.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeKeepTheChangeActive]: {
    id: DIALOGUE_IDS.wadeKeepTheChangeActive,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Tansy's still waiting. Three Power Cells, at The Jag, however you come by them.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "And see Bix while you're in town. That part isn't a suggestion.",
      ),
    ],
  },
  [DIALOGUE_IDS.bixKeepTheChangeIntroduction]: {
    id: DIALOGUE_IDS.bixKeepTheChangeIntroduction,
    npcId: NPC_IDS.bixWeller,
    beats: [
      bixLocal(EXPRESSION_IDS.neutral, "So you're the one who came down out of the sky."),
      bixLocal(EXPRESSION_IDS.amused, "And Wade's already got you running errands. That was fast."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        `Three Power Cells. ${spelledNumberCapitalized(CELL_PRICE)} Credits each. ${spelledNumberCapitalized(KEEP_THE_CHANGE_BUDGET_CREDITS)} Credits.`,
      ),
      bixLocal(EXPRESSION_IDS.amused, "Let me guess. That's exactly what Wade handed you."),
      bixLocal(EXPRESSION_IDS.amused, "No delivery tip. That's Wade."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Before you spend it, though — the Annex'll issue you five Cells per local day.",
      ),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Back when projector nights filled every room in town, Settled Systems required an emergency power depot.",
      ),
      bixLocal(EXPRESSION_IDS.neutral, "DeWhat? got the contract."),
      bixLocal(EXPRESSION_IDS.amused, "Tourists left. Contract didn't."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Five per person, per local day. Enough to keep heat, comms, or a tool alive until somebody got help.",
      ),
      bixLocal(EXPRESSION_IDS.amused, "Limit keeps one enterprising idiot from emptying the rack."),
      bixLocal(EXPRESSION_IDS.concerned, "And yes, I still sell them."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "The Annex gives you five. It gives me five. That doesn't stock a store.",
      ),
      bixLocal(
        EXPRESSION_IDS.neutral,
        `Need another one? ${spelledNumberCapitalized(CELL_PRICE)} Credits. Got extras? I'll give you ${spelledNumber(CELL_BUYBACK)} Credits each.`,
      ),
      bixLocal(EXPRESSION_IDS.amused, "That's called a store."),
      maraAtBixShop(EXPRESSION_IDS.amused, "Morning, Bix. How's business?"),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Hey Mara. Have you met the crash survivor? Wade has decided to make them his apprentice.",
      ),
      maraAtBixShop(EXPRESSION_IDS.amused, "Wade made you his apprentice?"),
      bixLocal(
        EXPRESSION_IDS.amused,
        "Yup. Already sent them on their first errand. Tansy ran out of Power Cells while working The Jag.",
      ),
      maraAtBixShop(EXPRESSION_IDS.amused, "Ahh, you lucky bastard, you."),
      maraAtBixShop(
        EXPRESSION_IDS.firm,
        "Wade can be demanding. But pay attention, and you will learn a lot from him.",
      ),
      maraAtBixShop(
        EXPRESSION_IDS.amused,
        "And hey, if he's putting you to work, maybe you're not a tourist anymore.",
      ),
      maraAtBixShop(
        EXPRESSION_IDS.firm,
        "Get Tansy what she needs first. She's out at The Jag with a dead Cutter while we're standing here yapping.",
      ),
      maraAtBixShop(
        EXPRESSION_IDS.amused,
        "After that, come find me. The B&B's only open for people who work here. That's you now.",
      ),
      bixLocal(EXPRESSION_IDS.amused, "Sounds like you're in, kid."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Tansy's waitin'. Cells are on the shelf if you want to buy them. Annex is up the road if you don't.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyKeepTheChangeConversationReminder]: {
    id: DIALOGUE_IDS.tansyKeepTheChangeConversationReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Wade sent you? Then you've already been told to go see Bix.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Do that part first. He's the one who keeps Cells on a shelf, and he'll know if you skipped him.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyKeepTheChangeCarriedReminder]: {
    id: DIALOGUE_IDS.tansyKeepTheChangeCarriedReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "Three Power Cells. I'm not being dramatic — the Cutter is dead weight without them.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        `Bix sells them for ${spelledNumber(CELL_PRICE)} Credits. The Annex hands out five a day for nothing. Either one works.`,
      ),
    ],
  },
  [DIALOGUE_IDS.tansyKeepTheChangeBusy]: {
    id: DIALOGUE_IDS.tansyKeepTheChangeBusy,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Finish what you're doing. I'll take the Cells when you're standing still.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyKeepTheChangeTurnIn]: {
    id: DIALOGUE_IDS.tansyKeepTheChangeTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "Please tell me those are Cells."),
      tansyLocal(EXPRESSION_IDS.neutral, "Three is exactly right. Hand them over."),
    ],
  },
  [DIALOGUE_IDS.tansyKeepTheChangeCompletion]: {
    id: DIALOGUE_IDS.tansyKeepTheChangeCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      // Presentation only: the authoritative turn-in has already taken the
      // three Power Cells when this sequence becomes visible.
      itemBeat(ITEM_IDS.powerCell, 3),
      tansyLocal(EXPRESSION_IDS.smile, "That's the seam back in business."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "And whatever's left of Wade's money stays in your pocket. That's how the job was supposed to work.",
      ),
      // The handoff (#190): Tansy makes the call, Wade names the next place.
      // Presentation only — it points the player at a yard that has been on the
      // map since the beginning and offers nothing until they walk in.
      tansyLocal(EXPRESSION_IDS.neutral, "Hold on. He should hear this from me."),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Wade. Your apprentice carried three Cells up the Scramble and put my seam back on line.",
      ),
      wadeCommsFromYard(EXPRESSION_IDS.neutral, "...Hm."),
      wadeCommsFromYard(
        EXPRESSION_IDS.neutral,
        "Took the job. Did the job. That's the whole of it.",
      ),
      wadeCommsFromYard(
        EXPRESSION_IDS.neutral,
        "Come by the shop when you're back this way. Rusk Recovery, northwest edge of the Hollow. There's bench time in it for you.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "That was him being proud, in case it went past you."),
    ],
  },
  [DIALOGUE_IDS.wadePostKeepTheChange]: {
    id: DIALOGUE_IDS.wadePostKeepTheChange,
    npcId: NPC_IDS.wadeRusk,
    // Wade says this wherever Wade currently is (#190).
    presentsAtCurrentVenue: true,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "Tansy's cutting again. That's the job done."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "And you met Bix. Next time you need something, you know where it is and what it costs.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        `Whatever's left of that ${spelledNumber(KEEP_THE_CHANGE_BUDGET_CREDITS)} is yours. Don't make a ceremony out of it.`,
      ),
    ],
  },
  [DIALOGUE_IDS.tansyPostKeepTheChange]: {
    id: DIALOGUE_IDS.tansyPostKeepTheChange,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "Still running on your Cells. Thanks for that."),
      tansyLocal(EXPRESSION_IDS.neutral, "Wade is proud of you, you know."),
      tansyLocal(EXPRESSION_IDS.smile, "Though he'd never say it out loud."),
    ],
  },

  // ---- Replayable social topics (#164) -------------------------------------
  // Ordinary NPC conversations. They carry no Mission action, gate nothing,
  // and stay replayable; the player character remains silent throughout.

  [DIALOGUE_IDS.wadeRecoveryWorkTopic]: {
    id: DIALOGUE_IDS.wadeRecoveryWorkTopic,
    npcId: NPC_IDS.wadeRusk,
    // Wade says this wherever Wade currently is (#190).
    presentsAtCurrentVenue: true,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "Recovery work. That's the polite name for it."),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Somebody's bad day lands in the mud, and I decide whether it moves again or gets sold for parts.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Most of it is patience. You look at a wreck long enough and it tells you which half is still worth something.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "I don't build from scratch. I make what's already lying around work again — or work as something else.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Which is why I get irritated when something arrives at speed and makes more work for everyone.",
      ),
      wadeLocal(EXPRESSION_IDS.neutral, "No. I'm not going to stop bringing that up."),
    ],
  },
  [DIALOGUE_IDS.wadeStashMountsTopic]: {
    id: DIALOGUE_IDS.wadeStashMountsTopic,
    npcId: NPC_IDS.wadeRusk,
    // Wade says this wherever Wade currently is (#190), same as his other
    // replayable topics.
    presentsAtCurrentVenue: true,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "You know what wastes more time than hauling equipment around? Hauling equipment around that you don't even need.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "You can weld yourself a stash mount out at The Jag. Install a spare container, leave a few extra Power Cells there. Maybe a backup Cutter. Keep what you need, store what you don't.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Amazing how much more shale you can carry when you're not hauling half a workshop around with you.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Get some more Welding experience and you can put another one at the Processing Yard. That's where it really starts paying off.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Bring in a full load of shale, put a couple of stacks in the stash, and leave yourself some room to work. Good batch gets you Refined Ferrite. Bad one gets you Slag. You'll want room for both.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Unless you're throwing away the Slag. Your business. Just don't come crying to me when you need some.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "One thing. Those stashes aren't connected. Whatever you leave at The Jag stays at The Jag. You'll still have to move it yourself.",
      ),
      wadeLocal(EXPRESSION_IDS.scowl, "I fix machinery. Not geography."),
    ],
  },
  [DIALOGUE_IDS.wadeForceSalesTopic]: {
    id: DIALOGUE_IDS.wadeForceSalesTopic,
    npcId: NPC_IDS.wadeRusk,
    // Wade says this wherever Wade currently is (#190), same as his other
    // replayable topics.
    presentsAtCurrentVenue: true,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "Yeah. ForceSales."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Free tier does what I need. Takes the jobs, keeps the board straight.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Now it says you qualify for enough different work that it'll let you refresh the queue once a day.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "Also says I should contact my Network Administrator about upgrading to Pro.",
      ),
      wadeLocal(EXPRESSION_IDS.neutral, "I am the Network Administrator."),
      wadeLocal(EXPRESSION_IDS.scowl, "No."),
    ],
  },
  // Skatboll planet identity (#402): Wade's version is about the work, not
  // the town — a wreck falls where it falls, and that ground is Skatboll.
  [DIALOGUE_IDS.wadeSkatbollTopic]: {
    id: DIALOGUE_IDS.wadeSkatbollTopic,
    npcId: NPC_IDS.wadeRusk,
    // Wade says this wherever Wade currently is (#190), same as his other
    // replayable topics.
    presentsAtCurrentVenue: true,
    beats: [
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Holo Hollow's a town. Skatboll's the planet. Mix those up and your errand looks a lot shorter than it is.",
      ),
      wadeLocal(
        EXPRESSION_IDS.scowl,
        "A wreck doesn't care what town it's near. It fell where it fell, and that's where I go.",
      ),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Holo Hollow's where you go for parts. Tell me where the wreck is if you want the damn thing fixed.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyMiningTopic]: {
    id: DIALOGUE_IDS.tansyMiningTopic,
    npcId: NPC_IDS.tansyRusk,
    // A replayable topic is Tansy talking where she stands now — at Wade's
    // yard during her Fabrication chapter (#232), at the seam otherwise.
    presentsAtCurrentVenue: true,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "The Jag? It's a seam, not a mine. Big difference."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Whoever got here first carved it out of the hardpan. Calling it a mine's generous, but the shale cuts fine.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Shale comes out in pieces. Some days it comes out clean, some days you swing eleven times for nothing.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "That's not the tool. That's you. The more you work it, the more often it bites.",
      ),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "And keep an eye on your charge. A dead Cutter is a very heavy stick.",
      ),
    ],
  },
  [DIALOGUE_IDS.tansyBeyondHoloHollowTopic]: {
    id: DIALOGUE_IDS.tansyBeyondHoloHollowTopic,
    npcId: NPC_IDS.tansyRusk,
    // A replayable topic is Tansy talking where she stands now — at Wade's
    // yard during her Fabrication chapter (#232), at the seam otherwise.
    presentsAtCurrentVenue: true,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "What's it like out there?"),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "You used to run deliveries, right? Going station to station, different planets...",
      ),
      tansyLocal(EXPRESSION_IDS.concerned, "...Oh."),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "Right. You hit your head hard enough that you don't remember any of it.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "Sorry. That was a pretty stupid question."),
      tansyLocal(EXPRESSION_IDS.neutral, "I think about it sometimes."),
      tansyLocal(EXPRESSION_IDS.smile, "Not maps. I've seen maps."),
      tansyLocal(EXPRESSION_IDS.neutral, "I mean actually being there."),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Different stations. Different planets. Places where nobody knows Wade, nobody knows me, and nobody has an opinion about how I'm holding a wrench.",
      ),
      tansyLocal(EXPRESSION_IDS.concerned, "I think about it more than I probably should."),
      tansyLocal(EXPRESSION_IDS.neutral, "Then something breaks."),
      tansyLocal(EXPRESSION_IDS.smile, "Something always breaks."),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "Wade's got more years behind him than he'll admit. Half the people around here who know how to keep the old equipment running are getting older too.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "And Holo Hollow isn't exactly overflowing with people lining up to replace them.",
      ),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "So every time I think about leaving, there's this little voice asking who I'm leaving everything to.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "Wade never asked me to stay."),
      tansyLocal(EXPRESSION_IDS.smile, "He'd probably be furious if he knew I blamed him."),
      tansyLocal(EXPRESSION_IDS.concerned, "That almost makes it worse."),
      tansyLocal(EXPRESSION_IDS.neutral, "I could go."),
      tansyLocal(EXPRESSION_IDS.neutral, "I know that."),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "I just haven't figured out how to want something for myself without feeling like I'm taking it away from somebody else.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "And meanwhile, you already went out there."),
      tansyLocal(EXPRESSION_IDS.smile, "You just got cheated out of remembering it."),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "So I guess if either of us ever makes it off this rock, we've both got some sightseeing to do.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "Anyway."),
      tansyLocal(EXPRESSION_IDS.smile, "That got heavier than I meant it to."),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Next time I'm telling you about the time Wade tried to repair a coolant manifold with a serving spoon.",
      ),
    ],
  },
  [DIALOGUE_IDS.bixTheShopTopic]: {
    id: DIALOGUE_IDS.bixTheShopTopic,
    npcId: NPC_IDS.bixWeller,
    beats: [
      bixLocal(EXPRESSION_IDS.neutral, "Holo Hollow Souvenirs."),
      bixLocal(EXPRESSION_IDS.concerned, "And Mining Supplies."),
      bixLocal(EXPRESSION_IDS.amused, "That part came later."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "My parents filled this place with shirts, mugs, little projector toys. Anything a kid could talk somebody into buying on the way home.",
      ),
      bixLocal(EXPRESSION_IDS.amused, "I still stock the souvenirs."),
      bixLocal(EXPRESSION_IDS.concerned, "They don't move much."),
      bixLocal(EXPRESSION_IDS.neutral, "Mining gear does."),
      bixLocal(EXPRESSION_IDS.amused, "That doesn't make this a mining store."),
    ],
  },
  [DIALOGUE_IDS.bixPowerCellsTopic]: {
    id: DIALOGUE_IDS.bixPowerCellsTopic,
    npcId: NPC_IDS.bixWeller,
    beats: [
      bixLocal(EXPRESSION_IDS.neutral, `Power Cells are ${spelledNumber(CELL_PRICE)} Credits.`),
      bixLocal(EXPRESSION_IDS.concerned, "Yes, I know."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Getting anything out here costs money before I even put it on a shelf.",
      ),
      bixLocal(
        EXPRESSION_IDS.neutral,
        `If you've got extras, I'll buy them for ${spelledNumber(CELL_BUYBACK)}.`,
      ),
      bixLocal(EXPRESSION_IDS.amused, "If that price offends you, keep the Cell. They're useful."),
      bixLocal(EXPRESSION_IDS.concerned, "I'm not going to wrestle it away from you."),
    ],
  },
  [DIALOGUE_IDS.bixHoloHollowTopic]: {
    id: DIALOGUE_IDS.bixHoloHollowTopic,
    npcId: NPC_IDS.bixWeller,
    beats: [
      bixLocal(EXPRESSION_IDS.neutral, "Used to be busier."),
      bixLocal(
        EXPRESSION_IDS.amused,
        "People came here on purpose, if you can believe that. Whole families.",
      ),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Projector nights. Full rooms. Kids trying to spend every Credit they had before their parents got them back in the speeder.",
      ),
      bixLocal(
        EXPRESSION_IDS.concerned,
        "Then the new releases stopped working here and everybody discovered somewhere else to be.",
      ),
      bixLocal(EXPRESSION_IDS.neutral, "Mining kept the place going."),
      bixLocal(EXPRESSION_IDS.amused, "Sort of."),
      bixLocal(EXPRESSION_IDS.neutral, "Still here, though."),
    ],
  },
  // Skatboll planet identity (#402): Bix's version is the shopkeeper's — the
  // tourists thought one street was the whole planet, and he sold them the
  // souvenirs to prove it. Distinct from Toll's shipping-label version.
  [DIALOGUE_IDS.bixSkatbollTopic]: {
    id: DIALOGUE_IDS.bixSkatbollTopic,
    npcId: NPC_IDS.bixWeller,
    beats: [
      bixLocal(EXPRESSION_IDS.neutral, "Tourists used to go home saying they'd seen Skatboll."),
      bixLocal(EXPRESSION_IDS.amused, "They'd seen one street. One shop. Mine, if I was lucky."),
      bixLocal(
        EXPRESSION_IDS.neutral,
        "Holo Hollow's the town. Skatboll's the planet it's sitting on — and the rest of it never bought a souvenir.",
      ),
    ],
  },
  // Skatboll planet identity (#402): Renn's quiet correction, in his own
  // register — a town is not a planet, no matter how hard it talks about
  // itself. Says nothing about his own standing at the Center, which canon
  // leaves deliberately unresolved.
  [DIALOGUE_IDS.rennSkatbollTopic]: {
    id: DIALOGUE_IDS.rennSkatbollTopic,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "People talk about Holo Hollow like it's the whole world."),
      rennLocal(
        EXPRESSION_IDS.sardonic,
        "It's one town. The planet is Skatboll, and Skatboll gets along fine without asking our opinion.",
      ),
      rennLocal(
        EXPRESSION_IDS.guarded,
        "Knowing which one you're standing in doesn't fix anything. It just stops you lying to yourself about the size of it.",
      ),
    ],
  },
  [DIALOGUE_IDS.rennAssistanceCenterTopic]: {
    id: DIALOGUE_IDS.rennAssistanceCenterTopic,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "Used to be the Visitor Center."),
      rennLocal(
        EXPRESSION_IDS.sardonic,
        "Brochures. Maps. Somebody behind the counter telling tourists what they absolutely couldn't leave Holo Hollow without seeing.",
      ),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "Now it's forms, ration crates, notices, and whoever needs a hand that week.",
      ),
      rennLocal(
        EXPRESSION_IDS.guarded,
        "People like to talk about needing this place like it's embarrassing.",
      ),
      rennLocal(EXPRESSION_IDS.neutral, "It isn't."),
      rennLocal(
        EXPRESSION_IDS.guarded,
        "Needing help isn't the part that should embarrass anybody.",
      ),
    ],
  },
  [DIALOGUE_IDS.rennFerriteTopic]: {
    id: DIALOGUE_IDS.rennFerriteTopic,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "Ferrite is work."),
      rennLocal(
        EXPRESSION_IDS.guarded,
        "It's rock. Useful rock, if somebody still wants enough of it.",
      ),
      rennLocal(EXPRESSION_IDS.neutral, "Every year somebody says demand's about to turn around."),
      rennLocal(EXPRESSION_IDS.guarded, "Every year we get another reason to wait one more year."),
      rennLocal(EXPRESSION_IDS.sardonic, "People talk about Ferrite like it's a weather system."),
      rennLocal(
        EXPRESSION_IDS.sardonic,
        "Market'll turn. Quotas'll loosen. New contracts'll come through.",
      ),
      rennLocal(EXPRESSION_IDS.guarded, "I'm tired of building plans around 'one more year.'"),
    ],
  },
  [DIALOGUE_IDS.rennLifeHereTopic]: {
    id: DIALOGUE_IDS.rennLifeHereTopic,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "If I hated Holo Hollow, leaving would be easy."),
      rennLocal(EXPRESSION_IDS.guarded, "That's the part people miss."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "I know everybody. I know which roof leaks. I know who'll show up when something breaks at two in the morning.",
      ),
      rennLocal(
        EXPRESSION_IDS.sardonic,
        "I also know exactly how many times I've heard 'a few more good years.'",
      ),
      rennLocal(
        EXPRESSION_IDS.guarded,
        "Caring about a place doesn't mean you owe it your whole life.",
      ),
      rennLocal(EXPRESSION_IDS.neutral, "Sometimes staying is loyalty."),
      rennLocal(EXPRESSION_IDS.guarded, "Sometimes it's just being afraid to go."),
      rennLocal(EXPRESSION_IDS.neutral, "Those aren't the same thing."),
    ],
  },
  // Out of the Weather (#172). Renn can be worn out by Holo Hollow and still
  // notice the small things that make other people's mornings worse. The offer
  // is a complaint, not an assignment — nobody owns the Crew Stop enough to fix
  // it, which is exactly why it never gets fixed. The player stays silent.
  [DIALOGUE_IDS.rennOutOfTheWeatherOffer]: {
    id: DIALOGUE_IDS.rennOutOfTheWeatherOffer,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "You seen the Crew Stop out on the haul road?"),
      rennLocal(EXPRESSION_IDS.neutral, "Roof's full of holes. Bench is busted."),
      rennLocal(EXPRESSION_IDS.guarded, "Everybody uses it, nobody owns it."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "Crews stand out there in the weather every morning, pretending it doesn't bother them.",
      ),
      rennLocal(EXPRESSION_IDS.guarded, "I can assure you, it does."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "No one 'round here can afford to spare 20 Refined Ferrite, otherwise it'd be patch-welded by now.",
      ),
    ],
  },
  [DIALOGUE_IDS.rennOutOfTheWeatherRepairReminder]: {
    id: DIALOGUE_IDS.rennOutOfTheWeatherRepairReminder,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "Still standing. Still leaking."),
      rennLocal(EXPRESSION_IDS.guarded, "Nobody's holding a clock over it."),
      rennLocal(EXPRESSION_IDS.neutral, "It's been like that a long time. It'll wait."),
    ],
  },
  [DIALOGUE_IDS.rennOutOfTheWeatherBusy]: {
    id: DIALOGUE_IDS.rennOutOfTheWeatherBusy,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.sardonic, "You're in the middle of something."),
      rennLocal(EXPRESSION_IDS.neutral, "Finish it. I'll be here."),
    ],
  },
  // Nothing Renn says here may assume time has passed: the player can finish
  // the tenth weld and walk straight back. He reports the state of the shelter,
  // which is true a minute later and true a week later.
  [DIALOGUE_IDS.rennOutOfTheWeatherTurnIn]: {
    id: DIALOGUE_IDS.rennOutOfTheWeatherTurnIn,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "The Crew Stop's fixed."),
      rennLocal(EXPRESSION_IDS.guarded, "Roof's whole. Bench is bolted down."),
      rennLocal(EXPRESSION_IDS.neutral, "That was you."),
    ],
  },
  [DIALOGUE_IDS.rennOutOfTheWeatherCompletion]: {
    id: DIALOGUE_IDS.rennOutOfTheWeatherCompletion,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "I didn't think anyone would."),
      rennLocal(EXPRESSION_IDS.guarded, "The crews will notice. They notice everything out there."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "The shift hauler runs out to The Jag most of the day. They'll squeeze you on for five Credits.",
      ),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "Out only. It comes back loaded with shale — there's no room on it for you.",
      ),
      rennLocal(
        EXPRESSION_IDS.guarded,
        "It's not a favour. They just don't mind you now. That's worth more here than it sounds.",
      ),
      rennSkillXpBeat(SKILL_IDS.welding, 250),
    ],
  },
  [DIALOGUE_IDS.rennPostOutOfTheWeather]: {
    id: DIALOGUE_IDS.rennPostOutOfTheWeather,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "Bench is holding."),
      rennLocal(
        EXPRESSION_IDS.sardonic,
        "Give it a year and somebody'll swear it was always like that.",
      ),
      rennLocal(EXPRESSION_IDS.guarded, "I'll know it wasn't."),
    ],
  },
  // Cutting Costs (#233) — the locked scene. Renn is buying, not asking a
  // favour: he names his price up front and does not care where the Cutter
  // came from. The player stays silent; showing and handing over the Cutter
  // are item beats, and the turn-in itself is the Mission's own control.
  [DIALOGUE_IDS.rennCuttingCostsOffer]: {
    id: DIALOGUE_IDS.rennCuttingCostsOffer,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "Been looking at those Loadsteel Cutters."),
      rennLocal(EXPRESSION_IDS.neutral, "Faster base cutting speed, without a charge."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "Means I don't have to keep feeding the damn thing a Cell every time I want to get some work done.",
      ),
      rennLocal(EXPRESSION_IDS.guarded, "I've been putting Credits aside for one."),
      rennLocal(EXPRESSION_IDS.guarded, "Five hundred credits."),
      rennLocal(EXPRESSION_IDS.guarded, "Had to save a while."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "If you can get me a Loadsteel Cutter, that's what I'll pay.",
      ),
      rennLocal(EXPRESSION_IDS.neutral, "Don't care where or how you get it."),
      rennLocal(EXPRESSION_IDS.neutral, "I need the Cutter, not the story behind it."),
    ],
  },
  [DIALOGUE_IDS.rennCuttingCostsReminder]: {
    id: DIALOGUE_IDS.rennCuttingCostsReminder,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "Still looking for that Cutter."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "Five hundred credits waiting for you when you've got one.",
      ),
    ],
  },
  [DIALOGUE_IDS.rennCuttingCostsTurnIn]: {
    id: DIALOGUE_IDS.rennCuttingCostsTurnIn,
    npcId: NPC_IDS.rennCalder,
    beats: [
      rennLocal(EXPRESSION_IDS.neutral, "That it?"),
      { ...itemBeat(ITEM_IDS.loadsteelCutter, 1), backgroundId: assistanceCenter },
      rennLocal(EXPRESSION_IDS.guarded, "Yeah."),
      rennLocal(EXPRESSION_IDS.guarded, "That'll do."),
      rennLocal(EXPRESSION_IDS.neutral, "Five hundred credits, like I said."),
    ],
  },
  // Presentation only: the turn-in has already taken one Loadsteel Cutter and
  // paid the Credits.
  [DIALOGUE_IDS.rennCuttingCostsCompletion]: {
    id: DIALOGUE_IDS.rennCuttingCostsCompletion,
    npcId: NPC_IDS.rennCalder,
    beats: [
      {
        ...itemBeat(ITEM_IDS.loadsteelCutter, 1, "Renn takes the Loadsteel Cutter."),
        backgroundId: assistanceCenter,
      },
      rennLocal(EXPRESSION_IDS.neutral, "Been saving up for far longer than I care to admit."),
      rennLocal(
        EXPRESSION_IDS.neutral,
        "Worth it if I can stop carrying half my weight around in Power Cells.",
      ),
    ],
  },
  // 10,000 Hours (#190) — Wade's own shop, in his own voice. The offer scene IS
  // the onboarding: it establishes the place, what the player may touch, what
  // they may not, and hands over the scrap the first three welds will burn.
  [DIALOGUE_IDS.wadeTenThousandHoursOffer]: {
    id: DIALOGUE_IDS.wadeTenThousandHoursOffer,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "So. Rusk Recovery. Everything this valley gives up on comes through that gate first.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "That bench is a real workbench. You can put time in on it. That's what it's for.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "What you're not doing yet is laying a torch on somebody's property. People bring me things they can't afford to lose twice.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Six pieces of scrap. Cut down, clean enough to run a bead on. Two pieces a weld, so that's three.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Burn through them properly and we'll talk about what comes after.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandHoursAccepted]: {
    id: DIALOGUE_IDS.wadeTenThousandHoursAccepted,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Ten sections to a weld. Take them one at a time and you'll feel where the bead wants to go.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Slag's yours to keep. Bix pays a credit for it, which is about what it's worth.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "Three welds. Then come find me."),
    ],
  },
  // One shared refusal for both capacity causes: Wade has nothing different to
  // say about slots than about mass. Nothing was granted and nothing was
  // accepted when this plays — coming back runs the ordinary offer again.
  [DIALOGUE_IDS.wadeTenThousandHoursCapacityRefusal]: {
    id: DIALOGUE_IDS.wadeTenThousandHoursCapacityRefusal,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.scowl, "You're loaded like you're moving house."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "All six or none. I'm not handing you scrap to drop in my own yard.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "Make room. Come back. It'll still be here."),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandHoursPracticeReminder]: {
    id: DIALOGUE_IDS.wadeTenThousandHoursPracticeReminder,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "Bench is right there. Three welds."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        `Run out of scrap, I sell it. ${spelledNumberCapitalized(SCRAP_PRICE)} credits a piece, same as anybody pays.`,
      ),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandHoursBusy]: {
    id: DIALOGUE_IDS.wadeTenThousandHoursBusy,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "Finish what you've got going. I'm not going anywhere."),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandHoursTurnIn]: {
    id: DIALOGUE_IDS.wadeTenThousandHoursTurnIn,
    npcId: NPC_IDS.wadeRusk,
    beats: [wadeAtYard(EXPRESSION_IDS.neutral, "Three welds, then. Let's see them.")],
  },
  [DIALOGUE_IDS.wadeTenThousandHoursCompletion]: {
    id: DIALOGUE_IDS.wadeTenThousandHoursCompletion,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "Hm. Not pretty. Wasn't going to be."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "But the last one's better than the first, and you stayed on it. That's the only thing I was watching for.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "Fifty credits. Shop time is still work."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        `Bench stays open. Scrap's ${spelledNumber(SCRAP_PRICE)} credits when you want more of it.`,
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "And that terminal in the corner is where the paying jobs come in. Not yet. But that's where they come in.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadePostTenThousandHours]: {
    id: DIALOGUE_IDS.wadePostTenThousandHours,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        `Bench is open. Scrap's ${spelledNumber(SCRAP_PRICE)} credits.`,
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Ten thousand hours, the old hands say. You've got a few of them behind you now.",
      ),
    ],
  },
  // 10,001 Hours (#207). Wade is plainly proud of the apprentice and says so
  // by refusing to: the compliment arrives, gets undercut in the next sentence,
  // and the actual reason he is handing over client work is that the terminal
  // is beating him. Short declaratives, no exclamation marks, no ceremony.
  [DIALOGUE_IDS.wadeTenThousandOneHoursOffer]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursOffer,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "Hm. You're getting decent with that torch."),
      wadeAtYard(EXPRESSION_IDS.scowl, "Decent. Don't write it down anywhere."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Normally I wouldn't put a customer's property in front of you yet. Not for a while.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "But that terminal's stacking orders faster than I'm clearing them, and there's one of me.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "So you're ready. Or you're not, and you're what I've got. Take a job off the board. Do it properly.",
      ),
      // Asks for the first finished job back for a look, and stops there. The
      // board is the player's from the moment this is accepted, so nothing here
      // may imply a second job waits on his approval.
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Bring the first one back here when it's done. My name's on the work, so I'll want a look at it.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandOneHoursAccepted]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursAccepted,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Board's yours now. It stays yours. I'm not going to keep unlocking it for you.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Bring the material yourself. A job doesn't start until it's paid for out of your own pocket.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandOneHoursWorkOrderReminder]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursWorkOrderReminder,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Terminal's over there. Board's not going to read itself.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "Pick one. Finish it. Then we'll talk."),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandOneHoursBusy]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursBusy,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "You're in the middle of something. Finish that first."),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandOneHoursTurnIn]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursTurnIn,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "All right. Let's see it."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Hold still. I'm looking at the seam, not at you."),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandOneHoursCompletion]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursCompletion,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "Hm."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "I've been at that for a minute and I can't find enough wrong with it to complain about.",
      ),
      wadeAtYard(EXPRESSION_IDS.scowl, "Don't make a thing out of that."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Shop stock. Ferrite and cells. You'll go through it, and I'd rather you didn't stop working to go shopping.",
      ),
      // One beat per distinct item, showing the true awarded total — never
      // one beat per persisted stack. Ten Refined Ferrite lands as two
      // carried stacks of five, but that split is Inventory's business, not
      // something the player clicks through twice (#207 follow-up).
      ...rewardItemBeats(ruskYard, [
        { itemId: ITEM_IDS.refinedFerrite, quantity: 10 },
        { itemId: ITEM_IDS.powerCell, quantity: 5 },
      ]),
      wadeAtYard(EXPRESSION_IDS.neutral, "Board's still up. Take the next one when you want it."),
    ],
  },
  // Unlike 10,000 Hours' one shared beat, the bundle is big enough that the two
  // causes are genuinely different problems, and Wade has something separate to
  // say about each.
  [DIALOGUE_IDS.wadeTenThousandOneHoursCapacitySlotsRefusal]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursCapacitySlotsRefusal,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.scowl, "Where exactly were you planning to put it?"),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Ten ferrite and five cells. All of it or none of it. I'm not splitting shop stock into a pile on the ground.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "Clear some space. Come back."),
    ],
  },
  [DIALOGUE_IDS.wadeTenThousandOneHoursCapacityMassRefusal]: {
    id: DIALOGUE_IDS.wadeTenThousandOneHoursCapacityMassRefusal,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.scowl, "You can barely stand up as it is."),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Ten ferrite and five cells. That's weight. All of it or none of it.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "Put something down. Come back."),
    ],
  },
  [DIALOGUE_IDS.wadePostTenThousandOneHours]: {
    id: DIALOGUE_IDS.wadePostTenThousandOneHours,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        `Board's up. Bench is open. Scrap's still ${spelledNumber(SCRAP_PRICE)} credits.`,
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "You don't need me standing over the terminal. Take what you can finish.",
      ),
    ],
  },
  // Brace Yourself (#209). Tansy has had the brace hardware in storage for
  // years and no one worth spending it on. She is not congratulating the player
  // on a level — she is saying that someone who can read rock and run a torch is
  // finally standing in front of her. The cave-in is old news to her; what is
  // new is that it is worth reopening.
  [DIALOGUE_IDS.tansyBraceYourselfOffer]: {
    id: DIALOGUE_IDS.tansyBraceYourselfOffer,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "There's a second cut southwest of here. Deep Jag."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Roof came down in the passage a long time before I got here.",
      ),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "Nobody's touched it since. Wrong job for someone who only knows one half of it.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "You need to read which rock is carrying weight, and you need to lay a bead that'll hold it.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "You can do both now. That's new."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "I've got the brace and the jack. Had them for years — that's not the part that was missing.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "You haul the stock out and weld the support in: 25 Refined Ferrite and 5 Power Cells.",
      ),
      tansyLocal(EXPRESSION_IDS.concerned, "Once it's in, it stays in. Don't set it crooked."),
    ],
  },
  [DIALOGUE_IDS.tansyBraceYourselfAccepted]: {
    id: DIALOGUE_IDS.tansyBraceYourselfAccepted,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "Hardware's already down there, under a tarp."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Southwest. It's a walk. Go when you're loaded, not before.",
      ),
    ],
  },
  // She is not holding a clock over it either: the materials are expensive and
  // the passage has waited this long. Nothing here may assume the player has
  // started, because they may have walked ten steps and turned around.
  [DIALOGUE_IDS.tansyBraceYourselfRepairReminder]: {
    id: DIALOGUE_IDS.tansyBraceYourselfRepairReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "Work's at Deep Jag. Southwest of here."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Set the materials in, then weld it. It'll take more than a couple of passes.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "It waited twenty years. It'll wait for you."),
    ],
  },
  [DIALOGUE_IDS.tansyBraceYourselfBusy]: {
    id: DIALOGUE_IDS.tansyBraceYourselfBusy,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "You're in the middle of something."),
      tansyLocal(EXPRESSION_IDS.smile, "Finish it first. I'm not going anywhere."),
    ],
  },
  // The player can weld the fifteenth section and walk straight back, so Tansy
  // reports the state of the passage rather than anything that needs time to
  // have passed. The mine is already open by the time she says this — the
  // Mission recognises the work, it does not perform it.
  [DIALOGUE_IDS.tansyBraceYourselfTurnIn]: {
    id: DIALOGUE_IDS.tansyBraceYourselfTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "Deep Jag's open."),
      tansyLocal(EXPRESSION_IDS.neutral, "Support's taking the load. I went and stood under it."),
      tansyLocal(EXPRESSION_IDS.smile, "That's a real thing you did."),
    ],
  },
  [DIALOGUE_IDS.tansyBraceYourselfCompletion]: {
    id: DIALOGUE_IDS.tansyBraceYourselfCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "The rock in there runs different. Heavier, and it'll throw a spark off a bare contact.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "Galvanite. Some of the old crews called it live rock."),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "It doesn't make power. It just carries it better than anything else you'll dig up here.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "It's yours to work. Nobody else was going to reopen it."),
      tansySkillXpBeat(SKILL_IDS.welding, 250),
    ],
  },
  [DIALOGUE_IDS.tansyPostBraceYourself]: {
    id: DIALOGUE_IDS.tansyPostBraceYourself,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "Brace is holding. I check it."),
      tansyLocal(EXPRESSION_IDS.smile, "Go mine your rock."),
    ],
  },
  // Wheel Be Right Back (#322). Wade at his own yard, because Keep the Change
  // moved him there long before Brace Yourself. His register is the Canon's:
  // short declaratives, no exclamation marks, approval arriving as a shorter
  // sentence rather than a warmer one. He has only three portraits, so the
  // expression carries the one thing the words do not: neutral is the flat
  // working default, scowl is the gruff deflection he reaches for the moment
  // something sounds like a kindness or an order he'd rather not repeat, and
  // concerned is kept for when the job is the ship itself.
  [DIALOGUE_IDS.wadeWheelBeRightBackOffer]: {
    id: DIALOGUE_IDS.wadeWheelBeRightBackOffer,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "Heard the Deep Jag brace is still holding. Good work."),
      wadeAtYard(
        EXPRESSION_IDS.concerned,
        "Your ship's still sitting on her belly. Get the wheels rebuilt and the mounts back under her. Won't make her fly, but there's no point fixing the engine before she can land.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.scowl,
        "How you get the parts is your business. Two Wheel Assemblies, two Mounting Brackets, one Galvanic Wire Spool.",
      ),
    ],
  },
  // Said whenever the player comes back with the Landing Gear unfinished,
  // whether they have installed nothing, half the parts, or are mid-weld. It
  // names the shopping list and the place, and nothing that assumes how far
  // along they are.
  [DIALOGUE_IDS.wadeWheelBeRightBackRepairReminder]: {
    id: DIALOGUE_IDS.wadeWheelBeRightBackRepairReminder,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Two Wheel Assemblies, two Mounting Brackets, one Galvanic Wire Spool. Get them under the ship at the Crash Site.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeWheelBeRightBackBusy]: {
    id: DIALOGUE_IDS.wadeWheelBeRightBackBusy,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "You're in the middle of something. Finish it, then tell me about the gear.",
      ),
    ],
  },
  // REPORT REPAIR has already been chosen and the player has no response beat
  // here, so Wade states rather than asks.
  [DIALOGUE_IDS.wadeWheelBeRightBackTurnIn]: {
    id: DIALOGUE_IDS.wadeWheelBeRightBackTurnIn,
    npcId: NPC_IDS.wadeRusk,
    beats: [wadeAtYard(EXPRESSION_IDS.neutral, "Wheels on. Mounts welded. Good.")],
  },
  [DIALOGUE_IDS.wadeWheelBeRightBackCompletion]: {
    id: DIALOGUE_IDS.wadeWheelBeRightBackCompletion,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "That'll hold. She's got her feet back under her."),
      wadeAtYard(EXPRESSION_IDS.scowl, "Engine's still dead. That's another job."),
      wadeAtYardSkillXpBeat(SKILL_IDS.welding, 250),
    ],
  },
  // His ordinary follow-up wherever he stands, which may be the moment after the
  // report. It states the whole of the ship's state and assumes no time has
  // passed, no trip to the wreck, and no promise about the engine.
  [DIALOGUE_IDS.wadePostWheelBeRightBack]: {
    id: DIALOGUE_IDS.wadePostWheelBeRightBack,
    npcId: NPC_IDS.wadeRusk,
    presentsAtCurrentVenue: true,
    beats: [wadeAtYard(EXPRESSION_IDS.neutral, "Landing gear's done. Engine isn't.")],
  },
  // Thrust Issues (#330). Wade at his own yard again, in the same register: short
  // declaratives, no exclamation marks, approval as a shorter sentence. The offer,
  // the reminder and the two completion lines are the locked copy, verbatim. The
  // busy beat, the turn-in opening and the follow-up are the only authored
  // additions, kept to what the repair itself already says.
  [DIALOGUE_IDS.wadeThrustIssuesOffer]: {
    id: DIALOGUE_IDS.wadeThrustIssuesOffer,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Hm. Landing gear's holding. Means there's one big problem left.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.concerned,
        "Drive itself survived better than it had any right to. Mounts didn't. Both are shot. Frame around them took a hit, too. You try to put thrust through what's there now, best case it tears itself loose.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "You'll need two Drive Mounts. Galvaferrite work. One more Galvaferrite for the damaged frame. Two Mounting Brackets. One Galvanic Wire Spool for the ship-side wiring. Then you weld the whole thing back together.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.scowl,
        "Fix it, and you're on your own. I'm done holding your hand.",
      ),
    ],
  },
  // Said whenever the player comes back with the Propulsion System unfinished,
  // whether nothing is installed, part of it is, or the weld is under way.
  [DIALOGUE_IDS.wadeThrustIssuesRepairReminder]: {
    id: DIALOGUE_IDS.wadeThrustIssuesRepairReminder,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Two Drive Mounts. One Galvaferrite. Two Mounting Brackets. One Galvanic Wire Spool. Crash Site. Try not to make the hole bigger.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadeThrustIssuesBusy]: {
    id: DIALOGUE_IDS.wadeThrustIssuesBusy,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "You're in the middle of something. Finish it, then tell me about the drive.",
      ),
    ],
  },
  // REPORT REPAIR has already been chosen and the player has no response beat
  // here, so Wade states rather than asks.
  [DIALOGUE_IDS.wadeThrustIssuesTurnIn]: {
    id: DIALOGUE_IDS.wadeThrustIssuesTurnIn,
    npcId: NPC_IDS.wadeRusk,
    beats: [wadeAtYard(EXPRESSION_IDS.neutral, "Mounts seated. Frame welded. Good.")],
  },
  // The locked completion. There is no reward beat: the work already paid its
  // Welding XP section by section, and the Mission adds nothing.
  [DIALOGUE_IDS.wadeThrustIssuesCompletion]: {
    id: DIALOGUE_IDS.wadeThrustIssuesCompletion,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "All right. Landing gear. Propulsion. Hold. Still looks like hell.",
      ),
      wadeAtYard(EXPRESSION_IDS.scowl, "But now it's a ship."),
      // Move Along's send-off (#358): reporting the drive starts it, so the story
      // hands straight on. These are the approved Move Along offer lines that
      // state the job, verbatim; the offer's opening and aside belong to a
      // return visit this scene never is.
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Holo Hollow Landing. They've got a proper pad. Take the Rivet there. Ten fuel units for the hop.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "You'll need fuel first. Make a Full Small Fuel Canister or buy one at Last Leg Trading. You can walk over to the Landing and back if you need to.",
      ),
      wadeAtYard(
        EXPRESSION_IDS.scowl,
        "Fly it over. Land it. And for once, don't make me come look at it.",
      ),
    ],
  },
  // His ordinary follow-up wherever he stands. It restates only the locked
  // verdict, so it promises no flight, fuel or destination.
  [DIALOGUE_IDS.wadePostThrustIssues]: {
    id: DIALOGUE_IDS.wadePostThrustIssues,
    npcId: NPC_IDS.wadeRusk,
    presentsAtCurrentVenue: true,
    beats: [wadeAtYard(EXPRESSION_IDS.neutral, "Still looks like hell. But it's a ship.")],
  },
  // Move Along (#358). The active reminder and the post-landing idle lines are the
  // owner-approved locked copy, verbatim; the send-off is the tail of Thrust
  // Issues' completion. There is no completion scene: touchdown completes the
  // Mission with a plain presentation, not Wade.
  [DIALOGUE_IDS.wadeMoveAlongActive]: {
    id: DIALOGUE_IDS.wadeMoveAlongActive,
    npcId: NPC_IDS.wadeRusk,
    beats: [
      wadeAtYard(
        EXPRESSION_IDS.neutral,
        "Crash Site to Holo Hollow Landing. Ten fuel units. Fuel the Rivet, fly it over, land it. In that order.",
      ),
    ],
  },
  [DIALOGUE_IDS.wadePostMoveAlong]: {
    id: DIALOGUE_IDS.wadePostMoveAlong,
    npcId: NPC_IDS.wadeRusk,
    presentsAtCurrentVenue: true,
    beats: [
      wadeAtYard(EXPRESSION_IDS.neutral, "Heard the Rivet made the Landing."),
      wadeAtYard(EXPRESSION_IDS.scowl, "Nobody's asked me to tow it back yet. Good."),
    ],
  },
  // Return the Favor (#232) — the locked offer scene from the Fabrication
  // design. Tansy teaches the station; Wade supplies the shop's shorthand.
  [DIALOGUE_IDS.tansyReturnTheFavorOffer]: {
    id: DIALOGUE_IDS.tansyReturnTheFavorOffer,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.smile, "Wade says you've been useful."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Didn't say useful."),
      tansyAtYard(EXPRESSION_IDS.smile, "He said you finished the work."),
      tansyAtYard(
        EXPRESSION_IDS.neutral,
        "You know how to weld now. Join pieces. Patch something that's broken. Keep an old machine alive another few years.",
      ),
      tansyAtYard(EXPRESSION_IDS.smile, "That's Wade's side of the business."),
      wadeAtYard(EXPRESSION_IDS.neutral, "The welding workshop."),
      tansyAtYard(EXPRESSION_IDS.neutral, "Fabrication's different."),
      tansyAtYard(
        EXPRESSION_IDS.neutral,
        "You start with processed stock and make the piece you need.",
      ),
      tansyAtYard(EXPRESSION_IDS.smile, "A bracket. A housing. A tool."),
      tansyAtYard(
        EXPRESSION_IDS.neutral,
        "Sometimes the thing Wade's going to complain about fixing ten years from now.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "If it lasts ten years, I won't complain."),
      tansyAtYard(EXPRESSION_IDS.smile, "You absolutely will."),
      tansyAtYard(EXPRESSION_IDS.neutral, "Remember that Cutter I gave you at the Jag?"),
      tansyAtYard(
        EXPRESSION_IDS.smile,
        "I threw that together because you needed one and couldn't make your own.",
      ),
      tansyAtYard(EXPRESSION_IDS.neutral, "Time to fix that."),
      tansyAtYard(
        EXPRESSION_IDS.neutral,
        "Use the Fabrication Station and make me a Salvage Cutter.",
      ),
      tansyAtYard(EXPRESSION_IDS.smile, "Call it returning the favor."),
      tansyAtYard(EXPRESSION_IDS.concerned, "One thing."),
      tansyAtYard(EXPRESSION_IDS.neutral, "You'll see a control marked Manual Override."),
      tansyAtYard(EXPRESSION_IDS.concerned, "Don't press it unless you know what you're doing."),
      wadeAtYard(EXPRESSION_IDS.neutral, "She presses it every time."),
      tansyAtYard(EXPRESSION_IDS.neutral, "I know what I'm doing."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Usually."),
      tansyAtYard(EXPRESSION_IDS.smile, "Make me a Cutter."),
    ],
  },
  [DIALOGUE_IDS.tansyReturnTheFavorReminder]: {
    id: DIALOGUE_IDS.tansyReturnTheFavorReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.neutral, "Fabrication Station. One Salvage Cutter."),
      tansyAtYard(EXPRESSION_IDS.smile, "Bring it to me when it's done."),
    ],
  },
  // After a Manual Override bust and before a Cutter has been made: the one
  // reactive reminder. It does not clear the fact or open another route.
  [DIALOGUE_IDS.tansyReturnTheFavorBustReminder]: {
    id: DIALOGUE_IDS.tansyReturnTheFavorBustReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.smile, "You pressed it."),
      tansyAtYard(EXPRESSION_IDS.neutral, "The button I specifically told you not to press."),
      tansyAtYard(EXPRESSION_IDS.smile, "Make another one."),
      tansyAtYard(EXPRESSION_IDS.neutral, "This time, stop before it comes apart."),
    ],
  },
  // Shared by both halves of the chapter. Tansy's own established busy beat,
  // at the yard rather than the seam.
  [DIALOGUE_IDS.tansyFabricationChapterBusy]: {
    id: DIALOGUE_IDS.tansyFabricationChapterBusy,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.neutral, "You're in the middle of something."),
      tansyAtYard(EXPRESSION_IDS.smile, "Finish it first. I'm not going anywhere."),
    ],
  },
  // Three turn-in openings, chosen by the Mission's two reactive facts in
  // authored priority (bust, then a clean Override success, then this), all
  // rejoining the same completion below.
  [DIALOGUE_IDS.tansyReturnTheFavorTurnIn]: {
    id: DIALOGUE_IDS.tansyReturnTheFavorTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [tansyAtYard(EXPRESSION_IDS.neutral, "Let's see it.")],
  },
  [DIALOGUE_IDS.tansyReturnTheFavorOverrideTurnIn]: {
    id: DIALOGUE_IDS.tansyReturnTheFavorOverrideTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.smile, "You pushed it."),
      tansyAtYard(EXPRESSION_IDS.neutral, "I told you not to unless you knew what you were doing."),
      tansyAtYard(EXPRESSION_IDS.smile, "Looks like you did."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Once."),
      tansyAtYard(EXPRESSION_IDS.smile, "Let them have this moment!"),
      tansyAtYard(EXPRESSION_IDS.smile, "Let me see the Cutter."),
    ],
  },
  [DIALOGUE_IDS.tansyReturnTheFavorBustTurnIn]: {
    id: DIALOGUE_IDS.tansyReturnTheFavorBustTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.smile, "Don't think I didn't see that first one."),
      tansyAtYard(EXPRESSION_IDS.neutral, "You really had to push the Override."),
      tansyAtYard(EXPRESSION_IDS.smile, "Can't say I blame you. I always push it too."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Every time."),
      tansyAtYard(EXPRESSION_IDS.smile, "Difference is, I usually know when to stop."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Usually."),
      tansyAtYard(EXPRESSION_IDS.smile, "Yeah, yeah. Let me see the Cutter."),
    ],
  },
  // The common completion, then straight on into Break It Down. Presentation
  // only: the turn-in has already taken the Cutter, and Tansy's demonstration
  // Scrap is illustrative — it stays with her and nothing is granted.
  [DIALOGUE_IDS.tansyReturnTheFavorCompletion]: {
    id: DIALOGUE_IDS.tansyReturnTheFavorCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      { ...itemBeat(ITEM_IDS.salvageCutter, 1), backgroundId: ruskYard },
      tansyAtYard(EXPRESSION_IDS.smile, "Not bad!"),
      tansyAtYard(EXPRESSION_IDS.neutral, "You know how to put one together."),
      tansyAtYard(EXPRESSION_IDS.smile, "So now I'm going to take it apart."),
      {
        ...itemBeat(ITEM_IDS.salvageCutter, 1, "Tansy dismantles the Salvage Cutter."),
        backgroundId: ruskYard,
      },
      {
        ...itemBeat(
          ITEM_IDS.scrapMetal,
          DEMONSTRATION_SCRAP,
          `Her demonstration recovers ${DEMONSTRATION_SCRAP} Scrap Metal. It stays on her bench.`,
        ),
        backgroundId: ruskYard,
      },
      tansyAtYard(
        EXPRESSION_IDS.neutral,
        "Putting something together teaches you where everything goes.",
      ),
      tansyAtYard(EXPRESSION_IDS.neutral, "Taking it apart teaches you why."),
      tansyAtYard(EXPRESSION_IDS.smile, "That's Tinkering."),
      {
        kind: "skill_xp",
        skillId: SKILL_IDS.fabrication,
        amount: 100,
        backgroundId: ruskYard,
        text: "Tinkering unlocked.",
      },
      // Break It Down begins here, as its authored continuation.
      tansyAtYard(EXPRESSION_IDS.neutral, "Your turn."),
      tansyAtYard(
        EXPRESSION_IDS.smile,
        "Make something you can spare. Then break it down yourself.",
      ),
      tansyAtYard(
        EXPRESSION_IDS.neutral,
        "Doesn't matter what. Just make sure it's something you can actually Tinker.",
      ),
      tansyAtYard(
        EXPRESSION_IDS.smile,
        "And maybe don't dismantle the only tool keeping you employed.",
      ),
      wadeAtYard(EXPRESSION_IDS.neutral, "Good rule generally."),
    ],
  },
  // Break It Down (#232).
  [DIALOGUE_IDS.tansyBreakItDownReminder]: {
    id: DIALOGUE_IDS.tansyBreakItDownReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.neutral, "Make something. Take it apart."),
      tansyAtYard(EXPRESSION_IDS.smile, "Try to learn something in between."),
    ],
  },
  [DIALOGUE_IDS.tansyBreakItDownTurnIn]: {
    id: DIALOGUE_IDS.tansyBreakItDownTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyAtYard(EXPRESSION_IDS.neutral, "Nicely done."),
      tansyAtYard(EXPRESSION_IDS.smile, "Now you've seen both sides of it."),
      tansyAtYard(EXPRESSION_IDS.neutral, "Fabrication isn't just knowing how to make something."),
      tansyAtYard(
        EXPRESSION_IDS.neutral,
        "It's knowing what went into it, what can come back out, and what isn't worth saving.",
      ),
      tansyAtYard(EXPRESSION_IDS.smile, "You've got enough to work with."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Enough to be dangerous."),
      tansyAtYard(EXPRESSION_IDS.smile, "Seems to work for me."),
    ],
  },
  // The chapter's close. Completing it is what sends Tansy home to The Jag
  // (`game/content/npcs.ts`).
  [DIALOGUE_IDS.tansyBreakItDownCompletion]: {
    id: DIALOGUE_IDS.tansyBreakItDownCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      {
        kind: "skill_xp",
        skillId: SKILL_IDS.fabrication,
        amount: 250,
        backgroundId: ruskYard,
        text: "",
      },
      tansyAtYard(EXPRESSION_IDS.neutral, "I should get back to the Jag."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Friday. Do not forget."),
      tansyAtYard(EXPRESSION_IDS.smile, "I know."),
      wadeAtYard(EXPRESSION_IDS.neutral, "You said that last week."),
      tansyAtYard(EXPRESSION_IDS.neutral, "And I showed up."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Twenty minutes late."),
      tansyAtYard(EXPRESSION_IDS.smile, "The trailers were still playing."),
      wadeAtYard(EXPRESSION_IDS.neutral, "Still."),
      tansyAtYard(EXPRESSION_IDS.smile, "You picking this week?"),
      wadeAtYard(EXPRESSION_IDS.neutral, "No."),
      tansyAtYard(EXPRESSION_IDS.smile, "Good."),
      wadeAtYard(EXPRESSION_IDS.neutral, "You complain through my movie choices."),
      tansyAtYard(EXPRESSION_IDS.smile, "The last one was three hours of dialogue!"),
      tansyAtYard(EXPRESSION_IDS.neutral, "Anyway. Back to The Jag."),
      tansyAtYard(EXPRESSION_IDS.smile, "Come find me when you're ready for real trouble."),
    ],
  },
  // A Cut Above (#233) — the locked scene from the Fabrication design, at The
  // Jag. Tansy is teaching a rule, not a recipe: the list grows with the skill.
  // The player stays silent throughout.
  [DIALOGUE_IDS.tansyACutAboveOffer]: {
    id: DIALOGUE_IDS.tansyACutAboveOffer,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.smile,
        "You've been using that Fabrication Station enough that it's starting to trust you.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "Take another look at the recipe list."),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "You'll get more options as your Fabrication gets better. Some of them are just different ways to make a mess.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "Some are worth paying attention to."),
      tansyLocal(EXPRESSION_IDS.smile, "You can build a Loadsteel Cutter now."),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "Better frame. Better drive. Faster than that Salvage Cutter you've been dragging around.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "And if you feed it a Power Cell, it'll pull a little more out of the rock.",
      ),
      tansyLocal(EXPRESSION_IDS.neutral, "Get your hands on one."),
      tansyLocal(EXPRESSION_IDS.neutral, "Bring it by when you've got it. I want to take a look."),
    ],
  },
  // Until there is a Cutter to show, she repeats the offer's own closing
  // instruction rather than saying anything the locked scene does not.
  [DIALOGUE_IDS.tansyACutAboveReminder]: {
    id: DIALOGUE_IDS.tansyACutAboveReminder,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.neutral, "Get your hands on one."),
      tansyLocal(EXPRESSION_IDS.neutral, "Bring it by when you've got it. I want to take a look."),
    ],
  },
  [DIALOGUE_IDS.tansyACutAboveTurnIn]: {
    id: DIALOGUE_IDS.tansyACutAboveTurnIn,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "There it is."),
      tansyLocal(EXPRESSION_IDS.smile, "Looks like you're done making starter gear."),
    ],
  },
  // Presentation only: the turn-in takes nothing, and the Cutter stays the
  // player's.
  [DIALOGUE_IDS.tansyACutAboveCompletion]: {
    id: DIALOGUE_IDS.tansyACutAboveCompletion,
    npcId: NPC_IDS.tansyRusk,
    beats: [
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Keep checking that recipe list as your Fabrication improves.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "The better you get, the more useful things you'll be able to make.",
      ),
      tansyLocal(
        EXPRESSION_IDS.smile,
        "And keep the Cutter. You'll get more use out of it than I will.",
      ),
      tansySkillXpBeat(SKILL_IDS.fabrication, 500),
    ],
  },
  [DIALOGUE_IDS.maraTheBnbTopic]: {
    id: DIALOGUE_IDS.maraTheBnbTopic,
    npcId: NPC_IDS.maraKells,
    beats: [
      maraLocal(
        EXPRESSION_IDS.neutral,
        "Family business. My parents ran it when people came here on purpose.",
      ),
      maraLocal(
        EXPRESSION_IDS.amused,
        "Every room decorated for families who drove out to watch a projector show.",
      ),
      maraLocal(
        EXPRESSION_IDS.neutral,
        "The tourists stopped coming. The rooms didn't stop existing.",
      ),
      maraLocal(
        EXPRESSION_IDS.firm,
        "So I stopped waiting. Miners, haulers, contractors, anybody working a long stretch out here — that's who fills them now.",
      ),
      maraLocal(EXPRESSION_IDS.amused, "Same beds. Fewer complaints about the pillows."),
      maraLocal(
        EXPRESSION_IDS.neutral,
        "It isn't the business my parents built. It's the one this town actually needed.",
      ),
    ],
  },
  [DIALOGUE_IDS.maraBixTopic]: {
    id: DIALOGUE_IDS.maraBixTopic,
    npcId: NPC_IDS.maraKells,
    beats: [
      maraLocal(
        EXPRESSION_IDS.amused,
        "Bix and I have known each other since we were kids running between these two buildings.",
      ),
      maraLocal(
        EXPRESSION_IDS.neutral,
        "He's decent. He'll tell you the truth even when a lie would make him money.",
      ),
      maraLocal(EXPRESSION_IDS.firm, "He's also still waiting for tourism to come back."),
      maraLocal(
        EXPRESSION_IDS.amused,
        "Years of waiting, and a whole shelf of souvenir mugs to prove it.",
      ),
      maraLocal(EXPRESSION_IDS.neutral, "I love him dearly. He's a dingdong."),
      maraLocal(EXPRESSION_IDS.amused, "Don't tell him I said the first part."),
    ],
  },
  // Curly Must-Stash (#292). The offer, acceptance, and reminder happen in the
  // unfinished room; the turn-in, payment, and follow-up in the finished one.
  [DIALOGUE_IDS.curlyMustStashOffer]: {
    id: DIALOGUE_IDS.curlyMustStashOffer,
    npcId: NPC_IDS.curly,
    beats: [
      curlyLocal(EXPRESSION_IDS.neutral, "Oh! Hello! You must be one of the locals. I'm Curly."),
      curlyLocal(
        EXPRESSION_IDS.smile,
        "I'm backpacking, actually. Taking a year off to see how people live on other planets. Really immerse myself in the culture.",
      ),
      curlyLocal(EXPRESSION_IDS.neutral, "I promised myself I'd travel light this time."),
      curlyLocal(EXPRESSION_IDS.smile, "The backpack's in there somewhere."),
      curlyLocal(
        EXPRESSION_IDS.concerned,
        "Mara's been wonderful. Although she did say I couldn't keep the rest of my luggage in the hallway.",
      ),
      curlyLocal(
        EXPRESSION_IDS.neutral,
        "I've already got a perfectly good storage container. The trouble is, there's nowhere to mount it.",
      ),
      curlyLocal(
        EXPRESSION_IDS.smile,
        "She mentioned you know your way around a welder. Think you could build me something?",
      ),
      curlyLocal(
        EXPRESSION_IDS.neutral,
        "Three hundred Credits? Half now, half when you're finished. Is that fair? I wouldn't want to shortchange you.",
      ),
    ],
  },
  [DIALOGUE_IDS.curlyMustStashAccepted]: {
    id: DIALOGUE_IDS.curlyMustStashAccepted,
    npcId: NPC_IDS.curly,
    // The confirmed first payment is shown right after he hands it over.
    creditsReceiptAfterBeats: 1,
    beats: [
      curlyLocal(
        EXPRESSION_IDS.smile,
        "Brilliant! Here's the first hundred and fifty. That should get you started.",
      ),
      curlyLocal(
        EXPRESSION_IDS.neutral,
        "I've already got the container, so it's just the mount you need to build. I'll leave the technical details to you.",
      ),
      curlyLocal(EXPRESSION_IDS.concerned, "Right. I'll get this lot out of your way."),
      curlyLocal(EXPRESSION_IDS.neutral, "...Some of it, anyway."),
    ],
  },
  [DIALOGUE_IDS.curlyMustStashRepairReminder]: {
    id: DIALOGUE_IDS.curlyMustStashRepairReminder,
    npcId: NPC_IDS.curly,
    beats: [
      curlyLocal(EXPRESSION_IDS.smile, "How's the mount coming along?"),
      curlyLocal(
        EXPRESSION_IDS.concerned,
        "Mara says the luggage pile is becoming a structural concern. I'm fairly sure she's exaggerating.",
      ),
      curlyLocal(
        EXPRESSION_IDS.neutral,
        "Take your time, though. You've already got the first half, and I meant it.",
      ),
    ],
  },
  [DIALOGUE_IDS.curlyMustStashTurnIn]: {
    id: DIALOGUE_IDS.curlyMustStashTurnIn,
    npcId: NPC_IDS.curly,
    beats: [
      curlyFinished(EXPRESSION_IDS.smile, "You did it! Look at that. An entire patch of floor!"),
      curlyFinished(
        EXPRESSION_IDS.neutral,
        "That mount looks fantastic. Mara's going to think I've checked out.",
      ),
      curlyFinished(
        EXPRESSION_IDS.smile,
        "I've got the other hundred and fifty ready for you. A deal's a deal!",
      ),
    ],
  },
  [DIALOGUE_IDS.curlyMustStashCompletion]: {
    id: DIALOGUE_IDS.curlyMustStashCompletion,
    npcId: NPC_IDS.curly,
    // The confirmed second payment is shown right after he hands it over.
    creditsReceiptAfterBeats: 1,
    beats: [
      curlyFinished(
        EXPRESSION_IDS.smile,
        "There you go! Honestly, I feel like I got the better end of this deal.",
      ),
      curlyFinished(
        EXPRESSION_IDS.neutral,
        "Now, if I can work out which suitcase has my toothbrush...",
      ),
    ],
  },
  [DIALOGUE_IDS.curlyPostCurlyMustStash]: {
    id: DIALOGUE_IDS.curlyPostCurlyMustStash,
    npcId: NPC_IDS.curly,
    beats: [
      curlyFinished(EXPRESSION_IDS.smile, "Good news! I found my toothbrush."),
      curlyFinished(EXPRESSION_IDS.neutral, "It was in the emergency toothbrush case."),
      curlyFinished(
        EXPRESSION_IDS.smile,
        "The mount's brilliant, by the way. I'm thinking of taking up a hobby now that I have floor space.",
      ),
    ],
  },
  // Curly's replayable topics (#292). Seeing the Worlds is authored against
  // the unfinished room, which resolves to the finished one once the mount is
  // in, so replaying it never shows a room the player has already changed.
  [DIALOGUE_IDS.curlySeeingTheWorldsTopic]: {
    id: DIALOGUE_IDS.curlySeeingTheWorldsTopic,
    npcId: NPC_IDS.curly,
    beats: [
      curlyLocal(
        EXPRESSION_IDS.smile,
        "I've been traveling for months! The idea is to get away from all the luxury and experience how real people live.",
      ),
      curlyLocal(
        EXPRESSION_IDS.neutral,
        "Everyone told me to pack light. I did. I had my winter equipment shipped separately.",
      ),
      curlyLocal(
        EXPRESSION_IDS.smile,
        "Back home, everything just sort of arrives when you need it. Here, people actually make things. Fix things. It's fascinating.",
      ),
      curlyLocal(
        EXPRESSION_IDS.concerned,
        "Mara's already taught me quite a bit. Apparently a room reservation doesn't include someone to unpack your luggage.",
      ),
    ],
  },
  [DIALOGUE_IDS.curlyBackHomeTopic]: {
    id: DIALOGUE_IDS.curlyBackHomeTopic,
    npcId: NPC_IDS.curly,
    beats: [
      curlyFinished(
        EXPRESSION_IDS.neutral,
        "My parents weren't exactly thrilled about the gap year. Dad thought I should try working for a change.",
      ),
      curlyFinished(
        EXPRESSION_IDS.smile,
        "So I bought an expedition kit and booked passage offworld. Seemed like a reasonable compromise.",
      ),
      curlyFinished(
        EXPRESSION_IDS.neutral,
        "I've seen some incredible places, but usually from hotel balconies. This is the first place I've actually gotten to know anyone.",
      ),
      curlyFinished(
        EXPRESSION_IDS.smile,
        "And look! I've already commissioned a construction project. Dad can't say I'm doing nothing productive.",
      ),
      curlyFinished(EXPRESSION_IDS.concerned, "He keeps asking when I'm coming home, though."),
      curlyFinished(EXPRESSION_IDS.neutral, "Honestly? I think I'd rather stay a little longer."),
    ],
  },
  // Toll Kade's three replayable topics (#357). The copy and its expression cues
  // are owner-approved and locked verbatim in the issue: nothing here paraphrases
  // them, and none of them carries a Mission, a Trade action or a price. Fuel
  // quantities are Toll's own spoken words rather than values read from content.
  [DIALOGUE_IDS.tollSkatbollTopic]: {
    id: DIALOGUE_IDS.tollSkatbollTopic,
    npcId: NPC_IDS.tollKade,
    beats: [
      tollLocal(
        EXPRESSION_IDS.neutral,
        "Skatboll's the planet. Holo Hollow's the town. You'd be amazed how often those get swapped on a shipping label.",
      ),
      tollLocal(
        EXPRESSION_IDS.friendly,
        "This Landing isn't much to look at, but the lights work and there's room to unload. I'll take that over fancy any day.",
      ),
      tollLocal(
        EXPRESSION_IDS.skeptical,
        "A fancy landing pad doesn't help much if the fuel isn't there when you need it.",
      ),
    ],
  },
  [DIALOGUE_IDS.tollStillreachTopic]: {
    id: DIALOGUE_IDS.tollStillreachTopic,
    npcId: NPC_IDS.tollKade,
    beats: [
      tollLocal(
        EXPRESSION_IDS.thoughtful,
        "Stillreach is a long enough haul that you want to count your fuel both ways. Getting there is only half the job.",
      ),
      tollLocal(
        EXPRESSION_IDS.neutral,
        "I've got a Last Leg Trading terminal at the station there. Same business. Automated counter.",
      ),
      tollLocal(
        EXPRESSION_IDS.friendly,
        "Efficient little thing. Takes payments, hands out supplies, and has never laughed at one of my jokes. Professional jealousy.",
      ),
    ],
  },
  [DIALOGUE_IDS.tollFuelTopic]: {
    id: DIALOGUE_IDS.tollFuelTopic,
    npcId: NPC_IDS.tollKade,
    beats: [
      tollLocal(
        EXPRESSION_IDS.neutral,
        "A full Small Fuel Canister holds fifty fuel units. One load, and the canister's gone. That's the arrangement.",
      ),
      tollLocal(
        EXPRESSION_IDS.thoughtful,
        "Check your tank first. Less than fifty units of room, and some of that fuel goes to waste.",
      ),
      tollLocal(
        EXPRESSION_IDS.friendly,
        "You can make fuel yourself or buy it from me. Either way, I'd keep enough to get home.",
      ),
      tollLocal(
        EXPRESSION_IDS.skeptical,
        "A full cargo hold's nice. A ship that can move it is nicer.",
      ),
    ],
  },
  // Not From Around Here (#369). First-pass writing for owner review. Every line
  // is spoken by the NPC: the player stays silent, and nothing here explains the
  // mineral, Runeworking or RuneSpace. Wade and Tansy hold an optional hint scene
  // that plays wherever each of them is standing for this character; Toll's is the
  // required one. The researcher is never named and never given a pronoun.
  [DIALOGUE_IDS.wadeNotFromAroundHereHint]: {
    id: DIALOGUE_IDS.wadeNotFromAroundHereHint,
    npcId: NPC_IDS.wadeRusk,
    presentsAtCurrentVenue: true,
    beats: [
      wadeLocal(EXPRESSION_IDS.neutral, "Let me see that."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Hm. That's not Ferrite. Not shale. Not anything that's come through my gate.",
      ),
      wadeLocal(EXPRESSION_IDS.concerned, "And it isn't salvage. I'd know salvage."),
      wadeLocal(
        EXPRESSION_IDS.neutral,
        "Tolliver Kade, over at Holo Hollow Landing. Runs Last Leg Trading. He hauls the odd cargo, the kind nobody wants to explain.",
      ),
      wadeLocal(EXPRESSION_IDS.scowl, "Go ask him. I've got work."),
    ],
  },
  [DIALOGUE_IDS.tansyNotFromAroundHereHint]: {
    id: DIALOGUE_IDS.tansyNotFromAroundHereHint,
    npcId: NPC_IDS.tansyRusk,
    presentsAtCurrentVenue: true,
    beats: [
      tansyLocal(EXPRESSION_IDS.smile, "Oh, that's interesting. Hold on. Can I see it?"),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "Huh. It's not Ferrite, and it's not any shale I've cut. And I've cut a lot of rock.",
      ),
      tansyLocal(
        EXPRESSION_IDS.concerned,
        "I'd keep it away from the Cutter until someone knows what it is. Mystery mineral, hot end. I like my fingers where they are.",
      ),
      tansyLocal(
        EXPRESSION_IDS.neutral,
        "I don't know what it is. But I've heard Tolliver Kade, who runs Last Leg Trading over at Holo Hollow Landing, has hauled some odd equipment out to Stillreach.",
      ),
      tansyLocal(EXPRESSION_IDS.smile, "Anyway. Worth asking him. Worst case, you've had a walk."),
    ],
  },
  [DIALOGUE_IDS.tollNotFromAroundHere]: {
    id: DIALOGUE_IDS.tollNotFromAroundHere,
    npcId: NPC_IDS.tollKade,
    beats: [
      tollLocal(EXPRESSION_IDS.thoughtful, "Let's have a look."),
      tollLocal(EXPRESSION_IDS.neutral, "Hm. I couldn't tell you what that is."),
      tollLocal(
        EXPRESSION_IDS.thoughtful,
        "But I've hauled crates marked “mineral samples, handle with care.” Small, odd, packed like they might bite. Yours would fit right in.",
      ),
      tollLocal(
        EXPRESSION_IDS.friendly,
        "They went to a customer on Stillreach. A researcher, up a hill in a workshop. Orders strange equipment, strange supplies, and never says what any of it's for.",
      ),
      tollLocal(
        EXPRESSION_IDS.skeptical,
        "I haul it. I don't ask. Excellent business model. Terrible dinner conversation.",
      ),
      tollLocal(
        EXPRESSION_IDS.neutral,
        "Hilltop Workshop. If anyone can tell you what that is, it's whoever's up that hill.",
      ),
      tollLocal(EXPRESSION_IDS.friendly, "No rush. The hill isn't going anywhere. Probably."),
    ],
  },
  // The Wise Old Enby at Hilltop Workshop (#389). First-pass owner-direction
  // script, authored for owner preview. Every line is the Enby's: the player
  // stays silent. They are "the Wise Old Enby" and they/them wherever anyone
  // refers to them; nothing here explains their identity or their past. The three
  // ordinary topics say nothing about how runes work.
  [DIALOGUE_IDS.wiseOldEnbyGreetingTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyGreetingTopic,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "Oh! A visitor. I was beginning to think only the wind knew the path up here.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Come in. Mind that cable by your feet. It bites, but only when it's feeling neglected.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "I came to this hill for the quiet. Then I built a machine that hums all night. Research does enjoy the last word.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "The Wise Old Enby, at your service. ‘Old’ I can prove. ‘Wise’ is still under review.",
      ),
    ],
  },
  // Werner's three replayable topics (#429). The copy, its order and the expression on
  // every beat are owner-approved and locked verbatim in the issue and the Notion Canon:
  // nothing here paraphrases them. They are evergreen, read the same for a newcomer and
  // for a Lapidary expert, and are presentation only: no item, price, XP, Mission or
  // Trade action. His signature line is reserved for his later introductory Mission
  // and is deliberately not used here.
  [DIALOGUE_IDS.wernerAboutTheLabTopic]: {
    id: DIALOGUE_IDS.wernerAboutTheLabTopic,
    npcId: NPC_IDS.werner,
    beats: [
      wernerLocal(
        EXPRESSION_IDS.neutral,
        "It's a mineral laboratory. I would have thought the equipment made that obvious.",
      ),
      wernerLocal(
        EXPRESSION_IDS.thoughtful,
        "The quarry provides the raw material. I provide the precision. There's a considerable difference.",
      ),
      wernerLocal(
        EXPRESSION_IDS.intense,
        "And don't touch my equipment. You have no idea what you're handling.",
      ),
    ],
  },
  [DIALOGUE_IDS.wernerTheQuarryTopic]: {
    id: DIALOGUE_IDS.wernerTheQuarryTopic,
    npcId: NPC_IDS.werner,
    beats: [
      wernerLocal(
        EXPRESSION_IDS.neutral,
        "Most people walk through that quarry looking for something valuable. They don't understand what they're looking at.",
      ),
      wernerLocal(
        EXPRESSION_IDS.thoughtful,
        "Every stone has a structure. Every fracture tells you something. You simply have to know how to listen.",
      ),
      wernerLocal(EXPRESSION_IDS.amused, "Of course, knowing how to listen is a rare quality."),
    ],
  },
  [DIALOGUE_IDS.wernerGemCuttingTopic]: {
    id: DIALOGUE_IDS.wernerGemCuttingTopic,
    npcId: NPC_IDS.werner,
    beats: [
      wernerLocal(
        EXPRESSION_IDS.thoughtful,
        "A gemstone doesn't become valuable because you found it. Its potential was always there.",
      ),
      wernerLocal(
        EXPRESSION_IDS.intense,
        "One wrong cut and you've destroyed something that took millions of years to form.",
      ),
      wernerLocal(
        EXPRESSION_IDS.neutral,
        "You can spend a lifetime mastering the cut. The stone will still demand your full attention.",
      ),
    ],
  },
  [DIALOGUE_IDS.wiseOldEnbyWorkshopTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyWorkshopTopic,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "It's part home, part laboratory, and part collection of things I'm absolutely going to put away someday.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "The ground on this hill behaves differently. I followed an odd signal here, and decided staying close was better than guessing from a distance.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "The roof leaks. The equipment works. On balance, I'd say I've done rather well.",
      ),
    ],
  },
  [DIALOGUE_IDS.wiseOldEnbyStillreachTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyStillreachTopic,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "Stillreach is quiet, as worlds go. I like that. Gives you room to notice the small things.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "The people at the landing station keep the supplies moving. I keep the instruments running. A decent arrangement.",
      ),
      // The Enby's own reason for staying (#393), owner-approved and verbatim,
      // before the topic's unchanged closing line.
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "The resonance brought me to Stillreach. That's true, but it's only half an answer.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "Where I lived before, people took an exhausting interest in telling me who I ought to be. Here, I've found room to be myself.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "The neighbors still complain, mind you. These days it's about the noise coming from my workshop. A much more reasonable grievance.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Whatever brought you here, don't rush past the hills. There's more to this place than the sky.",
      ),
    ],
  },
  // The in-person offer of Not From Around Here: a visitor who has not started the
  // mystery shows the Enby a carried Fragment or Runestone. Not in the issue's
  // script; a short placeholder for owner review that leaves the explanation to
  // the revelation itself, and works whichever stone is shown.
  [DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereOffer]: {
    id: DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Now that's an interesting thing to be carrying around.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "If you'd like to find out what it is, I may be able to help. Fair warning: it's a longer story than it looks.",
      ),
    ],
  },
  // The revelation that completes Not From Around Here. The ordinary opening is
  // the direct Stillreach route; the Toll opening plays only when Toll's lead was
  // genuinely acknowledged. After their two opening beats both sequences continue
  // into the same eight-beat explanation, written out in each so QC Studio can
  // edit them; tests/unit/wise-old-enby.test.ts keeps the two copies identical.
  [DIALOGUE_IDS.wiseOldEnbyNotFromAroundHere]: {
    id: DIALOGUE_IDS.wiseOldEnbyNotFromAroundHere,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "You've come looking for someone who understands unusual minerals. Well, you've found a rather well-equipped fool for the job.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Tell me what you found. Was there a hum you could feel more than hear?",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "That wasn't ordinary stone. You noticed it, didn't you? A vibration with no sensible source.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "What you found was rune material. Fragments and intact Runestones both resonate with something we call RuneSpace.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Not another planet. Not somewhere you'll find on a flight chart. Think of it as the space between worlds.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "Most of the time we barely know it's there. Sometimes something on this side answers something on the other.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "I followed traces of it to Stillreach. They were strongest on this hill, so I built a workshop and made myself comfortable.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Some of the useful things around here? Pulled straight out of RuneSpace. Better than ordering replacements. Slightly worse for the laws of physics.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "These fragments give us a way to listen. With the right equipment, you can do rather more than listen.",
      ),
      enbyLocal(EXPRESSION_IDS.friendly, "When you're ready, I'll show you. One step at a time."),
    ],
  },
  [DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereTollSent]: {
    id: DIALOGUE_IDS.wiseOldEnbyNotFromAroundHereTollSent,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Toll sent you, did they? That hauler has an excellent eye for someone else's problem.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Strange mineral, odd vibrations. Yes. I think I know why you made the trip.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "That wasn't ordinary stone. You noticed it, didn't you? A vibration with no sensible source.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "What you found was rune material. Fragments and intact Runestones both resonate with something we call RuneSpace.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Not another planet. Not somewhere you'll find on a flight chart. Think of it as the space between worlds.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "Most of the time we barely know it's there. Sometimes something on this side answers something on the other.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "I followed traces of it to Stillreach. They were strongest on this hill, so I built a workshop and made myself comfortable.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Some of the useful things around here? Pulled straight out of RuneSpace. Better than ordering replacements. Slightly worse for the laws of physics.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "These fragments give us a way to listen. With the right equipment, you can do rather more than listen.",
      ),
      enbyLocal(EXPRESSION_IDS.friendly, "When you're ready, I'll show you. One step at a time."),
    ],
  },
  [DIALOGUE_IDS.wiseOldEnbyAboutRuneSpaceTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyAboutRuneSpaceTopic,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "RuneSpace is the space between. I've spent years learning where it touches our world.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "I know enough to use some of its patterns. Not enough to pretend I've solved it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Anyone who says they've figured out the entire universe probably needs a longer measuring tape.",
      ),
    ],
  },
  // First Runeworking Lesson (#391). The owner-approved script, verbatim: one
  // beat per passage in the Enby's own expressions, the player silent throughout.
  //
  // The offer is made in person only to a character who finished Not From Around
  // Here before the lesson existed; everyone else arrives already accepted, by
  // the mystery's continuation.
  [DIALOGUE_IDS.wiseOldEnbyFirstLessonOffer]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstLessonOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Ah, there you are! I was hoping you'd come back. There's only so much conversation one can have with a machine, and this one is a terrible listener.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Well, that's not entirely fair. Listening is precisely what I built it for.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "You know what RuneSpace is now. Would you like to learn how to do something useful with it? I promise the equipment is considerably more reliable than it looks.",
      ),
    ],
  },
  // The lesson itself: the mystery's completion scene for a character whose
  // turn-in accepts the lesson, the accepted continuation of the in-person offer,
  // and — written out again in the replayable topic below so QC Studio can edit
  // each — the instructions. It closes with the Enby's Mining-level material
  // advice, the shared skill-level dialogue the "Where to Find Fragments" topic
  // also uses (`SKILL_LEVEL_DIALOGUES`). tests/unit/first-runeworking-lesson.test.ts
  // keeps the two copies identical.
  [DIALOGUE_IDS.wiseOldEnbyFirstLesson]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstLesson,
    npcId: NPC_IDS.wiseOldEnby,
    skillLevelDialogueId: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "One step at a time, as promised. Now, you may have noticed that rather impressive collection of questionable engineering over there.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "That's my Resonance Rig. I built it after following the disturbances in RuneSpace to this very hill. The signal was stronger here than anywhere else I'd been.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I wasn't trying to build a doorway into RuneSpace. I was trying to build an ear. The distinction has saved me a considerable amount of property damage.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Rune Fragments already resonate with that space between worlds. With a little careful attunement, we can persuade one to listen for something specific.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "A Resonance Echo. A disturbance hidden somewhere out there, waiting to be discovered.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "One Rune Fragment, properly attuned in the Rig, becomes what I call a Beginner Echo Seeker. Rather a grand name for a little piece of stone, but accuracy is important.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "I'd like you to make three. Not because three is a particularly magical number, mind you. It's just enough practice to make sure you've got the hang of it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And please, use the Rig as often as you like. I built it to be used. Not admired from a safe distance, as the instruction manual recommends.",
      ),
    ],
  },
  // The two variants of the Enby's advice on Rune Fragments, chosen by the
  // character's current Mining level (`SKILL_LEVEL_DIALOGUES`). Only the one that
  // applies is ever played.
  [DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice]: {
    id: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "If you're short on Fragments, try the Prospecting Quarry. They turn up among the ordinary stone from time to time.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "There's a place called Harmonic Workings where the fragments are much more plentiful. Tougher digging, though. I'd get a little more Mining experience before trying your luck there.",
      ),
    ],
  },
  [DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced]: {
    id: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "You look like you've done your share of Mining. I'd recommend Harmonic Workings. The rune material runs right through the rock there. Far better than hoping to turn up the odd Fragment at the Quarry.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Do be careful. The stones have a peculiar habit of humming back when you disturb them. Quite rude, really.",
      ),
    ],
  },
  // While fewer than three Seekers have been attuned since the lesson began.
  [DIALOGUE_IDS.wiseOldEnbyFirstLessonReminder]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstLessonReminder,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "How's the attunement coming along? Don't rush it. RuneSpace has been there a very long time. I doubt it's going anywhere before supper.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Three successful Seekers, remember. The Rig will take care of the delicate work, so long as you give it a Fragment to work with.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And don't worry about wearing the machine out. I've been trying for years. It appears to be winning.",
      ),
    ],
  },
  // Three attunements done: the turn-in, whose explicit control completes the lesson.
  [DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstLessonTurnIn,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Ah! Look at you! Three successful attunements, and the workshop is still standing!",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "You're already ahead of my first attempt. We don't discuss that one. Particularly not with the neighbors.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Let me tell you what you've made. Each Seeker is attuned to detect Resonance Echoes — little disturbances where RuneSpace brushes against the world we know.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "They won't tell you exactly where an Echo is hiding. But they can point you in the right direction. Sometimes that's all you need.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "You've learned how to make them. Next, we'll learn how to listen. Keep those Seekers handy.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And well done, genuinely. It's rather nice having someone else around who can operate the equipment without setting anything on fire.",
      ),
    ],
  },
  // The reward the turn-in already granted, presented once after it succeeds.
  [DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstLessonCompletion,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      {
        kind: "skill_xp",
        skillId: SKILL_IDS.runeworking,
        amount: 150,
        backgroundId: hilltopWorkshop,
        text: "",
      },
    ],
  },
  // The lesson again, as a replayable topic while it is accepted and after.
  [DIALOGUE_IDS.wiseOldEnbyFirstLessonTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstLessonTopic,
    npcId: NPC_IDS.wiseOldEnby,
    skillLevelDialogueId: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "One step at a time, as promised. Now, you may have noticed that rather impressive collection of questionable engineering over there.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "That's my Resonance Rig. I built it after following the disturbances in RuneSpace to this very hill. The signal was stronger here than anywhere else I'd been.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I wasn't trying to build a doorway into RuneSpace. I was trying to build an ear. The distinction has saved me a considerable amount of property damage.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Rune Fragments already resonate with that space between worlds. With a little careful attunement, we can persuade one to listen for something specific.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "A Resonance Echo. A disturbance hidden somewhere out there, waiting to be discovered.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "One Rune Fragment, properly attuned in the Rig, becomes what I call a Beginner Echo Seeker. Rather a grand name for a little piece of stone, but accuracy is important.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "I'd like you to make three. Not because three is a particularly magical number, mind you. It's just enough practice to make sure you've got the hang of it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And please, use the Rig as often as you like. I built it to be used. Not admired from a safe distance, as the instruction manual recommends.",
      ),
    ],
  },
  // Nothing but the Mining-level advice: the topic is the skill-level dialogue,
  // so a player who comes back after more Mining hears the other variant.
  [DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic,
    npcId: NPC_IDS.wiseOldEnby,
    skillLevelDialogueId: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
    beats: [],
  },
  [DIALOGUE_IDS.wiseOldEnbyAboutTheSeekersTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyAboutTheSeekersTopic,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "You've learned how to make Seekers. The next challenge is learning what they're telling you.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Keep a few handy. There are things worth finding out there, and I suspect you've only scratched the surface.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "The Rig is yours to use whenever you need it. Just leave the roof attached, would you? It's already doing the bare minimum.",
      ),
    ],
  },
  // First Resonance Echo (#393). The owner-approved script, verbatim: one beat
  // per line in the Enby's own expressions, the player silent throughout.
  //
  // The gift scene's opening line is the offer (the in-person route, for a
  // character who finished the lesson earlier or had no room at its turn-in);
  // the rest — the two Seekers handed over, then how to listen — is the offer's
  // accepted continuation. A lesson turn-in that accepts the Mission plays both
  // after its own reward, and only when the Seekers were actually given.
  [DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstEchoOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Well! You've learned to make Seekers. Now comes the interesting part. Finding out whether they have anything worthwhile to say.",
      ),
    ],
  },
  [DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstEchoInstructions,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "I've set two more aside for you. Consider them a little encouragement. Or insurance against an uncooperative universe.",
      ),
      enbyItem(ITEM_IDS.beginnerEchoSeeker, FIRST_RESONANCE_ECHO_GIFT_SEEKERS),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I recommend carrying a few. It can be terribly embarrassing to discover something remarkable just as you've run out of ways to look for it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "An Echo is a disturbance where RuneSpace brushes against our own. Usually quite faint. The sort of thing you'd walk past a thousand times without knowing it was there.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "But your Seekers have been attuned to recognize one. Take a Seeker from your Inventory, find yourself a place to stand, and use it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Give it a few moments. If there's an Echo at your location, the Seeker will resonate with it. And you may find that RuneSpace has left you something rather interesting.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Do keep your expectations reasonable. The universe is under no obligation to give you anything useful. I've reminded it of this several times.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "If the Echo is elsewhere, the Seeker will tell you which way to look. East or west. North or south. Sometimes you'll already be lined up in one direction.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Remember that the directions are measured from where you took the reading. You can check your last reading in the Seeker's details whenever you need a reminder.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "One important detail: a Seeker listens for Echoes on the planet you're standing on. Stillreach has its own disturbances. Skatboll has others.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "And if you leave one world before you've finished searching, don't worry. Come back and your last reading will still be there. Those Echoes can be patient things.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Each reading uses up a Seeker, I'm afraid. Rather like a match. An extraordinarily expensive match that points toward mysteries instead of setting your curtains on fire.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "And if you run out? Make some more. The Echo won't wander off simply because you've exhausted your supplies.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Oh, and do leave some room in your Inventory before you go looking. Sometimes an Echo gives up an item, and you'll need somewhere to put it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Otherwise, it slips straight back into RuneSpace, perhaps to be found by a better-prepared traveler. Rather judgmental, coming from a place that hasn't invented pockets.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Find one. Just one, for now. Then come back and tell me how it went.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And don't assume you need to travel halfway across Stillreach. For all we know, there's one under your feet. The universe does enjoy making fools of people with elaborate travel plans.",
      ),
    ],
  },
  // Both Seekers would not fit (slots or mass alike): nothing was given and the
  // Mission was not accepted. The lesson before it stays complete and paid.
  [DIALOGUE_IDS.wiseOldEnbyFirstEchoCapacity]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstEchoCapacity,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Ah. A small logistical complication. I've got two more Seekers for you, but your pockets appear to have lodged a formal complaint.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Make a little room and come back. I'll keep them here for you. The universe has waited this long to be explored. Another few minutes won't hurt.",
      ),
    ],
  },
  // While no Echo has been found since the Mission began.
  [DIALOGUE_IDS.wiseOldEnbyFirstEchoReminder]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstEchoReminder,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(EXPRESSION_IDS.friendly, "Back already? Any promising readings?"),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Try to narrow things down. Every reading tells you something, even when it doesn't find what you're looking for.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I once spent an entire afternoon following a particularly interesting resonance, only to discover I'd been listening to my own equipment.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Well, mostly my equipment. I'm still not entirely certain about the last reading.",
      ),
    ],
  },
  // One Echo found: the debrief, whose explicit control completes the Mission.
  [DIALOGUE_IDS.wiseOldEnbyFirstEchoTurnIn]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstEchoTurnIn,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "You're back! And judging by that look on your face, I'd say you've found something.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Remarkable, isn't it? One moment, you're standing in an ordinary place on an ordinary planet. The next, you've reached into something we barely understand.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I remember my first successful Echo. Nearly fell out of my chair. Which was particularly impressive, considering I was standing.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "You see, that's what makes RuneSpace so fascinating. We can measure its disturbances. We can learn to follow them. And sometimes, we can even retrieve something from the other side.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "But we still don't know why those things are there. Or what decides where they turn up.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "You've done something wonderful today. You've learned that a mystery doesn't have to remain a mystery forever.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Of course, solving one question tends to produce three more. Terrible habit. I've been putting up with it for years.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Keep exploring. Keep listening. And do come back now and then. It's nice having someone to share the strange bits of the universe with.",
      ),
    ],
  },
  // The reward the turn-in already granted, presented once after it succeeds.
  [DIALOGUE_IDS.wiseOldEnbyFirstEchoCompletion]: {
    id: DIALOGUE_IDS.wiseOldEnbyFirstEchoCompletion,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      {
        kind: "skill_xp",
        skillId: SKILL_IDS.runeworking,
        amount: FIRST_RESONANCE_ECHO_REWARD_XP,
        backgroundId: hilltopWorkshop,
        text: "",
      },
    ],
  },
  // How to listen again, as a replayable topic while the Mission is accepted and
  // after: no gift, no command. tests/unit/first-resonance-echo.test.ts keeps it
  // identical to the instructions above.
  [DIALOGUE_IDS.wiseOldEnbyHowToListenTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyHowToListenTopic,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "An Echo is a disturbance where RuneSpace brushes against our own. Usually quite faint. The sort of thing you'd walk past a thousand times without knowing it was there.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "But your Seekers have been attuned to recognize one. Take a Seeker from your Inventory, find yourself a place to stand, and use it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Give it a few moments. If there's an Echo at your location, the Seeker will resonate with it. And you may find that RuneSpace has left you something rather interesting.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Do keep your expectations reasonable. The universe is under no obligation to give you anything useful. I've reminded it of this several times.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "If the Echo is elsewhere, the Seeker will tell you which way to look. East or west. North or south. Sometimes you'll already be lined up in one direction.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Remember that the directions are measured from where you took the reading. You can check your last reading in the Seeker's details whenever you need a reminder.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "One important detail: a Seeker listens for Echoes on the planet you're standing on. Stillreach has its own disturbances. Skatboll has others.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "And if you leave one world before you've finished searching, don't worry. Come back and your last reading will still be there. Those Echoes can be patient things.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Each reading uses up a Seeker, I'm afraid. Rather like a match. An extraordinarily expensive match that points toward mysteries instead of setting your curtains on fire.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "And if you run out? Make some more. The Echo won't wander off simply because you've exhausted your supplies.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Oh, and do leave some room in your Inventory before you go looking. Sometimes an Echo gives up an item, and you'll need somewhere to put it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Otherwise, it slips straight back into RuneSpace, perhaps to be found by a better-prepared traveler. Rather judgmental, coming from a place that hasn't invented pockets.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Find one. Just one, for now. Then come back and tell me how it went.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And don't assume you need to travel halfway across Stillreach. For all we know, there's one under your feet. The universe does enjoy making fools of people with elaborate travel plans.",
      ),
    ],
  },
  [DIALOGUE_IDS.wiseOldEnbyAboutResonanceEchoesTopic]: {
    id: DIALOGUE_IDS.wiseOldEnbyAboutResonanceEchoesTopic,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "There are Echoes all over the place, if you know how to listen. And every world has its own peculiar relationship with RuneSpace.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Your Seekers will keep working long after your first discovery. There's no reason to stop looking.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I certainly haven't. At my age, a good mystery is one of the few things guaranteed to get me out of bed before noon.",
      ),
    ],
  },
  // The Wise Old Enby's repeatable research jobs (#406). Wording is the approved
  // Courier and Survey script and the Calibration implementation-copy draft from
  // the Canon page; all of it is first-pass copy open to playtest revision.
  [DIALOGUE_IDS.researchJobBlocked]: {
    id: DIALOGUE_IDS.researchJobBlocked,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Ah, you're already helping me with something! Let's see that through before I burden you with another assignment.",
      ),
    ],
  },
  [DIALOGUE_IDS.researchCourierOffer]: {
    id: DIALOGUE_IDS.researchCourierOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Oh, perfect timing! I've got a sealed research packet that needs to reach FedHex down at the landing station.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Take it to their terminal, hand it over, then come back to me. Everything inside is already recorded and sealed. No need to concern yourself with the contents.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I'll pay you twenty-five Credits for the round trip. Most of my research stays on this hill. The paperwork, apparently, has more ambitious travel plans.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "No special tools or experience needed. Just a little room in your Inventory and a willingness to stretch your legs. Interested?",
      ),
    ],
  },
  [DIALOGUE_IDS.researchCourierAccepted]: {
    id: DIALOGUE_IDS.researchCourierAccepted,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Wonderful! There you are. One packet, sealed and accounted for. Safe travels!",
      ),
      enbyItem(ITEM_IDS.sealedResearchPacket, 1),
    ],
  },
  [DIALOGUE_IDS.researchCourierRepeatOffer]: {
    id: DIALOGUE_IDS.researchCourierRepeatOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Back for another delivery? I've got a fresh packet ready for you.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Same arrangement as before. Down to FedHex, back up the hill, twenty-five Credits. Shall we?",
      ),
    ],
  },
  [DIALOGUE_IDS.researchCourierCapacity]: {
    id: DIALOGUE_IDS.researchCourierCapacity,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Ah. A small logistical complication. Your Inventory appears to have reached a rather firm opinion about carrying anything else.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Make room for one small packet and come back. I'll keep it safe until then.",
      ),
    ],
  },
  [DIALOGUE_IDS.researchCourierReminder]: {
    id: DIALOGUE_IDS.researchCourierReminder,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Still got that packet? Good. Take it to the FedHex terminal at Stillreach Landing Station. They'll see it on its way.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Then come back here. I'm considerably easier to find than most of the things I study.",
      ),
    ],
  },
  [DIALOGUE_IDS.researchCourierTurnIn]: {
    id: DIALOGUE_IDS.researchCourierTurnIn,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Ah, there you are! Packet delivered, and you've made it back in one piece. Excellent!",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "You know, research is made up of a thousand little tasks like this. It's terribly easy to forget how important they are until one of them doesn't get done.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Now, I believe I promised you something rather more useful than my gratitude. Twenty-five Credits, wasn't it?",
      ),
    ],
  },
  [DIALOGUE_IDS.researchCourierCompletion]: {
    id: DIALOGUE_IDS.researchCourierCompletion,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "There we are. Thank you, genuinely. Come by again if you're looking for more work.",
      ),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyOffer]: {
    id: DIALOGUE_IDS.geologicalSurveyOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "You wouldn't happen to be interested in a bit of fieldwork, would you? Real fieldwork. With a field, and everything.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "I'm comparing surface material from three places: Prospecting Quarry, The Dry Seam, and Harmonic Workings. What the ground looks like on top can tell us quite a lot about what's happening underneath.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "I've got a sampling case with three compartments. Take it to each location and collect a surface specimen. Nothing fancy. No digging, no cutter, and no Mining experience required.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I'd collect them myself, but every time I leave the workshop, something starts making a noise it absolutely wasn't making before. I've begun to suspect they're doing it deliberately.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Bring me all three specimens, and I'll pay you seventy-five Credits. How does that sound?",
      ),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyAccepted]: {
    id: DIALOGUE_IDS.geologicalSurveyAccepted,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Splendid! One case, three compartments. I've even labeled them. A triumph of organizational discipline, if I do say so myself.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Collect the samples in whatever order you like. The case will keep them separated. Bring it back when you've filled all three.",
      ),
      enbyItem(ITEM_IDS.geologicalSampleCase, 1),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyRepeatOffer]: {
    id: DIALOGUE_IDS.geologicalSurveyRepeatOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Back for another survey? Excellent! Stillreach hasn't stopped being interesting, and my notes certainly haven't stopped multiplying.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Same three locations, same sampling case, seventy-five Credits. Shall we give my filing system something else to complain about?",
      ),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyCapacity]: {
    id: DIALOGUE_IDS.geologicalSurveyCapacity,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Ah. A minor logistical difficulty. Science may be limitless, but your Inventory appears to have other ideas.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "The case is quite light, but it does need a little space of its own. Make some room and I'll have it ready for you.",
      ),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyNoProgress]: {
    id: DIALOGUE_IDS.geologicalSurveyNoProgress,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "No specimens yet? That's quite alright. The rocks aren't going anywhere. I'd be considerably more concerned if they were.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "Remember: Prospecting Quarry, The Dry Seam, and Harmonic Workings. One surface sample from each.",
      ),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyPartial]: {
    id: DIALOGUE_IDS.geologicalSurveyPartial,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(EXPRESSION_IDS.friendly, "Ah, making progress! Very good."),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Every specimen tells us something on its own. But it's the comparison I'm interested in. Keep going until you've collected all three.",
      ),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyTurnIn]: {
    id: DIALOGUE_IDS.geologicalSurveyTurnIn,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Ah! There you are! All three specimens, and not a single one appears to have escaped. Wonderful!",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Three very different places, three pieces of the same planet. Now comes the interesting part: finding out what they have in common.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And thanks to you, I can do that without leaving my workshop unattended. My instruments will be terribly disappointed.",
      ),
      enbyLocal(EXPRESSION_IDS.friendly, "Seventy-five Credits, as promised. You've earned them."),
    ],
  },
  [DIALOGUE_IDS.geologicalSurveyCompletion]: {
    id: DIALOGUE_IDS.geologicalSurveyCompletion,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Thank you, genuinely. Good fieldwork is worth more than people give it credit for.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And if you're ever looking for more, I have enough unanswered questions to keep us both busy for approximately the rest of our lives.",
      ),
    ],
  },
  [DIALOGUE_IDS.resonanceCalibrationOffer]: {
    id: DIALOGUE_IDS.resonanceCalibrationOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "There's something peculiar about the resonance at The Low Hum. It never quite settles into the same pattern twice.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Fascinating when you're studying it. Considerably less convenient when you're trying to use it for transportation.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "You see, there's a natural resonance at the Crash Site on Skatboll. With the right measurements, I can open a passage through RuneSpace and send someone directly there.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Take my Resonance Sampler to The Low Hum and record its current signature. Bring the instrument back, and I'll use that reading to send you to Skatboll. No Credits, no fuel, just a little fieldwork.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "One important detail: the passage carries you and whatever you're carrying. Your ship and Cargo Hold stay exactly where they are.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I've yet to devise a reliable way to fit an entire spacecraft through one of these passages. My workshop insurance is grateful for that.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Interested? There's no rush. Only take the assignment when you're considering a trip back to Skatboll.",
      ),
    ],
  },
  [DIALOGUE_IDS.resonanceCalibrationAccepted]: {
    id: DIALOGUE_IDS.resonanceCalibrationAccepted,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Excellent! Here's the sampler. Small, light, and considerably more sophisticated than it looks.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "I finally installed a handle on this version. You'd be surprised how much that improved the fieldwork.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Take it to The Low Hum, record the resonance, and bring it back. I'll handle the rest.",
      ),
      enbyItem(ITEM_IDS.resonanceSampler, 1),
    ],
  },
  [DIALOGUE_IDS.resonanceCalibrationRepeatOffer]: {
    id: DIALOGUE_IDS.resonanceCalibrationRepeatOffer,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Another passage to Skatboll? Certainly! I imagine The Low Hum has changed its tune again by now.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Fresh reading, same destination. The sampler does the measuring, I do the complicated bit, and you get to travel without sitting in a ship for several minutes. Shall we?",
      ),
    ],
  },
  [DIALOGUE_IDS.resonanceCalibrationCapacity]: {
    id: DIALOGUE_IDS.resonanceCalibrationCapacity,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Ah. It seems your Inventory has reached full capacity. Unfortunately, I haven't invented a sampler that can be carried without actually carrying it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Make a little room and come back. It's only a hundred grams.",
      ),
    ],
  },
  [DIALOGUE_IDS.resonanceCalibrationReminder]: {
    id: DIALOGUE_IDS.resonanceCalibrationReminder,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "The sampler needs a fresh signature from The Low Hum. The resonance changes over time, you see. An old reading won't tell me quite what I need.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Science can be terribly inconsiderate about reusing perfectly good measurements.",
      ),
    ],
  },
  [DIALOGUE_IDS.resonanceCalibrationDeparture]: {
    id: DIALOGUE_IDS.resonanceCalibrationDeparture,
    npcId: NPC_IDS.wiseOldEnby,
    beats: [
      enbyLocal(EXPRESSION_IDS.friendly, "Ah! There you are. Let's have a look at that reading."),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "Yes... yes, that's quite interesting. The pattern has shifted again. Only slightly, but enough to matter.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "Remarkable stuff, RuneSpace. Never stays quite where you left it. Rather like my glasses.",
      ),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Well! The measurements look good. I can open a passage to Skatboll's Crash Site whenever you're ready.",
      ),
      enbyLocal(
        EXPRESSION_IDS.neutral,
        "Remember, only you and your carried belongings will make the trip. Your ship, its fuel, and its Cargo Hold will remain wherever you've left them.",
      ),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "If your ship is still on Stillreach, you'll need to arrange your own transportation back to retrieve it.",
      ),
      enbyLocal(
        EXPRESSION_IDS.amused,
        "And before you ask: no, I won't be throwing the ship after you.",
      ),
      enbyLocal(EXPRESSION_IDS.friendly, "Ready to go?"),
      enbyLocal(EXPRESSION_IDS.friendly, "If you're ready, stand just there. Yes, that spot."),
      enbyLocal(
        EXPRESSION_IDS.thoughtful,
        "When the resonance takes hold, you'll feel a slight sensation. Perfectly normal.",
      ),
      enbyLocal(EXPRESSION_IDS.amused, "Probably."),
      enbyLocal(
        EXPRESSION_IDS.friendly,
        "Whenever you're ready, then. Safe travels! And do come back sometime. The universe is much more interesting with company.",
      ),
    ],
  },
} as const satisfies Record<DialogueId, DialogueSequence>;

/** Ordered authoritative dialogue catalog consumed by the RuneSpace adapter. */
export const DIALOGUE_SEQUENCES = Object.values(dialogue);

/**
 * Every authored skill-level-dependent dialogue (#391). See `SkillLevelDialogue`.
 */
export const SKILL_LEVEL_DIALOGUES = [
  {
    // Where the Wise Old Enby sends a player for Rune Fragments. The threshold is
    // the level Harmonic Workings itself requires, read from its Mining source,
    // so the advice moves with the mine (Mining 8 today): below it they point to
    // the Prospecting Quarry and mention the Workings as a future source; at or
    // above it they recommend the Workings. Played after the first lesson and as
    // the "Where to Find Fragments" topic.
    id: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
    npcId: NPC_IDS.wiseOldEnby,
    skillId: SKILL_IDS.mining,
    variants: [
      { minimumLevel: 1, dialogueId: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice },
      {
        minimumLevel: getEffectiveGameBalance().mining.sources.harmonicMining.requiredMiningLevel,
        dialogueId: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced,
      },
    ],
  },
] as const satisfies readonly SkillLevelDialogue[];

export function getSkillLevelDialogue(id: string): SkillLevelDialogue | undefined {
  return SKILL_LEVEL_DIALOGUES.find((candidate) => candidate.id === id);
}

export function getDialogue(dialogueId: string): DialogueSequence | undefined {
  return dialogue[dialogueId as DialogueId];
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
