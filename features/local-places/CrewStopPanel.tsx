"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { GAME_TICK_MS, LOCAL_PLACE_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { deriveCompletedMissionIds, deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";
import { CrewHaulerRideControl } from "@/features/travel/CrewHaulerRideControl";
import { availableCrewHaulerRides } from "@/features/travel/crew-hauler-rides";
import {
  contributeRepairMaterialsAction,
  startWeldingAction,
  stopWeldingAction,
  type PlayActionResult,
  type RepairMaterialContributionActionResult,
} from "@/server/actions";
import type { PlayGameplayState } from "@/server/play";

const TARGET_ID = REPAIR_TARGET_IDS.crewStop;
const PLACE_ID = LOCAL_PLACE_IDS.holoHollowCrewStop;

function weldingMessage(state: PlayGameplayState): string | undefined {
  if (state.weldingError === "welding_unavailable_here")
    return "Welding the Crew Stop is only possible while you are standing at it.";
  if (state.weldingError === "welding_locked") {
    const repair = state.repairs[TARGET_ID];
    const remaining = Math.max(
      0,
      (repair?.refinedFerriteRequired ?? 0) - (repair?.refinedFerriteContributed ?? 0),
    );
    return `The brace still needs ${remaining} more Refined Ferrite before there is anything to weld.`;
  }
  if (state.weldingError === "repair_complete") return "The Crew Stop is already repaired.";
  if (state.commandError === "another_action_active")
    return "Another activity is active. Finish it before starting Welding.";
  return undefined;
}

function resultError(result: PlayActionResult | RepairMaterialContributionActionResult) {
  return "error" in result ? result.error : undefined;
}

/**
 * The Crew Stop's own activity (#172).
 *
 * The place is visible from the start; this surface is where the repair work
 * lives, and it appears only once the repair is genuinely available — which the
 * server decides from the accepted Mission, not from the player having clicked
 * the location.
 *
 * Finishing the tenth weld and turning the Mission in are two different events,
 * and this surface keeps them apart. The repair completing is a physical fact:
 * the shelter's repaired artwork and copy change immediately, from the repair
 * record alone. The ride is a relationship, and it exists only once Renn has
 * actually been told — so nothing here mentions the hauler, and no boarding
 * control appears, until Out of the Weather is authoritatively completed. In
 * between, the blue Mission guidance is what points the player back to Renn.
 *
 * Everything rendered here comes from the generic repair projection, so the
 * material recipe and increment count are never a second copy of balance.
 */
