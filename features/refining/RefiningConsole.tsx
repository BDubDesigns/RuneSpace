"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ItemVisual } from "@/components/items/ItemVisual";
import { VisualTile } from "@/components/items/VisualTile";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, GAME_TICK_MS, ITEM_IDS } from "@/game/config/foundations";
import type { RefiningRunAttempt } from "@/server/mining";
import { refreshMiningAction, startRefiningAction, stopRefiningAction } from "@/server/actions";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

const RESULT_FEEDBACK_DURATION_MS = 3_600;

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

function refiningStopMessage(
  reason: Extract<
    import("@/server/mining").ActivityStop,
    { actionId: typeof ACTION_IDS.refining }
  >["reason"],
): string {
  return (
    (
      {
        manually_stopped: "Refining stopped.",
        insufficient_ferrite_shale:
          "Not enough Ferrite Shale \u2014 refining requires 2 per attempt.",
        inventory_slots_full:
          "Processing stopped \u2014 make room for the resulting material before refining more.",
        carried_mass_capacity_reached:
          "Processing stopped \u2014 make room for the resulting material before refining more.",
        action_replaced: "Refining stopped when Travel began.",
      } as Record<string, string>
    )[reason] ?? `Refining stopped: ${reason}.`
  );
}

function refiningCommandErrorMessage(error: string): string {
  return (
    (
      {
        another_action_active: "Another activity is active. Refining cannot change it.",
      } as Record<string, string>
    )[error] ?? error
  );
}

function refiningErrorMessage(error: string): string {
  return (
    (
      {
        refining_unavailable_here:
          "Ferrite refining is only available at the Abandoned Processing Yard.",
      } as Record<string, string>
    )[error] ?? error
  );
}

function latestRefiningAttempt(
  attempts: readonly RefiningRunAttempt[],
): RefiningRunAttempt | undefined {
  return attempts.at(-1);
}

function latestAnnouncement(attempt: RefiningRunAttempt, batch: number): string {
  const catchUp = batch > 1 ? `${batch} attempts resolved while away. ` : "";
  const roll = `Roll ${percentage(attempt.rolledBasisPoints)}. Needed below ${percentage(attempt.thresholdBasisPoints)}.`;
  return attempt.success
    ? `${catchUp}Refined Ferrite produced. ${roll} ${attempt.xpAwarded} Refining XP earned.`
    : `${catchUp}Slag produced. ${roll} ${attempt.xpAwarded} Refining XP earned.`;
}

