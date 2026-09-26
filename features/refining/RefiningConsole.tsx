"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { RefiningRunPanel } from "@/features/refining/RefiningRunPanel";
import { BoundedRunProgress, BoundedRunSelector } from "@/features/shared/BoundedRunControl";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  BOUNDED_RUN_MAX,
  type BoundedRunSelection,
} from "@/game/domain/bounded-run";
import { ItemVisual } from "@/components/items/ItemVisual";
import { VisualTile } from "@/components/items/VisualTile";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { refiningActionIds } from "@/game/config/balance";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { describeFailureOutcome, describeQuantities } from "@/features/refining/attempt-copy";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import type { RefiningRunAttempt } from "@/server/refining";
import type { RefiningRecipeProjection } from "@/server/play";
import { refreshPlayAction, startRefiningAction, stopRefiningAction } from "@/server/actions";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { usePlay } from "@/features/play/PlayContext";

const RESULT_FEEDBACK_DURATION_MS = 3_600;

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

const BATCH_UNIT = { singular: "batch", plural: "batches" };

function refiningStopMessage(
  reason: Extract<import("@/server/play").ActivityStop, { activity: "refining" }>["reason"],
  recipe: RefiningRecipeProjection | undefined,
  run?: { attempts: number },
): string {
  if (reason === "run_completed") {
    const attempted = run?.attempts ?? 0;
    return `Run complete — ${attempted} ${attempted === 1 ? "batch" : "batches"} attempted.`;
  }
  // A Max run's internal guard, not its materials, ended it (#229). Real
  // inventories never get here; if one does, say so plainly.
  if (reason === "run_safety_limit") {
    return "Refining paused at the run safety limit. Start again to keep going.";
  }
  // The authoritative reason says the inputs ran out; the recipe says which
  // ones and how many, so the copy is right for all three recipes (#209).
  const inputs = recipe
    ? recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ")
    : "the required inputs";
  return (
    (
      {
        manually_stopped: "Refining stopped.",
        insufficient_inputs: `Not enough material \u2014 each attempt requires ${inputs}.`,
        inventory_slots_full:
          "Processing stopped \u2014 make room for the resulting material before refining more.",
        carried_mass_capacity_reached:
          "Processing stopped \u2014 make room for the resulting material before refining more.",
        action_replaced: "Refining stopped when Travel began.",
      } as Record<string, string>
    )[reason] ?? `Refining stopped: ${reason}.`
  );
}

/**
 * Whether a stop is simply how the chosen run ends, rather than a problem to
 * act on (#229). A number ends by completing. Max runs until blocked, so
 * spending the last of its material is its ordinary ending too; a capacity
 * stop still asks the player to make room, so it stays a warning.
 */
function refiningStopIsExpected(
  reason: Extract<import("@/server/play").ActivityStop, { activity: "refining" }>["reason"],
  selection: BoundedRunSelection,
): boolean {
  if (reason === "run_completed") return true;
  return (
    selection === BOUNDED_RUN_MAX &&
    (reason === "insufficient_inputs" || reason === "run_safety_limit")
  );
}

/** The item's authoritative display name, by its stable ID. */
function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

function refiningCommandErrorMessage(error: string): string {
  return (
    (
      {
        another_action_active: "Another activity is active. Refining cannot change it.",
      } as Record<string, string>
    )[error] ?? error
  );
}

function refiningErrorMessage(error: string, recipe?: RefiningRecipeProjection): string {
  if (error === "refining_quantity_unavailable") {
    // Refused, never shortened (#229): the fresh affordable count is already
    // in the projection, so the player can choose again from it.
    const affordable = recipe?.affordableBatches ?? 0;
    return affordable > 0
      ? `Your materials cover ${affordable} ${affordable === 1 ? "batch" : "batches"} right now. Choose a run size and start again.`
      : "Nothing can be refined right now.";
  }
  return (
    (
      {
        refining_unavailable_here:
          "Ferrite refining is only available at the Abandoned Processing Yard.",
      } as Record<string, string>
    )[error] ?? error
  );
}

