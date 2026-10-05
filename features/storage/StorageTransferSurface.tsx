"use client";

import { Fragment, useRef, type ReactNode, type RefObject } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { ItemVisual } from "@/components/items/ItemVisual";
import { StackItemVisual } from "@/components/items/StackItemVisual";
import { getItemMaximumCharge } from "@/game/config/balance";
import { useSelectableDetails } from "@/features/shared/use-selectable-details";
import {
  StorageSelectionDetails,
  type StorageDetailsPlacement,
} from "@/features/storage/StorageSelectionDetails";
import { detailsInsertionIndex, tileColumn } from "@/features/storage/storage-grid-layout";
import { useGridColumnCount } from "@/features/storage/use-grid-column-count";
import {
  resolveStorageSelection,
  sameStorageSelection,
  type ResolvedStorageSelection,
  type StorageArea,
  type StorageProjection,
  type StorageRegion,
  type StorageSelection,
  type StorageUniqueEntry,
} from "@/features/storage/storage-selection";

/**
 * Handed to every transfer callback by the surface. The host calls
 * `armFocusReturn` only once its command is confirmed non-error, immediately
 * before it accepts the authoritative state that may vacate the selected tile
 * — never on submission, so a mid-flight render can never consume the arm
 * before the real reconciliation happens. The surface already knows which
 * region focus should return to.
 */
export type StorageTransferHooks = {
  armFocusReturn: () => void;
};

export type StackTransferInput = {
  stackId: string;
  mode: "one" | "stack";
  expectedQuantity: number;
};

export type UniqueTransferInput = { itemInstanceId: string };

/**
 * The host's authoritative transfer commands. The surface only chooses which
 * one a button invokes (carried → deposit, stored → withdraw); command
 * execution, the host's command gate, pending state, feedback and
 * authoritative-state reconciliation all stay behind these callbacks, so the
 * same surface serves destinations with different authorization and slot rules.
 * Each callback is fire-and-forget: the host reports progress back through the
 * surface's `pending` prop. A new action (for example Deposit All) is a new
 * member here plus a control in `renderRegionActions`.
 */
export type StorageTransferAdapter = {
  depositStack: (input: StackTransferInput, hooks: StorageTransferHooks) => void;
  withdrawStack: (input: StackTransferInput, hooks: StorageTransferHooks) => void;
  depositUniqueItem: (input: UniqueTransferInput, hooks: StorageTransferHooks) => void;
  withdrawUniqueItem: (input: UniqueTransferInput, hooks: StorageTransferHooks) => void;
};

/** The destination's own player-facing wording. The carried region is fixed. */
export type StorageDestinationLabels = {
  /** Region heading and mobile tab label, e.g. `CARGO`. */
  title: string;
  /** Accessible name of the destination region. */
  regionLabel: string;
  /** Accessible name of the destination's tile grid. */
  itemsLabel: string;
  /** Shown when the destination holds nothing. */
  emptyMessage: string;
  /** Accessible name of the mobile carried/destination tab list. */
  switcherLabel: string;
};

export type StorageRegionActionsContext = {
  area: StorageArea;
  pending: boolean;
} & StorageTransferHooks;

type StorageTransferSurfaceProps = {
  /** Current authoritative carried and destination contents. Never cached here. */
  projection: StorageProjection;
  labels: StorageDestinationLabels;
  transfers: StorageTransferAdapter;
  /**
   * Which region the narrow-screen switcher shows. Controlled by the host, so
   * the choice survives the host closing and reopening its storage panel; the
   * surface clears any selection whenever it changes it.
   */
  mode: StorageArea;
  onModeChange: (mode: StorageArea) => void;
  /** True while the host's command is in flight; disables every transfer control. */
  pending: boolean;
  /** Called on every explicit tile selection, so a host can clear stale feedback. */
  onSelectItem?: () => void;
  /**
   * The seam for future bulk affordances (Deposit All / Withdraw All): when
   * given, whatever it returns renders under that region's heading. Nothing in
   * the surface implements a bulk command.
   */
  renderRegionActions?: (context: StorageRegionActionsContext) => ReactNode;
};

