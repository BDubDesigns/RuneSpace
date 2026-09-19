"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { MiningRunPanel } from "@/features/mining/MiningRunPanel";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ItemVisual } from "@/components/items/ItemVisual";
import { VisualTile } from "@/components/items/VisualTile";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { miningNearMissBasisPoints, type MiningStopReason } from "@/game/domain/mining";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import type { MiningRunAttempt } from "@/server/mining";
import type { MiningSourceProjection, PlayGameplayState } from "@/server/play";
import { refreshPlayAction, startMiningAction, stopMiningAction } from "@/server/actions";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { latestMiningAttempt, resolvedAttemptCount } from "./latest-result";
import { usePlay } from "@/features/play/PlayContext";

const RESULT_FEEDBACK_DURATION_MS = 3_600;

/**
 * Whether an authoritative stop belongs to Mining at all (#209).
 *
 * The stop names the activity rather than one source's action, because the
 * durable stop reason is stored per activity: a Galvanite run and a Ferrite
 * Shale run stop the same way and this panel owns both.
 */
function isMiningStop(stop: NonNullable<PlayGameplayState["stop"]>): boolean {
  return stop.activity === "mining";
}

/** The awarded item's authoritative display name, by its stable ID. */
function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

function secondsForTicks(ticks: number) {
  return (ticks * GAME_TICK_MS) / 1_000;
}

function miningStopMessage(reason: MiningStopReason) {
  return {
    manually_stopped: "Mining stopped.",
    inventory_slots_full: "Mining stopped: inventory slots are full.",
    carried_mass_capacity_reached: "Mining stopped: carried-mass capacity reached.",
    compatible_mining_tool_missing: "Mining stopped: equip a Salvage Cutter.",
    mining_tool_replaced: "Mining stopped: the mining tool was replaced.",
    action_replaced: "Mining stopped when Travel began.",
  }[reason];
}

function commandErrorMessage(error: NonNullable<PlayGameplayState["commandError"]>) {
  return {
    another_action_active: "Another activity is active. Mining cannot change it.",
  }[error];
}

function percentage(basisPoints: number) {
  return (basisPoints / 100).toFixed(2);
}

function latestAttemptAnnouncement(
  attempt: MiningRunAttempt,
  attemptsResolved: number,
  maximumCharge: number,
  itemName: string,
) {
  const catchUp = attemptsResolved > 1 ? `${attemptsResolved} attempts resolved while away. ` : "";
  const roll = `Roll ${percentage(attempt.rolledBasisPoints)}. Needed below ${percentage(attempt.thresholdBasisPoints)}.`;
  const charge = attempt.chargeConsumed
    ? `Power Cell charge consumed · ${attempt.remainingCharge} / ${maximumCharge} remaining.`
    : "";
  const depleted =
    attempt.boosted && attempt.remainingCharge === 0
      ? " Power Cell depleted · Mining continues at normal speed."
      : "";
  return attempt.success
    ? `${catchUp}Success. ${roll} ${attempt.quantityAwarded} ${itemName} earned. ${attempt.xpAwarded} Mining XP earned. ${charge}${depleted}`
    : `${catchUp}No yield. ${roll} Missed by ${percentage(miningNearMissBasisPoints(attempt.rolledBasisPoints, attempt.thresholdBasisPoints))}. ${charge}${depleted}`;
}

