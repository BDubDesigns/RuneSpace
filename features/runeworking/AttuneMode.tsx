"use client";

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
import { RuneworkingRunPanel } from "@/features/runeworking/RuneworkingRunPanel";
import {
  ATTUNEMENT_UNIT,
  runeworkingErrorMessage,
  runeworkingCanStart,
  runeworkingCommitmentNote,
  runeworkingRecipeLine,
  runeworkingRunSummary,
  runeworkingStopIsExpected,
  runeworkingStopMessage,
  runeworkingUnmetRequirements,
} from "@/features/runeworking/rig-copy";
import { BoundedRunProgress, BoundedRunSelector } from "@/features/shared/BoundedRunControl";
import { seconds } from "@/features/shared/duration-copy";
import { useStationCommand } from "@/features/shared/use-station-command";
import { GAME_TICK_MS, SKILL_IDS } from "@/game/config/foundations";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  BOUNDED_RUN_MAX,
  type BoundedRunSelection,
} from "@/game/domain/bounded-run";
import { finishCurrentRuneworkingAction, startRuneworkingAction } from "@/server/actions";
import type {
  PlayGameplayState,
  ResonanceRigProjection,
  RuneworkingRecipeProjection,
} from "@/server/play";

function describe(
  state: PlayGameplayState,
  recipeActionId: string | undefined,
): string | undefined {
  if (state.commandError === "another_action_active") {
    return "Another activity is active. Finish it before starting the Rig.";
  }
  if (!state.runeworkingError) return undefined;
  const affordable = state.resonanceRig.recipes.find(
    (recipe) => recipe.actionId === recipeActionId,
  )?.affordableCycles;
  return runeworkingErrorMessage(state.runeworkingError, affordable);
}

/**
 * Attune (#391): every Runeworking recipe the character has learned, with what
 * it is missing and the ingredient's own Sources, the shared bounded-run
 * selector, and — once a cycle is on the Rig — the live cycle with Finish
 * Current. The server decides everything; this only asks and shows.
 */
export function AttuneMode() {
  const { foregroundBusy, state } = usePlay();
  const rig = state.resonanceRig;
  const [selection, setSelection] = useState<BoundedRunSelection>(BOUNDED_RUN_DEFAULT_QUANTITY);
  const active = rig.cycle;
  const isActive = Boolean(active);
  const guidance = derivePinnedGuidanceTargets(state);
  const activeRecipe = rig.recipes.find(
    (candidate) => candidate.actionId === active?.recipeActionId,
  );
  // Learned recipes stay listed whether or not their materials are carried, so
  // what is missing — and where to get it — is always one tap away. A recipe a
  // Mission is teaching is listed even before its level.
  const visible = rig.recipes.filter(
    (recipe) => recipe.unlocked || guidance.actionIds.has(recipe.actionId),
  );
  const guidedRecipe = visible.find((candidate) => guidance.actionIds.has(candidate.actionId));
  // A station makes one recipe (#441), so there is nothing to select between.
  const recipe = activeRecipe ?? guidedRecipe ?? visible[0];
  const command = useStationCommand((next) => describe(next, recipe?.actionId));
  const characterId = state.characterId;

  // A fresh selection starts at one whenever a run starts (#229).
  useEffect(() => {
    if (isActive) setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
  }, [isActive]);

  if (active && activeRecipe) {
    return (
      <div className="space-y-3" data-attune-mode>
        <RigCyclePanel
          busy={foregroundBusy}
          onFinishCurrent={() =>
            command.run("finish", () => finishCurrentRuneworkingAction({ characterId }))
          }
          pending={command.pending}
          recipe={activeRecipe}
          rig={rig}
        />
        {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
        <RuneworkingRunPanel run={rig.run} />
      </div>
    );
  }

  const stopReason = rig.lastStopReason;
  // The one Start rule, used for the button and for its guidance alike: a control that
  // cannot run now is never lit as the next step (#441). Mission pin guidance elsewhere
  // (the log, the Map, Sources) is untouched.
  const executable =
    recipe !== undefined &&
    runeworkingCanStart(recipe, {
      activityRunning: Boolean(state.activeAction),
      foregroundBusy,
    });
  const unmet = recipe ? runeworkingUnmetRequirements(recipe, state.runeworking.level) : [];
  return (
    <div className="space-y-3" data-attune-mode>
      {recipe ? (
        <div className="space-y-3" data-attune-selected={recipe.actionId}>
          <div className="flex items-start gap-3">
            <div className="w-24 shrink-0 sm:w-28">
              <StackItemVisual
                itemId={recipe.outputItemId}
                name={recipe.outputName}
                quantity={recipe.outputQuantity}
                stackLimit={recipe.outputStackLimit}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-display text-sm font-bold uppercase tracking-wide">
                {recipe.outputName}
              </p>
              <p className="text-xs text-[color:var(--rs-text-secondary)]" data-attune-recipe-line>
                {runeworkingRecipeLine(recipe)}
              </p>
              <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
                {seconds(recipe.durationTicks, GAME_TICK_MS)} &middot;{" "}
                <XpAmount
                  amount={recipe.baseXp}
                  prefix="+"
                  skillId={SKILL_IDS.runeworking}
                  skillName="Runeworking"
                />{" "}
                &middot; Always succeeds
              </p>
            </div>
          </div>
          <ul className="space-y-1 text-sm" data-attune-inputs>
            {recipe.inputs.map((input) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
                data-attune-input={input.itemId}
                key={input.itemId}
              >
                <span className="text-[color:var(--rs-text-secondary)]">
                  Needs {input.quantity} {input.name} &middot; carrying {input.carried}
                </span>
                <ItemSourcesButton itemId={input.itemId} state={state} />
              </li>
            ))}
          </ul>
          {/* Run size only when a run can be made: with nothing to make, the missing
              materials below are the whole story. */}
          {recipe.unlocked && recipe.affordableCycles >= 1 ? (
            <BoundedRunSelector
              affordable={recipe.affordableCycles}
              disabled={foregroundBusy || Boolean(state.activeAction)}
              onChange={setSelection}
              selection={selection}
              summary={runeworkingRunSummary(recipe, selection)}
              unit={ATTUNEMENT_UNIT}
            />
          ) : null}
          {unmet.length > 0 ? (
            <p className="text-sm text-[color:var(--rs-text-muted)]" data-attune-unmet>
              {unmet.join(" · ")}
            </p>
          ) : null}
          <MissionActionButton
            data-attune-start
            disabled={!executable}
            guidance={executable && guidance.actionIds.has(recipe.actionId) ? "active" : undefined}
            loading={command.pending === "start"}
            onClick={() =>
              command.run("start", () =>
                startRuneworkingAction({
                  characterId,
                  recipeActionId: recipe.actionId,
                  quantity: selection,
                }),
              )
            }
          >
            Attune {recipe.outputName}
          </MissionActionButton>
          <p className="text-xs text-[color:var(--rs-text-muted)]">
            {runeworkingCommitmentNote(recipe)}
          </p>
        </div>
      ) : null}

      {stopReason ? (
        <Feedback
          tone={runeworkingStopIsExpected(stopReason, rig.run.selection) ? "muted" : "danger"}
        >
          <span data-rig-stop={stopReason}>{runeworkingStopMessage(stopReason, rig.run)}</span>
        </Feedback>
      ) : null}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
      <RuneworkingRunPanel run={rig.run} />
    </div>
  );
}

