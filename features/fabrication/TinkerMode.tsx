"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { BoundedRunProgress, BoundedRunSelector } from "@/features/shared/BoundedRunControl";
import { TinkeringRunPanel } from "@/features/fabrication/FabricationRunPanel";
import { StationRecipeTile } from "@/features/fabrication/StationRecipeTile";
import {
  BATCH_UNIT,
  seconds,
  tinkeringErrorMessage,
  tinkeringStopIsExpected,
  tinkeringStopMessage,
} from "@/features/fabrication/station-copy";
import { useStationCommand } from "@/features/fabrication/use-station-command";
import { usePlay } from "@/features/play/PlayContext";
import { GAME_TICK_MS } from "@/game/config/foundations";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  BOUNDED_RUN_MAX,
  type BoundedRunSelection,
} from "@/game/domain/bounded-run";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import {
  finishCurrentTinkeringAction,
  setTinkeringScrapPreferenceAction,
  startTinkeringAction,
  stopTinkeringAction,
} from "@/server/actions";
import type { PlayGameplayState, TinkeringTargetProjection } from "@/server/play";

function targetLine(target: TinkeringTargetProjection): string {
  return `${target.batchQuantity} ${target.name} → ${target.scrap} Scrap Metal`;
}

function unmet(target: TinkeringTargetProjection, level: number): string[] {
  if (!target.unlocked) return [`Requires Fabrication ${target.minimumLevel} (you are ${level})`];
  if (target.lastCutterBlocked) return ["Your last Mining Cutter"];
  if (target.carriedBatches < 1) return [`Carry ${target.batchQuantity} ${target.name}`];
  return [];
}

/**
 * The selected run, before Start (#229): a number totals exactly — every batch
 * pays the same XP and Scrap — and Max describes one batch.
 */
function tinkeringRunSummary(
  target: TinkeringTargetProjection,
  selection: BoundedRunSelection,
  autoDiscardScrap: boolean,
): string {
  const scrap = autoDiscardScrap ? "Scrap discarded" : `${target.scrap} Scrap Metal`;
  if (selection === BOUNDED_RUN_MAX) {
    return `Max · ${target.batchQuantity} ${target.name} per batch · ${target.xp} Fabrication XP and ${scrap} each · ${seconds(target.durationTicks, GAME_TICK_MS)} each · runs until the next batch cannot begin`;
  }
  const scrapTotal = autoDiscardScrap
    ? "Scrap discarded"
    : `${target.scrap * selection} Scrap Metal`;
  return `${selection} ${selection === 1 ? "batch" : "batches"} · ${target.batchQuantity * selection} ${target.name} · ${seconds(target.durationTicks * selection, GAME_TICK_MS)} · ${target.xp * selection} Fabrication XP · ${scrapTotal}`;
}

function describe(
  state: PlayGameplayState,
  targetActionId: string | undefined,
): string | undefined {
  if (state.commandError === "another_action_active") {
    return "Another activity is active. Finish it before Tinkering.";
  }
  if (!state.tinkeringError) return undefined;
  const affordable = state.tinkering.targets.find(
    (target) => target.actionId === targetActionId,
  )?.affordableBatches;
  return tinkeringErrorMessage(state.tinkeringError, affordable);
}

/**
 * Tinker (#232): dismantle one complete authored Fabrication batch for its
 * base Fabrication XP and Scrap Metal. It mirrors Fabricate's list and filters,
 * uses the same bounded-run selector, and follows Practice Welding's cycle:
 * a started cycle's batch is gone at once, Stop keeps it waiting, and Finish
 * Current completes it and stops.
 */
