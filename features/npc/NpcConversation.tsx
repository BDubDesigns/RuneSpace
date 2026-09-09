"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { DialoguePlayer } from "@/features/dialogue/DialoguePlayer";
import { usePlay } from "@/features/play/PlayContext";
import { getDialogue } from "@/game/content/dialogue";
import type { NpcDefinition } from "@/game/content/npcs";
import {
  getMissionCapacityRefusalDialogue,
  getMissionCompletionPresentation,
  type MissionConversationAction,
  type NpcConversationEntry,
} from "@/game/domain/conversation";
import { acceptMissionAction, completeMissionAction } from "@/server/actions";

/**
 * One open conversation: the authored sequence currently being played plus the
 * Mission metadata that conversation carries. Mission authority always stays
 * server-side — this only records which command the terminal control submits
 * and which authored copy it shows.
 */
type OpenConversation = {
  dialogueId: string;
  missionId?: string;
  action?: MissionConversationAction;
  acceptedContinuation?: { dialogueId: string; action?: MissionConversationAction };
};

function fromEntry(entry: NpcConversationEntry): OpenConversation {
  if (entry.kind === "topic") return { dialogueId: entry.dialogueId };
  return {
    dialogueId: entry.dialogueId,
    missionId: entry.missionId,
    ...(entry.action ? { action: entry.action } : {}),
    ...(entry.acceptedContinuation ? { acceptedContinuation: entry.acceptedContinuation } : {}),
  };
}

/**
 * The canonical NPC conversation surface: one drawer that opens on the
 * conversation hub and plays the selected authored sequence in place.
 *
 * The hub is re-derived from authoritative state on every render, so accepting
 * or turning in a Mission updates the available conversations immediately
 * without any client-side mission bookkeeping.
 */
