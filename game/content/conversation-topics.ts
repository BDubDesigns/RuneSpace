import {
  CONVERSATION_TOPIC_IDS,
  DIALOGUE_IDS,
  MISSION_IDS,
  NPC_IDS,
  type ConversationTopicId,
  type DialogueId,
  type MissionId,
  type NpcId,
} from "@/game/config/foundations";

/**
 * The closed availability vocabulary for a replayable conversation topic.
 *
 * Deliberately narrow: an ordinary topic is always available, it becomes
 * visible once one authored Mission is completed, or it reads one other
 * already-authoritative server-computed fact. `work_orders_refresh_unlocked`
 * is that last kind's only member (#217's Wade ForceSales topic, gated on
 * Work Orders being unlocked AND Refining 5 — a combination the Mission-state
 * vocabulary above cannot express). It is resolved from an externally
 * supplied boolean, never from a new boolean-expression language, a
 * relationship/trust score, or world-state scripting. A future real content
 * need earns one more explicit kind here, not a generalized combinator.
 */
export type ConversationTopicAvailability =
  | { kind: "always" }
  | { kind: "mission_completed"; missionId: MissionId }
  | { kind: "work_orders_refresh_unlocked" };

/**
 * One authored replayable social/worldbuilding topic.
 *
 * `label` is a short UI subject — the thing the conversation is about. It is
 * never dialogue spoken by the player character, who stays silent, and it never
 * carries a Mission action: Mission command semantics belong to Mission content
 * (`game/content/missions.ts`) and the conversation resolver.
 */
export type ConversationTopicDefinition = {
  id: ConversationTopicId;
  npcId: NpcId;
  label: string;
  dialogueId: DialogueId;
  availability: ConversationTopicAvailability;
};

/**
 * Authored topics in display order. Topics are replayable by design: nothing
 * records that one was opened, and there are no NEW badges, viewed checkmarks,
 * or first-meeting flags.
 */
export const CONVERSATION_TOPICS = [
  {
    id: CONVERSATION_TOPIC_IDS.wadeRecoveryWork,
    npcId: NPC_IDS.wadeRusk,
    label: "Recovery work",
    dialogueId: DIALOGUE_IDS.wadeRecoveryWorkTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.tansyMining,
    npcId: NPC_IDS.tansyRusk,
    label: "Mining",
    dialogueId: DIALOGUE_IDS.tansyMiningTopic,
    availability: { kind: "always" },
  },
  {
    // Tansy's long-term arc seed. Hold It Together cannot complete without the
    // three starter Missions before it, so its completion alone is the gate.
    id: CONVERSATION_TOPIC_IDS.tansyBeyondHoloHollow,
    npcId: NPC_IDS.tansyRusk,
    label: "Beyond Holo Hollow",
    dialogueId: DIALOGUE_IDS.tansyBeyondHoloHollowTopic,
    availability: { kind: "mission_completed", missionId: MISSION_IDS.holdItTogether },
  },
  {
    id: CONVERSATION_TOPIC_IDS.bixTheShop,
    npcId: NPC_IDS.bixWeller,
    label: "The shop",
    dialogueId: DIALOGUE_IDS.bixTheShopTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.bixPowerCells,
    npcId: NPC_IDS.bixWeller,
    label: "Power Cells",
    dialogueId: DIALOGUE_IDS.bixPowerCellsTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.bixHoloHollow,
    npcId: NPC_IDS.bixWeller,
    label: "Holo Hollow",
    dialogueId: DIALOGUE_IDS.bixHoloHollowTopic,
    availability: { kind: "always" },
  },
  {
    // Mara is reachable only inside HH B&B, which Keep the Change opens, so the
    // Local Place access rule is the single gate — her topics add no second
    // condition that could leave her present with nothing to say.
    id: CONVERSATION_TOPIC_IDS.maraTheBnb,
    npcId: NPC_IDS.maraKells,
    label: "The B&B",
    dialogueId: DIALOGUE_IDS.maraTheBnbTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.maraBix,
    npcId: NPC_IDS.maraKells,
    label: "Bix",
    dialogueId: DIALOGUE_IDS.maraBixTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.rennAssistanceCenter,
    npcId: NPC_IDS.rennCalder,
    label: "The Assistance Center",
    dialogueId: DIALOGUE_IDS.rennAssistanceCenterTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.rennFerrite,
    npcId: NPC_IDS.rennCalder,
    label: "Ferrite",
    dialogueId: DIALOGUE_IDS.rennFerriteTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.rennLifeHere,
    npcId: NPC_IDS.rennCalder,
    label: "Life here",
    dialogueId: DIALOGUE_IDS.rennLifeHereTopic,
    availability: { kind: "always" },
  },
  {
    // #217: visible once Work Orders' ForceSales Free refresh is unlocked
    // (board unlock + Refining 5), read from the already-authoritative
    // server-computed projection rather than re-deriving either condition.
    id: CONVERSATION_TOPIC_IDS.wadeForceSales,
    npcId: NPC_IDS.wadeRusk,
    label: "ForceSales",
    dialogueId: DIALOGUE_IDS.wadeForceSalesTopic,
    availability: { kind: "work_orders_refresh_unlocked" },
  },
] as const satisfies readonly ConversationTopicDefinition[];

const topicsById = new Map<string, ConversationTopicDefinition>(
  CONVERSATION_TOPICS.map((topic) => [topic.id, topic]),
);

export function getConversationTopic(topicId: string): ConversationTopicDefinition | undefined {
  return topicsById.get(topicId);
}

/** Authored topics for one NPC, in authored order. Availability is applied later. */
export function getNpcConversationTopics(npcId: string): readonly ConversationTopicDefinition[] {
  return CONVERSATION_TOPICS.filter((topic) => topic.npcId === npcId);
}
