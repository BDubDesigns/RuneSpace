import type { DialogueId } from "@/game/config/foundations";
import {
  CONVERSATION_TOPICS,
  type ConversationTopicDefinition,
} from "@/game/content/conversation-topics";
import { getDialogue, type DialogueSequence } from "@/game/content/dialogue";
import {
  MISSIONS,
  getMission,
  type MissionDefinition,
  type MissionLifecycleMoment,
  type MissionRequirement,
  type MissionRequirementKind,
} from "@/game/content/missions";
import { getNpc } from "@/game/content/npcs";
import {
  lifecycleDialogueId,
  MISSION_STANDING_LABELS,
  missionOmitsMoment,
  reminderMomentFor,
  type MissionState,
} from "@/game/domain/missions";

/**
 * ONE canonical NPC conversation model.
 *
 * `Talk to <NPC>` opens a conversation hub. The hub lists the conversations that
 * are genuinely relevant right now:
 *
 * - **Current** — Mission-derived conversations (offer, active reminder, turn-in,
 *   and the narrow latest completed-story follow-up). Their Mission semantics —
 *   which Mission, which command, which authored control copy — come from Mission
 *   content, never from dialogue prose.
 * - **Talk about** — replayable authored social topics
 *   (`game/content/conversation-topics.ts`).
 *
 * Every NPC uses this one model. Selecting an entry in the client never grants
 * Mission authority: the server re-reads and revalidates every rule inside the
 * character transaction (`server/missions.ts`).
 */

/** Generic acceptance copy when an offer authors none. */
export const DEFAULT_ACCEPT_ACTION_LABEL = "Accept mission";
/** Generic completion copy when a turn-in authors none. */
export const DEFAULT_COMPLETE_ACTION_LABEL = "Turn in";
/** Generic copy closing a mandatory conversation when none is authored. */
export const DEFAULT_ACKNOWLEDGE_ACTION_LABEL = "Got it";

/**
 * The semantic Mission surface the conversation resolver consumes. It is
 * structurally satisfied by `MissionProjection`, so the client passes
 * `state.missions` directly. Projections arrive in authored registry order;
 * resolution scans newest-first.
 *
 * Resolution is driven exclusively by this semantic state and the derived
 * guidance projection — never by parsing objective copy, dialogue prose, or
 * hard-coded mission-ID chains in UI code.
 */
export type NpcConversationProjection = {
  missionId: string;
  state: MissionState;
  prerequisiteSatisfied: boolean;
  stage?: {
    requirementsSatisfied: boolean;
    turnInAvailable: boolean;
    nextObjectiveKind?: MissionRequirementKind;
  };
  /**
   * Live per-requirement satisfaction. Only mandatory-conversation routing
   * reads it: a one-time authored scene stops being offered once the
   * authoritative requirement holds, so the encounter does not replay.
   */
  requirements?: readonly { kind: MissionRequirementKind; satisfied: boolean; npcId?: string }[];
  /** The already-derived semantic guidance targets for this mission, if any. */
  guidance?: {
    npcId?: string;
    availableNpcIds?: readonly string[];
    turnIn?: true;
  };
  /**
   * The Mission-local reactive facts that hold (#232). They choose an authored
   * variant of the same moment; they never change what the Mission requires.
   */
  facts?: readonly string[];
};

/** Which Mission conversation this entry is; drives its short role copy. */
export type MissionConversationRole = "offer" | "active" | "turn_in" | "completed";

/**
 * The authoritative Mission command an entry's conversation may run, plus the
 * authored control copy. Present only when the selected conversation genuinely
 * drives that command right now.
 */
export type MissionConversationAction = {
  kind: "accept_mission" | "complete_mission" | "acknowledge_conversation";
  label: string;
  /**
   * The authored sequence the command is being reported for. Present only for
   * `acknowledge_conversation`, whose server command confirms the played scene
   * is the one the mission authored.
   */
  dialogueId?: DialogueId;
};

/** The authored continuation presented immediately after a successful acceptance. */
export type MissionConversationContinuation = {
  dialogueId: DialogueId;
  action?: MissionConversationAction;
};

