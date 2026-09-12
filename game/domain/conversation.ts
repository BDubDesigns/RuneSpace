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
  type MissionRequirement,
  type MissionRequirementKind,
} from "@/game/content/missions";
import { getNpc } from "@/game/content/npcs";
import type { MissionState } from "@/game/domain/missions";

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
  active: "Active",
  turn_in: "Turn in",
  completed: "Completed",
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
export function resolveNpcConversation(
  npcId: string,
  projections: readonly NpcConversationProjection[],
): readonly NpcConversationEntry[] {
  return resolveNpcConversationWith(npcId, projections, MISSIONS, CONVERSATION_TOPICS);
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

  return [...mission, ...availableTopics(npcId, projections, topics)];
}

/** The Mission conversation this NPC owns while a Mission is accepted and incomplete. */
function activeEntry(
  npcId: string,
  definition: MissionDefinition,
  projection: NpcConversationProjection,
): NpcConversationEntry | undefined {
  if (definition.turnIn.npcId === npcId) {
    const dialogueId = turnInStageDialogueId(definition, projection.stage);
    if (!dialogueId) return undefined;
    // The completion command belongs to the turn-in conversation only. A
    // reminder or busy branch presents state; it never offers a turn-in.
    const isTurnIn = dialogueId === definition.turnIn.dialogueId;
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
): readonly NpcConversationEntry[] {
  return topics
    .filter((topic) => topic.npcId === npcId)
    .filter((topic) => topicAvailable(topic, projections))
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
): boolean {
  if (topic.availability.kind === "always") return true;
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

/** Selects the turn-in NPC's authored sequence from semantic stage data. */
function turnInStageDialogueId(
  definition: MissionDefinition,
  stage: NpcConversationProjection["stage"],
): DialogueId | undefined {
  const turnIn = definition.turnIn.dialogueId;
  if (!stage) return turnIn;
  if (stage.turnInAvailable) return turnIn;
  if (stage.requirementsSatisfied) return dialogueOr(definition.dialogue.busyDialogueId, turnIn);
  if (stage.nextObjectiveKind === "equipped_item") {
    return dialogueOr(definition.dialogue.equipmentReminderDialogueId, turnIn);
  }
  if (stage.nextObjectiveKind === "carried_stack") {
    return dialogueOr(definition.dialogue.carriedReminderDialogueId, turnIn);
  }
  if (stage.nextObjectiveKind === "tracked_activity") {
    return dialogueOr(definition.dialogue.trackedActivityReminderDialogueId, turnIn);
  }
  if (stage.nextObjectiveKind === "cargo_hold_repaired") {
    return dialogueOr(definition.dialogue.cargoRepairReminderDialogueId, turnIn);
  }
  if (stage.nextObjectiveKind === "npc_conversation") {
    return dialogueOr(definition.dialogue.conversationReminderDialogueId, turnIn);
  }
  return turnIn;
}

function dialogueOr(dialogueId: DialogueId | undefined, fallback: DialogueId): DialogueId {
  if (dialogueId && getDialogue(dialogueId)) return dialogueId;
  return fallback;
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
