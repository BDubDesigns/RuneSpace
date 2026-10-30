import { GAME_TICK_MS } from "@/game/config/foundations";
import { BOUNDED_RUN_MAX, type BoundedRunSelection } from "@/game/domain/bounded-run";
import type { RuneworkingStopReason } from "@/game/domain/runeworking";
import { seconds } from "@/features/shared/duration-copy";
import type { RuneworkingCommandError } from "@/server/runeworking-commands";
import type { RuneworkingRecipeProjection } from "@/server/play";

/**
 * The Resonance Rig's player-facing copy (#391): refusals, stop reasons and the
 * selected run, in one place. Presentation only — every decision here was made
 * by the server; this only says it. A Runeworking cycle never fails, so nothing
 * here speaks of chance, failure or byproducts.
 */

/** One bounded-run unit at the Rig: one cycle that attunes one recipe batch. */
export const ATTUNEMENT_UNIT = { singular: "attunement", plural: "attunements" };

const plural = (count: number, singular: string, many: string) =>
  `${count} ${count === 1 ? singular : many}`;

export function runeworkingErrorMessage(
  error: RuneworkingCommandError,
  affordable: number | undefined,
): string {
  switch (error) {
    case "runeworking_unavailable_here":
      return "That recipe is attuned at a Resonance Rig: the Wise Old Enby's at Hilltop Workshop, or your own at the Crash Site.";
    case "runeworking_locked":
      return "That Resonance Rig is not open to you yet.";
    case "runeworking_unknown_recipe":
      return "The Rig does not know that recipe.";
    case "runeworking_recipe_locked":
      return "Your Runeworking level is too low for that recipe.";
    case "runeworking_insufficient_inputs":
      return "You are not carrying enough for one attunement.";
    case "runeworking_no_room":
      return "Make room for the finished piece before starting.";
    case "runeworking_quantity_unavailable":
      // Refused, never shortened (#229): the fresh count is already projected.
      return affordable && affordable > 0
        ? `Your materials cover ${plural(affordable, "attunement", "attunements")} right now. Choose a run size and start again.`
        : "You are not carrying enough for one attunement.";
  }
}

export function runeworkingStopMessage(
  reason: RuneworkingStopReason,
  run: { cycles: number },
): string {
  switch (reason) {
    case "access_denied":
      return "Workbench authorization changed. Speak to its owner before starting again.";
    case "run_completed":
      return `Run complete — ${plural(run.cycles, "attunement", "attunements")}.`;
    case "finished_current":
      return "Attunement finished. The Rig is clear.";
    case "insufficient_inputs":
      return "Out of materials for another attunement.";
    case "inventory_slots_full":
    case "carried_mass_capacity_reached":
      return "Stopped — make room for the next finished piece.";
    case "recipe_locked":
      return "Your Runeworking level is too low for that recipe.";
    case "run_safety_limit":
      return "Runeworking paused at the run safety limit. Start again to keep going.";
    case "manually_stopped":
      return "Runeworking was stopped.";
  }
}

/**
 * Whether a stop is simply how the chosen run ends (#229): a number completes,
 * Finish Current does what was asked, and Max runs until its materials are
 * spent. A capacity stop still asks the player to make room.
 */
export function runeworkingStopIsExpected(
  reason: RuneworkingStopReason,
  selection: BoundedRunSelection,
): boolean {
  if (reason === "run_completed" || reason === "finished_current") return true;
  return (
    selection === BOUNDED_RUN_MAX &&
    (reason === "insufficient_inputs" || reason === "run_safety_limit")
  );
}

/**
 * The selected run, before Start (#229). Runeworking is deterministic, so a
 * number totals exactly — inputs, outputs, time and XP. Max cannot know its
 * length, so it describes one attunement and says the run goes on until the
 * next one cannot begin.
 */
