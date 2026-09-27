import { BOUNDED_RUN_MAX, type BoundedRunSelection } from "@/game/domain/bounded-run";
import type { FabricationStopReason } from "@/game/domain/fabrication";
import type { TinkeringStopReason } from "@/game/domain/tinkering";
import type { FabricationCommandError } from "@/server/fabrication-commands";
import type { TinkeringCommandError } from "@/server/tinkering-commands";
import type { FabricationRecipeProjection } from "@/server/play";
import { GAME_TICK_MS } from "@/game/config/foundations";

/**
 * The Fabrication Station's player-facing copy (#232): refusals and stop
 * reasons, one place for both modes. Presentation only — every decision here
 * was made by the server; this only says it.
 */

export const BATCH_UNIT = { singular: "batch", plural: "batches" };

const plural = (count: number, singular: string, many: string) =>
  `${count} ${count === 1 ? singular : many}`;

export function fabricationErrorMessage(
  error: FabricationCommandError,
  affordable: number | undefined,
): string {
  switch (error) {
    case "fabrication_unavailable_here":
      return "The Fabrication Station is at Rusk Recovery.";
    case "fabrication_locked":
      return "Tansy has not put you on the Fabrication Station yet.";
    case "fabrication_unknown_recipe":
      return "That recipe is not on the station.";
    case "fabrication_recipe_locked":
      return "Your Fabrication level is too low for that recipe.";
    case "fabrication_insufficient_inputs":
      return "You are not carrying enough for one batch.";
    case "fabrication_no_room":
      return "Make room for the finished piece before starting.";
    case "fabrication_quantity_unavailable":
      // Refused, never shortened (#229): the fresh count is already projected.
      return affordable && affordable > 0
        ? `Your materials cover ${plural(affordable, "batch", "batches")} right now. Choose a run size and start again.`
        : "You are not carrying enough for one batch.";
    case "fabrication_not_active":
      return "There is no workpiece on the machine.";
    case "fabrication_override_unavailable":
      return "Manual Override cannot be pushed on this workpiece.";
    case "fabrication_stale_push":
      return "The machine had already moved on. Check it and try again.";
  }
}

export function fabricationStopMessage(
  reason: FabricationStopReason,
  run: { batches: number },
): string {
  switch (reason) {
    case "run_completed":
      return `Run complete — ${plural(run.batches, "workpiece", "workpieces")}.`;
    case "finished_current":
      return "Workpiece finished. The station is clear.";
    case "insufficient_inputs":
      return "Out of materials for another batch.";
    case "inventory_slots_full":
    case "carried_mass_capacity_reached":
      return "Stopped — make room for the next finished piece.";
    case "recipe_locked":
      return "Your Fabrication level is too low for that recipe.";
    case "run_safety_limit":
      return "Fabrication paused at the run safety limit. Start again to keep going.";
    case "manually_stopped":
      return "Fabrication was stopped.";
  }
}

/**
 * Whether a stop is simply how the chosen run ends (#229): a number completes,
 * Finish Current does what was asked, and Max runs until its materials are
 * spent. A capacity stop still asks the player to make room.
 */
export function fabricationStopIsExpected(
  reason: FabricationStopReason,
  selection: BoundedRunSelection,
): boolean {
  if (reason === "run_completed" || reason === "finished_current") return true;
  return (
    selection === BOUNDED_RUN_MAX &&
    (reason === "insufficient_inputs" || reason === "run_safety_limit")
  );
}