export type NpcConversationEntry =
  | {
      kind: "mission";
      /** Stable identity for this entry within one NPC's hub. */
      id: string;
      /** The conversation's UI subject — the authoritative Mission title. */
      label: string;
      role: MissionConversationRole;
      /** Short role copy shown with the subject ("Available", "Turn in", ...). */
      roleLabel: string;
      dialogueId: DialogueId;
      missionId: string;
      /** Semantic Mission guidance for this entry, reused from the projection. */
      guidance?: "available" | "active" | "turn_in";
      action?: MissionConversationAction;
      acceptedContinuation?: MissionConversationContinuation;
    }
  | {
      kind: "topic";
      id: string;
      /** A short UI subject, never player-spoken dialogue. */
      label: string;
      dialogueId: DialogueId;
    };

const ROLE_LABELS: Record<MissionConversationRole, string> = {
  offer: "Available",
  active: MISSION_STANDING_LABELS.work,
  turn_in: MISSION_STANDING_LABELS.turn_in,
  completed: MISSION_STANDING_LABELS.completed,
};

/**
 * Resolves the full conversation hub for one NPC against the production
 * registries. Ordering is stable and player-meaningful:
 *
 * 1. accepted Mission conversations (newest Mission first);
 * 2. available Mission offers (newest first);
 * 3. the single latest relevant completed-story follow-up, and only when this
 *    NPC has no current Mission conversation — completed Missions must not
 *    accumulate into a growing historical list;
 * 4. replayable social topics whose authored availability currently holds.
 */
/**
 * Externally-supplied facts a topic's availability may read beyond the
 * Mission projections — currently just #217's Work Orders refresh unlock.
 * Kept as one small optional bag rather than growing the function's
 * positional parameters each time a topic needs one more outside fact.
 */
export type ConversationAvailabilityContext = {
  workOrdersRefreshUnlocked?: boolean;
};

export function resolveNpcConversation(
  npcId: string,
  projections: readonly NpcConversationProjection[],
  context?: ConversationAvailabilityContext,
): readonly NpcConversationEntry[] {
  return resolveNpcConversationWith(npcId, projections, MISSIONS, CONVERSATION_TOPICS, context);
}

/**
 * Pure resolution against explicit ordered content. Production callers use
 * `resolveNpcConversation` (which injects the canonical registries); tests
 * inject synthetic ordered definitions to prove generic ordering/fallback
 * semantics without adding player-visible fake Missions or topics.
 */
export function resolveNpcConversationWith(
  npcId: string,
  projections: readonly NpcConversationProjection[],
  definitions: readonly MissionDefinition[],
  topics: readonly ConversationTopicDefinition[],
  context?: ConversationAvailabilityContext,
): readonly NpcConversationEntry[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const newestFirst = [...projections].reverse();
  const active: NpcConversationEntry[] = [];
  const offers: NpcConversationEntry[] = [];

  for (const projection of newestFirst) {
    if (projection.state !== "active" && projection.state !== "ready_for_completion") continue;
    const definition = byId.get(projection.missionId);
    if (!definition) continue;
    const entry = activeEntry(npcId, definition, projection);
    if (entry) active.push(entry);
  }

  for (const projection of newestFirst) {
    if (projection.state !== "not_accepted" || !projection.prerequisiteSatisfied) continue;
    const definition = byId.get(projection.missionId);
    const offer = definition?.offers.find((candidate) => candidate.npcId === npcId);
    if (!definition || !offer) continue;
    if (!getDialogue(offer.dialogueId)) continue;
    offers.push({
      kind: "mission",
      id: `${definition.id}:offer`,
      label: definition.title,
      role: "offer",
      roleLabel: ROLE_LABELS.offer,
      dialogueId: offer.dialogueId,
      missionId: definition.id,
      guidance: guidanceFor(npcId, projection),
      action: {
        kind: "accept_mission",
        label: offer.actionLabel ?? DEFAULT_ACCEPT_ACTION_LABEL,
      },
      ...(offer.acceptedContinuation
        ? {
            acceptedContinuation: {
              dialogueId: offer.acceptedContinuation.dialogueId,
              ...(offer.acceptedContinuation.completesMission
                ? { action: completionAction(definition) }
                : {}),
            },
          }
        : {}),
    });
  }

  const mission = [...active, ...offers];
  if (mission.length === 0) {
    const completed = completedStoryEntry(npcId, newestFirst, byId);
    if (completed) mission.push(completed);
  }

  return [...mission, ...availableTopics(npcId, projections, topics, context)];
}