export function TinkerMode() {
  const { foregroundBusy, state } = usePlay();
  const tinkering = state.tinkering;
  const [hideLocked, setHideLocked] = useState(false);
  const [hideUnavailable, setHideUnavailable] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selection, setSelection] = useState<BoundedRunSelection>(BOUNDED_RUN_DEFAULT_QUANTITY);
  const [now, setNow] = useState(Date.now());
  const cycle = tinkering.cycle;
  const cycleTarget = tinkering.targets.find((target) => target.actionId === cycle?.targetActionId);
  const target =
    cycleTarget ??
    tinkering.targets.find((candidate) => candidate.actionId === selectedActionId) ??
    tinkering.targets.find((candidate) => candidate.affordableBatches > 0) ??
    tinkering.targets[0];
  const command = useStationCommand((next) => describe(next, target?.actionId));
  const running = tinkering.active;
  const guided = deriveMissionGuidanceTargets(state.missions).activities.has("tinkering");

  useEffect(() => {
    if (!running) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, [running]);
  useEffect(() => {
    if (running) setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
  }, [running]);

  const characterId = state.characterId;
  const visible = tinkering.targets.filter(
    (candidate) =>
      (!hideLocked || candidate.unlocked) && (!hideUnavailable || candidate.affordableBatches > 0),
  );
  const cycleProgress =
    running && state.activeAction
      ? Math.min(
          100,
          ((now - new Date(state.activeAction.progressStartedAt).getTime()) /
            (new Date(state.activeAction.nextAttemptAt).getTime() -
              new Date(state.activeAction.progressStartedAt).getTime())) *
            100,
        )
      : cycle
        ? (cycle.ticksCompleted / cycle.durationTicks) * 100
        : 0;
  const remainingSeconds =
    running && state.activeAction
      ? Math.max(0, (new Date(state.activeAction.nextAttemptAt).getTime() - now) / 1000)
      : cycle
        ? ((cycle.durationTicks - cycle.ticksCompleted) * GAME_TICK_MS) / 1000
        : 0;
  const stopReason = !running && !cycle ? tinkering.lastStopReason : undefined;
  const affordable = (target?.affordableBatches ?? 0) + (cycle ? 1 : 0);

  return (
    <div className="space-y-3" data-tinker-mode data-tinker-active={String(running)}>
      {cycle && cycleTarget ? (
        <section
          aria-label="Item on the station"
          className="space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
          data-tinker-cycle={cycle.targetActionId}
        >
          <p className="font-display text-sm font-bold uppercase tracking-wide">
            Taking apart {cycleTarget.batchQuantity} {cycleTarget.name}
          </p>
          {running ? (
            <BoundedRunProgress
              completed={tinkering.run.batches}
              selection={tinkering.run.selection}
              unit={BATCH_UNIT}
            />
          ) : (
            <p className="text-xs text-[color:var(--rs-text-secondary)]">
              Already committed. Resume continues this item; it will not take another.
            </p>
          )}
          <StatusMeter
            detail={`${remainingSeconds.toFixed(1)}s left`}
            label="Current item"
            value={cycleProgress}
          />
          <div className="flex flex-wrap gap-3">
            {running ? (
              <ActionButton
                data-tinker-stop
                disabled={foregroundBusy && command.pending !== "stop"}
                intent="secondary"
                loading={command.pending === "stop"}
                onClick={() => command.run("stop", () => stopTinkeringAction({ characterId }))}
              >
                Stop Tinkering
              </ActionButton>
            ) : null}
            <ActionButton
              aria-pressed={tinkering.finishCurrent}
              data-tinker-finish
              disabled={tinkering.finishCurrent || (foregroundBusy && command.pending !== "finish")}
              intent={tinkering.finishCurrent ? "success" : "secondary"}
              loading={command.pending === "finish"}
              onClick={() =>
                command.run("finish", () => finishCurrentTinkeringAction({ characterId }))
              }
            >
              {tinkering.finishCurrent ? "Stopping After This Item" : "Finish Current Item"}
            </ActionButton>
          </div>
        </section>
      ) : null}

      {running ? null : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tinkering filters">
            <ActionButton
              aria-pressed={hideLocked}
              className="!min-h-9 px-3 text-xs"
              data-tinker-filter="level"
              intent="secondary"
              onClick={() => setHideLocked((value) => !value)}
            >
              Hide above my level
            </ActionButton>
            <ActionButton
              aria-pressed={hideUnavailable}
              className="!min-h-9 px-3 text-xs"
              data-tinker-filter="items"
              intent="secondary"
              onClick={() => setHideUnavailable((value) => !value)}
            >
              Hide what I can&apos;t Tinker
            </ActionButton>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-tinker-targets>
            {visible.map((candidate) => (
              <StationRecipeTile
                data-tinker-target={candidate.actionId}
                data-tinker-target-ready={String(candidate.affordableBatches > 0)}
                itemId={candidate.itemId}
                key={candidate.actionId}
                name={candidate.name}
                onSelect={() => {
                  if (candidate.actionId !== target?.actionId) {
                    setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
                  }
                  setSelectedActionId(candidate.actionId);
                }}
                quantity={candidate.batchQuantity}
                recipe={`${targetLine(candidate)} · ${candidate.xp} XP · ${seconds(candidate.durationTicks, GAME_TICK_MS)}`}
                requirements={unmet(candidate, state.fabrication.level)}
                selected={candidate.actionId === target?.actionId}
                {...(candidate.stackLimit !== undefined
                  ? { stackLimit: candidate.stackLimit }
                  : {})}
                tileLabel={`Tinker ${candidate.name}: ${targetLine(candidate)}`}
              />
            ))}
          </div>
          {target?.lastCutterBlocked ? (
            <Feedback tone="muted">
              That is your last Mining Cutter. Make or get another Cutter before taking one apart.
            </Feedback>
          ) : null}
          {target && target.unlocked ? (
            <BoundedRunSelector
              affordable={affordable}
              disabled={foregroundBusy || Boolean(state.activeAction)}
              onChange={setSelection}
              selection={selection}
              summary={tinkeringRunSummary(target, selection, tinkering.autoDiscardScrap)}
              unit={BATCH_UNIT}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {target ? (
              <MissionActionButton
                data-tinker-start
                disabled={affordable < 1 || Boolean(state.activeAction) || foregroundBusy}
                guidance={guided ? "active" : undefined}
                loading={command.pending === "start"}
                onClick={() =>
                  command.run("start", () =>
                    startTinkeringAction({
                      characterId,
                      targetActionId: target.actionId,
                      quantity: selection,
                    }),
                  )
                }
              >
                {cycle ? `Resume Tinkering ${target.name}` : `Tinker ${target.name}`}
              </MissionActionButton>
            ) : null}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          aria-pressed={tinkering.autoDiscardScrap}
          data-tinker-scrap-toggle
          disabled={foregroundBusy && command.pending !== "scrap"}
          intent="secondary"
          loading={command.pending === "scrap"}
          onClick={() =>
            command.run("scrap", () =>
              setTinkeringScrapPreferenceAction({
                characterId,
                autoDiscardScrap: !tinkering.autoDiscardScrap,
              }),
            )
          }
        >
          {tinkering.autoDiscardScrap ? "Auto-discard Scrap" : "Keep Scrap"}
        </ActionButton>
        <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
          Applied when an item finishes
        </p>
      </div>

      {stopReason ? (
        <Feedback
          tone={tinkeringStopIsExpected(stopReason, tinkering.run.selection) ? "muted" : "danger"}
        >
          {tinkeringStopMessage(stopReason, tinkering.run)}
        </Feedback>
      ) : null}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
      <TinkeringRunPanel run={tinkering.run} />
    </div>
  );
}