/**
 * The cycle on the Rig: the output's canonical visual, the recipe, the run's
 * progress, the live timer and Finish Current. Every number is the server's;
 * the timer presents the cycle's authoritative start and duration, and what
 * happens at its end is the server's call.
 */
function RigCyclePanel({
  busy,
  onFinishCurrent,
  pending,
  recipe,
  rig,
}: {
  busy: boolean;
  onFinishCurrent: () => void;
  pending?: string;
  recipe: RuneworkingRecipeProjection;
  rig: ResonanceRigProjection;
}) {
  const cycle = rig.cycle!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, []);
  const startsAt = new Date(cycle.startedAt).getTime();
  const endsAt = new Date(cycle.endsAt).getTime();
  const remainingMs = Math.max(0, endsAt - now);
  const run = rig.run;
  const lastOfRun = run.selection !== BOUNDED_RUN_MAX && cycle.sequence >= run.selection;

  return (
    <section
      aria-label="Attunement on the Rig"
      className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-rig-cycle
      data-rig-cycle-sequence={cycle.sequence}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="w-28 shrink-0">
          <StackItemVisual
            itemId={recipe.outputItemId}
            name={recipe.outputName}
            quantity={recipe.outputQuantity}
            stackLimit={recipe.outputStackLimit}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-display text-sm font-bold uppercase tracking-wide">
            {recipe.outputName}
          </p>
          <p className="text-xs text-[color:var(--rs-text-secondary)]">
            {runeworkingRecipeLine(recipe)}
          </p>
          <BoundedRunProgress
            completed={run.cycles}
            selection={run.selection}
            unit={ATTUNEMENT_UNIT}
          />
          <StatusMeter
            accentColor="var(--rs-skill-runeworking)"
            detail={remainingMs === 0 ? "Resolving" : `${(remainingMs / 1000).toFixed(1)}s`}
            label={`Attunement ${cycle.sequence}`}
            value={
              endsAt === startsAt
                ? 100
                : Math.min(100, ((now - startsAt) / (endsAt - startsAt)) * 100)
            }
          />
        </div>
      </div>

      {lastOfRun ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ActionButton
            aria-pressed={cycle.finishCurrent}
            data-rig-finish
            data-rig-finish-armed={String(cycle.finishCurrent)}
            disabled={cycle.finishCurrent || (busy && pending !== "finish")}
            intent={cycle.finishCurrent ? "success" : "secondary"}
            loading={pending === "finish"}
            onClick={onFinishCurrent}
          >
            {cycle.finishCurrent ? "Stopping After This Attunement" : "Stop After This Attunement"}
          </ActionButton>
        </div>
      )}
      {cycle.finishCurrent ? (
        <Feedback tone="muted">
          The run ends when this attunement finishes. Its piece still goes to your Inventory.
        </Feedback>
      ) : null}
    </section>
  );
}
