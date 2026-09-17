"use client";

import { useEffect, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { SkillProgressRow } from "@/features/shared/activity-context";
import { CleanPassControl } from "@/features/welding/CleanPassControl";
import { usePlay } from "@/features/play/PlayContext";
import { ACTION_IDS } from "@/game/config/foundations";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import {
  startWorkOrderWeldingAction,
  stopWorkOrderWeldingAction,
  type WorkOrderActionResult,
} from "@/server/actions";
import type { ActiveWorkOrderProjection } from "@/server/play";

/**
 * The customer job on Wade's bench (#207).
 *
 * The same Welding the player already knows — the same section cadence, the
 * same Clean Pass, the same Stop and Resume — with a client's name on it and a
 * payout at the end. What is deliberately different from Practice is that
 * nothing here starts by itself: accepting the job put it on the bench, and
 * lighting the torch is a separate decision the player makes when they are
 * ready.
 */
export function WorkOrderBenchPanel({ active }: { active: ActiveWorkOrderProjection }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();

  const welding = active.active;

  useEffect(() => {
    if (!welding) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, [welding]);

  const guided = deriveMissionGuidanceTargets(state.missions).actionIds.has(
    ACTION_IDS.workOrderWelding,
  );
  const started = active.sectionsCompleted > 0;

  function applyResult(result: WorkOrderActionResult) {
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    acceptState(result.state);
    setMessage(result.workOrder.status === "refused" ? result.workOrder.message : undefined);
  }

  function run(intent: "start" | "stop") {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          applyResult(
            intent === "start"
              ? await startWorkOrderWeldingAction({ characterId: state.characterId })
              : await stopWorkOrderWeldingAction({ characterId: state.characterId }),
          );
        } catch {
          setMessage("Comms interruption. The bench could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  const sectionMs =
    state.activeAction && welding
      ? new Date(state.activeAction.nextAttemptAt).getTime() -
        new Date(state.activeAction.progressStartedAt).getTime()
      : 0;
  const sectionRemaining =
    state.activeAction && welding
      ? Math.max(0, new Date(state.activeAction.nextAttemptAt).getTime() - now)
      : 0;

  return (
    <ActivityPanel
      eyebrow="Workbench — client job"
      title={active.title}
      data-work-order-bench
      data-work-order-id={active.workOrderId}
      data-work-order-active={String(welding)}
    >
      <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        {`For ${active.clientName}. Materials are already committed.`}
      </p>

      {welding ? (
        <ActionButton
          data-work-order-stop
          disabled={foregroundBusy && pending !== "stop"}
          intent="secondary"
          loading={pending === "stop"}
          onClick={() => run("stop")}
        >
          Stop Welding
        </ActionButton>
      ) : (
        <MissionActionButton
          data-work-order-start
          disabled={Boolean(state.activeAction) || foregroundBusy}
          guidance={guided ? "active" : undefined}
          loading={pending === "start"}
          onClick={() => run("start")}
        >
          {started ? "Resume Welding" : "Start Welding"}
        </MissionActionButton>
      )}

      <StatusMeter
        detail={`${active.sectionsCompleted} / ${active.sections}`}
        label="Job progress"
        value={(active.sectionsCompleted / active.sections) * 100}
      />
      {welding ? (
        <StatusMeter
          detail={`${(sectionRemaining / 1_000).toFixed(1)}s`}
          label="Current section"
          value={
            sectionMs === 0 ? 0 : Math.min(100, ((sectionMs - sectionRemaining) / sectionMs) * 100)
          }
        />
      ) : null}

      <CleanPassControl cleanPass={active.cleanPass} />

      <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        {`${active.sections} sections, ${active.xpPerSection} Welding XP each. Pays ${active.payoutCredits} Credits on completion.`}
      </p>

      {message ? <Feedback tone="danger">{message}</Feedback> : null}

      <SkillProgressRow
        level={state.welding.level}
        skill="Welding"
        tone="welding"
        xpIntoLevel={state.welding.xpIntoLevel}
        {...(state.welding.xpToNextLevel === undefined
          ? {}
          : { xpToNextLevel: state.welding.xpToNextLevel })}
      />
    </ActivityPanel>
  );
}
