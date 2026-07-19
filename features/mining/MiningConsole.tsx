"use client";

import { useEffect, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { GAME_TICK_MS } from "@/game/config/foundations";
import type { MiningGameplayState } from "@/server/mining";
import { refreshMiningAction, startMiningAction, stopMiningAction } from "@/server/actions";

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
      if (result.state.stoppingReason) setMessage(stopMessage(result.state.stoppingReason));
      else if (result.state.recentResult.successes || result.state.recentResult.failures)
        setMessage(
          `${result.state.recentResult.successes} successful, ${result.state.recentResult.failures} failed attempt${result.state.recentResult.successes + result.state.recentResult.failures === 1 ? "" : "s"}.`,
        );
    }
  }
  function command(action: (id: string) => ReturnType<typeof refreshMiningAction>) {
    startTransition(async () => apply(await action(state.characterId)));
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
          <Feedback tone={state.stoppingReason ? "danger" : "muted"}>{message}</Feedback>
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
    </div>
  );
}
