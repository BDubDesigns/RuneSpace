"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { BoundedRunSelector } from "@/features/shared/BoundedRunControl";
import { FabricationRunPanel } from "@/features/fabrication/FabricationRunPanel";
import { LiveWorkpiecePanel } from "@/features/fabrication/LiveWorkpiecePanel";
import { StationRecipeTile } from "@/features/fabrication/StationRecipeTile";
import {
  BATCH_UNIT,
  fabricationErrorMessage,
  fabricationRunSummary,
  fabricationStopIsExpected,
  fabricationStopMessage,
  seconds,
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
  finishCurrentFabricationAction,
  lockInManualOverrideAction,
  pushManualOverrideAction,
  setManualOverrideAction,
  startFabricationAction,
} from "@/server/actions";
import type { FabricationRecipeProjection, PlayGameplayState } from "@/server/play";

function recipeLine(recipe: FabricationRecipeProjection): string {
  return `${recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ")} → ${recipe.outputQuantity} ${recipe.outputName}`;
}

function unmetRequirements(recipe: FabricationRecipeProjection, level: number): string[] {
  const unmet: string[] = [];
  if (!recipe.unlocked)
    unmet.push(`Requires Fabrication ${recipe.minimumLevel} (you are ${level})`);
  for (const input of recipe.inputs) {
    if (input.carried < input.quantity) {
      unmet.push(`Need ${input.quantity - input.carried} more ${input.name}`);
    }
  }
  return unmet;
}

function describe(
  state: PlayGameplayState,
  recipeActionId: string | undefined,
): string | undefined {
  if (state.commandError === "another_action_active") {
    return "Another activity is active. Finish it before starting a workpiece.";
  }
  if (!state.fabricationError) return undefined;
  const affordable = state.fabricationStation.recipes.find(
    (recipe) => recipe.actionId === recipeActionId,
  )?.affordableBatches;
  return fabricationErrorMessage(state.fabricationError, affordable);
}

/**
 * Fabricate (#232): the full authored recipe list by default, locked and
 * unaffordable recipes included with what they are missing, under two
 * independent filters; the shared bounded-run selector; and — once a workpiece
 * is on the machine — the live workpiece panel with its Manual Override.
 */
