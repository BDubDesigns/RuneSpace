"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ItemVisual } from "@/components/items/ItemVisual";
import { VisualTile } from "@/components/items/VisualTile";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { SkillProgressCard } from "@/features/shared/run-presentation";
import { CargoReadout } from "@/features/shared/CargoReadout";
import { RefiningRunPanel } from "@/features/refining/RefiningRunPanel";
import { MiningRunPanel } from "@/features/mining/MiningRunPanel";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, GAME_TICK_MS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { boostedMiningAttemptDurationTicks, miningNearMissBasisPoints } from "@/game/domain/mining";
import type { MiningGameplayState, MiningRunAttempt } from "@/server/mining";
import { refreshMiningAction, startMiningAction, stopMiningAction } from "@/server/actions";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { latestMiningAttempt, resolvedAttemptCount } from "./latest-result";
import { useMiningPlay } from "./MiningPlayContext";
import { EquipmentPanel } from "./EquipmentPanel";
import { InventoryPanel } from "./InventoryPanel";
import { LocalMapPanel } from "@/features/travel/LocalMapPanel";
import { RefiningConsole } from "@/features/refining/RefiningConsole";
import { PowerAnnexClaimPanel } from "@/features/power-annex/PowerAnnexClaimPanel";
import { LocationSceneHeader } from "@/features/location-scene/LocationSceneHeader";

const RESULT_FEEDBACK_DURATION_MS = 3_600;

