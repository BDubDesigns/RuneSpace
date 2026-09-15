"use client";

import { useEffect, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance, practiceSectionXp } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { CleanPassControl } from "@/features/welding/CleanPassControl";
import { usePlay } from "@/features/play/PlayContext";
import { PracticeRunPanel } from "@/features/practice/PracticeRunPanel";
import {
  setPracticeSlagPreferenceAction,
  startPracticeWeldingAction,
  stopPracticeWeldingAction,
  type PlayActionResult,
} from "@/server/actions";
import type { PlayGameplayState } from "@/server/play";

function practiceMessage(state: PlayGameplayState): string | undefined {
  if (state.practiceError === "practice_unavailable_here")
    return "The Workbench is only usable while you are standing at it.";
  if (state.practiceError === "practice_locked") return "Wade has not put you on the bench yet.";
  if (state.practiceError === "insufficient_scrap")
    return `A fresh weld takes ${state.practice.scrapPerWeld} Scrap Metal.`;
  if (state.commandError === "another_action_active")
    return "Another activity is active. Finish it before starting a weld.";
  return undefined;
}

/**
 * The Workbench (#190).
 *
 * Before Wade puts the player on the bench this renders nothing at all: the
 * bench is scenery in the scene art, with no label, no click target, no
 * disabled control and no teaser. Opening the panel afterwards costs nothing —
 * Scrap is consumed by starting a weld, never by looking.
 *
 * Every number here is the authoritative projection: the recipe, the section
 * count, the run totals, and how much loose Scrap is left for the next weld.
 */
export function PracticeWeldingPanel() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();

  const balance = getEffectiveGameBalance();
  const practice = state.practice;
  const active = practice.active;

  useEffect(() => {
    if (!active) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, [active]);

  // The bench is scenery until the Mission that opens it is accepted.
  if (!practice.unlocked) return null;

  const guided = deriveMissionGuidanceTargets(state.missions).actionIds.has(
    ACTION_IDS.practiceWelding,
  );
  const canStartFresh = practice.scrapAvailable >= practice.scrapPerWeld;
  const resumable = practice.cycleActive;

  function applyResult(result: PlayActionResult) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (!result.state) return;
    acceptState(result.state);
    setMessage(practiceMessage(result.state));
  }

  function run(intent: "start" | "stop" | "slag", autoDiscardSlag?: boolean) {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          applyResult(
            intent === "start"
              ? await startPracticeWeldingAction({ characterId: state.characterId })
              : intent === "stop"
                ? await stopPracticeWeldingAction({ characterId: state.characterId })
                : await setPracticeSlagPreferenceAction({
                    characterId: state.characterId,
                    autoDiscardSlag: Boolean(autoDiscardSlag),
                  }),
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
    state.activeAction && active
      ? new Date(state.activeAction.nextAttemptAt).getTime() -
        new Date(state.activeAction.progressStartedAt).getTime()
      : 0;
  const sectionRemaining =
    state.activeAction && active
      ? Math.max(0, new Date(state.activeAction.nextAttemptAt).getTime() - now)
      : 0;

  return (
    <div className="mt-5 space-y-4" data-practice-panel data-practice-active={String(active)}>
      <SectionHeader eyebrow="Workbench">Practice Welding</SectionHeader>

      <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        {`${practice.scrapPerWeld} Scrap Metal, ${practice.sectionsPerWeld} sections, nominal up to ${balance.practiceWelding.slagPerWeld} Slag. Each section is worth ${practiceSectionXp(balance)} Welding XP.`}
      </p>

      <StatusMeter
        detail={`${practice.sectionsCompleted} / ${practice.sectionsPerWeld}`}
        label="Current weld"
        value={(practice.sectionsCompleted / practice.sectionsPerWeld) * 100}
      />
      {active ? (
        <StatusMeter
          detail={`${(sectionRemaining / 1_000).toFixed(1)}s`}
          label="Current section"
          value={
            sectionMs === 0 ? 0 : Math.min(100, ((sectionMs - sectionRemaining) / sectionMs) * 100)
          }
        />
      ) : null}

      <p className="text-sm text-[color:var(--rs-text-secondary)]" data-practice-scrap>
        <strong>{practice.scrapAvailable}</strong> Scrap Metal loose for later welds
      </p>

      {active ? (
        <ActionButton
          data-practice-stop
          disabled={foregroundBusy && pending !== "stop"}
          intent="secondary"
          loading={pending === "stop"}
          onClick={() => run("stop")}
        >
          Stop Practice
        </ActionButton>
      ) : (
        <MissionActionButton
          data-practice-start
          disabled={(!resumable && !canStartFresh) || Boolean(state.activeAction) || foregroundBusy}
          guidance={guided ? "active" : undefined}
          loading={pending === "start"}
          onClick={() => run("start")}
        >
          {resumable
            ? "Resume Practice"
            : canStartFresh
              ? "Start Practice"
              : `Need ${practice.scrapPerWeld} Scrap Metal`}
        </MissionActionButton>
      )}

      <CleanPassControl cleanPass={practice.cleanPass} />

      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          aria-pressed={practice.autoDiscardSlag}
          data-practice-slag-toggle
          disabled={foregroundBusy && pending !== "slag"}
          intent="secondary"
          loading={pending === "slag"}
          onClick={() => run("slag", !practice.autoDiscardSlag)}
        >
          {practice.autoDiscardSlag ? "Auto-discard Slag" : "Keep Slag"}
        </ActionButton>
        <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Applied when a weld finishes
        </p>
      </div>

      {practice.lastStopReason === "out_of_scrap" && !active ? (
        <Feedback tone="muted">Out of Scrap Metal</Feedback>
      ) : null}
      {message ? <Feedback tone="danger">{message}</Feedback> : null}

      <Panel className="!p-0">
        <PracticeRunPanel run={practice.run} />
      </Panel>
    </div>
  );
}
