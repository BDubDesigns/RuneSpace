"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { BoundedRunSelector } from "@/features/shared/BoundedRunControl";
import { FabricationRunPanel } from "@/features/fabrication/FabricationRunPanel";
import { LiveWorkpiecePanel } from "@/features/fabrication/LiveWorkpiecePanel";
import { StationRecipeTile } from "@/features/fabrication/StationRecipeTile";
import { fabricateVisibleRecipes } from "@/features/fabrication/station-lists";
import {
  BATCH_UNIT,
  recipeLine,
  unmetRequirements,
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
import type { PlayGameplayState } from "@/server/play";

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
 * Fabricate (#232): what the character can make now — level-unlocked recipes
 * whose materials are carried, plus a Mission-guided recipe with what it is
 * missing (`fabricateVisibleRecipes`). Everything the character knows lives on
 * the station's Recipes surface instead. Then the shared bounded-run selector
 * and — once a workpiece is on the machine — the live workpiece panel with its
 * Manual Override.
 */
export function FabricateMode() {
  const { foregroundBusy, state } = usePlay();
  const station = state.fabricationStation;
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selection, setSelection] = useState<BoundedRunSelection>(BOUNDED_RUN_DEFAULT_QUANTITY);
  const active = station.workpiece;
  const isActive = Boolean(active);
  const guidance = deriveMissionGuidanceTargets(state.missions);
  const activeRecipe = station.recipes.find(
    (candidate) => candidate.actionId === active?.recipeActionId,
  );
  const visible = fabricateVisibleRecipes(station.recipes, guidance.actionIds);
  // With nothing chosen yet, the recipe a Mission is teaching comes first.
  const guidedRecipe = visible.find((candidate) => guidance.actionIds.has(candidate.actionId));
  const recipe =
    activeRecipe ??
    visible.find((candidate) => candidate.actionId === selectedActionId) ??
    guidedRecipe ??
    visible[0];
  const command = useStationCommand((next) => describe(next, recipe?.actionId));

  // A fresh selection starts at one whenever a run ends (#229).
  useEffect(() => {
    if (isActive) setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
  }, [isActive]);

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
            recipe={`${recipeLine(candidate)} · ${seconds(candidate.durationTicks, GAME_TICK_MS)}`}
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
        <Feedback tone="muted">
          <span data-fabricate-empty>
            Nothing you are carrying makes a recipe right now. Recipes shows everything you know how
            to make.
          </span>
        </Feedback>
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
              intent={station.manualOverrideEnabled ? "fabrication" : "secondary"}
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
