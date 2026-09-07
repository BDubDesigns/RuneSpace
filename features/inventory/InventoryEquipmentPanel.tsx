"use client";

import type { RefObject } from "react";
import { Drawer } from "@/components/ui/Drawer";
import type { PlayGameplayState } from "@/server/play";
import { usePlay } from "@/features/play/PlayContext";
import { EquipmentPanel } from "./EquipmentPanel";
import { InventoryPanel } from "./InventoryPanel";

export function InventoryEquipmentPanel({
  state,
  onClose,
  triggerRef,
}: {
  state: PlayGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { inventoryTab, setInventoryTab } = usePlay();
  const inventorySelected = inventoryTab === "inventory";

  return (
    <Drawer
      eyebrow="MYKEA SCHLEPPRAUM-8"
      label={inventorySelected ? "Inventory" : "Equipment"}
      onClose={onClose}
      title={inventorySelected ? "Inventory" : "Equipment"}
      triggerRef={triggerRef}
    >
      <div
        aria-label="Inventory and Equipment"
        className="mt-4 grid grid-cols-2 gap-1 border-b border-[color:var(--rs-border-structural)] pb-1"
        role="tablist"
      >
        <button
          aria-controls="inventory-tab-panel"
          aria-selected={inventorySelected}
          className={`rs-focus min-h-[var(--rs-touch-target)] border px-3 py-2 font-display text-xs uppercase tracking-[0.12em] outline-none ${inventorySelected ? "border-[color:var(--rs-accent-primary)] text-[color:var(--rs-accent-primary)]" : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-secondary)]"}`}
          data-inventory-tab="inventory"
          id="inventory-tab"
          onClick={() => setInventoryTab("inventory")}
          role="tab"
          type="button"
        >
          Inventory
        </button>
        <button
          aria-controls="equipment-tab-panel"
          aria-selected={!inventorySelected}
          className={`rs-focus min-h-[var(--rs-touch-target)] border px-3 py-2 font-display text-xs uppercase tracking-[0.12em] outline-none ${!inventorySelected ? "border-[color:var(--rs-accent-primary)] text-[color:var(--rs-accent-primary)]" : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-secondary)]"}`}
          data-inventory-tab="equipment"
          id="equipment-tab"
          onClick={() => setInventoryTab("equipment")}
          role="tab"
          type="button"
        >
          Equipment
        </button>
      </div>
      <div
        aria-labelledby={`${inventoryTab}-tab`}
        id={`${inventoryTab}-tab-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {inventorySelected ? (
          <InventoryPanel embedded onClose={onClose} state={state} triggerRef={triggerRef} />
        ) : (
          <EquipmentPanel embedded onClose={onClose} state={state} triggerRef={triggerRef} />
        )}
      </div>
    </Drawer>
  );
}