export function tinkeringErrorMessage(
  error: TinkeringCommandError,
  affordable: number | undefined,
): string {
  switch (error) {
    case "tinkering_unavailable_here":
      return "Tinkering happens at the Fabrication Station at Rusk Recovery.";
    case "tinkering_locked":
      return "Tansy has not shown you Tinkering yet.";
    case "tinkering_unknown_target":
      return "That cannot be Tinkered.";
    case "tinkering_recipe_locked":
      return "Your Fabrication level is too low to Tinker that.";
    case "tinkering_no_items":
      return "You are not carrying a complete batch of that.";
    case "tinkering_last_cutter":
      return "That would leave you without a Mining Cutter. Make or get another Cutter first.";
    case "tinkering_no_room":
      return "Make room for the Scrap, or turn on Auto-discard Scrap.";
    case "tinkering_quantity_unavailable":
      return affordable && affordable > 0
        ? `You can Tinker ${plural(affordable, "batch", "batches")} of that right now. Choose a run size and start again.`
        : "You are not carrying a complete batch of that.";
    case "tinkering_resume_pending":
      return "Finish the item already on the station first.";
    case "tinkering_nothing_to_finish":
      return "Nothing is on the station to finish.";
  }
}

export function tinkeringStopMessage(
  reason: TinkeringStopReason,
  run: { batches: number },
): string {
  switch (reason) {
    case "run_completed":
      return `Run complete — ${plural(run.batches, "batch", "batches")} Tinkered.`;
    case "finished_current_item":
      return "Item finished. The station is clear.";
    case "no_eligible_items":
      return "Nothing left to Tinker in that batch size.";
    case "last_cutter":
      return "Stopped before your last Mining Cutter.";
    case "no_room_for_scrap":
      return "Stopped — make room for the Scrap, or turn on Auto-discard Scrap.";
    case "recipe_locked":
      return "Your Fabrication level is too low to Tinker that.";
    case "run_safety_limit":
      return "Tinkering paused at the run safety limit. Start again to keep going.";
  }
}

export function tinkeringStopIsExpected(
  reason: TinkeringStopReason,
  selection: BoundedRunSelection,
): boolean {
  if (reason === "run_completed" || reason === "finished_current_item") return true;
  return (
    selection === BOUNDED_RUN_MAX &&
    (reason === "no_eligible_items" || reason === "last_cutter" || reason === "run_safety_limit")
  );
}

/**
 * The station's one duration format: "7.2 sec", never a bare "s". The space is
 * non-breaking so a narrow tile never strands the unit on a line of its own.
 */
export function seconds(ticks: number, tickMs: number): string {
  const value = (ticks * tickMs) / 1000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}\u00a0sec`;
}

/**
 * The selected run, before Start (#229, #232). Tier-1 Fabrication is
 * deterministic without Override, so a number totals exactly — inputs,
 * outputs, base time, base XP at 1.00×. Max cannot know its length, so it
 * describes one batch and says the run goes on until the next one cannot
 * begin. Manual Override is folded into neither.
 */
export function fabricationRunSummary(
  recipe: FabricationRecipeProjection,
  selection: BoundedRunSelection,
): string {
  const perBatch = recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ");
  if (selection === BOUNDED_RUN_MAX) {
    return `Max · ${perBatch} per batch · ${recipe.outputQuantity} ${recipe.outputName} and ${recipe.baseXp} Fabrication XP each · ${seconds(recipe.durationTicks, GAME_TICK_MS)} each · runs until the next workpiece cannot begin`;
  }
  const inputs = recipe.inputs
    .map((input) => `${input.quantity * selection} ${input.name}`)
    .join(" + ");
  return `${selection} ${selection === 1 ? "batch" : "batches"} · ${inputs} → ${recipe.outputQuantity * selection} ${recipe.outputName} · ${seconds(recipe.durationTicks * selection, GAME_TICK_MS)} · ${recipe.baseXp * selection} base Fabrication XP`;
}

/** A recipe as one line, e.g. "2 Refined Ferrite → 1 Mounting Bracket". */
export function recipeLine(recipe: FabricationRecipeProjection): string {
  return `${recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ")} → ${recipe.outputQuantity} ${recipe.outputName}`;
}

/** What still stands between the character and one batch of a recipe. */
export function unmetRequirements(recipe: FabricationRecipeProjection, level: number): string[] {
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
