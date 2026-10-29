"use client";

import { LapidaryRunPanel } from "@/features/lapidary/LapidaryRunPanel";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { useEffect, useState } from "react";
import { StackItemVisual } from "@/components/items/StackItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { XpAmount } from "@/components/ui/XpAmount";
import { ItemSourcesButton } from "@/features/item-sources/ItemSourcesButton";
import { derivePinnedGuidanceTargets } from "@/features/missions/mission-pins";
import { usePlay } from "@/features/play/PlayContext";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { BoundedRunSelector, BoundedRunProgress } from "@/features/shared/BoundedRunControl";
import { seconds } from "@/features/shared/duration-copy";
import { useStationCommand } from "@/features/shared/use-station-command";
import { GAME_TICK_MS, SKILL_IDS } from "@/game/config/foundations";
import type { BoundedRunSelection } from "@/game/domain/bounded-run";
import { startLapidaryAction, finishCurrentLapidaryAction } from "@/server/actions";

const UNIT = { singular: "piece", plural: "pieces" };

/** Server-projected permission, recipe, capacity, run and results; UI sends intent. */
export function LapidaryWorkbench() {
  const { state, foregroundBusy } = usePlay();
  const bench = state.lapidaryWorkbench;
  const [selected, setSelected] = useState<string>();
  const [selection, setSelection] = useState<BoundedRunSelection>(1);
  const [now, setNow] = useState(Date.now());
  const authorized = bench.recipes.filter((recipe) => recipe.authorized);
  const recipe =
    bench.recipes.find((candidate) => candidate.actionId === bench.cycle?.recipeActionId) ??
    authorized.find((candidate) => candidate.actionId === selected) ??
    authorized[0];
  const command = useStationCommand((next) =>
    next.commandError === "another_action_active"
      ? "Finish your current activity first."
      : next.lapidaryError
        ? next.lapidaryError === "lapidary_locked"
          ? next.lapidaryWorkbench.instruction
          : next.lapidaryError === "lapidary_quantity_unavailable"
            ? "Choose an available run size. Supervised lessons permit one piece only."
            : (next.lapidaryWorkbench.recipes.find(
                (candidate) => candidate.actionId === recipe?.actionId,
              )?.refusal ??
              "The workbench could not start that recipe. Check your materials and run size.")
        : undefined,
  );
  const targets = derivePinnedGuidanceTargets(state);
  useEffect(() => {
    if (!bench.cycle) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [bench.cycle]);
  useEffect(() => {
    setSelection(1);
  }, [bench.access.kind, bench.cycle?.recipeActionId]);
  const busy = foregroundBusy || Boolean(state.activeAction);
  const cycle = bench.cycle;
  return (
    <ActivityPanel
      title="Lapidary Workbench"
      data-lapidary-workbench
      data-lapidary-access={bench.access.kind}
    >
      <p className="text-sm text-[color:var(--rs-text-secondary)]">{bench.instruction}</p>
      {cycle && recipe ? (
        <section aria-label="Piece on the workbench" className="space-y-3" data-lapidary-cycle>
          <p className="font-display text-sm font-bold uppercase">{recipe.displayName}</p>
          <BoundedRunProgress
            completed={bench.run.cycles}
            selection={bench.run.selection}
            unit={UNIT}
          />
          <StatusMeter
            label={recipe.displayName}
            accentColor="var(--rs-skill-lapidary)"
            value={Math.min(
              100,
              Math.max(
                0,
                ((now - Date.parse(cycle.startedAt)) /
                  (Date.parse(cycle.endsAt) - Date.parse(cycle.startedAt))) *
                  100,
              ),
            )}
            detail={
              now >= Date.parse(cycle.endsAt)
                ? "Resolving"
                : `${((Date.parse(cycle.endsAt) - now) / 1000).toFixed(1)}s`
            }
          />
          {bench.run.selection === "max" ||
          (typeof bench.run.selection === "number" &&
            bench.run.cycles + 1 < bench.run.selection) ? (
            <ActionButton
              disabled={cycle.finishCurrent || foregroundBusy}
              onClick={() =>
                command.run("finish", () =>
                  finishCurrentLapidaryAction({ characterId: state.characterId }),
                )
              }
              loading={command.pending === "finish"}
            >
              {cycle.finishCurrent ? "Stopping After This Piece" : "Stop After This Piece"}
            </ActionButton>
          ) : null}
        </section>
      ) : recipe ? (
        <div className="space-y-3">
          {bench.access.kind === "unrestricted" ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Lapidary recipe">
              {authorized.map((candidate) => (
                <ActionButton
                  key={candidate.actionId}
                  aria-pressed={recipe.actionId === candidate.actionId}
                  intent={recipe.actionId === candidate.actionId ? "primary" : "secondary"}
                  onClick={() => {
                    setSelected(candidate.actionId);
                    setSelection(1);
                  }}
                >
                  {candidate.displayName}
                </ActionButton>
              ))}
            </div>
          ) : null}
          <div className="flex items-start gap-3">
            <div className="w-24 shrink-0">
              <StackItemVisual
                itemId={recipe.outputItemId ?? recipe.inputs[0]!.itemId}
                name={recipe.outputItemId ? recipe.displayName : recipe.inputs[0]!.name}
                quantity={1}
                stackLimit={recipe.outputStackLimit ?? recipe.inputs[0]!.stackLimit!}
              />
            </div>
            <div className="min-w-0 space-y-2 text-sm">
              <p className="font-display font-bold uppercase">
                {recipe.displayName} · {seconds(recipe.durationTicks, GAME_TICK_MS)}
              </p>
              <XpAmount
                amount={recipe.baseXp}
                prefix="+"
                skillId={SKILL_IDS.lapidary}
                skillName="Lapidary"
              />
              <p>
                {recipe.outputItemId
                  ? "Produces one Cut Quartz. Always succeeds."
                  : "Consumes the Stone for practice. No output item. Always succeeds."}
              </p>
            </div>
          </div>
          <ul className="space-y-2 text-sm">
            {recipe.inputs.map((input) => (
              <li className="flex flex-wrap items-center gap-2" key={input.itemId}>
                <span>
                  Needs {input.quantity} {input.name} · carrying {input.carried}
                </span>
                <ItemSourcesButton itemId={input.itemId} state={state} />
              </li>
            ))}
          </ul>
          {bench.access.kind === "unrestricted" ? (
            <BoundedRunSelector
              affordable={recipe.affordableCycles}
              disabled={busy}
              onChange={setSelection}
              selection={selection}
              unit={UNIT}
              summary={
                selection === "max"
                  ? "Continue until materials or capacity stop the run."
                  : `${selection} ${selection === 1 ? "piece" : "pieces"}`
              }
            />
          ) : (
            <p className="text-xs text-[color:var(--rs-text-muted)]">
              Supervised lesson · one piece
            </p>
          )}
          {recipe.refusal ? <Feedback tone="muted">{recipe.refusal}</Feedback> : null}
          <MissionActionButton
            guidance={targets.actionIds.has(recipe.actionId) ? "active" : undefined}
            disabled={!recipe.canStart || busy}
            loading={command.pending === "start"}
            onClick={() =>
              command.run("start", () =>
                startLapidaryAction({
                  characterId: state.characterId,
                  recipeActionId: recipe.actionId,
                  quantity: bench.access.kind === "supervised" ? 1 : selection,
                }),
              )
            }
          >
            {recipe.displayName}
          </MissionActionButton>
          <p className="text-xs text-[color:var(--rs-text-muted)]">
            A started piece must finish. Its materials stay reserved in Inventory until completion.
            Stop After This Piece ends a longer run after the current piece.
          </p>
        </div>
      ) : null}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
      {bench.run.cycles > 0 ? (
        <p role="status" data-lapidary-result className="text-sm">
          This run: {bench.run.cycles} {bench.run.cycles === 1 ? "piece" : "pieces"} complete · +
          {bench.run.xpGained} Lapidary XP
          {Object.entries(bench.run.outputsGained).map(([itemId, quantity]) => (
            <span key={itemId}>
              {" "}
              · {quantity} {resolveItemPresentation(itemId, itemId).displayName}
            </span>
          ))}
        </p>
      ) : null}
      {bench.lastStopReason === "insufficient_inputs" ? (
        <Feedback tone="muted">Out of materials for another piece.</Feedback>
      ) : null}
      {bench.lastStopReason &&
      !["run_completed", "finished_current", "insufficient_inputs"].includes(
        bench.lastStopReason,
      ) ? (
        <Feedback tone="danger">
          {bench.lastStopReason === "access_denied"
            ? "Authorization changed. Speak to Werner before starting again."
            : "The run stopped. Check materials, level and room for the next piece."}
        </Feedback>
      ) : null}
      <LapidaryRunPanel bench={bench} />
      <SkillProgressRow
        skill="Lapidary"
        tone="lapidary"
        level={state.lapidary.level}
        xpIntoLevel={state.lapidary.xpIntoLevel}
        xpToNextLevel={state.lapidary.xpToNextLevel}
      />
      <ActivityContextRow
        items={[]}
        carry={{
          slotsUsed: state.inventory.slotsUsed,
          slotsAvailable: state.inventory.slotsAvailable,
          massGrams: state.inventory.massGrams,
          capacityGrams: state.inventory.capacityGrams,
        }}
      />
    </ActivityPanel>
  );
}
