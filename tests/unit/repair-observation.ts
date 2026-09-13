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
export function repairObservation(
  progress: Partial<
    Record<RepairTargetId, { complete?: boolean; contributed?: number; welded?: number }>
  > = {},
): ReadonlyMap<string, RepairTargetObservation> {
  const balance = getEffectiveGameBalance();
  return new Map(
    REPAIR_TARGETS.map((target) => {
      const recipe = getRepairTargetBalance(target.id, balance);
      const state = progress[target.id as RepairTargetId] ?? {};
      const complete = state.complete ?? false;
      const contributed = complete ? recipe.refinedFerriteRequired : (state.contributed ?? 0);
      return [
        target.id,
        {
          complete,
          materials: [
            {
              itemId: balance.items.refinedFerrite.itemId,
              contributed,
              required: recipe.refinedFerriteRequired,
            },
            {
              itemId: balance.items.slag.itemId,
              contributed: complete ? recipe.slagRequired : 0,
              required: recipe.slagRequired,
            },
          ].filter((material) => material.required > 0),
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