/**
 * The selected run, before Start, from the recipe's per-batch facts (#229).
 *
 * Only a deterministic recipe with a number can honestly total its run. A
 * rolled recipe's failures can hand material back, and a Max run lasts until
 * it is blocked, so both describe one batch and leave the total to the run.
 */
function refiningRunSummary(
  recipe: RefiningRecipeProjection,
  selection: BoundedRunSelection,
): string {
  const perBatchInputs = recipe.inputs
    .map((input) => `${input.quantity} ${input.name}`)
    .join(" + ");
  const perBatchSeconds = (recipe.attemptDurationTicks * GAME_TICK_MS) / 1000;
  if (selection === BOUNDED_RUN_MAX) {
    return `Max · ${perBatchInputs} per batch · ${perBatchSeconds.toFixed(1)}s each · runs until materials or space run out`;
  }
  const batches = `${selection} ${selection === 1 ? "batch" : "batches"}`;
  if (!recipe.deterministic) {
    return `${batches} · ${perBatchInputs} per batch · ${perBatchSeconds.toFixed(1)}s each`;
  }
  const inputs = recipe.inputs
    .map((input) => `${input.quantity * selection} ${input.name}`)
    .join(" + ");
  return `${batches} · ${inputs} · ${(perBatchSeconds * selection).toFixed(1)}s · ${
    recipe.outputQuantity * selection
  } ${recipe.outputName} · ${recipe.successXp * selection} Refining XP`;
}

function latestRefiningAttempt(
  attempts: readonly RefiningRunAttempt[],
): RefiningRunAttempt | undefined {
  return attempts.at(-1);
}

function latestAnnouncement(attempt: RefiningRunAttempt, batch: number): string {
  const catchUp = batch > 1 ? `${batch} attempts resolved while away. ` : "";
  if (attempt.deterministic) {
    return `${catchUp}${describeQuantities(attempt.awarded, ", ")} produced. ${attempt.xpAwarded} Refining XP earned.`;
  }
  const roll = `Roll ${percentage(attempt.rolledBasisPoints)}. Needed below ${percentage(attempt.thresholdBasisPoints)}.`;
  // A failure is not always Slag: Galvaferrite hands one input back instead
  // (#209), so the announcement reads the attempt's own consumed and awarded
  // lists rather than assuming either verb.
  return attempt.success
    ? `${catchUp}${describeQuantities(attempt.awarded, ", ")} produced. ${roll} ${attempt.xpAwarded} Refining XP earned.`
    : `${catchUp}Attempt failed, ${describeFailureOutcome(attempt)}. ${roll} ${attempt.xpAwarded} Refining XP earned.`;
}

