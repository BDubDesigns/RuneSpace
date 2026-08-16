"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ItemVisual } from "@/components/items/ItemVisual";
import { VisualTile } from "@/components/items/VisualTile";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
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
import { PowerAnnexClaimPanel } from "@/features/power-annex/PowerAnnexClaimPanel";
import { LocationSceneHeader } from "@/features/location-scene/LocationSceneHeader";

const RESULT_FEEDBACK_DURATION_MS = 3_600;

function kilograms(grams: number) {
  return `${(grams / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function secondsForTicks(ticks: number) {
  return (ticks * GAME_TICK_MS) / 1_000;
}

function stopMessage(reason: NonNullable<MiningGameplayState["stoppingReason"]>) {
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
    busy,
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
    state.stoppingReason ? stopMessage(state.stoppingReason) : undefined,
  );
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();
  const [recovery, setRecovery] = useState<(() => void) | undefined>();
  const observedAttempts = useRef(state.run.attempts);
  const observedSequence = useRef(latestMiningAttempt(state.run.recentAttempts)?.sequence);
  const [feedback, setFeedback] = useState<{ sequence: number; attempts: number }>();
  const balance = getEffectiveGameBalance();
  const active = state.activeAction;
  const inTransit = Boolean(state.travelState);
  const currentLocationId = state.location.currentLocationId;
  const atCrashSite = currentLocationId === LOCATION_IDS.crashSite;
  const showMiningActivity = atCrashSite && !inTransit;
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
      else if (result.state.stoppingReason) setMessage(stopMessage(result.state.stoppingReason));
      else setMessage(undefined);
    }
  }
  function command(action: (id: string) => ReturnType<typeof refreshMiningAction>) {
    if (!acquireCommand()) return;
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
      }
    });
  }
  useEffect(() => {
    setRefreshCallback(() => command(refreshMiningAction));
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
                  resourceLabel={
                    atCrashSite ? "Ferrite Shale" : atPowerAnnex ? "Power Cell" : undefined
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
              You are walking between locations. Mining stopped before departure, and no new
              activity can begin until you arrive. Use the world map below to follow your journey.
            </p>
          ) : atCrashSite ? (
            <>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                The damaged ship needs raw material. Cut Ferrite Shale from the infinite crash-site
                deposit to prepare for repairs.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {active ? (
                  <ActionButton
                    intent="danger"
                    loading={busy}
                    onClick={() => command(stopMiningAction)}
                  >
                    Stop Mining
                  </ActionButton>
                ) : (
                  <ActionButton
                    intent="mining"
                    loading={busy}
                    onClick={() => command(startMiningAction)}
                  >
                    Start Mining
                  </ActionButton>
                )}
                <ActionButton
                  intent="secondary"
                  disabled={busy}
                  onClick={() => command(refreshMiningAction)}
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
          ) : (
            <div className="mt-4">
              <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                {getLocation(currentLocationId)?.description}
              </p>
              <Feedback tone="muted">
                Mining is only available at the Crash Site. The processing equipment is offline and
                refining is not available yet.
              </Feedback>
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
            <Feedback tone={state.stoppingReason && !active ? "danger" : "muted"}>
              {message}
            </Feedback>
          ) : null}
          {showMiningActivity && recovery ? (
            <ActionButton className="mt-3" disabled={busy} intent="secondary" onClick={recovery}>
              Retry status check
            </ActionButton>
          ) : null}
        </div>
      </Panel>
      <LocalMapPanel />
      <PowerAnnexClaimPanel />
      {showMiningActivity ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel>
              <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
                Mining progression
              </p>
              <p className="mt-3 font-display text-3xl font-bold">Level {state.mining.level}</p>
              <StatusMeter
                label="Mining XP"
                value={
                  state.mining.xpToNextLevel
                    ? Math.min(
                        100,
                        (state.mining.xpIntoLevel /
                          (state.mining.xpIntoLevel + state.mining.xpToNextLevel)) *
                          100,
                      )
                    : 100
                }
                detail={
                  state.mining.xpToNextLevel
                    ? `${state.mining.xpToNextLevel} XP to next level`
                    : "Maximum level"
                }
              />
              <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
                {state.mining.totalXp.toLocaleString()} total XP
              </p>
            </Panel>
            <Panel>
              <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
                Cargo readout
              </p>
              <p className="mt-3 font-display text-3xl font-bold">{state.ferriteShaleQuantity}</p>
              <p className="text-sm text-[color:var(--rs-text-secondary)]">Ferrite Shale</p>
              <div className="mt-4 space-y-3">
                <StatusMeter
                  label="Inventory slots"
                  value={
                    state.inventory.slotsUsed + state.inventory.slotsAvailable
                      ? (state.inventory.slotsUsed /
                          (state.inventory.slotsUsed + state.inventory.slotsAvailable)) *
                        100
                      : 0
                  }
                  detail={`${state.inventory.slotsUsed} used / ${state.inventory.slotsAvailable} available`}
                />
                <StatusMeter
                  label="Carried mass"
                  value={(state.inventory.massGrams / state.inventory.capacityGrams) * 100}
                  detail={`${kilograms(state.inventory.massGrams)} / ${kilograms(state.inventory.capacityGrams)}`}
                />
              </div>
            </Panel>
          </div>
          <Panel>
            <SectionHeader eyebrow="Server-resolved">This mining run</SectionHeader>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <p>
                <strong>{state.run.attempts}</strong> attempts
              </p>
              <p>
                <strong>{state.run.successes}</strong> successful
              </p>
              <p>
                <strong>{state.run.failures}</strong> failed
              </p>
              <p>
                <strong>{state.run.shaleGained}</strong> shale gained
              </p>
              <p>
                <strong>{state.run.xpGained}</strong> Mining XP
              </p>
            </div>
            <div
              className="mt-5 max-h-72 space-y-2 overflow-y-auto pr-1"
              aria-label="Mining attempt history"
            >
              {[...state.run.recentAttempts].reverse().map((attempt) => (
                <article
                  className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm"
                  key={attempt.sequence}
                >
                  <p className="font-display uppercase tracking-wide">
                    Attempt {attempt.sequence} - {attempt.success ? "Success" : "Failed"}
                  </p>
                  <p className="text-[color:var(--rs-text-secondary)]">
                    Roll {percentage(attempt.rolledBasisPoints)} | Needed below{" "}
                    {percentage(attempt.thresholdBasisPoints)}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                    {attempt.boosted
                      ? `Boosted · ${attempt.durationTicks} ticks · charge consumed: ${attempt.chargeConsumed ? "yes" : "no"} · ${attempt.remainingCharge} / ${balance.items.salvageCutter.maximumCharge} remaining`
                      : `Normal · ${attempt.durationTicks} ticks`}
                  </p>
                  <p className="text-xs text-[color:var(--rs-text-muted)]">
                    Resolved {new Date(attempt.resolvedAt).toLocaleTimeString()}
                  </p>
                  {attempt.success ? (
                    <p>
                      {attempt.shaleAwarded} Ferrite Shale | {attempt.xpAwarded} Mining XP
                    </p>
                  ) : (
                    <p>
                      Missed by{" "}
                      {percentage(
                        miningNearMissBasisPoints(
                          attempt.rolledBasisPoints,
                          attempt.thresholdBasisPoints,
                        ),
                      )}
                    </p>
                  )}
                </article>
              ))}
              {state.run.recentAttempts.length === 0 ? (
                <p className="text-sm text-[color:var(--rs-text-muted)]">
                  No resolved attempts in this run yet.
                </p>
              ) : null}
            </div>
          </Panel>
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