/**
 * The two storage regions are two inventories, so each one is drawn as its own
 * bounded sub-panel rather than as a bare heading above a grid (#199). Both
 * regions use the identical treatment — the separation comes from grouping and
 * hierarchy, never from a colour that would imply the items inside differ.
 * Panel surface over the activity's raised surface is the existing nesting step
 * used by every other block inside an activity.
 */
const REGION_CLASS =
  "h-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3";
const REGION_HEADER_CLASS =
  "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[color:var(--rs-border-subtle)] pb-2";
const REGION_TITLE_CLASS =
  "font-display text-sm font-bold uppercase tracking-[0.16em] text-[color:var(--rs-text-primary)]";
const REGION_COUNT_CLASS =
  "font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-secondary)]";

function chargeDescription(item: StorageUniqueEntry): string | undefined {
  return item.currentCharge !== undefined
    ? `${item.currentCharge} of ${getItemMaximumCharge(item.itemId)} charges remaining`
    : undefined;
}

function chargeBadge(item: StorageUniqueEntry): string | undefined {
  return item.currentCharge !== undefined
    ? `${item.currentCharge}/${getItemMaximumCharge(item.itemId)}`
    : undefined;
}

type StorageTile = { key: string; selected: boolean; node: ReactNode };

/**
 * One region's tile grid, with the selected item's details inserted into the
 * grid's own child order right after the selected tile's row (#291). It owns
 * the measured column count because the row boundary is whatever the grid is
 * laying out now (three columns on a phone, four from `sm`), so the details
 * follow the right row at any width and stay in DOM and tab order. The gap is
 * one custom property so the details' connector can span exactly one gap.
 */
