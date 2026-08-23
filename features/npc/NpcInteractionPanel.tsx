"use client";

import { useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { Feedback } from "@/components/ui/Feedback";
import { DialoguePlayer } from "@/features/dialogue/DialoguePlayer";
import { getConversationBackground } from "@/game/content/conversation-backgrounds";
import { getWalkItOffDialogue } from "@/game/content/dialogue";
import { getNpcAtLocation, getNpc } from "@/game/content/npcs";
import { MISSION_IDS } from "@/game/config/foundations";
import { acceptWalkItOffAction, completeWalkItOffAction } from "@/server/actions";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

export function NpcInteractionPanel() {
  const { acquireCommand, acceptState, foregroundBusy, releaseCommand, state } = useMiningPlay();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const npc = getNpcAtLocation(state.location.currentLocationId);
  const mission = state.missions.find((entry) => entry.missionId === MISSION_IDS.walkItOff);
  const sequence = npc && mission ? getWalkItOffDialogue(npc.id, mission.state) : undefined;
  const background = npc ? getConversationBackground(npc.conversationBackgroundId) : undefined;
  if (!npc || !mission || !sequence || !background) return null;
  const dialogue = sequence;
  const stationary = !state.activeAction && !state.travelState;

  function openDialogue() {
    setMessage(undefined);
    setOpen(true);
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
          setMessage(result.mission.message);
          return;
        }
        setMessage(undefined);
        setOpen(false);
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
            ref={triggerRef}
            disabled={foregroundBusy}
            intent="secondary"
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
          background={background}
          npc={getNpc(sequence.npcId) ?? npc}
          onAction={dialogue.action ? runDialogueAction : undefined}
          onClose={() => setOpen(false)}
          sequence={dialogue}
          triggerRef={triggerRef}
        />
      ) : null}
    </>
  );
}
