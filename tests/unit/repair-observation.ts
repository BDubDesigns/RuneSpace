import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { REPAIR_TARGET_IDS, type RepairTargetId } from "@/game/config/foundations";
import { REPAIR_TARGETS } from "@/game/content/repair-targets";
import type { RepairTargetObservation } from "@/game/domain/missions";

/**
 * The repair half of a MissionObservation, built the way the server builds it
 * (#172): the authored recipe from balance, the progress from durable state.
 *
 * Tests name only what they care about — "the Cargo Hold is finished", "ten of
 * the twenty are installed" — and every other target reports its honest zero.
 */
export type RepairProgressInput = {
  complete?: boolean;
  /** Installed quantity per item ID; anything unnamed reports its honest zero. */
  materials?: Readonly<Record<string, number>>;
  welded?: number;
};

export function repairObservation(
  progress: Partial<Record<RepairTargetId, RepairProgressInput>> = {},
): ReadonlyMap<string, RepairTargetObservation> {
  const balance = getEffectiveGameBalance();
  return new Map(
    REPAIR_TARGETS.map((target) => {
      const recipe = getRepairTargetBalance(target.id, balance);
      const state = progress[target.id as RepairTargetId] ?? {};
      const complete = state.complete ?? false;
      return [
        target.id,
        {
          complete,
          // Every material the recipe authors, in recipe order (#209): a
          // finished repair has all of them installed, and a partial one has
          // whatever the caller named.
          materials: recipe.materials.map((requirement) => ({
            itemId: requirement.itemId,
            contributed: complete
              ? requirement.quantity
              : (state.materials?.[requirement.itemId] ?? 0),
            required: requirement.quantity,
          })),
          welding: {
            completed: complete ? recipe.repairIncrements : (state.welded ?? 0),
            required: recipe.repairIncrements,
          },
        } satisfies RepairTargetObservation,
      ];
    }),
  );
}

/** The common case: everything Hold It Together needs is already done. */
export function cargoRepaired() {
  return repairObservation({ [REPAIR_TARGET_IDS.cargoHold]: { complete: true } });
}
