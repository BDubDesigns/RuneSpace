import type { WorkOrderId } from "@/game/config/foundations";
import type { ActiveWorkOrderState } from "@/game/domain/work-orders";
import type { PracticeWeldState } from "@/game/domain/practice-welding";

/**
 * Wade's Workbench holds one unfinished piece of work at a time (#207).
 *
 * There is one bench in the yard, and once customer property can be on it the
 * question "is anything already on it?" has to have exactly one answer. This
 * module derives that answer from the durable state the two kinds of work
 * already keep, rather than introducing a `practiceBusy` / `workOrderBusy` pair
 * that could disagree with each other — or with the rows.
 *
 * Occupancy is about unfinished WORK, not about a running timer. A Practice
 * weld the player stopped halfway through still occupies the bench: its two
 * Scrap are spent, its sections are real, and starting a customer job over the
 * top of it would silently destroy work the player paid for. That is exactly
 * what "Finish Current Weld and Stop" exists to resolve without costing them
 * another recipe.
 */

export type WorkbenchOccupancy =
  | { kind: "clear" }
  | { kind: "practice" }
  | { kind: "work_order"; workOrderId: WorkOrderId };

export type WorkbenchObservation = {
  practice: PracticeWeldState;
  activeWorkOrder: ActiveWorkOrderState | undefined;
};

/**
 * What currently occupies the bench.
 *
 * An accepted Work Order wins when both somehow read as present, because an
 * accepted job is a customer's property and a paid commitment — but the two are
 * mutually exclusive by construction, since neither can be started while the
 * other holds the bench.
 */
export function deriveWorkbenchOccupancy(observation: WorkbenchObservation): WorkbenchOccupancy {
  if (observation.activeWorkOrder) {
    return { kind: "work_order", workOrderId: observation.activeWorkOrder.workOrderId };
  }
  // `cycleActive` is "this weld's Scrap is already spent", which is precisely
  // the condition under which a weld is unfinished rather than absent.
  if (observation.practice.cycleActive) return { kind: "practice" };
  return { kind: "clear" };
}

/**
 * Whether a NEW unit of work may claim the bench.
 *
 * Deliberately one question for both kinds, with no "which kind" parameter: a
 * second Practice weld over an unfinished one is refused for exactly the reason
 * a Work Order over an unfinished Practice weld is, so letting a caller name
 * its kind would only invite the two cases to drift apart.
 *
 * Resuming what is already there is a different question and is not asked here:
 * Resume never claims the bench, because the unit it continues already holds
 * it.
 */
export function workbenchIsClear(observation: WorkbenchObservation): boolean {
  return deriveWorkbenchOccupancy(observation).kind === "clear";
}

/** Player-readable refusal copy for a bench that is already occupied. */
export function workbenchOccupiedMessage(occupancy: WorkbenchOccupancy): string | undefined {
  if (occupancy.kind === "clear") return undefined;
  return occupancy.kind === "practice"
    ? "The Workbench still has an unfinished practice weld on it. Finish it before taking client work."
    : "The Workbench already has a client job on it. Finish it before starting anything else.";
}