export function FabricateMode() {
  const { foregroundBusy, state } = usePlay();
  const station = state.fabricationStation;
  const [hideLocked, setHideLocked] = useState(false);
  const [hideUnaffordable, setHideUnaffordable] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selection, setSelection] = useState<BoundedRunSelection>(BOUNDED_RUN_DEFAULT_QUANTITY);
  const active = station.workpiece;
  const isActive = Boolean(active);
  const guidance = deriveMissionGuidanceTargets(state.missions);
  const activeRecipe = station.recipes.find(
    (candidate) => candidate.actionId === active?.recipeActionId,
  );
  // With nothing chosen yet, the recipe a Mission is teaching comes first.
  const guidedRecipe = station.recipes.find((candidate) =>
    guidance.actionIds.has(candidate.actionId),
  );
  const recipe =
    activeRecipe ??
    station.recipes.find((candidate) => candidate.actionId === selectedActionId) ??
    guidedRecipe ??
    station.recipes[0];
  const command = useStationCommand((next) => describe(next, recipe?.actionId));

  // A fresh selection starts at one whenever a run ends (#229).
  useEffect(() => {
    if (isActive) setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
  }, [isActive]);

  const visible = station.recipes.filter(
    (candidate) =>
      (!hideLocked || candidate.unlocked) && (!hideUnaffordable || candidate.inputsAvailable),
  );
  const stopReason = !active ? station.lastStopReason : undefined;
  const characterId = state.characterId;

  if (active && activeRecipe) {
    return (
      <div className="space-y-3" data-fabricate-mode>
        <LiveWorkpiecePanel
          busy={foregroundBusy}
          onFinishCurrent={() =>
            command.run("finish", () => finishCurrentFabricationAction({ characterId }))
          }
          onLockIn={() =>
            command.run("lock", () =>
              lockInManualOverrideAction({ characterId, expectedWorkpiece: active.sequence }),
            )
          }
          onPush={(feed) =>
            command.run("push", () =>
              pushManualOverrideAction({
                characterId,
                feed,
                expectedWorkpiece: active.sequence,
                expectedPushes: active.override?.pushes ?? 0,
              }),
            )
          }
          onToggleOverride={(enabled) =>
            command.run("override", () => setManualOverrideAction({ characterId, enabled }))
          }
          pending={command.pending}
          recipe={activeRecipe}
          station={station}
        />
        {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
        <FabricationRunPanel run={station.run} />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-fabricate-mode>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Recipe filters">
        <ActionButton
          aria-pressed={hideLocked}
          className="!min-h-9 px-3 text-xs"
          data-fabricate-filter="level"
          intent="secondary"
          onClick={() => setHideLocked((value) => !value)}
        >
          Hide above my level
        </ActionButton>
        <ActionButton
          aria-pressed={hideUnaffordable}
          className="!min-h-9 px-3 text-xs"
          data-fabricate-filter="materials"
          intent="secondary"
          onClick={() => setHideUnaffordable((value) => !value)}
        >
          Hide without materials
        </ActionButton>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-fabricate-recipes>
        {visible.map((candidate) => (
          <StationRecipeTile
            data-fabricate-recipe={candidate.actionId}
            data-fabricate-recipe-ready={String(candidate.unlocked && candidate.inputsAvailable)}
            guided={guidance.actionIds.has(candidate.actionId)}
            itemId={candidate.outputItemId}
            key={candidate.actionId}
            name={candidate.outputName}
            onSelect={() => {
              if (candidate.actionId !== recipe?.actionId)
                setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
              setSelectedActionId(candidate.actionId);
            }}
            quantity={candidate.outputQuantity}
            recipe={recipeLine(candidate)}
            requirements={unmetRequirements(candidate, state.fabrication.level)}
            selected={candidate.actionId === recipe?.actionId}
            {...(candidate.outputStackLimit !== undefined
              ? { stackLimit: candidate.outputStackLimit }
              : {})}
            tileLabel={`${candidate.outputName}: ${recipeLine(candidate)}`}
          />
        ))}
      </div>
      {visible.length === 0 ? (
        <Feedback tone="muted">No recipe matches both filters right now.</Feedback>
      ) : null}

      {recipe ? (
        <div className="space-y-3" data-fabricate-selected={recipe.actionId}>
          <p className="font-display text-sm uppercase tracking-wide">
            {recipe.outputName} &middot; {seconds(recipe.durationTicks, GAME_TICK_MS)} &middot; +
            {recipe.baseXp} Fabrication XP
          </p>
          {recipe.unlocked ? (
            <BoundedRunSelector
              affordable={recipe.affordableBatches}
              disabled={foregroundBusy || Boolean(state.activeAction)}
              onChange={setSelection}
              selection={selection}
              summary={fabricationRunSummary(recipe, selection)}
              unit={BATCH_UNIT}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <MissionActionButton
              data-fabricate-start
              disabled={
                !recipe.unlocked ||
                recipe.affordableBatches < 1 ||
                Boolean(state.activeAction) ||
                foregroundBusy
              }
              guidance={guidance.actionIds.has(recipe.actionId) ? "active" : undefined}
              loading={command.pending === "start"}
              onClick={() =>
                command.run("start", () =>
                  startFabricationAction({
                    characterId,
                    recipeActionId: recipe.actionId,
                    quantity: selection,
                  }),
                )
              }
            >
              Fabricate {recipe.outputName}
            </MissionActionButton>
            <ActionButton
              aria-pressed={station.manualOverrideEnabled}
              data-manual-override-toggle
              disabled={foregroundBusy && command.pending !== "override"}
              intent="secondary"
              loading={command.pending === "override"}
              onClick={() =>
                command.run("override", () =>
                  setManualOverrideAction({ characterId, enabled: !station.manualOverrideEnabled }),
                )
              }
            >
              Manual Override: {station.manualOverrideEnabled ? "On" : "Off"}
            </ActionButton>
          </div>
          <p className="text-xs text-[color:var(--rs-text-muted)]">
            A started workpiece is committed: its materials stay reserved in your Inventory until it
            finishes, and you cannot leave the station while it is on the machine.
          </p>
        </div>
      ) : null}

      {stopReason ? (
        <Feedback
          tone={fabricationStopIsExpected(stopReason, station.run.selection) ? "muted" : "danger"}
        >
          {fabricationStopMessage(stopReason, station.run)}
        </Feedback>
      ) : null}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
      <FabricationRunPanel run={station.run} />
    </div>
  );
}
