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
 * visible once one authored Mission is completed — or, for a Mission's
 * replayable instructions, once it is accepted (#391) — or it reads one other
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
  /**
   * Accepted, finished or not (#391): the Wise Old Enby's first lesson stays
   * replayable from the moment it is taken on, by either route.
   */
  | { kind: "mission_accepted"; missionId: MissionId }
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
    // #298: practical advice after the Cargo Hold repair. Replayable forever;
    // it records nothing and never depends on stash or later Mission progress.
    id: CONVERSATION_TOPIC_IDS.wadeStashMounts,
    npcId: NPC_IDS.wadeRusk,
    label: "Stash mounts",
    dialogueId: DIALOGUE_IDS.wadeStashMountsTopic,
    availability: { kind: "mission_completed", missionId: MISSION_IDS.holdItTogether },
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
    // #402: the planet, from the shopkeeper's side of the counter.
    id: CONVERSATION_TOPIC_IDS.bixSkatboll,
    npcId: NPC_IDS.bixWeller,
    label: "Skatboll",
    dialogueId: DIALOGUE_IDS.bixSkatbollTopic,
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
    // #402: the planet, as Renn's quiet correction of the town's self-mythology.
    id: CONVERSATION_TOPIC_IDS.rennSkatboll,
    npcId: NPC_IDS.rennCalder,
    label: "Skatboll",
    dialogueId: DIALOGUE_IDS.rennSkatbollTopic,
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
  {
    // #402: the planet, from the recovery yard — a wreck falls where it falls.
    id: CONVERSATION_TOPIC_IDS.wadeSkatboll,
    npcId: NPC_IDS.wadeRusk,
    label: "Skatboll",
    dialogueId: DIALOGUE_IDS.wadeSkatbollTopic,
    availability: { kind: "always" },
  },
  {
    // Curly (#292) is reachable exactly when HH B&B is, like Mara, so his
    // first topic needs no gate of its own and is there before his Mission is.
    id: CONVERSATION_TOPIC_IDS.curlySeeingTheWorlds,
    npcId: NPC_IDS.curly,
    label: "Seeing the Worlds",
    dialogueId: DIALOGUE_IDS.curlySeeingTheWorldsTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.curlyBackHome,
    npcId: NPC_IDS.curly,
    label: "Back Home",
    dialogueId: DIALOGUE_IDS.curlyBackHomeTopic,
    availability: { kind: "mission_completed", missionId: MISSION_IDS.curlyMustStash },
  },
  {
    // Toll's three topics (#357) are ordinary and always available, on foot,
    // before Trade unlocks and before any Mission: reading one neither advances
    // anything nor enables a transaction, and nothing records that it was read.
    id: CONVERSATION_TOPIC_IDS.tollSkatboll,
    npcId: NPC_IDS.tollKade,
    label: "Skatboll",
    dialogueId: DIALOGUE_IDS.tollSkatbollTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.tollStillreach,
    npcId: NPC_IDS.tollKade,
    label: "Stillreach",
    dialogueId: DIALOGUE_IDS.tollStillreachTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.tollFuel,
    npcId: NPC_IDS.tollKade,
    label: "Fuel",
    dialogueId: DIALOGUE_IDS.tollFuelTopic,
    availability: { kind: "always" },
  },
  {
    // The Wise Old Enby (#389). Their introduction and two ordinary topics are
    // there for anyone who reaches Hilltop Workshop, with or without a Fragment or
    // the mystery, and say nothing about how runes work. Nothing records that the
    // introduction was heard: it is a replayable topic, not a first-meeting state.
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyGreeting,
    npcId: NPC_IDS.wiseOldEnby,
    label: "Introductions",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyGreetingTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyWorkshop,
    npcId: NPC_IDS.wiseOldEnby,
    label: "The workshop",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyWorkshopTopic,
    availability: { kind: "always" },
  },
  {
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyStillreach,
    npcId: NPC_IDS.wiseOldEnby,
    label: "Stillreach",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyStillreachTopic,
    availability: { kind: "always" },
  },
  {
    // Only once the mystery is solved: RuneSpace has been named by then. Replaying
    // it runs no Mission command, pays nothing and records nothing.
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyAboutRuneSpace,
    npcId: NPC_IDS.wiseOldEnby,
    label: "About RuneSpace",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyAboutRuneSpaceTopic,
    availability: { kind: "mission_completed", missionId: MISSION_IDS.notFromAroundHere },
  },
  {
    // First Runeworking Lesson (#391): the lesson's instructions, replayable from
    // the moment it is accepted — by the mystery's continuation or by the
    // in-person offer — and after it is finished. Ends with the same Mining-level
    // advice as "Where to Find Fragments".
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyFirstLesson,
    npcId: NPC_IDS.wiseOldEnby,
    label: "First lesson",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyFirstLessonTopic,
    availability: { kind: "mission_accepted", missionId: MISSION_IDS.firstRuneworkingLesson },
  },
  {
    // The Enby's advice on Rune Fragments by current Mining level, once RuneSpace
    // has been explained. Reopening it after more Mining plays the other variant.
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyWhereToFindFragments,
    npcId: NPC_IDS.wiseOldEnby,
    label: "Where to Find Fragments",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic,
    availability: { kind: "mission_completed", missionId: MISSION_IDS.notFromAroundHere },
  },
  {
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyAboutTheSeekers,
    npcId: NPC_IDS.wiseOldEnby,
    label: "About the Seekers",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyAboutTheSeekersTopic,
    availability: { kind: "mission_completed", missionId: MISSION_IDS.firstRuneworkingLesson },
  },
  {
    // First Resonance Echo (#393): how to use a Seeker, replayable from the
    // moment the Mission is accepted and after it is finished. It never gives
    // the Seekers again and never touches the Mission.
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyHowToListen,
    npcId: NPC_IDS.wiseOldEnby,
    label: "How to Listen",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyHowToListenTopic,
    availability: { kind: "mission_accepted", missionId: MISSION_IDS.firstResonanceEcho },
  },
  {
    id: CONVERSATION_TOPIC_IDS.wiseOldEnbyAboutResonanceEchoes,
    npcId: NPC_IDS.wiseOldEnby,
    label: "About Resonance Echoes",
    dialogueId: DIALOGUE_IDS.wiseOldEnbyAboutResonanceEchoesTopic,
    availability: { kind: "mission_completed", missionId: MISSION_IDS.firstResonanceEcho },
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