function StorageTileGrid({
  ariaLabel,
  renderDetails,
  tiles,
}: {
  ariaLabel: string;
  /** Given only to the region holding the selection. */
  renderDetails: ((placement: StorageDetailsPlacement) => ReactNode) | undefined;
  tiles: readonly StorageTile[];
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useGridColumnCount(gridRef);
  const selectedIndex = renderDetails ? tiles.findIndex((tile) => tile.selected) : -1;
  const insertAfter =
    selectedIndex < 0 ? -1 : detailsInsertionIndex(selectedIndex, columns, tiles.length);
  return (
    <div
      aria-label={ariaLabel}
      className="mt-3 grid grid-cols-3 gap-[var(--storage-grid-gap)] [--storage-grid-gap:0.5rem] sm:grid-cols-4"
      ref={gridRef}
    >
      {tiles.flatMap((tile, index) => {
        const node = <Fragment key={tile.key}>{tile.node}</Fragment>;
        if (index !== insertAfter) return [node];
        return [
          node,
          <Fragment key="selection-details">
            {renderDetails?.({ column: tileColumn(selectedIndex, columns), columns })}
          </Fragment>,
        ];
      })}
    </div>
  );
}

function StorageRegionSection({
  area,
  ariaLabel,
  actions,
  emptyMessage,
  itemsLabel,
  onSelect,
  region,
  regionRef,
  renderDetails,
  selected,
  title,
}: {
  area: StorageArea;
  ariaLabel: string;
  actions: ReactNode;
  emptyMessage: string;
  itemsLabel: string;
  onSelect: (selection: StorageSelection) => void;
  region: StorageRegion;
  // The section root (not the inner tile grid) so a fallback focus target
  // always exists even when the region has no occupied tiles left.
  regionRef: RefObject<HTMLElement | null>;
  renderDetails: ((placement: StorageDetailsPlacement) => ReactNode) | undefined;
  selected: StorageSelection | undefined;
  title: string;
}) {
  const isSelected = (kind: StorageSelection["kind"], id: string) =>
    selected?.area === area && selected.kind === kind && selected.id === id;
  const tiles: StorageTile[] = [
    ...region.stacks.map((stack) => ({
      key: `stack:${stack.id}`,
      selected: isSelected("stack", stack.id),
      node: (
        <StackItemVisual
          interactive
          itemId={stack.itemId}
          name={stack.name}
          onSelect={() => onSelect({ area, kind: "stack", id: stack.id })}
          quantity={stack.quantity}
          selected={isSelected("stack", stack.id)}
          stackLimit={stack.stackLimit}
        />
      ),
    })),
    ...region.uniqueItems.map((item) => ({
      key: `unique:${item.id}`,
      selected: isSelected("unique", item.id),
      node: (
        <ItemVisual
          accessibleLabel={item.name}
          additionalDescription={chargeDescription(item)}
          badge={chargeBadge(item)}
          interactive
          itemId={item.itemId}
          name={item.name}
          onSelect={() => onSelect({ area, kind: "unique", id: item.id })}
          selected={isSelected("unique", item.id)}
        />
      ),
    })),
  ];
  return (
    <section
      aria-label={ariaLabel}
      className={REGION_CLASS}
      data-storage-area={area}
      ref={regionRef}
      tabIndex={-1}
    >
      <div className={REGION_HEADER_CLASS}>
        <h3 className={REGION_TITLE_CLASS}>{title}</h3>
        <span className={REGION_COUNT_CLASS}>
          {region.slotsUsed} / {region.capacitySlots}
        </span>
      </div>
      {actions}
      {tiles.length ? (
        <StorageTileGrid ariaLabel={itemsLabel} renderDetails={renderDetails} tiles={tiles} />
      ) : (
        <div className="mt-3">
          <Feedback>{emptyMessage}</Feedback>
        </div>
      )}
    </section>
  );
}

/**
 * The one destination-agnostic carried-vs-stored transfer surface (#282): the
 * two inventory grids, the mobile region switcher, the selected-item details
 * (inserted beneath the selected tile's row, #291), and the Deposit/Withdraw
 * control layout. A host supplies the current authoritative projection, its own
 * wording, and its own transfer commands; the ship Cargo Hold is the first host
 * and a location stash will be the next.
 *
 * It owns the interaction a player sees — selection, toggle, reveal and focus
 * restoration, through the shared selectable-details contract — and none of
 * the domain. It imports no server action and assumes no storage shape, so a
 * destination's authorization, slot limits and persistence stay with its host.
 * Selection is always re-resolved from `projection` on render.
 *
 * Selection state is the surface's own, so a host that unmounts it (closing a
 * storage panel) discards the selection; the narrow-screen region choice is the
 * host's, passed as `mode`, so it persists across that unmount.
 */
export function StorageTransferSurface({
  projection,
  labels,
  transfers,
  mode,
  onModeChange,
  pending,
  onSelectItem,
  renderRegionActions,
}: StorageTransferSurfaceProps) {
  const carriedRef = useRef<HTMLElement>(null);
  const storedRef = useRef<HTMLElement>(null);
  const {
    armFocusReturn,
    clear: clearSelection,
    detailsHeadingRef,
    detailsRef,
    resolved,
    select,
    selection,
  } = useSelectableDetails<StorageSelection, ResolvedStorageSelection>({
    resolve: (current) => resolveStorageSelection(projection, current),
    isSameSelection: sameStorageSelection,
  });

  // Selecting the already-selected tile toggles its action area closed; any
  // other selection (including one in the other region) replaces it.
  function toggleSelect(next: StorageSelection) {
    onSelectItem?.();
    select(next);
  }

  function hooksFor(area: StorageArea): StorageTransferHooks {
    return {
      armFocusReturn: () =>
        armFocusReturn(() => (area === "carried" ? carriedRef.current : storedRef.current)),
    };
  }

  function switchMode(next: StorageArea) {
    onModeChange(next);
    clearSelection();
  }

  function renderActions(area: StorageArea) {
    return renderRegionActions?.({ area, pending, ...hooksFor(area) });
  }

  function renderStackButtons(area: StorageArea, stackId: string, quantity: number) {
    const deposit = area === "carried";
    const run = (stackMode: StackTransferInput["mode"]) => {
      const input = { stackId, mode: stackMode, expectedQuantity: quantity };
      if (deposit) transfers.depositStack(input, hooksFor(area));
      else transfers.withdrawStack(input, hooksFor(area));
    };
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton
          className="px-3"
          disabled={pending}
          intent="secondary"
          onClick={() => run("one")}
        >
          {deposit ? "DEPOSIT 1" : "WITHDRAW 1"}
        </ActionButton>
        <ActionButton
          className="px-3"
          disabled={pending}
          intent="secondary"
          onClick={() => run("stack")}
        >
          {deposit ? "DEPOSIT STACK" : "WITHDRAW STACK"}
        </ActionButton>
      </div>
    );
  }

  function renderUniqueButton(area: StorageArea, itemInstanceId: string) {
    const deposit = area === "carried";
    return (
      <div className="mt-3">
        <ActionButton
          className="px-3"
          disabled={pending}
          intent="secondary"
          onClick={() => {
            const input = { itemInstanceId };
            if (deposit) transfers.depositUniqueItem(input, hooksFor(area));
            else transfers.withdrawUniqueItem(input, hooksFor(area));
          }}
        >
          {deposit ? "DEPOSIT ITEM" : "WITHDRAW ITEM"}
        </ActionButton>
      </div>
    );
  }

  // The details belong to the region holding the selection and render inside
  // that region's grid, beneath the selected tile's row (#291).
  function detailsFor(area: StorageArea) {
    if (!resolved || resolved.area !== area) return undefined;
    return (placement: StorageDetailsPlacement) => (
      <StorageSelectionDetails
        actions={
          resolved.kind === "stack"
            ? renderStackButtons(area, resolved.entry.id, resolved.entry.quantity)
            : renderUniqueButton(area, resolved.entry.id)
        }
        area={area}
        headingRef={detailsHeadingRef}
        itemId={resolved.entry.itemId}
        name={resolved.entry.name}
        onClose={clearSelection}
        panelRef={detailsRef}
        placement={placement}
        summary={
          resolved.kind === "stack"
            ? `Quantity ${resolved.entry.quantity}`
            : chargeDescription(resolved.entry)
        }
      />
    );
  }

  const { carried, destination } = projection;
  return (
    <section>
      <div className="mb-3 flex gap-2 sm:hidden" role="tablist" aria-label={labels.switcherLabel}>
        <ActionButton
          aria-selected={mode === "carried"}
          className="flex-1"
          intent={mode === "carried" ? "primary" : "secondary"}
          onClick={() => switchMode("carried")}
          role="tab"
        >
          CARRIED {carried.slotsUsed} / {carried.capacitySlots}
        </ActionButton>
        <ActionButton
          aria-selected={mode === "stored"}
          className="flex-1"
          intent={mode === "stored" ? "primary" : "secondary"}
          onClick={() => switchMode("stored")}
          role="tab"
        >
          {labels.title} {destination.slotsUsed} / {destination.capacitySlots}
        </ActionButton>
      </div>
      {/* Two inventories, not one continuous grid (#199): on desktop each
          region is its own bounded sub-panel with a real gap between them, so
          the boundary is obvious without colouring either side differently.
          Mobile keeps the switcher above and shows one region at a time. */}
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
        <div className={mode === "carried" ? "" : "hidden sm:block"}>
          <StorageRegionSection
            actions={renderActions("carried")}
            area="carried"
            ariaLabel="Carried Inventory"
            emptyMessage="No occupied carried items."
            itemsLabel="Carried items"
            onSelect={toggleSelect}
            region={carried}
            regionRef={carriedRef}
            renderDetails={detailsFor("carried")}
            selected={selection}
            title="CARRIED"
          />
        </div>
        <div className={mode === "stored" ? "" : "hidden sm:block"}>
          <StorageRegionSection
            actions={renderActions("stored")}
            area="stored"
            ariaLabel={labels.regionLabel}
            emptyMessage={labels.emptyMessage}
            itemsLabel={labels.itemsLabel}
            onSelect={toggleSelect}
            region={destination}
            regionRef={storedRef}
            renderDetails={detailsFor("stored")}
            selected={selection}
            title={labels.title}
          />
        </div>
      </div>
    </section>
  );
}
