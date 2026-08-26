"use client";

import { Panel } from "@/components/ui/Panel";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { COLLAPSE_KEYS, useSyncedCollapse } from "./use-synced-collapse";
import { CollapseButton } from "./CollapseButton";
import { formatMassGrams } from "@/game/domain/mass";
import type { MiningGameplayState } from "@/server/mining";

export type CargoReadoutItem = {
  /** Item display name, e.g. "Ferrite Shale". */
  label: string;
  quantity: number;
};

/**
 * Shared cargo readout used at every location with a resource output.
 *
 * At the Crash Site it shows Ferrite Shale (one column); at the Processing
 * Yard it shows Refined Ferrite + Slag (two columns, wrapping to a row below
 * on narrow screens). Inventory slots + carried mass always render beneath.
 *
 * Collapse state is synced across all locations via localStorage — collapsing
 * the readout at the Yard collapses it at the Crash Site and vice versa.
 */
export function CargoReadout({
  state,
  items,
}: {
  state: MiningGameplayState;
  items: readonly CargoReadoutItem[];
}) {
  const { collapsed, toggle } = useSyncedCollapse(COLLAPSE_KEYS.cargoReadout);

  const twoColumns = items.length > 1;

  return (
    <Panel>
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
          Cargo readout
        </p>
        <CollapseButton collapsed={collapsed} label="cargo readout" onToggle={toggle} />
      </div>
      {!collapsed ? (
        <>
          {twoColumns ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {items.map((item) => (
                <div key={item.label}>
                  <p className="font-display text-3xl font-bold">{item.quantity}</p>
                  <p className="text-sm text-[color:var(--rs-text-secondary)]">{item.label}</p>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <p className="mt-3 font-display text-3xl font-bold">{items[0]?.quantity ?? 0}</p>
              <p className="text-sm text-[color:var(--rs-text-secondary)]">
                {items[0]?.label ?? ""}
              </p>
            </div>
          )}
          <div className="mt-4 space-y-3">
            <StatusMeter
              label="Inventory slots"
              value={
                state.inventory.slotsUsed + state.inventory.slotsAvailable
                  ? (state.inventory.slotsUsed /
                      (state.inventory.slotsUsed + state.inventory.slotsAvailable)) *
                    100
                  : 0
              }
              detail={`${state.inventory.slotsUsed} used / ${state.inventory.slotsAvailable} available`}
            />
            <StatusMeter
              label="Carried mass"
              value={(state.inventory.massGrams / state.inventory.capacityGrams) * 100}
              detail={`${formatMassGrams(state.inventory.massGrams)} / ${formatMassGrams(state.inventory.capacityGrams)}`}
            />
          </div>
        </>
      ) : null}
    </Panel>
  );
}
