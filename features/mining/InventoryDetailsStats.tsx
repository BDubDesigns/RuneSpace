"use client";

import * as React from "react";
import { formatMassGrams } from "@/game/domain/mass";
import type { ResolvedInventorySelection } from "./inventory-selection";

function StatRow({ label, value, dataStat }: { label: string; value: string; dataStat: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rs-border-subtle)] py-1.5 last:border-b-0"
      data-stat={dataStat}
    >
      <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">{label}</dt>
      <dd className="text-right font-medium text-[color:var(--rs-text-primary)]">{value}</dd>
    </div>
  );
}

/**
 * The single generic stat block for the Inventory details panel.
 * Stack entries render Quantity, Stack limit, Unit mass, and Total mass
 * purely from the authoritative projection — no per-item branch.
 * Unique entries keep their existing Identity + Mass path, also via the
 * canonical formatter. This component is the real UI contract for #119 and
 * exists so focused unit coverage can assert against it without needing a
 * browser harness.
 */
export function InventoryDetailsStats({ selection }: { selection: ResolvedInventorySelection }) {
  if (selection.kind === "stack") {
    return (
      <>
        <StatRow dataStat="item" label="Item" value={selection.entry.name} />
        <StatRow dataStat="quantity" label="Quantity" value={String(selection.entry.quantity)} />
        <StatRow
          dataStat="stack-limit"
          label="Stack limit"
          value={String(selection.entry.stackLimit)}
        />
        <StatRow
          dataStat="unit-mass"
          label="Unit mass"
          value={formatMassGrams(selection.entry.massGrams)}
        />
        <StatRow
          dataStat="total-mass"
          label="Total mass"
          value={formatMassGrams(selection.entry.massGrams * selection.entry.quantity)}
        />
      </>
    );
  }

  return (
    <>
      <StatRow dataStat="item" label="Item" value={selection.entry.name} />
      <StatRow dataStat="identity" label="Identity" value="Unique item" />
      <StatRow dataStat="mass" label="Mass" value={formatMassGrams(selection.entry.massGrams)} />
    </>
  );
}
