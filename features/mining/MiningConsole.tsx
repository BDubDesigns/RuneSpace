"use client";

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ItemVisual } from "@/components/items/ItemVisual";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { inventoryStackFillFraction } from "@/game/domain/inventory";
import { miningNearMissBasisPoints } from "@/game/domain/mining";
import type { MiningGameplayState } from "@/server/mining";
import { refreshMiningAction, startMiningAction, stopMiningAction } from "@/server/actions";
import { reportClientDiagnostic } from "@/features/diagnostics/client";

function kilograms(grams: number) {
  return `${(grams / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function stopMessage(reason: NonNullable<MiningGameplayState["stoppingReason"]>) {
  return {
    manually_stopped: "Mining stopped.",
    inventory_slots_full: "Mining stopped: inventory slots are full.",
    carried_mass_capacity_reached: "Mining stopped: carried-mass capacity reached.",
    compatible_mining_tool_missing: "Mining stopped: equip a Salvage Cutter.",
    action_replaced: "Mining stopped because another action replaced it.",
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

function InventoryPanel({
  state,
  onClose,
  triggerRef,
}: {
  state: MiningGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  function close() {
    onClose();
    triggerRef.current?.focus();
  }
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, triggerRef]);
  const totalSlots = state.inventory.slotsUsed + state.inventory.slotsAvailable;
  return (
    <div
      className="bg-[color:var(--rs-surface-page)]/90 fixed inset-0 z-50 flex items-end p-3 sm:items-center sm:justify-end sm:p-4"
      role="presentation"
    >
      <section
        aria-label="Inventory"
        aria-modal="true"
        className="max-h-[min(78dvh,42rem)] w-full max-w-xl overflow-y-auto border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [box-shadow:var(--rs-shadow-panel)] sm:max-h-[calc(100dvh-2rem)] sm:w-[min(34rem,calc(100vw-2rem))]"
        ref={panel}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <SectionHeader eyebrow="MYKEA SCHLEPPRAUM-8">Inventory</SectionHeader>
          <ActionButton
            ref={closeButton}
            aria-label="Close inventory"
            className="shrink-0 px-3"
            intent="secondary"
            onClick={close}
          >
            Close
          </ActionButton>
        </div>
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          {state.inventory.slotsUsed} occupied / {totalSlots} slots
        </p>
        <div
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
          aria-label="Eight inventory slots"
        >
          {Array.from({ length: totalSlots }, (_, index) => {
            const stack = state.inventory.stacks[index];
            return stack ? (
              <article
                className="relative min-h-28 overflow-hidden border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-3"
                key={stack.id}
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 z-0 w-2 overflow-hidden bg-[color:var(--rs-accent-mining-stack-track)]"
                  data-stack-track
                >
                  <div
                    className="absolute inset-x-0 bottom-0 bg-[color:var(--rs-accent-mining)] transition-[height] duration-[var(--rs-duration-fast)]"
                    data-stack-fill={Math.round(
                      inventoryStackFillFraction(stack.quantity, stack.stackLimit) * 100,
                    )}
                    style={{
                      height: `${inventoryStackFillFraction(stack.quantity, stack.stackLimit) * 100}%`,
                    }}
                  />
                </div>
                <ItemVisual itemId={stack.itemId} name={stack.name} quantity={stack.quantity} />
              </article>
            ) : (
              <div
                aria-label={`Empty inventory slot ${index + 1}`}
                className="min-h-28 border border-dashed border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]"
                key={`empty-${index}`}
              >
                Empty slot
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function MiningConsole({
  characterName,
  initialState,
}: {
  characterName: string;
  initialState: MiningGameplayState;
}) {
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState<string | undefined>(
    initialState.stoppingReason ? stopMessage(initialState.stoppingReason) : undefined,
  );
  const [now, setNow] = useState(Date.now());
  const [pending, startTransition] = useTransition();
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [recovery, setRecovery] = useState<(() => void) | undefined>();
  const commandInFlight = useRef(false);
  const inventoryTrigger = useRef<HTMLButtonElement>(null);
  const balance = getEffectiveGameBalance();
  const active = state.activeAction;
  const durationMs = balance.mining.attemptDurationTicks * GAME_TICK_MS;
  const elapsed = active ? Math.max(0, now - new Date(active.progressStartedAt).getTime()) : 0;
  const progress = active ? Math.min(100, (elapsed / durationMs) * 100) : 0;
  const secondsRemaining = active ? Math.max(0, (durationMs - elapsed) / 1_000) : 0;

  function apply(result: Awaited<ReturnType<typeof refreshMiningAction>>) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.state) {
      setState(result.state);
      if (result.state.commandError) setMessage(commandErrorMessage(result.state.commandError));
      else if (result.state.stoppingReason) setMessage(stopMessage(result.state.stoppingReason));
      else if (result.state.recentResult.successes || result.state.recentResult.failures)
        setMessage(
          `${result.state.recentResult.successes} successful, ${result.state.recentResult.failures} failed attempt${result.state.recentResult.successes + result.state.recentResult.failures === 1 ? "" : "s"}.`,
        );
      else setMessage(undefined);
    }
  }
  function command(action: (id: string) => ReturnType<typeof refreshMiningAction>) {
    if (commandInFlight.current) return;
    commandInFlight.current = true;
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
        setRecovery(() => () => command(action));
      } finally {
        commandInFlight.current = false;
      }
    });
  }

  useEffect(() => {
    if (!active) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    const delay = Math.max(100, new Date(active.nextAttemptAt).getTime() - Date.now() + 100);
    const refresh = window.setTimeout(() => command(refreshMiningAction), delay);
    return () => {
      window.clearInterval(clock);
      window.clearTimeout(refresh);
    };
  }, [active?.nextAttemptAt]);

  return (
    <div className="space-y-4">
      <Panel tone="raised">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeader eyebrow="Crash Site // Sector 01">{characterName}</SectionHeader>
          <span className="border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-subtle)] px-2 py-1 font-display text-xs uppercase tracking-wide text-[color:var(--rs-accent-mining)]">
            Ferrite Shale
          </span>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
          The damaged ship needs raw material. Cut Ferrite Shale from the infinite crash-site
          deposit to prepare for repairs.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {active ? (
            <ActionButton
              intent="danger"
              loading={pending}
              onClick={() => command(stopMiningAction)}
            >
              Stop Mining
            </ActionButton>
          ) : (
            <ActionButton
              intent="mining"
              loading={pending}
              onClick={() => command(startMiningAction)}
            >
              Start Mining
            </ActionButton>
          )}
          <ActionButton
            intent="secondary"
            disabled={pending}
            onClick={() => command(refreshMiningAction)}
          >
            Refresh status
          </ActionButton>
        </div>
        <p className="mt-3 font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-mining)]">
          Success chance: {percentage(state.successChanceBps)}%
        </p>
        {active ? (
          <div className="mt-5">
            <StatusMeter
              label="Mining attempt"
              value={progress}
              detail={`${secondsRemaining.toFixed(1)}s to next attempt`}
            />
          </div>
        ) : (
          <Feedback>Mining is idle. Attempts take six seconds and resolve on the server.</Feedback>
        )}
        {message ? (
          <Feedback tone={state.stoppingReason && !active ? "danger" : "muted"}>{message}</Feedback>
        ) : null}
        {recovery ? (
          <ActionButton className="mt-3" intent="secondary" onClick={recovery}>
            Retry status check
          </ActionButton>
        ) : null}
      </Panel>
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
          <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
            Salvage Cutter and MYKEA SCHLEPPRAUM-8 equipped
          </p>
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
          aria-label="Latest mining attempts"
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
      <div className="sticky bottom-0 z-40 -mx-4 border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:fixed sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0 sm:w-fit sm:border sm:px-2 sm:py-2 sm:[box-shadow:var(--rs-shadow-panel)]">
        <ActionButton
          ref={inventoryTrigger}
          intent="secondary"
          onClick={() => setInventoryOpen((open) => !open)}
        >
          Inventory {state.inventory.slotsUsed}/
          {state.inventory.slotsUsed + state.inventory.slotsAvailable}
        </ActionButton>
      </div>
      {inventoryOpen ? (
        <InventoryPanel
          state={state}
          onClose={() => setInventoryOpen(false)}
          triggerRef={inventoryTrigger}
        />
      ) : null}
    </div>
  );
}
