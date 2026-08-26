"use client";

import { useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { DialoguePlayer } from "@/features/dialogue/DialoguePlayer";
import {
  getCutYourTeethActiveDialogue,
  getCutYourTeethCompletion,
  getDialogue,
  getWalkItOffDialogue,
} from "@/game/content/dialogue";
import { getNpc, getNpcAtLocation } from "@/game/content/npcs";
import { DIALOGUE_IDS, MISSION_IDS, NPC_IDS } from "@/game/config/foundations";
import {
  acceptCutYourTeethAction,
  acceptWalkItOffAction,
  completeCutYourTeethAction,
  completeWalkItOffAction,
} from "@/server/actions";
import type { DialogueSequence } from "@/game/content/dialogue";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

type ActiveMissionFlow = "walk_it_off" | "cut_your_teeth";

/**
 * Resolves the Tansy conversation for the Walk It Off → Cut Your Teeth chain
 * from the authoritative mission projections (issue #110). Wade keeps his
 * existing two-sequence flow.
 *
 * Routing uses SEMANTIC mission state only (state, stage.readyForCompletion,
 * stage.nextObjectiveKind) — never regex-parses player-facing objective copy.
 */
function resolveDialogueForNpc(
  npcId: string,
  missions: readonly {
    missionId: string;
    state: string;
    prerequisiteSatisfied?: boolean;
    stage?: {
      requirementsSatisfied: boolean;
      turnInAvailable: boolean;
      nextObjectiveKind?: "equip_item" | "carry_stack";
    };
  }[],
): { sequence: DialogueSequence; flow: ActiveMissionFlow | null } | undefined {
  const walkItOff = missions.find((entry) => entry.missionId === MISSION_IDS.walkItOff);
  const cutYourTeeth = missions.find((entry) => entry.missionId === MISSION_IDS.cutYourTeeth);

  if (npcId === NPC_IDS.wadeRusk) {
    const sequence = getWalkItOffDialogue(npcId, asMissionState(walkItOff?.state));
    return sequence ? { sequence, flow: "walk_it_off" } : undefined;
  }
  if (npcId !== NPC_IDS.tansyRusk) return undefined;

  // Chain routing: Cut Your Teeth content only exists once Walk It Off is done.
  if (cutYourTeeth && cutYourTeeth.state !== "not_accepted") {
    if (cutYourTeeth.state === "completed") {
      const sequence = getCutYourTeethCompletion();
      return sequence ? { sequence, flow: null } : undefined;
    }
    // Active: contextual reminder vs turn-in from SEMANTIC stage data.
    // Requirements can be satisfied while the character is busy (Mining still
    // running): never tell them to gather MORE shale when they already have a
    // full stack — route to the turn-in or a finish-your-action treatment.
    const requirementsSatisfied = cutYourTeeth.stage?.requirementsSatisfied === true;
    const turnInAvailable = cutYourTeeth.stage?.turnInAvailable === true;
    const nextKind = cutYourTeeth.stage?.nextObjectiveKind;
    const sequence = getCutYourTeethActiveDialogue(
      turnInAvailable
        ? "ready"
        : requirementsSatisfied
          ? "busy"
          : nextKind === "equip_item"
            ? "equip"
            : "stack",
    );
    return sequence ? { sequence, flow: "cut_your_teeth" } : undefined;
  }

  // Walk It Off complete + Cut Your Teeth not accepted → the CYT OFFER is
  // owned by the cut_your_teeth flow so its Accept calls the CYT acceptance.
  // Never show the offer before its prerequisite is satisfied.
  if (cutYourTeeth && cutYourTeeth.state === "not_accepted" && cutYourTeeth.prerequisiteSatisfied) {
    const sequence = getDialogue(DIALOGUE_IDS.tansyCutYourTeethOffer);
    if (sequence) return { sequence, flow: "cut_your_teeth" };
  }

  const sequence = getWalkItOffDialogue(npcId, asMissionState(walkItOff?.state));
  return sequence ? { sequence, flow: "walk_it_off" } : undefined;
}

type MissionStateLiteral = "not_accepted" | "active" | "ready_for_completion" | "completed";

function asMissionState(state: string | undefined): MissionStateLiteral {
  return state === "active" || state === "ready_for_completion" || state === "completed"
    ? state
    : "not_accepted";
}

export function NpcInteractionPanel() {
  const { acquireCommand, acceptState, foregroundBusy, releaseCommand, state } = useMiningPlay();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [sequenceOverride, setSequenceOverride] = useState<string>();
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const npc = getNpcAtLocation(state.location.currentLocationId);
  const stationary = !state.activeAction && !state.travelState;
  const resolved = npc ? resolveDialogueForNpc(npc.id, state.missions) : undefined;
  const baseFlow = resolved?.flow ?? null;
  const baseSequence = resolved?.sequence;
  const overrideIsCompletion =
    sequenceOverride === DIALOGUE_IDS.tansyAfterClaim ||
    sequenceOverride === DIALOGUE_IDS.tansyCutYourTeethCompletion;
  const sequence = sequenceOverride ? getDialogue(sequenceOverride) : baseSequence;
  const dialogueNpc = sequence ? getNpc(sequence.npcId) : npc;
  if (!npc || !sequence || !dialogueNpc) return null;
  const dialogue = sequence;
  const turnInAvailable =
    stationary &&
    ((baseFlow === "walk_it_off" &&
      dialogue.action === "complete_mission" &&
      !overrideIsCompletion) ||
      (baseFlow === "cut_your_teeth" &&
        dialogue.action === "complete_mission" &&
        !overrideIsCompletion));

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
        const isAccept = dialogue.action === "accept_mission";
        const result =
          baseFlow === "cut_your_teeth"
            ? isAccept
              ? await acceptCutYourTeethAction({ characterId: state.characterId })
              : await completeCutYourTeethAction({ characterId: state.characterId })
            : isAccept
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
        if (
          dialogue.id === DIALOGUE_IDS.tansyCutYourTeethOffer &&
          result.mission.status === "accepted"
        ) {
          // Accepted: close so the authoritative objective panel takes over.
          setMessage(undefined);
          setOpen(false);
          setSequenceOverride(undefined);
          return;
        }
        if (dialogue.action === "complete_mission" && result.mission.status === "completed") {
          // Only the authoritative success reveals the reward presentation.
          setSequenceOverride(
            baseFlow === "cut_your_teeth"
              ? DIALOGUE_IDS.tansyCutYourTeethCompletion
              : DIALOGUE_IDS.tansyAfterClaim,
          );
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
          onAction={dialogue.action ? runDialogueAction : undefined}
          onClose={closeDialogue}
          sequence={dialogue}
          triggerRef={triggerRef}
        />
      ) : null}
    </>
  );
}