/** The Mission conversation this NPC owns while a Mission is accepted and incomplete. */
function activeEntry(
  npcId: string,
  definition: MissionDefinition,
  projection: NpcConversationProjection,
): NpcConversationEntry | undefined {
  if (definition.turnIn.npcId === npcId) {
    const dialogueId = turnInStageDialogueId(definition, projection.stage, projection.facts);
    if (!dialogueId) return undefined;
    // The completion command belongs to the turn-in conversation only — its
    // ordinary opening or a reactive one. A reminder or busy branch presents
    // state; it never offers a turn-in.
    const isTurnIn =
      dialogueId === definition.turnIn.dialogueId ||
      (definition.dialogue.reactive ?? []).some(
        (variant) => variant.moment === "turn_in" && variant.dialogueId === dialogueId,
      );
    return {
      kind: "mission",
      id: `${definition.id}:${isTurnIn ? "turn_in" : "active"}`,
      label: definition.title,
      role: isTurnIn ? "turn_in" : "active",
      roleLabel: isTurnIn ? ROLE_LABELS.turn_in : ROLE_LABELS.active,
      dialogueId,
      missionId: definition.id,
      guidance: guidanceFor(npcId, projection),
      ...(isTurnIn ? { action: completionAction(definition) } : {}),
    };
  }

  // A mandatory authored conversation is a one-time story event, not idle
  // dialogue: it is offered while its authoritative requirement is unsatisfied
  // and disappears from the hub once the scene has genuinely happened. Backing
  // out before the terminal control leaves the requirement unsatisfied, so the
  // encounter can be entered again until it actually commits.
  const conversation = definition.requirements.find(
    (candidate): candidate is Extract<MissionRequirement, { kind: "npc_conversation" }> =>
      candidate.kind === "npc_conversation" && candidate.npcId === npcId,
  );
  if (conversation && !conversationRequirementSatisfied(projection, npcId)) {
    if (!getDialogue(conversation.dialogueId)) return undefined;
    return {
      kind: "mission",
      id: `${definition.id}:conversation`,
      label: definition.title,
      role: "active",
      roleLabel: ROLE_LABELS.active,
      dialogueId: conversation.dialogueId,
      missionId: definition.id,
      guidance: guidanceFor(npcId, projection),
      action: {
        kind: "acknowledge_conversation",
        label: conversation.actionLabel ?? DEFAULT_ACKNOWLEDGE_ACTION_LABEL,
        dialogueId: conversation.dialogueId,
      },
    };
  }

  const contextual = definition.activeNpcDialogue?.find((entry) => entry.npcId === npcId);
  const offer = definition.offers.find((candidate) => candidate.npcId === npcId);
  const dialogueId = contextual?.dialogueId ?? offer?.activeDialogueId;
  if (!dialogueId || !getDialogue(dialogueId)) return undefined;
  return {
    kind: "mission",
    id: `${definition.id}:active`,
    label: definition.title,
    role: "active",
    roleLabel: ROLE_LABELS.active,
    dialogueId,
    missionId: definition.id,
    guidance: guidanceFor(npcId, projection),
  };
}

/**
 * The narrow latest-relevant story follow-up: the newest completed Mission that
 * authors ordinary post-completion dialogue for this NPC. At most one entry, so
 * completed Missions never accumulate into a historical topic list. The one-shot
 * completion presentation is never reused here.
 */