function kilograms(grams: number) {
  return `${(grams / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function secondsForTicks(ticks: number) {
  return (ticks * GAME_TICK_MS) / 1_000;
}

function miningStopMessage(reason: import("@/game/domain/mining").MiningStopReason) {
  return {
    manually_stopped: "Mining stopped.",
    inventory_slots_full: "Mining stopped: inventory slots are full.",
    carried_mass_capacity_reached: "Mining stopped: carried-mass capacity reached.",
    compatible_mining_tool_missing: "Mining stopped: equip a Salvage Cutter.",
    mining_tool_replaced: "Mining stopped: the mining tool was replaced.",
    action_replaced: "Mining stopped when Travel began.",
  }[reason];
}

function commandErrorMessage(error: NonNullable<MiningGameplayState["commandError"]>) {
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
    ? `${catchUp}Success. ${roll} ${attempt.shaleAwarded} Ferrite Shale earned. ${attempt.xpAwarded} Mining XP earned. ${charge}${depleted}`
    : `${catchUp}No yield. ${roll} Missed by ${percentage(miningNearMissBasisPoints(attempt.rolledBasisPoints, attempt.thresholdBasisPoints))}. ${charge}${depleted}`;
}

function LatestAttemptResult({
  attempt,
  attemptsResolved,
  feedback,
  maximumCharge,
}: {
  attempt: MiningRunAttempt;
  attemptsResolved: number;
  feedback: boolean;
  maximumCharge: number;
}) {
  const feedbackTone = feedback ? (attempt.success ? "success" : "danger") : "calm";
  return (
    <section
      aria-label="Latest mining attempt"
      className={`mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3 ${feedback ? `rs-result-feedback-${feedbackTone}` : ""}`}
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
              accessibleLabel={`${attempt.shaleAwarded} Ferrite Shale earned`}
              className={feedback ? "rs-reward-feedback" : ""}
              itemId={ITEM_IDS.ferriteShale}
              name="Ferrite Shale"
              quantity={attempt.shaleAwarded}
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

export function MiningConsole({ characterName }: { characterName: string }) {
  const {
    acquireCommand,
    enqueueForeground,
    foregroundBusy,
    equipmentOpen,
    equipmentTrigger,
    inventoryOpen,
    inventoryTrigger,
    releaseCommand,
    setEquipmentOpen,
    setInventoryOpen,
    setRefreshCallback,
    acceptState,
    state,
  } = useMiningPlay();
  const [message, setMessage] = useState<string | undefined>(
    state.stop?.actionId === ACTION_IDS.ferriteShaleMining
      ? miningStopMessage(state.stop.reason as import("@/game/domain/mining").MiningStopReason)
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
  const inTransit = Boolean(state.travelState);
  const currentLocationId = state.location.currentLocationId;
  const atProcessingYard = currentLocationId === LOCATION_IDS.abandonedProcessingYard;
  const atTheJag = currentLocationId === LOCATION_IDS.theJag;
  const atTheLongScramble = currentLocationId === LOCATION_IDS.theLongScramble;
  const showMiningActivity = atTheJag && !inTransit;
  const showRefiningActivity = atProcessingYard && !inTransit;
  const durationTicks = active?.nextAttemptDurationTicks ?? balance.mining.attemptDurationTicks;
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
      ? boostedMiningAttemptDurationTicks(balance)
      : balance.mining.attemptDurationTicks);

  function apply(result: Awaited<ReturnType<typeof refreshMiningAction>>) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.state) {
      acceptState(result.state);
      if (result.state.commandError) setMessage(commandErrorMessage(result.state.commandError));
      else if (result.state.stop?.actionId === ACTION_IDS.ferriteShaleMining)
        setMessage(
          miningStopMessage(
            result.state.stop.reason as import("@/game/domain/mining").MiningStopReason,
          ),
        );
      else setMessage(undefined);
    }
  }
  function executeCommand(action: (id: string) => ReturnType<typeof refreshMiningAction>) {
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
        setRecovery(() => () => command(refreshMiningAction));
      } finally {
        releaseCommand();
        setPendingCommand(undefined);
      }
    });
  }
  function runForeground(
    intent: "start" | "stop" | "refresh",
    action: (id: string) => ReturnType<typeof refreshMiningAction>,
  ) {
    enqueueForeground(() => {
      setPendingCommand(intent);
      executeCommand(action);
    });
  }

  function command(
    action: (id: string) => ReturnType<typeof refreshMiningAction>,
    opts?: { background?: boolean },
  ) {
    if (!acquireCommand(opts)) return;
    executeCommand(action);
  }

  useEffect(() => {
    setRefreshCallback((opts?: { background?: boolean }) => command(refreshMiningAction, opts));
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

  return (
    <div className="space-y-4">
      <Panel tone="raised" className="overflow-hidden !p-0">
        {/* Responsive industrial scene header integrated into the top of the existing
            location/activity panel. Same asset on mobile + desktop; frame height
            is responsive (shallow cinematic strip on mobile, taller on desktop).
            Transit never shows the destination — location stays authoritative origin
            until arrival commits. */}
        {!inTransit
          ? (() => {
              const currentLocation = getLocation(currentLocationId);
              if (!currentLocation) return null;
              const atPowerAnnex = currentLocationId === LOCATION_IDS.emergencyPowerAnnex;
              return (
                <LocationSceneHeader
                  location={currentLocation}
                  characterName={characterName}
                  resourceLabels={
                    atTheJag
                      ? ["Ferrite Shale"]
                      : atProcessingYard
                        ? ["Refined Ferrite", "Slag"]
                        : atPowerAnnex
                          ? ["Power Cell"]
                          : undefined
                  }
                />
              );
            })()
          : null}
        <div className="p-5">
          {/* Eyebrow + resource plate now live inside the scene header; keep only
              a compact heading row here so the panel doesn't repeat the eyebrow.
              During transit the location truth is the walk description below. */}
          {!inTransit ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <SectionHeader eyebrow={getLocation(currentLocationId)?.displayName ?? "Location"}>
                Activity
              </SectionHeader>
            </div>
          ) : (
            <SectionHeader eyebrow="In transit">Journey</SectionHeader>
          )}

          {inTransit ? (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
              You are walking between locations. The active work stopped before departure, and no
              new activity can begin until you arrive. Use the world map below to follow your
              journey.
            </p>
          ) : atProcessingYard ? (
            <RefiningConsole />
          ) : atTheJag ? (
            <>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                {getLocation(currentLocationId)?.description}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {active || pendingCommand === "stop" ? (
                  <ActionButton
                    intent="danger"
                    loading={foregroundBusy && pendingCommand === "stop"}
                    onClick={() => runForeground("stop", stopMiningAction)}
                  >
                    Stop Mining
                  </ActionButton>
                ) : (
                  <ActionButton
                    intent="mining"
                    loading={foregroundBusy && pendingCommand === "start"}
                    onClick={() => runForeground("start", startMiningAction)}
                  >
                    Start Mining
                  </ActionButton>
                )}
                <ActionButton
                  intent="secondary"
                  disabled={foregroundBusy}
                  loading={foregroundBusy && pendingCommand === "refresh"}
                  onClick={() => runForeground("refresh", refreshMiningAction)}
                >
                  Refresh status
                </ActionButton>
              </div>
              <p className="mt-3 font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-mining)]">
                Success chance: {percentage(state.successChanceBps)}%
              </p>
              {active && !active.nextAttemptBoosted ? (
                <p className="mt-3 font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
                  NORMAL TIMING · Next attempt: {active.nextAttemptDurationTicks} ticks
                </p>
              ) : cutter && cutter.currentCharge > 0 ? (
                <p className="mt-3 font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-mining)]">
                  POWER CELL BOOST · {cutter.currentCharge} / {cutter.maximumCharge}
                  <span className="ml-2 text-[color:var(--rs-text-secondary)]">
                    Next attempt: {nextMiningDurationTicks} ticks
                  </span>
                </p>
              ) : null}
              {active ? (
                <div className="mt-5">
                  <StatusMeter
                    label="Mining attempt"
                    value={progress}
                    detail={`${secondsRemaining.toFixed(1)}s to next attempt`}
                  />
                </div>
              ) : (
                <Feedback>
                  Mining is idle. Normal attempts take {balance.mining.attemptDurationTicks} ticks /{" "}
                  {secondsForTicks(balance.mining.attemptDurationTicks)} seconds and resolve on the
                  server.
                </Feedback>
              )}
            </>
          ) : atTheLongScramble ? (
            <div className="mt-4">
              <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                {getLocation(currentLocationId)?.description}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                {getLocation(currentLocationId)?.description}
              </p>
              <Feedback tone="muted">No production activity is available here.</Feedback>
            </div>
          )}
          {showMiningActivity && latestAttempt ? (
            <LatestAttemptResult
              attempt={latestAttempt}
              attemptsResolved={
                feedback?.sequence === latestAttempt.sequence ? feedback.attempts : recentBatchCount
              }
              feedback={feedback?.sequence === latestAttempt.sequence}
              maximumCharge={balance.items.salvageCutter.maximumCharge}
            />
          ) : null}
          <p aria-live="polite" className="sr-only">
            {feedback && latestAttempt && feedback.sequence === latestAttempt.sequence
              ? latestAttemptAnnouncement(
                  latestAttempt,
                  feedback.attempts,
                  balance.items.salvageCutter.maximumCharge,
                )
              : ""}
          </p>
          {showMiningActivity && message ? (
            <Feedback
              tone={
                state.stop?.actionId === ACTION_IDS.ferriteShaleMining && !active ? "danger" : "muted"
              }
            >
              {message}
            </Feedback>
          ) : null}
          {showMiningActivity && recovery ? (
            <ActionButton
              className="mt-3"
              disabled={foregroundBusy}
              intent="secondary"
              onClick={recovery}
            >
              Retry status check
            </ActionButton>
          ) : null}
        </div>
      </Panel>
      <LocalMapPanel />
      <PowerAnnexClaimPanel />
      {showMiningActivity || showRefiningActivity ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {showMiningActivity ? (
              <SkillProgressCard
                level={state.mining.level}
                title="Mining progression"
                tone="mining"
                totalXp={state.mining.totalXp}
                xpIntoLevel={state.mining.xpIntoLevel}
                xpToNextLevel={state.mining.xpToNextLevel}
              />
            ) : (
              <SkillProgressCard
                level={state.refining.level}
                title="Refining progression"
                tone="refining"
                totalXp={state.refining.totalXp}
                xpIntoLevel={state.refining.xpIntoLevel}
                xpToNextLevel={state.refining.xpToNextLevel}
              />
            )}
            {showMiningActivity ? (
              <CargoReadout
                state={state}
                items={[{ label: "Ferrite Shale", quantity: state.ferriteShaleQuantity }]}
              />
            ) : (
              <CargoReadout
                state={state}
                items={[
                  { label: "Refined Ferrite", quantity: state.refinedFerriteQuantity },
                  { label: "Slag", quantity: state.slagQuantity },
                ]}
              />
            )}
          </div>
          {showMiningActivity ? (
            <MiningRunPanel run={state.run} balance={balance} />
          ) : (
            <RefiningRunPanel
              ferriteQuantity={state.refinedFerriteQuantity}
              run={state.refiningRun}
              slagQuantity={state.slagQuantity}
            />
          )}
        </>
      ) : null}
      {inventoryOpen ? (
        <InventoryPanel
          state={state}
          onClose={() => setInventoryOpen(false)}
          triggerRef={inventoryTrigger}
        />
      ) : equipmentOpen ? (
        <EquipmentPanel
          onClose={() => setEquipmentOpen(false)}
          state={state}
          triggerRef={equipmentTrigger}
        />
      ) : null}
    </div>
  );
}