export function runeworkingRunSummary(
  recipe: RuneworkingRecipeProjection,
  selection: BoundedRunSelection,
): string {
  const perCycle = recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ");
  if (selection === BOUNDED_RUN_MAX) {
    return `Max · ${perCycle} per attunement · ${recipe.outputQuantity} ${recipe.outputName} and ${recipe.baseXp} Runeworking XP each · ${seconds(recipe.durationTicks, GAME_TICK_MS)} each · runs until the next attunement cannot begin`;
  }
  const inputs = recipe.inputs
    .map((input) => `${input.quantity * selection} ${input.name}`)
    .join(" + ");
  return `${plural(selection, "attunement", "attunements")} · ${inputs} → ${recipe.outputQuantity * selection} ${recipe.outputName} · ${seconds(recipe.durationTicks * selection, GAME_TICK_MS)} · ${recipe.baseXp * selection} Runeworking XP`;
}

/**
 * The binding-cycle rule, said for the selected recipe's own inputs (#441): a Rune
 * Fragment at Hilltop, a Cut Quartz and a Runestone at a personal Rig. Never names
 * an ingredient of a different recipe.
 */
export function runeworkingCommitmentNote(recipe: RuneworkingRecipeProjection): string {
  const names = recipe.inputs.map((input) => input.name);
  const reserved =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  return `A started attunement is committed: its ${reserved} stay${names.length > 1 ? "" : "s"} reserved in your Inventory until it finishes, and you cannot leave the Rig while it is running. Finished pieces go straight to your Inventory.`;
}

/**
 * Whether Start can actually run this recipe right now (#441). One rule for the
 * button's enabled state AND its Mission halo, so a control that cannot run is never
 * lit as the next step: level, materials for one cycle, no other activity, no command
 * in flight.
 */
export function runeworkingCanStart(
  recipe: Pick<RuneworkingRecipeProjection, "unlocked" | "affordableCycles">,
  context: { activityRunning: boolean; foregroundBusy: boolean },
): boolean {
  return (
    recipe.unlocked &&
    recipe.affordableCycles >= 1 &&
    !context.activityRunning &&
    !context.foregroundBusy
  );
}

/** The Wiki article that lists every Runeworking recipe and where each is made. */
export const RUNEWORKING_WIKI_PATH = "/wiki/runeworking";

/** A recipe as one line, e.g. "1 Rune Fragment → 1 Beginner Echo Seeker". */
export function runeworkingRecipeLine(recipe: RuneworkingRecipeProjection): string {
  return `${recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ")} → ${recipe.outputQuantity} ${recipe.outputName}`;
}

/** What still stands between the character and one attunement of a recipe. */
export function runeworkingUnmetRequirements(
  recipe: RuneworkingRecipeProjection,
  level: number,
): string[] {
  const unmet: string[] = [];
  if (!recipe.unlocked)
    unmet.push(`Requires Runeworking ${recipe.minimumLevel} (you are ${level})`);
  for (const input of recipe.inputs) {
    if (input.carried < input.quantity) {
      unmet.push(`Need ${input.quantity - input.carried} more ${input.name}`);
    }
  }
  return unmet;
}

/**
 * The Rig's result beat (#391): what a run newly completed since the surface
 * last looked, from the authoritative run counters. However many cycles
 * resolved before the client looked — one live, or a whole Max run offline —
 * they arrive as one aggregated line.
 */
export function runeworkingResultLine(input: {
  cycles: number;
  outputs: Readonly<Record<string, number>>;
  xp: number;
  nameOf: (itemId: string) => string;
}): { headline: string; details: string } | undefined {
  if (input.cycles <= 0) return undefined;
  const made = Object.entries(input.outputs)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => {
      const name = input.nameOf(itemId);
      return `${quantity > 1 ? `${quantity} × ${name}` : name} attuned`;
    });
  return {
    headline: made.length > 0 ? made.join(" · ") : "Attunement complete",
    details: `+${input.xp} Runeworking XP`,
  };
}