function completedStoryEntry(
  npcId: string,
  newestFirst: readonly NpcConversationProjection[],
  byId: ReadonlyMap<string, MissionDefinition>,
): NpcConversationEntry | undefined {
  for (const projection of newestFirst) {
    if (projection.state !== "completed") continue;
    const definition = byId.get(projection.missionId);
    if (!definition) continue;
    const authored = definition.completedNpcDialogue?.find((entry) => entry.npcId === npcId);
    if (!authored) continue;
    if (!getDialogue(authored.dialogueId)) continue;
    return {
      kind: "mission",
      id: `${definition.id}:completed`,
      label: definition.title,
      role: "completed",
      roleLabel: ROLE_LABELS.completed,
      dialogueId: authored.dialogueId,
      missionId: definition.id,
    };
  }
  return undefined;
}

/**
 * Replayable social topics for this NPC whose authored availability currently
 * holds. Availability reads the same semantic Mission projections the rest of
 * the conversation uses — no conversation history, first-meeting flag, or
 * viewed-topic state exists or is consulted.
 */
function availableTopics(
  npcId: string,
  projections: readonly NpcConversationProjection[],
  topics: readonly ConversationTopicDefinition[],
  context: ConversationAvailabilityContext | undefined,
): readonly NpcConversationEntry[] {
  return topics
    .filter((topic) => topic.npcId === npcId)
    .filter((topic) => topicAvailable(topic, projections, context))
    .filter((topic) => getDialogue(topic.dialogueId) !== undefined)
    .map((topic) => ({
      kind: "topic" as const,
      id: topic.id,
      label: topic.label,
      dialogueId: topic.dialogueId,
    }));
}

export function topicAvailable(
  topic: ConversationTopicDefinition,
  projections: readonly NpcConversationProjection[],
  context?: ConversationAvailabilityContext,
): boolean {
  if (topic.availability.kind === "always") return true;
  if (topic.availability.kind === "work_orders_refresh_unlocked") {
    return context?.workOrdersRefreshUnlocked ?? false;
  }
  const gate = topic.availability.missionId;
  return projections.some(
    (projection) => projection.missionId === gate && projection.state === "completed",
  );
}

/**
 * Whether this NPC's mandatory conversation already holds for the character.
 * Read from the projected requirement statuses, never from conversation
 * history — RuneSpace persists nothing about conversations themselves.
 */
function conversationRequirementSatisfied(
  projection: NpcConversationProjection,
  npcId: string,
): boolean {
  return (
    projection.requirements?.some(
      (status) => status.kind === "npc_conversation" && status.npcId === npcId && status.satisfied,
    ) ?? false
  );
}

function completionAction(definition: MissionDefinition): MissionConversationAction {
  return {
    kind: "complete_mission",
    label: definition.turnIn.actionLabel ?? DEFAULT_COMPLETE_ACTION_LABEL,
  };
}

function guidanceFor(
  npcId: string,
  projection: NpcConversationProjection,
): "available" | "active" | "turn_in" | undefined {
  if (projection.guidance?.npcId === npcId) {
    return projection.guidance.turnIn ? "turn_in" : "active";
  }
  if (projection.guidance?.availableNpcIds?.includes(npcId)) return "available";
  return undefined;
}

/**
 * The first authored reactive variant of `moment` whose fact holds (#232).
 * Authored order is the priority; with no fact holding, the ordinary sequence
 * stands.
 */
function reactiveVariant(
  definition: MissionDefinition,
  moment: "turn_in" | "tracked_activity_reminder",
  facts: readonly string[] | undefined,
): DialogueId | undefined {
  if (!facts?.length) return undefined;
  return (definition.dialogue.reactive ?? []).find(
    (variant) =>
      variant.moment === moment &&
      facts.includes(variant.factKey) &&
      getDialogue(variant.dialogueId) !== undefined,
  )?.dialogueId;
}

/**
 * Selects the turn-in NPC's authored sequence from semantic stage data. A
 * reminder or busy moment presents its own sequence; it falls back to the
 * turn-in opening only when the Mission declares that moment in
 * `dialogue.omitted` (#324). An undeclared gap resolves to no entry rather than
 * presenting dialogue written for a different moment — registry validation
 * makes that unreachable for production content.
 */
