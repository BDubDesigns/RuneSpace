"use client";

import { InventoryStackVisual } from "@/components/items/InventoryStackVisual";
import { ItemVisual } from "@/components/items/ItemVisual";

/**
 * One authored recipe batch as a station tile (#232): the canonical item
 * visual — `InventoryStackVisual` for a stackable output, with its per-batch
 * quantity badge and stack fill, `ItemVisual` for a unique item — and the
 * recipe and any unmet requirement directly beneath it.
 *
 * The badge is always the one authored batch. A run's size is the selector's
 * business, never the tile's: four batches of a two-item recipe still show x2.
 */
export function StationRecipeTile({
  guided,
  itemId,
  name,
  onSelect,
  quantity,
  recipe,
  requirements,
  selected,
  stackLimit,
  tileLabel,
  ...rest
}: {
  guided?: boolean;
  itemId: string;
  name: string;
  /** Absent for a read-only reference tile (the Recipes catalog). */
  onSelect?: () => void;
  /** Per-batch quantity of the item this tile depicts. */
  quantity: number;
  /** The recipe line, e.g. "2 Refined Ferrite → 1 Mounting Bracket". */
  recipe: string;
  /** Unmet requirements, shown under the recipe; empty when it can begin. */
  requirements: readonly string[];
  selected?: boolean;
  /** Present for a stackable item; a unique item has no stack to fill. */
  stackLimit?: number;
  tileLabel: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div className="min-w-0 space-y-1.5" {...rest}>
      {stackLimit !== undefined ? (
        <InventoryStackVisual
          accessibleLabel={tileLabel}
          interactive={onSelect !== undefined}
          itemId={itemId}
          missionGuidance={guided}
          name={name}
          quantity={quantity}
          selected={selected ?? false}
          stackLimit={stackLimit}
          {...(onSelect ? { onSelect } : {})}
        />
      ) : (
        <ItemVisual
          accessibleLabel={tileLabel}
          interactive={onSelect !== undefined}
          itemId={itemId}
          missionGuidance={guided}
          name={name}
          selected={selected ?? false}
          {...(onSelect ? { onSelect } : {})}
          {...(quantity > 1 ? { quantity } : {})}
        />
      )}
      <p className="text-xs leading-snug text-[color:var(--rs-text-secondary)]">{recipe}</p>
      {requirements.map((requirement) => (
        <p
          className="font-display text-[11px] uppercase tracking-wide text-[color:var(--rs-accent-danger)]"
          data-station-requirement
          key={requirement}
        >
          {requirement}
        </p>
      ))}
    </div>
  );
}
