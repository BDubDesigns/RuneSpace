"use client";

import { useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { DialoguePlayer } from "@/features/dialogue/DialoguePlayer";
import { getDialogue, getWalkItOffDialogue } from "@/game/content/dialogue";
import { getNpc, getNpcAtLocation } from "@/game/content/npcs";
import { DIALOGUE_IDS, MISSION_IDS } from "@/game/config/foundations";
import { acceptWalkItOffAction, completeWalkItOffAction } from "@/server/actions";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

export function NpcInteractionPanel() {
  const { acquireCommand, acceptState, foregroundBusy, releaseCommand, state } = useMiningPlay();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [sequenceOverride, setSequenceOverride] = useState<string>();
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const npc = getNpcAtLocation(state.location.currentLocationId);
  const mission = state.missions.find((entry) => entry.missionId === MISSION_IDS.walkItOff);
  const baseSequence = npc
    ? getWalkItOffDialogue(npc.id, mission?.state ?? "not_accepted")
    : undefined;
  const sequence = sequenceOverride ? getDialogue(sequenceOverride) : baseSequence;
  const dialogueNpc = sequence ? getNpc(sequence.npcId) : npc;
  if (!npc || !sequence || !dialogueNpc) return null;
  const dialogue = sequence;
  const stationary = !state.activeAction && !state.travelState;
  const turnInAvailable =
    stationary && mission?.state === "ready_for_completion" && mission.completionNpcId === npc.id;

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
    if (!acquireCommand()) {
      setMessage("Another command is being confirmed. Try again in a moment.");
      return;
    }
    setPending(true);
    startTransition(async () => {
      try {
        const result =
          dialogue.action === "accept_mission"
            ? await acceptWalkItOffAction({ characterId: state.characterId })
            : await completeWalkItOffAction({ characterId: state.characterId });
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
            setSequenceOverride(
              result.mission.capacityReason === "slots"
                ? DIALOGUE_IDS.tansyCapacitySlots
                : DIALOGUE_IDS.tansyCapacityMass,
            );
            setMessage(undefined);
          } else {
            setMessage(result.mission.message);
          }
          return;
        }
        if (
          dialogue.id === DIALOGUE_IDS.tansyBeforeMission &&
          result.mission.status === "accepted"
        ) {
          setSequenceOverride(DIALOGUE_IDS.tansyAfterRemoteAcceptance);
          setMessage(undefined);
          return;
        }
        if (dialogue.action === "complete_mission" && result.mission.status === "completed") {
          setSequenceOverride(DIALOGUE_IDS.tansyAfterClaim);
          setMessage(undefined);
          return;
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
            data-npc-turn-in={turnInAvailable ? "true" : "false"}
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
          npc={dialogueNpc}
          onAction={dialogue.action ? runDialogueAction : undefined}
          onClose={closeDialogue}
          sequence={dialogue}
          triggerRef={triggerRef}
        />
      ) : null}
    </>
  );
}
