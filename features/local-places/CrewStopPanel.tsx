"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { GAME_TICK_MS, LOCAL_PLACE_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { deriveCompletedMissionIds, deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";
import { CleanPassControl } from "@/features/welding/CleanPassControl";
import {
  describeMaterialQuantities,
  describeOutstandingMaterials,
  plannedContribution,
} from "@/features/welding/repair-materials";
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
    const materials = state.repairs[TARGET_ID]?.materials ?? [];
    const outstanding = describeMaterialQuantities(
      Object.fromEntries(materials.map((material) => [material.itemId, material.remaining])),
      materials,
    );
    return `The brace still needs ${outstanding} before there is anything to weld.`;
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
  const contribution = plannedContribution(repair?.materials ?? []);
  const contributionSummary = describeMaterialQuantities(contribution, repair?.materials ?? []);
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
      <ActivityPanel
        eyebrow="Crew Stop"
        title="Shift hauler"
        data-crew-stop-panel
        data-crew-stop-state="boarding"
      >
        <CrewHaulerRideControl localPlaceId={PLACE_ID} />
        <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
          The crews run out to The Jag through the day and will squeeze you on. Coming back the
          hauler is full of shale, so the walk home is yours.
        </p>
        <span aria-live="polite" className="sr-only">
          {completionAnnouncement}
        </span>
      </ActivityPanel>
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
            expectedMaterials: contribution,
          });
          if ("error" in result) setMessage(result.error);
          else {
            acceptState(result.state);
            setMessage(
              result.repair.status === "committed"
                ? `${describeMaterialQuantities(result.repair.materials, repair?.materials ?? [])} added to the brace.`
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
    <ActivityPanel
      eyebrow="Crew Stop"
      title="Repair"
      data-crew-stop-panel
      data-crew-stop-state="damaged"
    >
      {!repair.materialComplete ? (
        <>
          <MissionActionButton
            data-crew-stop-contribute
            disabled={!repair.canContribute || foregroundBusy || Boolean(state.activeAction)}
            guidance={guided && repair.canContribute ? "active" : undefined}
            loading={pending === "materials"}
            onClick={contribute}
          >
            {repair.canContribute
              ? `Add ${contributionSummary}`
              : `No useful ${describeOutstandingMaterials(repair.materials)} carried`}
          </MissionActionButton>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            {`The canopy needs ${describeMaterialQuantities(
              Object.fromEntries(
                repair.materials.map((material) => [material.itemId, material.required]),
              ),
              repair.materials,
            )} of bracing before any of it is worth welding. Hand over what you are carrying; the rest can wait until you come back.`}
          </p>
        </>
      ) : activeWelding ? (
        <>
          <ActionButton
            data-crew-stop-stop-welding
            disabled={foregroundBusy}
            intent="secondary"
            loading={pending === "stop"}
            onClick={() => runWeldingCommand("stop")}
          >
            Stop Welding
          </ActionButton>
          <StatusMeter
            detail={`${secondsRemaining.toFixed(1)}s`}
            label="Current weld"
            value={attemptProgress}
          />
          {/* Clean Pass is general Welding, not a Practice feature (#190). */}
          <CleanPassControl cleanPass={repair.cleanPass} />
        </>
      ) : (
        <>
          <MissionActionButton
            data-crew-stop-start-welding
            disabled={foregroundBusy || Boolean(state.activeAction)}
            guidance={guided ? "active" : undefined}
            loading={pending === "start"}
            onClick={() => runWeldingCommand("start")}
          >
            Start Welding
          </MissionActionButton>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            The bracing is all here. What is left is the welding.
          </p>
        </>
      )}

      {/* The repair's own progress sits under the control that advances it
          (#193), not above it: the player came here to hand over ferrite or to
          weld, and the two meters are how they read the result. */}
      {/* One meter per authored material row (#209); the Crew Stop happens to
          want one, and the panel never assumes that. */}
      {repair.materials.map((material) => (
        <StatusMeter
          detail={`${material.contributed} / ${material.required}`}
          key={material.itemId}
          label={`${material.name} in the brace`}
          value={material.required === 0 ? 100 : (material.contributed / material.required) * 100}
        />
      ))}
      <StatusMeter
        detail={`${repair.weldingProgress} / ${repair.weldingIncrements} welds`}
        label="Welding"
        value={
          repair.weldingIncrements === 0
            ? 0
            : (repair.weldingProgress / repair.weldingIncrements) * 100
        }
      />

      {/* The same Welding the Workbench trains, so it reports the same way
          (#193): the welds here grant Welding XP and used to show none. */}
      <SkillProgressRow
        level={state.welding.level}
        skill="Welding"
        tone="welding"
        xpIntoLevel={state.welding.xpIntoLevel}
        {...(state.welding.xpToNextLevel === undefined
          ? {}
          : { xpToNextLevel: state.welding.xpToNextLevel })}
      />
      <ActivityContextRow
        items={repair.materials.map((material) => ({
          label: `${material.name} carried`,
          quantity: state.carriedByItemId[material.itemId] ?? 0,
        }))}
      />

      {message ? <Feedback>{message}</Feedback> : null}
      <span aria-live="polite" className="sr-only">
        {completionAnnouncement}
      </span>
    </ActivityPanel>
  );
}
