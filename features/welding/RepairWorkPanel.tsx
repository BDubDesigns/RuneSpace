"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { usePlay } from "@/features/play/PlayContext";
import { CleanPassControl } from "@/features/welding/CleanPassControl";
import {
  describeMaterialQuantities,
  plannedContribution,
} from "@/features/welding/repair-materials";
import {
  contributeRepairMaterialsAction,
  startWeldingAction,
  stopWeldingAction,
  type PlayActionResult,
  type RepairMaterialContributionActionResult,
} from "@/server/actions";

/**
 * A Welding job at a World Location, rendered entirely from the authored recipe
 * (#209).
 *
 * The Cargo Hold and the Crew Stop each have their own panel because each is
 * part of a larger surface — a storage hold with deposits and withdrawals, a
 * roadside shelter with crew hauler rides — and the repair is one block inside
 * it. A repair that IS the whole activity at a place has no such surroundings,
 * and this is that case: the Deep Jag brace is the first, and nothing here
 * knows that Deep Jag exists.
 *
 * It takes a repair target ID and its own copy, and reads everything else from
 * the projection: which materials the recipe wants, how much is installed, how
 * much the player could hand over now, how many Welding sections remain, and
 * whether a Clean Pass is open. A second job of this shape is two lines at the
 * call site.
 */
export function RepairWorkPanel({
  eyebrow,
  materialsPrompt,
  targetId,
  title,
  weldingPrompt,
}: {
  /** In-world context above the title, e.g. "Collapsed Passage". */
  eyebrow?: string;
  /** Copy shown under the contribute control while material is outstanding. */
  materialsPrompt: string;
  targetId: string;
  /** What the player is doing here, e.g. "Bracing". */
  title: string;
  /** Copy shown under the Start Welding control once the material is in. */
  weldingPrompt: string;
}) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<"materials" | "start" | "stop">();
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();
  const balance = getEffectiveGameBalance();
  const target = getRepairTargetBalance(targetId, balance);
  const repair = state.repairs[targetId];
  const activeWelding = state.activeAction?.actionId === target.actionId;
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
    if (!wasComplete && repair?.complete) {
      setCompletionAnnouncement(`${title} complete.`);
    }
  }, [repair?.complete, title]);

  // The repair's own access rule decides whether this surface exists at all:
  // the authorizing Mission has to be accepted, which is the same fact the
  // location-state boundary reads to let the player walk here in the first
  // place. A completed repair keeps its surface so the finished work is still
  // legible; an unavailable one renders nothing rather than an empty frame.
  if (!repair?.repairAvailable) return null;

  const contribution = plannedContribution(repair.materials);
  const contributionSummary = describeMaterialQuantities(contribution, repair.materials);
  const guided = deriveMissionGuidanceTargets(state.missions).repairTargetIds.has(targetId);
  const attemptDurationMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const elapsed = activeWelding
    ? Math.max(0, now - new Date(state.activeAction!.progressStartedAt).getTime())
    : 0;
  const attemptProgress = activeWelding ? Math.min(100, (elapsed / attemptDurationMs) * 100) : 0;
  const secondsRemaining = activeWelding
    ? Math.max(0, (new Date(state.activeAction!.nextAttemptAt).getTime() - now) / 1_000)
    : 0;

  function resultError(result: PlayActionResult | RepairMaterialContributionActionResult) {
    return "error" in result ? result.error : undefined;
  }

  function contribute() {
    enqueueForeground(() => {
      setPending("materials");
      startTransition(async () => {
        try {
          const result = await contributeRepairMaterialsAction({
            characterId: state.characterId,
            targetId,
            expectedMaterials: contribution,
          });
          const error = resultError(result);
          if (error) setMessage(error);
          else if ("repair" in result) {
            acceptState(result.state);
            setMessage(
              result.repair.status === "committed"
                ? `${describeMaterialQuantities(result.repair.materials, repair!.materials)} installed.`
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

  function runWelding(intent: "start" | "stop") {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          const action = intent === "start" ? startWeldingAction : stopWeldingAction;
          const result = await action({ characterId: state.characterId, targetId });
          const error = resultError(result);
          if (error) setMessage(error);
          else if (result.state) {
            acceptState(result.state);
            setMessage(undefined);
          }
        } catch {
          setMessage("Comms interruption. Welding status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  return (
    <ActivityPanel
      data-repair-work-panel={targetId}
      data-repair-complete={repair.complete ? "true" : "false"}
      title={title}
      {...(eyebrow ? { eyebrow } : {})}
    >
      <p aria-live="polite" className="sr-only">
        {completionAnnouncement}
      </p>
      {repair.complete ? (
        <p className="text-sm text-[color:var(--rs-text-secondary)]">
          The work is done and it is holding.
        </p>
      ) : !repair.materialComplete ? (
        <>
          <MissionActionButton
            data-repair-contribute
            disabled={!repair.canContribute || foregroundBusy || Boolean(state.activeAction)}
            guidance={guided && repair.canContribute ? "active" : undefined}
            loading={pending === "materials"}
            onClick={contribute}
          >
            {repair.canContribute ? `Install ${contributionSummary}` : "Nothing useful carried"}
          </MissionActionButton>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            {materialsPrompt}
          </p>
        </>
      ) : activeWelding ? (
        <>
          <ActionButton
            data-repair-stop-welding
            disabled={foregroundBusy}
            intent="secondary"
            loading={pending === "stop"}
            onClick={() => runWelding("stop")}
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
            data-repair-start-welding
            disabled={foregroundBusy || Boolean(state.activeAction)}
            guidance={guided ? "active" : undefined}
            loading={pending === "start"}
            onClick={() => runWelding("start")}
          >
            Start Welding
          </MissionActionButton>
          <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            {weldingPrompt}
          </p>
        </>
      )}

      {/* One meter per authored material row, then the weld itself: progress
          sits under the control that advances it (#193). */}
      {repair.materials.map((material) => (
        <StatusMeter
          detail={`${material.contributed} / ${material.required}`}
          key={material.itemId}
          label={material.note ? `${material.name} — ${material.note}` : material.name}
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

      {message ? <Feedback>{message}</Feedback> : null}
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
        carry={{
          slotsUsed: state.inventory.slotsUsed,
          slotsAvailable: state.inventory.slotsAvailable,
          massGrams: state.inventory.massGrams,
          capacityGrams: state.inventory.capacityGrams,
        }}
        items={repair.materials.map((material) => ({
          label: `${material.name} carried`,
          quantity: state.carriedByItemId[material.itemId] ?? 0,
        }))}
      />
    </ActivityPanel>
  );
}