function LatestAttemptResult({
  attempt,
  attemptsResolved,
  feedback,
  itemName,
  maximumCharge,
}: {
  attempt: MiningRunAttempt;
  attemptsResolved: number;
  feedback: boolean;
  /** The awarded item's authoritative display name — never assumed to be Shale. */
  itemName: string;
  maximumCharge: number;
}) {
  const feedbackTone = feedback ? (attempt.success ? "success" : "danger") : "calm";
  return (
    <section
      aria-label="Latest mining attempt"
      className={`border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3 ${feedback ? `rs-result-feedback-${feedbackTone}` : ""}`}
      data-feedback-state={feedback ? "new" : "calm"}
      data-result-outcome={attempt.success ? "success" : "no-yield"}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-sm uppercase tracking-wide">
          Latest attempt: {attempt.success ? "Success" : "No yield"}
        </p>
        {attemptsResolved > 1 ? (
          <p className="text-xs text-[color:var(--rs-text-secondary)]">
            {attemptsResolved} attempts resolved while away
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Roll {percentage(attempt.rolledBasisPoints)} | Needed below{" "}
        {percentage(attempt.thresholdBasisPoints)}
      </p>
      <p className="mt-2 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {attempt.boosted
          ? `Power Cell boosted · ${attempt.durationTicks} ticks · ${attempt.chargeConsumed ? `Power Cell charge consumed · ${attempt.remainingCharge} / ${maximumCharge} remaining` : "charge not consumed"}`
          : `Normal attempt · ${attempt.durationTicks} ticks`}
      </p>
      {attempt.boosted && attempt.remainingCharge === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--rs-accent-mining)]">
          Power Cell depleted · Mining continues at normal speed
        </p>
      ) : null}
      {attempt.success ? (
        <>
          <p className="mt-3 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
            Rewards
          </p>
          <div className="mt-2 grid max-w-sm grid-cols-2 gap-2 sm:grid-cols-3">
            <ItemVisual
              accessibleLabel={`${attempt.quantityAwarded} ${itemName} earned`}
              className={feedback ? "rs-reward-feedback" : ""}
              itemId={attempt.itemId}
              name={itemName}
              quantity={attempt.quantityAwarded}
            />
            <VisualTile
              accessibleLabel={`${attempt.xpAwarded} Mining XP earned`}
              badge={`+${attempt.xpAwarded}`}
              className={feedback ? "rs-reward-feedback [animation-delay:90ms]" : ""}
              fallbackText="XP"
              name="Mining"
            />
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          Missed by{" "}
          {percentage(
            miningNearMissBasisPoints(attempt.rolledBasisPoints, attempt.thresholdBasisPoints),
          )}
        </p>
      )}
    </section>
  );
}

/**
 * The Mining-specific activity surface: Start/Stop/Refresh Mining, success
 * chance, power-cell boost, progress meter, and latest-attempt result
 * presentation. This is genuinely Mining-owned; the generic play shell
 * (PlayConsole) composes it alongside Refining, Travel, Cargo, missions, and
 * the other shared panels.
 *
 * It sits in the shared activity frame (#193) rather than appearing as bare
 * controls in the middle of the location panel, which is also how it finally
 * says what it is: before this, the player arrived at The Jag and found two
 * buttons under the population line with nothing naming them Mining.
 */
