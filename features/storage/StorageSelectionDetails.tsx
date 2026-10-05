import Image from "next/image";
import type { ReactNode, RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { RowDetailsPanel, type RowDetailsPlacement } from "@/features/shared/RowDetailsGrid";
import type { StorageArea } from "@/features/storage/storage-selection";

export type StorageDetailsPlacement = RowDetailsPlacement;

type StorageSelectionDetailsProps = {
  area: StorageArea;
  itemId: string;
  name: string;
  /** Quantity or charge, in words; omitted when the item has neither. */
  summary?: string;
  /** The host's transfer controls for this item. */
  actions: ReactNode;
  onClose: () => void;
  placement: StorageDetailsPlacement;
  panelRef: RefObject<HTMLElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
};

/**
 * The selected item's action area, drawn as a full-width row of its own inside
 * the storage grid directly beneath the selected tile's row (#291). The shared
 * `RowDetailsPanel` accent border and connector bar under the selected column tie it to the tile
 * that opened it without implying the neighbouring, unselected tiles are part
 * of the selection. The preview is a purpose-built thumbnail beside the full
 * item name — never a whole `VisualTile` squeezed into a thumbnail, which has
 * no room for its reserved label band — so a long name wraps instead of
 * clipping at any phone width.
 */
export function StorageSelectionDetails({
  area,
  itemId,
  name,
  summary,
  actions,
  onClose,
  placement,
  panelRef,
  headingRef,
}: StorageSelectionDetailsProps) {
  const presentation = resolveItemPresentation(itemId, name);
  return (
    <RowDetailsPanel
      aria-label={`${name} selected`}
      data-storage-selection
      panelRef={panelRef}
      placement={placement}
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]"
          data-storage-selection-heading
          ref={headingRef}
          tabIndex={-1}
        >
          {area === "carried" ? "Carried item" : "Stored item"}
        </h3>
        <ActionButton className="px-3" intent="secondary" onClick={onClose}>
          CLOSE
        </ActionButton>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-raised)]"
          data-storage-selection-art
        >
          {presentation.artworkSrc ? (
            <Image
              alt=""
              className="h-14 w-14 object-contain"
              height={160}
              sizes="56px"
              src={presentation.artworkSrc}
              width={160}
            />
          ) : (
            <span
              className="font-display text-sm uppercase tracking-[0.16em] text-[color:var(--rs-text-secondary)]"
              data-item-fallback
            >
              {presentation.textFallback}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold" data-storage-selection-name>
            {name}
          </p>
          {summary ? (
            <p className="mt-1 break-words text-xs text-[color:var(--rs-text-secondary)]">
              {summary}
            </p>
          ) : null}
        </div>
      </div>
      {actions}
    </RowDetailsPanel>
  );
}
