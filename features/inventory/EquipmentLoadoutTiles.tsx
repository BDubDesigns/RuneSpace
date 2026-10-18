"use client";

import Image from "next/image";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ITEM_RARITY_STYLE } from "@/components/items/item-rarity";
import { ActionButton } from "@/components/ui/ActionButton";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { ITEM_IDS } from "@/game/config/foundations";
import { EquipmentSlotIcon } from "./EquipmentSlotIcon";
import type {
  EquipmentCandidate,
  EquipmentSlotIconKind,
  EquipmentSlotState,
  PowerCellUtilityState,
} from "./equipment-loadout";

const SELECTION_ACCENT = "var(--rs-accent-primary)";
const LABEL_CLASS =
  "mb-1 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]";
const DASHED_TILE_CLASS =
  "rs-focus flex min-h-28 w-full flex-1 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] p-3 text-[color:var(--rs-text-muted)]";

function selectedRing(selected: boolean) {
  return selected ? "ring-2 ring-[color:var(--rs-accent-primary)]" : "";
}

/** A real, authoritative slot: occupied (item artwork) or empty (category silhouette). */
export function SlotTile({
  slot,
  shortLabel,
  icon,
  selected,
  onSelect,
}: {
  slot: EquipmentSlotState;
  shortLabel: string;
  icon: EquipmentSlotIconKind;
  selected: boolean;
  onSelect: () => void;
}) {
  const available = slot.eligibleItems.length;
  return (
    <>
      <p className={LABEL_CLASS}>{shortLabel}</p>
      {slot.item ? (
        <ItemVisual
          accessibleLabel={`${shortLabel}: ${slot.item.name}, equipped`}
          className="flex-1"
          interactive
          itemId={slot.item.itemId}
          name={slot.item.name}
          onSelect={onSelect}
          selected={selected}
          selectionAccent={SELECTION_ACCENT}
        />
      ) : (
        <button
          aria-label={`${shortLabel}: empty${available ? `, ${available} compatible ${available === 1 ? "item" : "items"} carried` : ""}`}
          aria-pressed={selected}
          className={`${DASHED_TILE_CLASS} ${selectedRing(selected)}`}
          onClick={onSelect}
          type="button"
        >
          <EquipmentSlotIcon kind={icon} />
          <span className="text-xs uppercase tracking-wide">
            {available ? `Empty · ${available} available` : "Empty"}
          </span>
        </button>
      )}
    </>
  );
}

/** Gloves/Boots: visual-only "Coming soon" tiles, never a live slot (#364). */
export function PlaceholderTile({
  label,
  icon,
  selected,
  onSelect,
}: {
  label: string;
  icon: EquipmentSlotIconKind;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      <p className={LABEL_CLASS}>{label}</p>
      <button
        aria-label={`${label}: coming soon, not yet equippable`}
        aria-pressed={selected}
        className={`${DASHED_TILE_CLASS} opacity-80 ${selectedRing(selected)}`}
        onClick={onSelect}
        type="button"
      >
        <EquipmentSlotIcon kind={icon} />
        <span className="text-xs uppercase tracking-wide">Coming soon</span>
      </button>
    </>
  );
}

/**
 * The Power Cell utility (#364): NOT equipment. It reads the authoritative
 * charge and loose-cell total and offers the existing Load command; the server
 * chooses which stack a Load consumes. No stack-fill bar.
 */
export function PowerCellTile({
  utility,
  busy,
  loading,
  onLoad,
}: {
  utility: PowerCellUtilityState;
  busy: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  const presentation = resolveItemPresentation(ITEM_IDS.powerCell, "Power Cell");
  return (
    <>
      <p className={LABEL_CLASS}>Power Cell</p>
      <div
        className="flex min-h-28 w-full flex-1 flex-col gap-2 border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-3"
        data-power-cell-utility={utility.status}
      >
        <div className="flex items-center gap-2">
          {presentation.artworkSrc ? (
            <Image
              alt=""
              className="h-12 w-12 shrink-0 object-contain"
              height={96}
              src={presentation.artworkSrc}
              width={96}
            />
          ) : null}
          <p className="min-w-0 text-xs text-[color:var(--rs-text-secondary)]">
            {utility.status === "no_tool" ? null : (
              <strong className="block text-sm">
                Charge {utility.charge} / {utility.maximum}
              </strong>
            )}
            {utility.carried} carried
          </p>
        </div>
        {utility.status === "ready" ? (
          <ActionButton disabled={busy} intent="mining" loading={loading} onClick={onLoad}>
            Load Power Cell
          </ActionButton>
        ) : (
          <p className="text-xs text-[color:var(--rs-text-muted)]">
            {utility.status === "charged"
              ? "Charged · boosted attempts ready"
              : utility.status === "no_tool"
                ? "Unavailable · no Mining tool equipped"
                : "Unavailable · no loose Power Cells"}
          </p>
        )}
      </div>
    </>
  );
}

/** Compact ~56px canonical-art thumbnail for a candidate row (#364). */
export function CandidateThumbnail({ candidate }: { candidate: EquipmentCandidate }) {
  const presentation = resolveItemPresentation(candidate.itemId, candidate.name);
  return (
    <span
      className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)]"
      data-candidate-thumbnail
      style={
        presentation.rarity
          ? { borderColor: ITEM_RARITY_STYLE[presentation.rarity].accent }
          : undefined
      }
    >
      {presentation.artworkSrc ? (
        <Image
          alt=""
          className="h-12 w-12 object-contain"
          height={96}
          src={presentation.artworkSrc}
          width={96}
        />
      ) : (
        <span className="px-1 text-center text-[10px] uppercase leading-tight">
          {presentation.textFallback}
        </span>
      )}
    </span>
  );
}