export function RefiningConsole() {
  const { acquireCommand, busy, releaseCommand, setRefreshCallback, acceptState, state } =
    useMiningPlay();
  const refining = state.refining;
  const refiningRun = state.refiningRun;
  const [message, setMessage] = useState<string | undefined>(
    state.stop?.actionId === ACTION_IDS.refining
      ? refiningStopMessage(state.stop.reason)
      : undefined,
  );
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();
  const [recovery, setRecovery] = useState<(() => void) | undefined>();
  const [pendingCommand, setPendingCommand] = useState<"start" | "stop" | "refresh">();
  const observedAttempts = useRef(refiningRun.attempts);
  const observedSequence = useRef(latestRefiningAttempt(refiningRun.recentAttempts)?.sequence);
  const [feedback, setFeedback] = useState<{ sequence: number; attempts: number }>();
  const balance = getEffectiveGameBalance();
  const active =
    state.activeAction?.actionId === "processing_yard_refining" ? state.activeAction : undefined;
  const durationTicks = active?.nextAttemptDurationTicks ?? balance.refining.attemptDurationTicks;
  const durationMs = durationTicks * GAME_TICK_MS;
  const elapsed = active ? Math.max(0, now - new Date(active.progressStartedAt).getTime()) : 0;
  const progress = active ? Math.min(100, (elapsed / durationMs) * 100) : 0;
  const secondsRemaining = active
    ? Math.max(0, (new Date(active.nextAttemptAt).getTime() - now) / 1_000)
    : 0;

  function apply(result: Awaited<ReturnType<typeof refreshMiningAction>>) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.state) {
      acceptState(result.state);
      const next = result.state;
      if (next.refiningError) setMessage(refiningErrorMessage(next.refiningError));
      else if (next.commandError) setMessage(refiningCommandErrorMessage(next.commandError));
      else if (next.stop?.actionId === ACTION_IDS.refining)
        setMessage(refiningStopMessage(next.stop.reason));
      else setMessage(undefined);
    }
  }

  function command(action: (id: string) => ReturnType<typeof refreshMiningAction>) {
    if (!acquireCommand()) return;
    setRecovery(undefined);
    startTransition(async () => {
      try {
        apply(await action(state.characterId));
      } catch (error) {
        reportClientDiagnostic("mining-command", error, { miningActive: Boolean(active) });
        setMessage("Comms interruption. Refining status could not be confirmed.");
        setRecovery(() => () => command(refreshMiningAction));
      } finally {
        releaseCommand();
        setPendingCommand(undefined);
      }
    });
  }

  useEffect(() => {
    setRefreshCallback(() => command(refreshMiningAction));
  });

  useEffect(() => {
    if (!active) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, [Boolean(active)]);

  const latestAttempt = latestRefiningAttempt(refiningRun.recentAttempts);
  const recentBatchCount =
    state.refiningRecentResult.successes + state.refiningRecentResult.failures;

  useEffect(() => {
    const prevAttempts = observedAttempts.current;
    const prevSeq = observedSequence.current;
    observedAttempts.current = refiningRun.attempts;
    observedSequence.current = latestAttempt?.sequence;
    if (
      !latestAttempt ||
      refiningRun.attempts <= prevAttempts ||
      latestAttempt.sequence === prevSeq
    )
      return;
    const nextFeedback = {
      sequence: latestAttempt.sequence,
      attempts: Math.max(0, refiningRun.attempts - prevAttempts),
    };
    setFeedback(nextFeedback);
    const t = window.setTimeout(() => setFeedback(undefined), RESULT_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [latestAttempt?.sequence, refiningRun.attempts]);

  const isActive = Boolean(active);

  return (
    <>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        Rusted conveyors and a refurbished hopper stand ready. Feed 2 Ferrite Shale to refine it
        into Refined Ferrite or Slag.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {isActive || pendingCommand === "stop" ? (
          <ActionButton
            intent="danger"
            loading={busy}
            onClick={() => {
              setPendingCommand("stop");
              command(stopRefiningAction);
            }}
          >
            Stop Refining
          </ActionButton>
        ) : (
          <ActionButton
            intent="mining"
            loading={busy}
            onClick={() => {
              setPendingCommand("start");
              command(startRefiningAction);
            }}
          >
            Start Refining
          </ActionButton>
        )}
        <ActionButton
          intent="secondary"
          disabled={busy}
          onClick={() => {
            setPendingCommand("refresh");
            command(refreshMiningAction);
          }}
        >
          Refresh status
        </ActionButton>
      </div>
      <p className="mt-3 font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-arcane)]">
        Success chance: {percentage(state.refiningSuccessChanceBps)}%
      </p>
      <p className="mt-2 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {balance.refining.attemptDurationTicks} ticks /{" "}
        {(balance.refining.attemptDurationTicks * GAME_TICK_MS) / 1000}s per attempt &middot; 2
        Ferrite Shale &rarr; 1 output
      </p>
      {isActive ? (
        <div className="mt-5">
          <StatusMeter
            label="Refining attempt"
            value={progress}
            detail={`${secondsRemaining.toFixed(1)}s to next attempt`}
          />
        </div>
      ) : (
        <Feedback>
          Refining is idle. Each attempt takes 7 ticks / 4.2 seconds and resolves on the server.
        </Feedback>
      )}
      {latestAttempt ? (
        <section
          aria-label="Latest refining attempt"
          className={`mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3 ${feedback?.sequence === latestAttempt.sequence ? (latestAttempt.success ? "rs-result-feedback-success" : "rs-result-feedback-danger") : ""}`}
          data-feedback-state={feedback?.sequence === latestAttempt.sequence ? "new" : "calm"}
          data-result-outcome={latestAttempt.success ? "success" : "slag"}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-display text-sm uppercase tracking-wide">
              Latest attempt: {latestAttempt.success ? "Refined Ferrite" : "Slag"}
            </p>
            {feedback?.sequence === latestAttempt.sequence && feedback.attempts > 1 ? (
              <p className="text-xs text-[color:var(--rs-text-secondary)]">
                {feedback.attempts} attempts resolved while away
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            Roll {percentage(latestAttempt.rolledBasisPoints)} | Needed below{" "}
            {percentage(latestAttempt.thresholdBasisPoints)}
          </p>
          <p className="mt-2 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            7 ticks &middot; 2 Ferrite Shale consumed
          </p>
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-2 sm:grid-cols-3">
            <ItemVisual
              accessibleLabel={`${latestAttempt.success ? latestAttempt.ferriteAwarded : latestAttempt.slagAwarded} ${latestAttempt.success ? "Refined Ferrite" : "Slag"} produced`}
              className={feedback?.sequence === latestAttempt.sequence ? "rs-reward-feedback" : ""}
              itemId={latestAttempt.success ? ITEM_IDS.refinedFerrite : ITEM_IDS.slag}
              name={latestAttempt.success ? "Refined Ferrite" : "Slag"}
              quantity={
                latestAttempt.success ? latestAttempt.ferriteAwarded : latestAttempt.slagAwarded
              }
            />
            <VisualTile
              accessibleLabel={`${latestAttempt.xpAwarded} Refining XP earned`}
              badge={`+${latestAttempt.xpAwarded}`}
              className={
                feedback?.sequence === latestAttempt.sequence
                  ? "rs-reward-feedback [animation-delay:90ms]"
                  : ""
              }
              fallbackText="XP"
              name="Refining"
            />
          </div>
        </section>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {feedback && latestAttempt && feedback.sequence === latestAttempt.sequence
          ? latestAnnouncement(latestAttempt, feedback.attempts)
          : ""}
      </p>
      {message ? (
        <Feedback
          tone={state.stop?.actionId === ACTION_IDS.refining && !active ? "danger" : "muted"}
        >
          {message}
        </Feedback>
      ) : null}
      {recovery ? (
        <ActionButton className="mt-3" disabled={busy} intent="secondary" onClick={recovery}>
          Retry status check
        </ActionButton>
      ) : null}
    </>
  );
}
