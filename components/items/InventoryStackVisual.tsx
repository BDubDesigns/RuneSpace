import { inventoryStackFillFraction } from "@/game/domain/inventory";
import { ItemVisual } from "./ItemVisual";

type InventoryStackVisualProps = {
  itemId: string;
  name: string;
  quantity: number;
  stackLimit: number;
  accessibleLabel?: string;
  className?: string;
  interactive?: boolean;
  selected?: boolean;
  onSelect?: () => void;
};

/**
 * The one approved compact treatment for a fungible stack tile: artwork,
 * quantity plate, and the left-side stack-fill indicator derived from the
 * authoritative quantity and stack limit. Inventory grid tiles and the
 * selected-stack preview both render through this boundary so the fill
 * formula and track/fill markup cannot diverge. Unique items never use it.
 */
export function InventoryStackVisual({
  itemId,
  name,
  quantity,
  stackLimit,
  accessibleLabel,
  className,
  interactive,
  selected,
  onSelect,
}: InventoryStackVisualProps) {
  const fillFraction = inventoryStackFillFraction(quantity, stackLimit);
  return (
    <ItemVisual
      accessibleLabel={accessibleLabel}
      background={
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-0 w-2 overflow-hidden bg-[color:var(--rs-accent-mining-stack-track)]"
          data-stack-track
        >
          <span
            className="absolute inset-x-0 bottom-0 bg-[color:var(--rs-accent-mining)] transition-[height] duration-[var(--rs-duration-fast)]"
            data-stack-fill={Math.round(fillFraction * 100)}
            style={{ height: `${fillFraction * 100}%` }}
          />
        </span>
      }
      className={className}
      interactive={interactive}
      itemId={itemId}
      name={name}
      onSelect={onSelect}
      quantity={quantity}
      selected={selected}
    />
  );
}