function turnInStageDialogueId(
  definition: MissionDefinition,
  stage: NpcConversationProjection["stage"],
  facts?: readonly string[],
): DialogueId | undefined {
  const turnIn = reactiveVariant(definition, "turn_in", facts) ?? definition.turnIn.dialogueId;
  if (!stage) return turnIn;
  if (stage.turnInAvailable) return turnIn;
  const momentOr = (moment: MissionLifecycleMoment, dialogueId: DialogueId | undefined) => {
    if (dialogueId && getDialogue(dialogueId)) return dialogueId;
    return missionOmitsMoment(definition, moment) ? turnIn : undefined;
  };
  if (stage.requirementsSatisfied) return momentOr("busy", lifecycleDialogueId(definition, "busy"));
  const moment = stage.nextObjectiveKind && reminderMomentFor(stage.nextObjectiveKind);
  // A kind with no reminder moment (`at_location`) is validated to name the
  // turn-in location, so the turn-in NPC is not reached while it is unmet.
  if (!moment) return turnIn;
  const reactive =
    moment === "tracked_activity_reminder"
      ? reactiveVariant(definition, "tracked_activity_reminder", facts)
      : undefined;
  return momentOr(moment, reactive ?? lifecycleDialogueId(definition, moment));
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

/**
 * A confirmed Credits payout, presented as a reward tile in front of (`leads`)
 * or instead of (`stands_alone`) an authored scene (#290). It is built only from
 * the `creditsPaid` receipt of a successful Mission command, never from content.
 */
export type CreditsReceipt = {
  /** The Credits the server reports it actually paid. */
  amount: number;
  /**
   * `leads`: the tile opens the conversation that follows the payment (an
   * accepted continuation, or the completion presentation). `stands_alone`: the
   * payment has no authored scene after it, so the tile is the whole scene.
   */
  placement: "leads" | "stands_alone";
};

/** The view a conversation moves to after a Mission command succeeds. */
export type MissionSuccessView =
  | { kind: "hub" }
  | {
      kind: "dialogue";
      dialogueId: DialogueId;
      action?: MissionConversationAction;
      creditsReceipt?: CreditsReceipt;
    };

/**
 * Decides what the conversation presents after the server reported a Mission
 * command that was neither refused nor failed. Pure so the payment boundary is
 * provable without a browser.
 *
 * A Credits tile is returned only when the result carries `creditsPaid` — the
 * receipt of a payment that committed in THAT call. `already_accepted`,
 * `already_completed`, acknowledgements, free Missions and every refusal carry
 * none, so a replay, retry, or revisit can never present a payout. Existing
 * sequencing is preserved: an accepted continuation and a completion
 * presentation still play in full, with the tile placed in front of them; with
 * no scene to follow, the tile stands alone against the scene just played.
 */
export function resolveMissionSuccessView(input: {
  actionKind: MissionConversationAction["kind"];
  missionId: string;
  /** The sequence the command was run from. */
  dialogueId: DialogueId;
  acceptedContinuation?: MissionConversationContinuation;
  mission: { status: string; creditsPaid?: number };
}): MissionSuccessView {
  const { mission } = input;
  const paid =
    mission.creditsPaid !== undefined && mission.creditsPaid > 0 ? mission.creditsPaid : 0;
  const receipt = (placement: CreditsReceipt["placement"]) =>
    paid ? { creditsReceipt: { amount: paid, placement } } : {};

  if (mission.status === "accepted") {
    // An offer may author an immediate continuation (e.g. the remote acceptance
    // follow-up that leads straight to the Cutter claim).
    const continuation = input.acceptedContinuation;
    if (continuation) {
      return {
        kind: "dialogue",
        dialogueId: continuation.dialogueId,
        ...(continuation.action ? { action: continuation.action } : {}),
        ...receipt("leads"),
      };
    }
    return paid
      ? { kind: "dialogue", dialogueId: input.dialogueId, ...receipt("stands_alone") }
      : { kind: "hub" };
  }

  if (input.actionKind === "complete_mission" && mission.status === "completed") {
    // Only the authoritative success reveals the reward presentation. Any
    // authored continuation mission is already accepted server-side, so the hub
    // behind this presentation already reflects the next assignment.
    const presentation = getMissionCompletionPresentation(input.missionId);
    if (presentation) {
      return { kind: "dialogue", dialogueId: presentation.id, ...receipt("leads") };
    }
    if (paid) {
      return { kind: "dialogue", dialogueId: input.dialogueId, ...receipt("stands_alone") };
    }
  }
  return { kind: "hub" };
}

/** Authored presentation-only completion beats revealed after authoritative success. */
export function getMissionCompletionPresentation(missionId: string): DialogueSequence | undefined {
  const definition = getMission(missionId);
  const dialogueId = definition?.dialogue.completionPresentationDialogueId;
  return dialogueId ? getDialogue(dialogueId) : undefined;
}

/**
 * Startup validation for authored conversation topics. Fails fast at module
 * load so an authoring mistake never reaches a player as a missing or
 * mis-attributed conversation.
 */
export function validateConversationTopics(
  topics: readonly ConversationTopicDefinition[],
  definitions: readonly MissionDefinition[] = MISSIONS,
): void {
  const knownMissionIds = new Set(definitions.map((definition) => definition.id));
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const seenDialogueIds = new Set<string>();
  for (const topic of topics) {
    const where = `Conversation topic "${topic.id}"`;
    if (seenIds.has(topic.id)) throw new Error(`${where} is declared more than once.`);
    seenIds.add(topic.id);
    if (!getNpc(topic.npcId)) throw new Error(`${where} references unknown NPC "${topic.npcId}".`);
    if (topic.label.trim().length === 0) {
      throw new Error(`${where} must author a short subject label.`);
    }
    const labelKey = `${topic.npcId}:${topic.label.toLowerCase()}`;
    if (seenLabels.has(labelKey)) {
      throw new Error(`${where} duplicates another topic label for NPC "${topic.npcId}".`);
    }
    seenLabels.add(labelKey);
    const sequence = getDialogue(topic.dialogueId);
    if (!sequence) {
      throw new Error(`${where} references unknown dialogue "${topic.dialogueId}".`);
    }
    if (sequence.npcId !== topic.npcId) {
      throw new Error(
        `${where} references dialogue "${topic.dialogueId}" belonging to NPC "${sequence.npcId}".`,
      );
    }
    if (seenDialogueIds.has(topic.dialogueId)) {
      throw new Error(`${where} reuses dialogue "${topic.dialogueId}" already used by a topic.`);
    }
    seenDialogueIds.add(topic.dialogueId);
    if (
      topic.availability.kind === "mission_completed" &&
      !knownMissionIds.has(topic.availability.missionId)
    ) {
      throw new Error(`${where} gates on unknown mission "${topic.availability.missionId}".`);
    }
    // "work_orders_refresh_unlocked" needs no mission lookup: it reads a
    // server-supplied fact, not a projected Mission.
  }
  // A Mission-owned sequence must never double as a replayable social topic.
  const missionDialogueIds = new Set(missionOwnedDialogueIds(definitions));
  for (const topic of topics) {
    if (missionDialogueIds.has(topic.dialogueId)) {
      throw new Error(
        `Conversation topic "${topic.id}" reuses Mission dialogue "${topic.dialogueId}".`,
      );
    }
  }
}

function missionOwnedDialogueIds(definitions: readonly MissionDefinition[]): readonly string[] {
  return definitions.flatMap((definition) => [
    definition.turnIn.dialogueId,
    ...definition.requirements
      .filter(
        (requirement): requirement is Extract<MissionRequirement, { kind: "npc_conversation" }> =>
          requirement.kind === "npc_conversation",
      )
      .map((requirement) => requirement.dialogueId),
    ...definition.offers.flatMap((offer) => [
      offer.dialogueId,
      ...(offer.acceptedContinuation ? [offer.acceptedContinuation.dialogueId] : []),
      ...(offer.activeDialogueId ? [offer.activeDialogueId] : []),
    ]),
    ...(definition.activeNpcDialogue ?? []).map((entry) => entry.dialogueId),
    ...(definition.completedNpcDialogue ?? []).map((entry) => entry.dialogueId),
    ...Object.values(definition.dialogue).filter(
      (dialogueId): dialogueId is DialogueId => typeof dialogueId === "string",
    ),
  ]);
}