export function RefiningConsole() {
  const {
    acquireCommand,
    enqueueForeground,
    foregroundBusy,
    releaseCommand,
    setRefreshCallback,
    acceptState,
    state,
  } = usePlay();
  const refining = state.refining;
  const refiningRun = state.refiningRun;
  // The recipe the player has chosen. It defaults to whatever is already
  // running, so a refresh mid-run lands back on the right recipe; otherwise it
  // is the first authored one, and the authored order puts Refined Ferrite —
  // the only recipe a new character can work — first.
  const [selectedActionId, setSelectedActionId] = useState<string | undefined>();
  // The run's selection (#229): always starts at one, and resets to one
  // whenever the recipe changes, because a count means batches OF a recipe.
  const [selection, setSelection] = useState<BoundedRunSelection>(BOUNDED_RUN_DEFAULT_QUANTITY);
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();
  const [recovery, setRecovery] = useState<(() => void) | undefined>();
  const [pendingCommand, setPendingCommand] = useState<"start" | "stop" | "refresh">();
  const observedAttempts = useRef(refiningRun.attempts);
  const observedSequence = useRef(latestRefiningAttempt(refiningRun.recentAttempts)?.sequence);
  const [feedback, setFeedback] = useState<{ sequence: number; attempts: number }>();
  const recipes = state.refiningRecipes;
  const active =
    state.activeAction && refiningActionIds().includes(state.activeAction.actionId)
      ? state.activeAction
      : undefined;
  const activeRecipe = recipes.find((recipe) => recipe.actionId === active?.actionId);
  const recipe =
    activeRecipe ??
    recipes.find((candidate) => candidate.actionId === selectedActionId) ??
    recipes[0];
  const [message, setMessage] = useState<string | undefined>(
    state.stop?.activity === "refining"
      ? refiningStopMessage(state.stop.reason, recipe, refiningRun)
      : undefined,
  );
  // Mission guidance consumes the ONE derived target set: a Refining mission
  // authors `recommendedActionId` naming one recipe's action, and only that
  // recipe's Start receives the treatment — no mission-ID branching.
  const missionGuidanceTargets = deriveMissionGuidanceTargets(state.missions);
  const startRefiningGuided =
    !active && recipe !== undefined && missionGuidanceTargets.actionIds.has(recipe.actionId);
  const durationTicks = active?.nextAttemptDurationTicks ?? recipe?.attemptDurationTicks ?? 0;
  const durationMs = durationTicks * GAME_TICK_MS;
  const elapsed = active ? Math.max(0, now - new Date(active.progressStartedAt).getTime()) : 0;
  const progress = active ? Math.min(100, (elapsed / durationMs) * 100) : 0;
  const secondsRemaining = active
    ? Math.max(0, (new Date(active.nextAttemptAt).getTime() - now) / 1_000)
    : 0;

  function apply(result: Awaited<ReturnType<typeof refreshPlayAction>>) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.state) {
      acceptState(result.state);
      const next = result.state;
      const nextRecipe = next.refiningRecipes.find(
        (candidate) => candidate.actionId === recipe?.actionId,
      );
      if (next.refiningError) setMessage(refiningErrorMessage(next.refiningError, nextRecipe));
      else if (next.commandError) setMessage(refiningCommandErrorMessage(next.commandError));
      else if (next.stop?.activity === "refining")
        setMessage(refiningStopMessage(next.stop.reason, recipe, next.refiningRun));
      else setMessage(undefined);
    }
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

  function executeCommand(action: (id: string) => ReturnType<typeof refreshPlayAction>) {
    setRecovery(undefined);
    startTransition(async () => {
      try {
        apply(await action(state.characterId));
      } catch (error) {
        reportClientDiagnostic("mining-command", error, { miningActive: Boolean(active) });
        setMessage("Comms interruption. Refining status could not be confirmed.");
        setRecovery(() => () => command(refreshPlayAction));
      } finally {
        releaseCommand();
        setPendingCommand(undefined);
      }
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
    if (!active) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, [Boolean(active)]);

  const latestAttempt = latestRefiningAttempt(refiningRun.recentAttempts);
  const recentBatchCount =
    state.refiningRecentResult.successes + state.refiningRecentResult.failures;

  useEffect(() => {
    const prevAttempts = observedAttempts.current;
    const prevSeq = observedSequence.current;
    observedAttempts.current = refiningRun.attempts;
    observedSequence.current = latestAttempt?.sequence;
    if (
      !latestAttempt ||
      refiningRun.attempts <= prevAttempts ||
      latestAttempt.sequence === prevSeq
    )
      return;
    const nextFeedback = {
      sequence: latestAttempt.sequence,
      attempts: Math.max(0, refiningRun.attempts - prevAttempts),
    };
    setFeedback(nextFeedback);
    const t = window.setTimeout(() => setFeedback(undefined), RESULT_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [latestAttempt?.sequence, refiningRun.attempts]);

  const isActive = Boolean(active);

  // Every new selection starts at one (#229): once a run is under way the
  // selector is hidden, and when it next appears it is for a fresh run.
  useEffect(() => {
    if (isActive) setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
  }, [isActive]);

  return (
    <ActivityPanel title="Refining" data-refining-activity>
      {/* The run (#229): choose how many batches to attempt, or Max to run
          until blocked, before Start; then follow the run through them. The
          affordable count and the running counts are both the server's;
          nothing here computes either or predicts how long Max will run. */}
      {isActive ? (
        <BoundedRunProgress
          completed={refiningRun.attempts}
          selection={refiningRun.selection}
          unit={BATCH_UNIT}
        />
      ) : recipe?.unlocked ? (
        <BoundedRunSelector
          affordable={recipe.affordableBatches}
          disabled={foregroundBusy || Boolean(state.activeAction)}
          onChange={setSelection}
          selection={selection}
          summary={refiningRunSummary(recipe, selection)}
          unit={BATCH_UNIT}
        />
      ) : null}
      <div className="flex flex-wrap gap-3">
        {isActive || pendingCommand === "stop" ? (
          <ActionButton
            intent="danger"
            loading={foregroundBusy && pendingCommand === "stop"}
            onClick={() => runForeground("stop", stopRefiningAction)}
          >
            Stop Refining
          </ActionButton>
        ) : (
          <MissionActionButton
            disabled={!recipe?.unlocked}
            guidance={startRefiningGuided ? "active" : undefined}
            intent="mining"
            loading={foregroundBusy && pendingCommand === "start"}
            onClick={() =>
              runForeground("start", (characterId) =>
                startRefiningAction({
                  characterId,
                  recipeActionId: recipe?.actionId,
                  quantity: selection,
                }),
              )
            }
          >
            Start Refining
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
      {/* Every authored recipe, locked ones included (#209): a player at
          Refining 1 can see that Galvanic Stock and Galvaferrite exist and what
          they will cost, which is the whole reason the locked rows render at
          all. Selection is disabled while a run is active, because changing the
          recipe mid-run is a stop, not a toggle. */}
      <div className="grid gap-2 sm:grid-cols-2" data-refining-recipes>
        {recipes.map((candidate) => {
          const chosen = candidate.actionId === recipe?.actionId;
          return (
            <button
              aria-pressed={chosen}
              className={`border p-3 text-left ${
                chosen
                  ? "border-[color:var(--rs-accent-arcane)] bg-[color:var(--rs-surface-panel)]"
                  : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)]"
              } ${candidate.unlocked ? "" : "opacity-60"}`}
              data-refining-recipe={candidate.actionId}
              data-refining-recipe-locked={candidate.unlocked ? "false" : "true"}
              disabled={Boolean(active) || !candidate.unlocked}
              key={candidate.actionId}
              onClick={() => {
                if (candidate.actionId !== recipe?.actionId)
                  setSelection(BOUNDED_RUN_DEFAULT_QUANTITY);
                setSelectedActionId(candidate.actionId);
              }}
              type="button"
            >
              <p className="font-display text-sm uppercase tracking-wide">
                {candidate.outputQuantity} {candidate.outputName}
              </p>
              <p className="mt-1 text-xs text-[color:var(--rs-text-secondary)]">
                {describeQuantities(candidate.inputs)} &rarr; {candidate.outputQuantity}{" "}
                {candidate.outputName}
              </p>
              {candidate.unlocked ? (
                <p className="mt-1 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                  {candidate.attemptDurationTicks} ticks /{" "}
                  {(candidate.attemptDurationTicks * GAME_TICK_MS) / 1000}s &middot;{" "}
                  {candidate.deterministic
                    ? "Certain"
                    : `${percentage(candidate.successChanceBps)}%`}{" "}
                  &middot; +{candidate.successXp} XP
                </p>
              ) : (
                <p className="mt-1 font-display text-xs uppercase tracking-wide text-[color:var(--rs-accent-danger)]">
                  Requires Refining {candidate.minimumLevel}
                </p>
              )}
            </button>
          );
        })}
      </div>
      {recipe ? (
        <>
          <p className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-arcane)]">
            {recipe.deterministic
              ? "Deterministic: every batch succeeds"
              : `Success chance: ${percentage(recipe.successChanceBps)}%`}
          </p>
          <p className="!mt-2 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            {recipe.attemptDurationTicks} ticks /{" "}
            {(recipe.attemptDurationTicks * GAME_TICK_MS) / 1000}s per attempt &middot;{" "}
            {describeQuantities(recipe.inputs)} &rarr; {recipe.outputQuantity} {recipe.outputName}
          </p>
        </>
      ) : null}
      {isActive ? (
        <div>
          <StatusMeter
            label="Refining attempt"
            value={progress}
            detail={`${secondsRemaining.toFixed(1)}s to next attempt`}
          />
        </div>
      ) : (
        <Feedback>
          Refining is idle. Each {recipe?.outputName ?? "attempt"} attempt takes{" "}
          {recipe?.attemptDurationTicks ?? 0} ticks /{" "}
          {((recipe?.attemptDurationTicks ?? 0) * GAME_TICK_MS) / 1000} seconds and resolves on the
          server.
        </Feedback>
      )}
      {latestAttempt ? (
        <section
          aria-label="Latest refining attempt"
          className={`border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3 ${feedback?.sequence === latestAttempt.sequence ? (latestAttempt.success ? "rs-result-feedback-success" : "rs-result-feedback-danger") : ""}`}
          data-feedback-state={feedback?.sequence === latestAttempt.sequence ? "new" : "calm"}
          data-result-outcome={latestAttempt.success ? "success" : "failed"}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-display text-sm uppercase tracking-wide">
              Latest attempt: {describeQuantities(latestAttempt.awarded, ", ")}
            </p>
            {feedback?.sequence === latestAttempt.sequence && feedback.attempts > 1 ? (
              <p className="text-xs text-[color:var(--rs-text-secondary)]">
                {feedback.attempts} attempts resolved while away
              </p>
            ) : null}
          </div>
          {latestAttempt.deterministic ? null : (
            <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
              Roll {percentage(latestAttempt.rolledBasisPoints)} | Needed below{" "}
              {percentage(latestAttempt.thresholdBasisPoints)}
            </p>
          )}
          <p className="mt-2 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            {latestAttempt.durationTicks} ticks &middot;{" "}
            {describeQuantities(latestAttempt.consumed, ", ")} consumed
          </p>
          {/* One tile per awarded item, from the attempt's own awards: a
              Galvaferrite failure hands back one input rather than producing
              Slag, so nothing here may assume which item appears (#209). */}
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-2 sm:grid-cols-3">
            {latestAttempt.awarded.map((award) => (
              <ItemVisual
                accessibleLabel={`${award.quantity} ${itemName(award.itemId)} produced`}
                className={
                  feedback?.sequence === latestAttempt.sequence ? "rs-reward-feedback" : ""
                }
                itemId={award.itemId}
                key={award.itemId}
                name={itemName(award.itemId)}
                quantity={award.quantity}
              />
            ))}
            <VisualTile
              accessibleLabel={`${latestAttempt.xpAwarded} Refining XP earned`}
              badge={`+${latestAttempt.xpAwarded}`}
              className={
                feedback?.sequence === latestAttempt.sequence
                  ? "rs-reward-feedback [animation-delay:90ms]"
                  : ""
              }
              fallbackText="XP"
              name="Refining"
            />
          </div>
        </section>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {feedback && latestAttempt && feedback.sequence === latestAttempt.sequence
          ? latestAnnouncement(latestAttempt, feedback.attempts)
          : ""}
      </p>
      {message ? (
        <Feedback
          tone={
            state.stop?.activity === "refining" &&
            !active &&
            !refiningStopIsExpected(state.stop.reason, refiningRun.selection)
              ? "danger"
              : "muted"
          }
        >
          {message}
        </Feedback>
      ) : null}
      {recovery ? (
        <ActionButton disabled={foregroundBusy} intent="secondary" onClick={recovery}>
          Retry status check
        </ActionButton>
      ) : null}
      {/* The selected recipe's own inputs and output: Refining stops on carried
          capacity as readily as it stops on running out of input, and which
          material that is depends on the recipe. */}
      <SkillProgressRow
        level={refining.level}
        skill="Refining"
        tone="refining"
        xpIntoLevel={refining.xpIntoLevel}
        {...(refining.xpToNextLevel === undefined ? {} : { xpToNextLevel: refining.xpToNextLevel })}
      />
      <ActivityContextRow
        carry={{
          slotsUsed: state.inventory.slotsUsed,
          slotsAvailable: state.inventory.slotsAvailable,
          massGrams: state.inventory.massGrams,
          capacityGrams: state.inventory.capacityGrams,
        }}
        items={
          recipe
            ? [
                ...recipe.inputs.map((input) => ({
                  label: input.name,
                  quantity: input.carried,
                })),
                {
                  label: recipe.outputName,
                  quantity: state.carriedByItemId[recipe.outputItemId] ?? 0,
                },
              ]
            : []
        }
      />
      <RefiningRunPanel run={refiningRun} />
    </ActivityPanel>
  );
}
