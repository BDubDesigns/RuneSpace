"use client";

import { useEffect, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { PracticeRunPanel } from "@/features/practice/PracticeRunPanel";
import { getEffectiveGameBalance, practiceSectionXp } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { CleanPassControl } from "@/features/welding/CleanPassControl";
import { usePlay } from "@/features/play/PlayContext";
import {
  finishCurrentPracticeWeldAction,
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
  if (state.practiceError === "workbench_occupied")
    return "The Workbench already has a client job on it. Finish it before practising.";
  if (state.practiceError === "no_weld_in_progress")
    return "There is no weld on the bench to finish.";
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
 * count, and how much loose Scrap is left for the next weld. The run history is
 * its own sibling panel, so the bench stays the controls the player is using.
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

  function run(intent: "start" | "stop" | "finish" | "slag", autoDiscardSlag?: boolean) {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          applyResult(
            intent === "start"
              ? await startPracticeWeldingAction({ characterId: state.characterId })
              : intent === "stop"
                ? await stopPracticeWeldingAction({ characterId: state.characterId })
                : intent === "finish"
                  ? await finishCurrentPracticeWeldAction({ characterId: state.characterId })
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
    <ActivityPanel
      eyebrow="Workbench"
      title="Practice Welding"
      data-practice-panel
      data-practice-active={String(active)}
    >
      {/* Start or stop first (#193), together with the third "stop after
          this one" intent, given room of its own rather than sitting flush
          against Stop/Resume — two controls that both end the run otherwise
          read as one segmented control on a phone (#207 follow-up). The
          recipe, the meters and the loose scrap all describe what these
          controls do, so they follow — which is what moves the bench above
          the fold on a phone while Wade's Mission strip is on screen. */}
      <div className="flex flex-wrap items-center gap-3">
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
            disabled={
              (!resumable && !canStartFresh) || Boolean(state.activeAction) || foregroundBusy
            }
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

        {/* Practice repeats by design, which leaves no ordinary way to end a
            run on a clear bench: Stop preserves a partial weld, and simply
            waiting spends two more Scrap the instant this one finishes.
            Offered whenever a paid weld exists — running or stopped —
            because that weld is what stands between the player and a
            customer job (#207). Once armed there is no way to disarm it
            short of an ordinary Start, so the control disables itself rather
            than inviting a second, pointless click, and reads the persisted
            server intent rather than a local guess so a reload shows the
            same armed state the server is actually holding.

            Armed reuses the existing `--rs-glow-success` attention token as
            an exterior halo, not a new one — the same token the success
            flash animations already use, applied here as a steady glow
            instead of a one-shot fade. Two things keep it from silently
            doing nothing, exactly as `PlayScreen`'s `NewsControl` documents
            for its own unread-news halo: `ActionButton` always carries
            `rs-bevel`, whose clip-path would clip a shadow drawn outside the
            element's own box, so the glow goes on this unclipped wrapper
            span instead of the beveled button; and Tailwind's
            `shadow-[var(...)]` arbitrary-value syntax only sets internal
            `--tw-shadow-*` custom properties, not `box-shadow` itself,
            unless a base `shadow` utility is also present — an inline style
            sets `box-shadow` directly instead, avoiding that trap. */}
        {resumable ? (
          <span
            className="inline-flex"
            style={practice.finishCurrentWeld ? { boxShadow: "var(--rs-glow-success)" } : undefined}
          >
            <ActionButton
              aria-pressed={practice.finishCurrentWeld}
              data-practice-finish
              data-practice-finish-armed={String(practice.finishCurrentWeld)}
              disabled={practice.finishCurrentWeld || (foregroundBusy && pending !== "finish")}
              intent={practice.finishCurrentWeld ? "success" : "secondary"}
              loading={pending === "finish"}
              onClick={() => run("finish")}
            >
              {practice.finishCurrentWeld
                ? "Stopping After Current Weld"
                : "Stop After Current Weld"}
            </ActionButton>
          </span>
        ) : null}
      </div>

      {practice.finishCurrentWeld ? (
        <Feedback tone="muted">Practice will stop when this weld finishes.</Feedback>
      ) : null}

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

      <CleanPassControl cleanPass={practice.cleanPass} />

      <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        {`${practice.scrapPerWeld} Scrap Metal, ${practice.sectionsPerWeld} sections, nominal up to ${balance.practiceWelding.slagPerWeld} Slag. Each section is worth ${practiceSectionXp(balance)} Welding XP.`}
      </p>

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
      {practice.lastStopReason === "finished_current_weld" && !active ? (
        <Feedback tone="muted">Weld finished. The Workbench is clear.</Feedback>
      ) : null}
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
      {/* Welding progression belongs with the welding, and the loose Scrap is
          what decides whether there is another weld after this one. */}
      <SkillProgressRow
        level={state.welding.level}
        skill="Welding"
        tone="welding"
        xpIntoLevel={state.welding.xpIntoLevel}
        {...(state.welding.xpToNextLevel === undefined
          ? {}
          : { xpToNextLevel: state.welding.xpToNextLevel })}
      />
      <div data-practice-scrap>
        <ActivityContextRow items={[{ label: "Scrap Metal", quantity: practice.scrapAvailable }]} />
      </div>
      <PracticeRunPanel run={practice.run} />
    </ActivityPanel>
  );
}