export function MiningActivity({ characterName }: { characterName: string }) {
  const {
    acceptState,
    acquireCommand,
    enqueueForeground,
    foregroundBusy,
    releaseCommand,
    setRefreshCallback,
    state,
  } = usePlay();
  const [message, setMessage] = useState<string | undefined>(
    state.stop && isMiningStop(state.stop)
      ? miningStopMessage(state.stop.reason as MiningStopReason)
      : undefined,
  );
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();
  const [recovery, setRecovery] = useState<(() => void) | undefined>();
  const [pendingCommand, setPendingCommand] = useState<"start" | "stop" | "refresh">();
  const observedAttempts = useRef(state.run.attempts);
  const observedSequence = useRef(latestMiningAttempt(state.run.recentAttempts)?.sequence);
  const [feedback, setFeedback] = useState<{ sequence: number; attempts: number }>();
  const balance = getEffectiveGameBalance();
  const active = state.activeAction;
  // Where Mining happens is the location state's answer, not this surface's
  // (#209): The Jag offers Ferrite Shale, an opened Deep Jag offers Galvanite,
  // and a collapsed one offers neither. The projection resolves which source is
  // reachable, so this panel never names a location.
  const source = state.miningSource;
  const showMiningActivity = source !== undefined && !state.travelState;
  // Mission guidance is consumed from the ONE derived target set — this activity
  // never inspects mission IDs, objective prose, or drop tables to decide
  // whether Start Mining advances the active mission.
  const missionGuidanceTargets = deriveMissionGuidanceTargets(state.missions);
  const startMiningGuided =
    showMiningActivity && !active && missionGuidanceTargets.actionIds.has(source.actionId);
  const durationTicks = active?.nextAttemptDurationTicks ?? source?.attemptDurationTicks ?? 0;
  const durationMs = durationTicks * GAME_TICK_MS;
  const elapsed = active ? Math.max(0, now - new Date(active.progressStartedAt).getTime()) : 0;
  const progress = active ? Math.min(100, (elapsed / durationMs) * 100) : 0;
  const secondsRemaining = active
    ? Math.max(0, (new Date(active.nextAttemptAt).getTime() - now) / 1_000)
    : 0;
  const cutter = state.equipment.salvageCutter;
  const nextMiningDurationTicks =
    active?.nextAttemptDurationTicks ??
    (cutter && cutter.currentCharge > 0
      ? (source?.boostedAttemptDurationTicks ?? 0)
      : (source?.attemptDurationTicks ?? 0));

  function apply(result: Awaited<ReturnType<typeof refreshPlayAction>>) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.state) {
      acceptState(result.state);
      if (result.state.commandError) setMessage(commandErrorMessage(result.state.commandError));
      else if (result.state.stop && isMiningStop(result.state.stop))
        setMessage(miningStopMessage(result.state.stop.reason as MiningStopReason));
      else setMessage(undefined);
    }
  }
  function executeCommand(action: (id: string) => ReturnType<typeof refreshPlayAction>) {
    setRecovery(undefined);
    startTransition(async () => {
      try {
        // Expected domain/ownership errors are returned by the action and retain
        // their existing player-facing behavior. Transport/runtime failures are
        // separately recoverable and never replace the last confirmed state.
        apply(await action(state.characterId));
      } catch (error) {
        reportClientDiagnostic("mining-command", error, { miningActive: Boolean(active) });
        setMessage("Comms interruption. Mining status could not be confirmed.");
        // A mutation might have reached the server despite its rejected response.
        // Reconcile only; never replay Start/Stop from uncertain client state.
        setRecovery(() => () => command(refreshPlayAction));
      } finally {
        releaseCommand();
        setPendingCommand(undefined);
      }
    });
  }
  function runForeground(
    intent: "start" | "stop" | "refresh",
    action: (id: string) => ReturnType<typeof refreshPlayAction>,
  ) {
    enqueueForeground(() => {
      setPendingCommand(intent);
      executeCommand(action);
    });
  }

  function command(
    action: (id: string) => ReturnType<typeof refreshPlayAction>,
    opts?: { background?: boolean },
  ) {
    if (!acquireCommand(opts)) return;
    executeCommand(action);
  }

  useEffect(() => {
    setRefreshCallback((opts?: { background?: boolean }) => command(refreshPlayAction, opts));
  });

  useEffect(() => {
    if (!active && !state.travelState) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(clock);
    };
  }, [Boolean(active), Boolean(state.travelState)]);

  const latestAttempt = latestMiningAttempt(state.run.recentAttempts);
  const recentBatchCount = state.recentResult.successes + state.recentResult.failures;
  useEffect(() => {
    const previousAttempts = observedAttempts.current;
    const previousSequence = observedSequence.current;
    observedAttempts.current = state.run.attempts;
    observedSequence.current = latestAttempt?.sequence;
    if (
      !latestAttempt ||
      state.run.attempts <= previousAttempts ||
      latestAttempt.sequence === previousSequence
    )
      return;
    const nextFeedback = {
      sequence: latestAttempt.sequence,
      attempts: resolvedAttemptCount(previousAttempts, state.run.attempts),
    };
    setFeedback(nextFeedback);
    const timeout = window.setTimeout(() => setFeedback(undefined), RESULT_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [latestAttempt?.sequence, state.run.attempts]);

  if (!showMiningActivity) return null;

  return (
    <ActivityPanel title="Mining" data-mining-activity>
      <div className="flex flex-wrap gap-3">
        {active || pendingCommand === "stop" ? (
          <ActionButton
            intent="danger"
            loading={foregroundBusy && pendingCommand === "stop"}
            onClick={() => runForeground("stop", stopMiningAction)}
          >
            Stop Mining
          </ActionButton>
        ) : (
          <MissionActionButton
            guidance={startMiningGuided ? "active" : undefined}
            intent="mining"
            loading={foregroundBusy && pendingCommand === "start"}
            onClick={() => runForeground("start", startMiningAction)}
          >
            Start Mining
          </MissionActionButton>
        )}
        <ActionButton
          intent="secondary"
          disabled={foregroundBusy}
          loading={foregroundBusy && pendingCommand === "refresh"}
          onClick={() => runForeground("refresh", refreshPlayAction)}
        >
          Refresh status
        </ActionButton>
      </div>
      <p className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-mining)]">
        Success chance: {percentage(source.successChanceBps)}%
      </p>
      {active && !active.nextAttemptBoosted ? (
        <p className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
          NORMAL TIMING · Next attempt: {active.nextAttemptDurationTicks} ticks
        </p>
      ) : cutter && cutter.currentCharge > 0 ? (
        <p className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-mining)]">
          POWER CELL BOOST · {cutter.currentCharge} / {cutter.maximumCharge}
          <span className="ml-2 text-[color:var(--rs-text-secondary)]">
            Next attempt: {nextMiningDurationTicks} ticks
          </span>
        </p>
      ) : null}
      {active ? (
        <div>
          <StatusMeter
            label="Mining attempt"
            value={progress}
            detail={`${secondsRemaining.toFixed(1)}s to next attempt`}
          />
        </div>
      ) : (
        <Feedback>
          Mining is idle. Normal {source.itemName} attempts take {source.attemptDurationTicks} ticks
          / {secondsForTicks(source.attemptDurationTicks)} seconds and resolve on the server.
        </Feedback>
      )}
      {latestAttempt ? (
        <LatestAttemptResult
          attempt={latestAttempt}
          attemptsResolved={
            feedback?.sequence === latestAttempt.sequence ? feedback.attempts : recentBatchCount
          }
          feedback={feedback?.sequence === latestAttempt.sequence}
          itemName={itemName(latestAttempt.itemId)}
          maximumCharge={balance.items.salvageCutter.maximumCharge}
        />
      ) : null}
      <p aria-live="polite" className="sr-only">
        {feedback && latestAttempt && feedback.sequence === latestAttempt.sequence
          ? latestAttemptAnnouncement(
              latestAttempt,
              feedback.attempts,
              balance.items.salvageCutter.maximumCharge,
              itemName(latestAttempt.itemId),
            )
          : ""}
      </p>
      {message ? (
        <Feedback tone={state.stop && isMiningStop(state.stop) && !active ? "danger" : "muted"}>
          {message}
        </Feedback>
      ) : null}
      {recovery ? (
        <ActionButton disabled={foregroundBusy} intent="secondary" onClick={recovery}>
          Retry status check
        </ActionButton>
      ) : null}
      {/* The context Mining is actually working against: the skill the attempts
          raise, whatever ore this source produces, and the two limits that stop
          a run. */}
      <SkillProgressRow
        level={state.mining.level}
        skill="Mining"
        tone="mining"
        xpIntoLevel={state.mining.xpIntoLevel}
        {...(state.mining.xpToNextLevel === undefined
          ? {}
          : { xpToNextLevel: state.mining.xpToNextLevel })}
      />
      <ActivityContextRow
        carry={{
          slotsUsed: state.inventory.slotsUsed,
          slotsAvailable: state.inventory.slotsAvailable,
          massGrams: state.inventory.massGrams,
          capacityGrams: state.inventory.capacityGrams,
        }}
        items={[{ label: source.itemName, quantity: state.carriedByItemId[source.itemId] ?? 0 }]}
      />
      <MiningRunPanel balance={balance} run={state.run} source={source} />
    </ActivityPanel>
  );
}