export function NpcConversation({
  npc,
  entries,
  stationary,
  onClose,
  triggerRef,
}: {
  npc: NpcDefinition;
  entries: readonly NpcConversationEntry[];
  stationary: boolean;
  onClose: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { acceptState, acquireCommand, releaseCommand, state } = usePlay();
  const [open, setOpen] = useState<OpenConversation>();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const content = useRef<HTMLDivElement>(null);
  const previousView = useRef<string | undefined>(undefined);

  const sequence = open ? getDialogue(open.dialogueId) : undefined;

  // Selecting an entry (or returning to the hub) replaces the control the
  // player just activated. Move focus into the new view so the drawer's focus
  // trap keeps a valid anchor and keyboard users are never dropped onto the
  // page behind the modal. The initial mount is left to the drawer itself.
  useEffect(() => {
    const view = open?.dialogueId ?? "hub";
    const changed = previousView.current !== undefined && previousView.current !== view;
    previousView.current = view;
    if (!changed) return;
    content.current
      ?.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ?.focus();
  }, [open?.dialogueId]);

  const missionEntries = entries.filter(
    (entry): entry is Extract<NpcConversationEntry, { kind: "mission" }> =>
      entry.kind === "mission",
  );
  const topicEntries = entries.filter(
    (entry): entry is Extract<NpcConversationEntry, { kind: "topic" }> => entry.kind === "topic",
  );

  function returnToHub() {
    setOpen(undefined);
    setMessage(undefined);
  }

  function selectEntry(entry: NpcConversationEntry) {
    setMessage(undefined);
    setOpen(fromEntry(entry));
  }

  function runConversationAction() {
    const conversation = open;
    const action = conversation?.action;
    const missionId = conversation?.missionId;
    if (!action || !missionId) {
      setMessage("This conversation is not driving a mission command.");
      return;
    }
    if (!stationary) {
      setMessage("You must be stationary to complete this conversation action.");
      return;
    }
    if (!acquireCommand()) {
      setMessage("Another command is being confirmed. Try again in a moment.");
      return;
    }
    setPending(true);
    startTransition(async () => {
      try {
        const command = { characterId: state.characterId, missionId, npcId: npc.id };
        const result =
          action.kind === "accept_mission"
            ? await acceptMissionAction(command)
            : await completeMissionAction(command);
        if ("error" in result) {
          setMessage(result.error);
          return;
        }
        acceptState(result.state);
        if (result.mission.status === "refused") {
          if (
            "reason" in result.mission &&
            result.mission.reason === "capacity" &&
            result.mission.capacityReason
          ) {
            // The authored refusal is presentation for a refused command: the
            // conversation stays open on that sequence with no action control.
            const refusal = getMissionCapacityRefusalDialogue(
              missionId,
              result.mission.capacityReason,
            );
            if (refusal) {
              setOpen({ dialogueId: refusal.id, missionId });
              setMessage(undefined);
            } else {
              setMessage(result.mission.message);
            }
          } else {
            setMessage(result.mission.message);
          }
          return;
        }
        if (result.mission.status === "accepted") {
          // An offer may author an immediate continuation (e.g. the remote
          // acceptance follow-up that leads straight to the Cutter claim);
          // otherwise the conversation returns to the freshly derived hub.
          const continuation = conversation?.acceptedContinuation;
          if (continuation) {
            setOpen({
              dialogueId: continuation.dialogueId,
              missionId,
              ...(continuation.action ? { action: continuation.action } : {}),
            });
            setMessage(undefined);
            return;
          }
          returnToHub();
          return;
        }
        if (action.kind === "complete_mission" && result.mission.status === "completed") {
          // Only the authoritative success reveals the reward presentation. Any
          // authored continuation mission is already accepted server-side, so
          // the hub behind this presentation already reflects the next
          // assignment — there is no second acceptance click.
          const presentation = getMissionCompletionPresentation(missionId);
          if (presentation) {
            setOpen({ dialogueId: presentation.id, missionId });
            setMessage(undefined);
            return;
          }
        }
        returnToHub();
      } catch (error) {
        reportClientDiagnostic("mining-command", error, { miningActive: false });
        setMessage("Comms interruption. Mission status could not be confirmed.");
      } finally {
        setPending(false);
        releaseCommand();
      }
    });
  }

  return (
    <Drawer
      eyebrow={sequence ? "Story dialogue" : "Conversation"}
      label={`${npc.displayName} conversation`}
      onClose={onClose}
      size="wide"
      title={npc.displayName}
      triggerRef={triggerRef}
    >
      <div ref={content}>
        {sequence ? (
          <DialoguePlayer
            actionBusy={pending}
            actionLabel={open?.action?.label}
            actionMessage={message}
            onAction={open?.action ? runConversationAction : undefined}
            onBack={returnToHub}
            onFinish={returnToHub}
            sequence={sequence}
          />
        ) : (
          <div className="mt-4" data-conversation-hub={npc.id}>
            <p className="text-sm text-[color:var(--rs-text-secondary)]">{npc.role}</p>
            {missionEntries.length > 0 ? (
              <ConversationSection heading="Current" testId="current">
                {missionEntries.map((entry) => (
                  <ConversationEntryButton
                    entry={entry}
                    key={entry.id}
                    onSelect={() => selectEntry(entry)}
                  />
                ))}
              </ConversationSection>
            ) : null}
            {topicEntries.length > 0 ? (
              <ConversationSection heading="Talk about" testId="topics">
                {topicEntries.map((entry) => (
                  <ConversationEntryButton
                    entry={entry}
                    key={entry.id}
                    onSelect={() => selectEntry(entry)}
                  />
                ))}
              </ConversationSection>
            ) : null}
            {message ? <Feedback tone="danger">{message}</Feedback> : null}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function ConversationSection({
  heading,
  testId,
  children,
}: {
  heading: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={heading} className="mt-4" data-conversation-section={testId}>
      <h3 className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
        {heading}
      </h3>
      <ul className="mt-2 space-y-2">{children}</ul>
    </section>
  );
}

/**
 * One selectable conversation. Mission entries keep the existing semantic
 * guidance treatment — blue "there is a new mission here", green "this advances
 * the mission you accepted" — so the hub cannot invent its own colour meaning.
 * A topic label is a subject, never a line the silent player character speaks.
 */
function ConversationEntryButton({
  entry,
  onSelect,
}: {
  entry: NpcConversationEntry;
  onSelect: () => void;
}) {
  const guidance = entry.kind === "mission" ? entry.guidance : undefined;
  const guidanceClass =
    guidance === "active"
      ? "rs-mission-guidance"
      : guidance === "available"
        ? "rs-mission-available"
        : "";
  const roleLabel = entry.kind === "mission" ? entry.roleLabel : undefined;
  return (
    <li>
      <button
        className={`rs-focus flex min-h-[var(--rs-touch-target)] w-full items-center justify-between gap-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-3 text-left ${guidanceClass}`}
        data-conversation-entry={entry.id}
        data-conversation-entry-kind={entry.kind}
        data-mission-guidance={guidance}
        onClick={onSelect}
        type="button"
      >
        <span className="min-w-0 font-display text-sm font-bold uppercase tracking-wide">
          {entry.label}
        </span>
        {roleLabel ? (
          <span
            className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--rs-text-secondary)]"
            data-conversation-entry-role
          >
            {roleLabel}
          </span>
        ) : null}
      </button>
    </li>
  );
}
