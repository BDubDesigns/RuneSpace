"use client";

import { useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { DialoguePlayer } from "@/features/dialogue/DialoguePlayer";
import {
  getDialogue,
  getMissionCapacityRefusalDialogue,
  getMissionCompletionPresentation,
  resolveNpcMissionDialogue,
} from "@/game/content/dialogue";
import { MISSIONS } from "@/game/content/missions";
import { getNpc, getNpcAtLocation } from "@/game/content/npcs";
import { acceptMissionAction, completeMissionAction } from "@/server/actions";
import { deriveQuestGuidanceTargets } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";

/**
 * Resolves the conversation for the NPC at the player's current location from
 * the authoritative mission projections through ONE generic semantic router.
 * Routing uses semantic mission state only (state, stage.requirementsSatisfied,
 * stage.turnInAvailable, stage.nextObjectiveKind) — it never parses
 * player-facing objective copy and contains no per-mission ID chains, so an
 * ordinary third mission converses through this panel without edits.
 */
export function NpcInteractionPanel() {
  const { acquireCommand, acceptState, foregroundBusy, releaseCommand, state } = usePlay();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [sequenceOverride, setSequenceOverride] = useState<string>();
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const npc = getNpcAtLocation(state.location.currentLocationId);
  const stationary = !state.activeAction && !state.travelState;
  const resolved = npc ? resolveNpcMissionDialogue(npc.id, state.missions) : undefined;
  const missionId = resolved?.missionId;
  const baseSequence = resolved?.sequence;
  const overrideIsCompletion =
    sequenceOverride !== undefined &&
    MISSIONS.some(
      (mission) => mission.dialogue.completionPresentationDialogueId === sequenceOverride,
    );
  const sequence = sequenceOverride ? getDialogue(sequenceOverride) : baseSequence;
  const dialogueNpc = sequence ? getNpc(sequence.npcId) : npc;
  const guidance = deriveQuestGuidanceTargets(state.missions);
  // Available (blue) vs active (green) — distinct semantic sets. If the
  // same NPC is ever in both (e.g. offers a new quest while also being the
  // turn-in for an active one), active green wins.
  const hasActiveGuidance = npc ? guidance.npcIds.has(npc.id) : false;
  const hasAvailableGuidance = npc ? guidance.availableNpcIds.has(npc.id) : false;
  const guidanceClass = hasActiveGuidance
    ? "rs-quest-guidance"
    : hasAvailableGuidance
      ? "rs-quest-available"
      : undefined;
  const guidanceValue = hasActiveGuidance
    ? "active"
    : hasAvailableGuidance
      ? "available"
      : undefined;
  if (!npc || !sequence || !dialogueNpc) return null;
  const dialogue = sequence;
  const npcId = npc.id;
  // The Talk control reads as a turn-in exactly when the conversation drives a
  // completion command right now (stationary, complete_mission authored, and
  // not merely re-viewing the presentation beats after success).
  const turnInAvailable =
    stationary && dialogue.action === "complete_mission" && !overrideIsCompletion;

  function openDialogue() {
    setMessage(undefined);
    setSequenceOverride(undefined);
    setOpen(true);
  }

  function closeDialogue() {
    setOpen(false);
    setSequenceOverride(undefined);
    setMessage(undefined);
  }

  function runDialogueAction() {
    if (!stationary) {
      setMessage("You must be stationary to complete this conversation action.");
      return;
    }
    if (!missionId) {
      setMessage("This conversation is not driving a mission command.");
      return;
    }
    if (!acquireCommand()) {
      setMessage("Another command is being confirmed. Try again in a moment.");
      return;
    }
    setPending(true);
    startTransition(async () => {
      try {
        const isAccept = dialogue.action === "accept_mission";
        const command = { characterId: state.characterId, missionId, npcId };
        const result = isAccept
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
            const refusal = getMissionCapacityRefusalDialogue(
              missionId,
              result.mission.capacityReason,
            );
            if (refusal) {
              setSequenceOverride(refusal.id);
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
          // Offers may author an immediate continuation (e.g. the remote
          // acceptance follow-up that leads straight to the Cutter claim);
          // otherwise acceptance hands control to the objective panel.
          const continuation = resolved?.acceptedContinuationDialogueId;
          if (continuation) {
            setSequenceOverride(continuation);
            setMessage(undefined);
          } else {
            setMessage(undefined);
            setOpen(false);
            setSequenceOverride(undefined);
          }
          return;
        }
        if (dialogue.action === "complete_mission" && result.mission.status === "completed") {
          // Only the authoritative success reveals the reward presentation.
          const presentation = getMissionCompletionPresentation(missionId);
          if (presentation) {
            setSequenceOverride(presentation.id);
            setMessage(undefined);
            return;
          }
        }
        setMessage(undefined);
        setOpen(false);
        setSequenceOverride(undefined);
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
    <>
      <Panel className="!p-4" data-npc-interaction>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
              Local contact
            </p>
            <h2 className="mt-1 font-display text-lg font-bold">{npc.displayName}</h2>
            <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">{npc.role}</p>
          </div>
          <ActionButton
            className={guidanceClass}
            data-npc-turn-in={turnInAvailable ? "true" : "false"}
            data-quest-guidance={guidanceValue}
            ref={triggerRef}
            disabled={foregroundBusy}
            intent={turnInAvailable ? "mission" : "secondary"}
            onClick={openDialogue}
          >
            Talk to {npc.displayName}
          </ActionButton>
        </div>
        {!stationary ? (
          <Feedback tone="muted">
            Conversations with gameplay actions require a stationary character.
          </Feedback>
        ) : null}
        {message && !open ? <Feedback tone="danger">{message}</Feedback> : null}
      </Panel>
      {open ? (
        <DialoguePlayer
          actionBusy={pending}
          actionMessage={message}
          onAction={dialogue.action ? runDialogueAction : undefined}
          onClose={closeDialogue}
          sequence={dialogue}
          triggerRef={triggerRef}
        />
      ) : null}
    </>
  );
}