export function CrewStopPanel() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();

  const balance = getEffectiveGameBalance();
  const target = getRepairTargetBalance(TARGET_ID, balance);
  const repair = state.repairs[TARGET_ID];
  const activeWelding = state.activeAction?.actionId === target.actionId;
  const guided = deriveMissionGuidanceTargets(state.missions).repairTargetIds.has(TARGET_ID);
  // The same authored rule the town surface asks: this place's rides are the
  // ones boarding here, and only once their unlocking Mission is completed.
  const rides = availableCrewHaulerRides({
    locationId: state.location.currentLocationId,
    localPlaceId: PLACE_ID,
    completedMissionIds: deriveCompletedMissionIds(state.missions),
  });
  const contribution = repair?.availableContribution.refinedFerrite ?? 0;
  const previousCompletion = useRef(repair?.complete ?? false);
  const [completionAnnouncement, setCompletionAnnouncement] = useState("");

  useEffect(() => {
    if (!activeWelding) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [activeWelding]);

  useEffect(() => {
    const wasComplete = previousCompletion.current;
    previousCompletion.current = repair?.complete ?? false;
    if (wasComplete || !repair?.complete) return;
    setCompletionAnnouncement("Crew Stop repaired");
    const timer = window.setTimeout(() => setCompletionAnnouncement(""), 3_600);
    return () => window.clearTimeout(timer);
  }, [repair?.complete]);

  if (!repair) return null;

  // A finished Crew Stop keeps no quest chrome: the repaired artwork and the
  // repaired description are the persistent world change.
  if (repair.complete) {
    // Repaired, but Renn has not been told yet. The shelter already looks
    // fixed; claiming the crews will carry the player would be claiming a
    // relationship that does not exist yet, so this renders nothing visible at
    // all and leaves the turn-in to the Mission guidance.
    if (rides.length === 0) {
      return (
        <div data-crew-stop-panel data-crew-stop-state="repaired">
          <span aria-live="polite" className="sr-only">
            {completionAnnouncement}
          </span>
        </div>
      );
    }
    return (
      <div className="mt-5" data-crew-stop-panel data-crew-stop-state="boarding">
        <SectionHeader eyebrow="Crew Stop">Shift hauler</SectionHeader>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
          The crews run out to The Jag through the day and will squeeze you on.
        </p>
        <div className="mt-4">
          <CrewHaulerRideControl localPlaceId={PLACE_ID} />
        </div>
        <span aria-live="polite" className="sr-only">
          {completionAnnouncement}
        </span>
      </div>
    );
  }

  // Before the Mission is accepted the shelter is simply in the state it is in.
  // The description and the artwork already say so; there is no repair UI to
  // tease and no control to grey out.
  if (!repair.repairAvailable) return null;

  function applyStateResult(result: PlayActionResult) {
    const error = resultError(result);
    if (error) {
      setMessage(error);
      return;
    }
    if (!result.state) return;
    acceptState(result.state);
    setMessage(weldingMessage(result.state));
  }

  function runWeldingCommand(intent: "start" | "stop") {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          applyStateResult(
            intent === "start"
              ? await startWeldingAction({ characterId: state.characterId, targetId: TARGET_ID })
              : await stopWeldingAction({ characterId: state.characterId, targetId: TARGET_ID }),
          );
        } catch {
          setMessage("Comms interruption. Welding status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  function contribute() {
    enqueueForeground(() => {
      setPending("materials");
      startTransition(async () => {
        try {
          const result = await contributeRepairMaterialsAction({
            characterId: state.characterId,
            targetId: TARGET_ID,
            expectedRefinedFerrite: contribution,
            expectedSlag: 0,
          });
          if ("error" in result) setMessage(result.error);
          else {
            acceptState(result.state);
            setMessage(
              result.repair.status === "committed"
                ? `${result.repair.refinedFerrite} Refined Ferrite added to the brace.`
                : result.repair.message,
            );
          }
        } catch {
          setMessage("Comms interruption. Repair materials were not confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  const attemptDurationMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const elapsed = activeWelding
    ? Math.max(0, now - new Date(state.activeAction!.progressStartedAt).getTime())
    : 0;
  const attemptProgress = activeWelding ? Math.min(100, (elapsed / attemptDurationMs) * 100) : 0;
  const secondsRemaining = activeWelding
    ? Math.max(0, (new Date(state.activeAction!.nextAttemptAt).getTime() - now) / 1_000)
    : 0;

  return (
    <div className="mt-5 space-y-4" data-crew-stop-panel data-crew-stop-state="damaged">
      <SectionHeader eyebrow="Crew Stop">Repair</SectionHeader>

      <StatusMeter
        detail={`${repair.refinedFerriteContributed} / ${repair.refinedFerriteRequired}`}
        label="Refined Ferrite in the brace"
        value={
          repair.refinedFerriteRequired === 0
            ? 100
            : (repair.refinedFerriteContributed / repair.refinedFerriteRequired) * 100
        }
      />
      <StatusMeter
        detail={`${repair.weldingProgress} / ${repair.weldingIncrements} welds`}
        label="Welding"
        value={
          repair.weldingIncrements === 0
            ? 0
            : (repair.weldingProgress / repair.weldingIncrements) * 100
        }
      />

      {!repair.materialComplete ? (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            {`The canopy needs ${repair.refinedFerriteRequired} Refined Ferrite of bracing before any of it is worth welding. Hand over what you are carrying; the rest can wait until you come back.`}
          </p>
          <MissionActionButton
            data-crew-stop-contribute
            disabled={contribution === 0 || foregroundBusy || Boolean(state.activeAction)}
            guidance={guided && contribution > 0 ? "active" : undefined}
            loading={pending === "materials"}
            onClick={contribute}
          >
            {contribution > 0
              ? `Add ${contribution} Refined Ferrite`
              : "No useful Refined Ferrite carried"}
          </MissionActionButton>
        </>
      ) : activeWelding ? (
        <>
          <StatusMeter
            detail={`${secondsRemaining.toFixed(1)}s`}
            label="Current weld"
            value={attemptProgress}
          />
          <ActionButton
            data-crew-stop-stop-welding
            disabled={foregroundBusy}
            intent="secondary"
            loading={pending === "stop"}
            onClick={() => runWeldingCommand("stop")}
          >
            Stop Welding
          </ActionButton>
        </>
      ) : (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            The bracing is all here. What is left is the welding.
          </p>
          <MissionActionButton
            data-crew-stop-start-welding
            disabled={foregroundBusy || Boolean(state.activeAction)}
            guidance={guided ? "active" : undefined}
            loading={pending === "start"}
            onClick={() => runWeldingCommand("start")}
          >
            Start Welding
          </MissionActionButton>
        </>
      )}

      {message ? <Feedback>{message}</Feedback> : null}
      <span aria-live="polite" className="sr-only">
        {completionAnnouncement}
      </span>
    </div>
  );
}
