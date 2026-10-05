import { getItemPresentation } from "@/game/content/item-presentation";
import { inventoryStackFillFraction } from "@/game/domain/inventory";
import { ItemVisual } from "./ItemVisual";
import { ITEM_RARITY_STYLE } from "./item-rarity";

type StackItemVisualProps = {
  itemId: string;
  name: string;
  quantity: number;
  stackLimit: number;
  accessibleLabel?: string;
  className?: string;
  interactive?: boolean;
  /** Marks the tile as a current semantic mission-guidance target. */
  missionGuidance?: boolean;
  selected?: boolean;
  onSelect?: () => void;
};

/**
 * The one approved compact treatment for a fungible stack tile: artwork,
 * nameplate, quantity plate, and the left-side stack-fill indicator derived from
 * a quantity and the item's canonical stack limit. Inventory grid tiles, the
 * selected-stack preview, storage, recipes, and a Mining reward all render
 * through this boundary so the fill formula and track/fill markup cannot
 * diverge. For a reward, `quantity` is what the attempt awarded — not a claim
 * about any persisted stack. A rare item's track and fill take its authored
 * rarity accent instead of the default (#308). Unique items never use it.
 */
export function StackItemVisual({
  itemId,
  name,
  quantity,
  stackLimit,
  accessibleLabel,
  className,
  interactive,
  missionGuidance,
  selected,
  onSelect,
}: StackItemVisualProps) {
  const fillFraction = inventoryStackFillFraction(quantity, stackLimit);
  const rarity = getItemPresentation(itemId)?.rarity;
  const rarityStyle = rarity ? ITEM_RARITY_STYLE[rarity] : undefined;
  return (
    <ItemVisual
      accessibleLabel={accessibleLabel}
      background={
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-0 w-2 overflow-hidden bg-[color:var(--rs-accent-mining-stack-track)]"
          data-stack-track
          style={rarityStyle ? { backgroundColor: rarityStyle.stackTrack } : undefined}
        >
          <span
            className="absolute inset-x-0 bottom-0 bg-[color:var(--rs-accent-mining)] transition-[height] duration-[var(--rs-duration-fast)]"
            data-stack-fill={Math.round(fillFraction * 100)}
            style={{
              height: `${fillFraction * 100}%`,
              ...(rarityStyle ? { backgroundColor: rarityStyle.accent } : {}),
            }}
          />
        </span>
      }
      className={className}
      interactive={interactive}
      itemId={itemId}
      missionGuidance={missionGuidance}
      name={name}
      onSelect={onSelect}
      quantity={quantity}
      selected={selected}
    />
  );
}
