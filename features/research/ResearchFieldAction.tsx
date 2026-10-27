"use client";

import { useEffect, useRef, useState } from "react";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { usePlay } from "@/features/play/PlayContext";
import { seconds } from "@/features/shared/duration-copy";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { RESEARCH_COPY, getResearchJob } from "@/game/content/research-jobs";
import {
  assignmentFactsOf,
  availableFieldAction,
  researchFieldActionTicks,
  surfaceSampleFeedback,
} from "@/game/domain/research-jobs";
import { startResearchFieldAction } from "@/server/actions";
import { useResearchCommand } from "./use-research-command";

/**
 * The compact contextual Mission action of a Wise Old Enby research job, shown
 * above a site's ordinary activity (#406): COLLECT SURFACE SAMPLE at each Survey
 * site and RECORD RESONANCE SIGNATURE at The Low Hum.
 *
 * It is a short Mission-styled row, never a permanent activity panel, and it
 * exists only while the server's projection says the action is available: the
 * run is held, its original item is still carried and this site's work is not
 * done. It does not depend on the Mission being pinned. The action is one
 * stationary, whole-tick timed action; the seconds shown are derived from the
 * tick count, and what was collected is the server's to say when it resolves.
 *
 * The component stays mounted for the held run so it can say what just happened
 * after the control has gone, then it returns the site to its ordinary look.
 */
export function ResearchFieldAction() {
  const { foregroundBusy, state } = usePlay();
  const command = useResearchCommand();
  const assignment = state.research.assignment;
  const locationId = state.location.currentLocationId;
  const facts = assignmentFactsOf(assignment);
  const field = availableFieldAction(facts, locationId);

  // What the last resolution recorded here, said once the control has gone.
  const [done, setDone] = useState<{ locationId: string; text: string }>();
  const lastProgress = useRef<{ assignmentId: string; current: number } | undefined>(undefined);
  const progress = assignment?.progress.current;
  useEffect(() => {
    if (!assignment || progress === undefined) {
      lastProgress.current = undefined;
      return;
    }
    const previous = lastProgress.current;
    lastProgress.current = { assignmentId: assignment.assignmentId, current: progress };
    if (!previous || previous.assignmentId !== assignment.assignmentId) return;
    if (progress <= previous.current) return;
    setDone({
      locationId,
      text:
        getResearchJob(assignment.jobId)?.kind === "survey"
          ? surfaceSampleFeedback(locationId, progress, assignment.progress.target)
          : `${RESEARCH_COPY.recordingDone} ${RESEARCH_COPY.recordingNext}`,
    });
  }, [assignment, progress, locationId]);

  if (!assignment) return null;
  const balance = getEffectiveGameBalance().researchJobs;
  const running =
    state.activeAction?.actionId === balance.surfaceSampleActionId ||
    state.activeAction?.actionId === balance.resonanceRecordingActionId
      ? state.activeAction
      : undefined;
  const feedback = done?.locationId === locationId ? done.text : undefined;
  if (!field && !running && !feedback) return null;

  const label =
    field?.kind === "resonance_recording"
      ? RESEARCH_COPY.recordingAction
      : RESEARCH_COPY.surveyAction;
  const ticks = field ? researchFieldActionTicks(field.kind) : undefined;
  const otherActivity = state.activeAction !== undefined && !running;

  return (
    <section
      aria-label="Research field action"
      className="rs-mission-guidance space-y-2 border bg-[color:var(--rs-surface-panel)] px-3 py-2"
      data-research-field-action={field?.kind ?? (running ? "running" : "done")}
    >
      {running ? (
        <ActionProgress endsAt={running.nextAttemptAt} startsAt={running.progressStartedAt} />
      ) : field && ticks !== undefined ? (
        <div className="space-y-1">
          <MissionActionButton
            data-research-start={field.kind}
            disabled={foregroundBusy || otherActivity}
            guidance="active"
            haloClassName="w-full"
            loading={command.pending === "start"}
            onClick={() =>
              command.run("start", () =>
                startResearchFieldAction({
                  characterId: state.characterId,
                  assignmentId: assignment.assignmentId,
                }),
              )
            }
          >
            {label} — {ticks} ticks
          </MissionActionButton>
          <p className="text-xs text-[color:var(--rs-text-secondary)]">
            {seconds(ticks, GAME_TICK_MS)}
            {field.kind === "surface_sample"
              ? ` · ${assignment.progress.current} / ${assignment.progress.target} collected · no Mining, ore or XP`
              : " · no Mining, Runeworking or XP"}
          </p>
        </div>
      ) : null}
      {otherActivity && field ? (
        <p className="text-xs text-[color:var(--rs-text-secondary)]" data-research-busy>
          Stop your current activity before starting this.
        </p>
      ) : null}
      {feedback && !running ? (
        <p
          className="text-sm text-[color:var(--rs-accent-success)]"
          data-research-done
          role="status"
        >
          {feedback}
        </p>
      ) : null}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
    </section>
  );
}

function ActionProgress({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, []);
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const remainingMs = Math.max(0, end - now);
  return (
    <div data-research-progress>
      <StatusMeter
        detail={remainingMs === 0 ? "Resolving" : `${(remainingMs / 1000).toFixed(1)}s`}
        label="Working"
        value={end === start ? 100 : Math.min(100, ((now - start) / (end - start)) * 100)}
      />
    </div>
  );
}
