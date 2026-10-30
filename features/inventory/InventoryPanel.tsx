"use client";

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { StackItemVisual } from "@/components/items/StackItemVisual";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance, getItemMaximumCharge } from "@/game/config/balance";
import { getItemPresentation, itemQuantityLabel } from "@/game/content/item-presentation";
import { breakApartFacts, canBreakApart } from "@/game/domain/rune-materials";
import { ITEM_IDS } from "@/game/config/foundations";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { ItemOfferModal } from "@/features/missions/ItemOfferModal";
import { itemOfferForItem, type ItemOfferView } from "@/features/missions/item-offers";
import { derivePinnedGuidanceTargets } from "@/features/missions/mission-pins";
import { breakApartRunestoneAction, discardInventoryStackAction } from "@/server/actions";
import type { PlayGameplayState } from "@/server/play";
import {
  deriveInventoryEquipAvailability,
  derivePowerCellLoadAvailability,
  resolveInventorySelection,
  sameInventorySelection,
  stackDropActions,
  type InventorySelection,
  type InventoryStackEntry,
  type ResolvedInventorySelection,
} from "./inventory-selection";
import { useSelectableDetails } from "@/features/shared/use-selectable-details";
import {
  RowDetailsGrid,
  RowDetailsPanel,
  type RowDetailsTile,
} from "@/features/shared/RowDetailsGrid";
import { InlineConfirmation } from "./InlineConfirmation";
import { InventoryDetailsStats } from "./InventoryDetailsStats";
import { EchoSeekerDetails } from "@/features/echo-hunts/EchoSeekerDetails";
import {
  RuneTeleportDetails,
  RuneTeleportNotice,
} from "@/features/rune-teleport/RuneTeleportDetails";
import { loanBadge } from "@/features/research/loan-badge";
import { ResearchLoanDestroy } from "@/features/research/ResearchLoanDestroy";
import { ResearchLoanDetails } from "@/features/research/ResearchLoanDetails";
import { isResearchLoanItem } from "@/game/domain/research-jobs";
import { useEquipCommand } from "./useEquipCommand";
import { useLoadPowerCell, type LoadPowerCellFeedback } from "@/features/mining/useLoadPowerCell";
import { usePlay } from "@/features/play/PlayContext";

type DropConfirmation = {
  kind: "drop";
  stackId: string;
  mode: "one" | "stack";
  expectedQuantity: number;
  itemName: string;
};

/** The irreversible Break Apart confirmation (#367): exactly one stone, the selected stack. */
type BreakApartConfirmation = {
  kind: "break_apart";
  stackId: string;
  expectedQuantity: number;
};

type InventoryConfirmation = DropConfirmation | BreakApartConfirmation;

export function InventoryPanel({
  state,
  onClose,
  triggerRef,
  embedded = false,
}: {
  state: PlayGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  embedded?: boolean;
}) {
  const {
    acquireCommand,
    acceptState,
    enqueueForeground,
    foregroundBusy,
    openInventory,
    releaseCommand,
  } = usePlay();
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<InventoryConfirmation | undefined>();
  // `success` is announced as a polite status (a destroyed Mission item).
  const [message, setMessage] = useState<
    LoadPowerCellFeedback | { tone: "success"; message: string }
  >();
  // The carried-item Mission offer opened from Item Details (#369).
  // Held for the whole offer, including its Mission Started view, so the overlay
  // survives the authoritative state update that ends the offer itself.
  const [offerSession, setOfferSession] = useState<
    { offer: ItemOfferView; stack: { id: string; itemId: string; name: string } } | undefined
  >();
  const inspectRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Selection, authoritative reconciliation, the explicit-selection reveal, and
  // post-command focus restoration all come from the shared selectable-details
  // contract; Drop, Equip, and Power Cell loading remain owned here.
  const {
    armFocusReturn,
    clear: clearSelected,
    detailsHeadingRef,
    detailsRef,
    resolved: resolvedSelection,
    select,
    selection: selected,
  } = useSelectableDetails<InventorySelection, ResolvedInventorySelection>({
    resolve: (selection) => resolveInventorySelection(state.inventory, selection),
    isSameSelection: sameInventorySelection,
  });
  const { equip } = useEquipCommand(
    (feedback) => {
      // Replacement-safe feedback mirror: the equipment command and the Power
      // Cell load share one status line, so success/refusal both route here.
      setMessage(feedback);
    },
    // Arm focus-return ONLY after the server confirms Equip and the returned
    // authoritative state has been accepted. Arming earlier would let a
    // refusal or uncertain transport leave the flag set and trigger equip
    // focus behavior on some later, unrelated reconciliation.
    () => {
      armFocusReturn(() => gridRef.current);
    },
  );
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const originSelectorRef = useRef<string>("");
  const cancelledRef = useRef(false);
  const hasConfirmedRef = useRef(false);
  const totalSlots = state.inventory.slotsUsed + state.inventory.slotsAvailable;
  const breakApart = breakApartFacts(getEffectiveGameBalance());
  // The equipped Mining tool a loose Power Cell would go into (#233).
  const loadTool = state.equipment.miningTool;
  // Mission guidance is consumed from the ONE derived target set: while an
  // equipped-item requirement is the current unmet step, the matching carried
  // item's tile receives the treatment so the player finds the equip path.
  // No mission-ID branching here.
  const missionGuidanceTargets = derivePinnedGuidanceTargets(state);
  // A carried stack can offer an unaccepted Mission through its Item Details
  // (#369). The offer comes from content and the projection, never from an item
  // or Mission literal here.
  const selectedItemOffer =
    resolvedSelection?.kind === "stack"
      ? itemOfferForItem(state, resolvedSelection.entry.itemId)
      : undefined;
  const loadAvailability = derivePowerCellLoadAvailability(
    state,
    resolvedSelection,
    foregroundBusy,
  );
  const equipAvailability = deriveInventoryEquipAvailability(
    state,
    resolvedSelection,
    foregroundBusy,
  );
  const selectedIsPowerCell =
    resolvedSelection?.kind === "stack" && resolvedSelection.entry.itemId === ITEM_IDS.powerCell;
  const selectedPowerCell = selectedIsPowerCell
    ? {
        stackId: resolvedSelection.entry.id,
        expectedQuantity: resolvedSelection.entry.quantity,
      }
    : undefined;
  const { busy: loadBusy, loadPowerCell } = useLoadPowerCell(setMessage, selectedPowerCell);

  // Reconcile the pending confirmation: when the authoritative stack changed
  // or vanished since confirmation, clear it safely and explain why.
  useEffect(() => {
    if (!confirming) return;
    const stack = state.inventory.stacks.find((entry) => entry.id === confirming.stackId);
    if (!stack || stack.quantity !== confirming.expectedQuantity) {
      setConfirming(undefined);
      setMessage({
        tone: "danger",
        message: "Inventory changed. Review the stack and try again.",
      });
    }
  }, [confirming, state.inventory.stacks]);

  // Keyboard flow: focus Cancel when the confirmation appears; when it closes
  // (cancel, success, or refusal), return focus to the selected tile or the
  // first occupied tile so keyboard users land back on the grid.
  useEffect(() => {
    if (confirming) {
      hasConfirmedRef.current = true;
      cancelButtonRef.current?.focus();
      return;
    }
    if (!hasConfirmedRef.current) return;
    if (cancelledRef.current) {
      cancelledRef.current = false;
      detailsRef.current?.querySelector<HTMLButtonElement>(originSelectorRef.current)?.focus();
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    const selectedTile = grid.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    (selectedTile ?? grid.querySelector<HTMLButtonElement>("button[aria-pressed]"))?.focus();
  }, [confirming]);

  // Selecting the same tile again toggles details closed; any other selection
  // replaces the current one. Both paths discard transient confirmation state.
  function toggleSelect(next: InventorySelection) {
    setMessage(undefined);
    setConfirming(undefined);
    setOfferSession(undefined);
    select(next);
  }

  // Passive dismissal (empty slot, unused drawer space, Close details): clears
  // the selection and any confirmation owned by it, while preserving confirmed
  // authoritative feedback already shown to the player.
  function clearSelection() {
    setConfirming(undefined);
    setOfferSession(undefined);
    clearSelected();
  }

  function onSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    clearSelection();
  }

  function openConfirmation(
    action: { mode: "one" | "stack"; label: string },
    entry: InventoryStackEntry,
  ) {
    originSelectorRef.current = `[data-drop-action="${action.mode}"]`;
    setConfirming({
      kind: "drop",
      stackId: entry.id,
      mode: action.mode,
      expectedQuantity: entry.quantity,
      itemName: entry.name,
    });
  }

  // Cancel restores the initiating action in place and returns focus to it.
  function cancelConfirmation() {
    cancelledRef.current = true;
    setConfirming(undefined);
  }

  function runEquip() {
    if (!equipAvailability || !equipAvailability.enabled) return;
    // Focus-return is armed by the hook's onSuccess callback only after the
    // server confirms the Equip; a refusal or uncertain transport must not
    // prime it. Here we only clear transient state before submission.
    setMessage(undefined);
    setConfirming(undefined);
    equip(
      equipAvailability.itemInstanceId,
      equipAvailability.target,
      `Equipped ${resolvedSelection?.entry.name} into ${equipAvailability.slotLabel}.`,
    );
  }

  function openBreakApartConfirmation(entry: InventoryStackEntry) {
    originSelectorRef.current = "[data-break-apart]";
    setConfirming({ kind: "break_apart", stackId: entry.id, expectedQuantity: entry.quantity });
  }

  function runBreakApart() {
    if (confirming?.kind !== "break_apart") return;
    const request = { stackId: confirming.stackId, expectedQuantity: confirming.expectedQuantity };
    const execute = () => {
      startTransition(async () => {
        try {
          const result = await breakApartRunestoneAction({
            characterId: state.characterId,
            ...request,
          });
          if ("error" in result) {
            setMessage({ tone: "danger", message: result.error });
          } else {
            acceptState(result.state);
            setMessage(
              result.breakApart.status === "broken"
                ? {
                    tone: "muted",
                    message: `Broke apart ${itemQuantityLabel(
                      breakApart.inputItemId,
                      result.breakApart.consumedQuantity,
                      "Runestone",
                    )} into ${itemQuantityLabel(
                      breakApart.outputItemId,
                      result.breakApart.producedQuantity,
                      "Rune Fragment",
                    )}.`,
                  }
                : { tone: "danger", message: result.breakApart.message },
            );
          }
        } catch {
          setMessage({
            tone: "danger",
            message: "Comms interruption. Inventory could not be confirmed.",
          });
        } finally {
          releaseCommand();
          setConfirming(undefined);
        }
      });
    };
    enqueueForeground(execute);
  }

  function runDiscard() {
    if (confirming?.kind !== "drop") return;
    const request = {
      stackId: confirming.stackId,
      mode: confirming.mode,
      expectedQuantity: confirming.expectedQuantity,
    };
    const execute = () => {
      startTransition(async () => {
        try {
          const result = await discardInventoryStackAction({
            characterId: state.characterId,
            ...request,
          });
          if ("error" in result) {
            setMessage({ tone: "danger", message: result.error });
          } else {
            acceptState(result.state);
            setMessage(
              result.discard.status === "discarded"
                ? {
                    tone: "muted",
                    message: `Dropped ${result.discard.discardedQuantity} ${confirming.itemName}.`,
                  }
                : { tone: "danger", message: result.discard.message },
            );
          }
        } catch {
          setMessage({
            tone: "danger",
            message: "Comms interruption. Inventory could not be confirmed.",
          });
        } finally {
          releaseCommand();
          setConfirming(undefined);
        }
      });
    };
    enqueueForeground(execute);
  }

  // One ordered tile list — stacks, unique items, then empty slots — so the
  // shared row-details grid treats every slot as a grid cell when it decides
  // which row the selected tile belongs to.
  const tiles: (RowDetailsTile & { selected: boolean })[] = [
    ...state.inventory.stacks.map((stack) => ({
      key: stack.id,
      selected:
        resolvedSelection !== undefined && selected?.kind === "stack" && selected.id === stack.id,
      node: (
        <StackItemVisual
          className={
            missionGuidanceTargets.actionItemIds.has(stack.itemId)
              ? "rs-mission-guidance"
              : missionGuidanceTargets.availableItemIds.has(stack.itemId)
                ? "rs-mission-available"
                : undefined
          }
          interactive
          itemId={stack.itemId}
          missionGuidance={
            missionGuidanceTargets.actionItemIds.has(stack.itemId)
              ? "active"
              : missionGuidanceTargets.availableItemIds.has(stack.itemId)
                ? "available"
                : undefined
          }
          name={stack.name}
          onSelect={() => toggleSelect({ kind: "stack", id: stack.id })}
          quantity={stack.quantity}
          selected={selected?.kind === "stack" && selected.id === stack.id}
          stackLimit={stack.stackLimit}
        />
      ),
    })),
    ...state.inventory.uniqueItems.map((item) => ({
      key: item.id,
      selected:
        resolvedSelection !== undefined && selected?.kind === "unique" && selected.id === item.id,
      node: (
        <ItemVisual
          accessibleLabel={item.name}
          additionalDescription={
            item.currentCharge !== undefined
              ? `${item.currentCharge} of ${getItemMaximumCharge(item.itemId)} charges remaining`
              : undefined
          }
          badge={
            item.currentCharge !== undefined
              ? `${item.currentCharge}/${getItemMaximumCharge(item.itemId)}`
              : loanBadge(state, item.itemId)
          }
          className={
            missionGuidanceTargets.equipmentItemIds.has(item.itemId)
              ? "rs-mission-guidance"
              : undefined
          }
          interactive
          itemId={item.itemId}
          name={item.name}
          onSelect={() => toggleSelect({ kind: "unique", id: item.id })}
          missionGuidance={missionGuidanceTargets.equipmentItemIds.has(item.itemId)}
          selected={selected?.kind === "unique" && selected.id === item.id}
        />
      ),
    })),
    ...Array.from({ length: Math.max(0, totalSlots - state.inventory.slotsUsed) }, (_, index) => ({
      key: `empty-${state.inventory.slotsUsed + index}`,
      selected: false,
      node: (
        <div
          aria-label={`Empty inventory slot ${state.inventory.slotsUsed + index + 1}`}
          className="min-h-28 border border-dashed border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]"
          onClick={clearSelection}
        >
          Empty slot
        </div>
      ),
    })),
  ];

  const content = (
    <div className="pb-2" data-inventory-surface onClick={onSurfaceClick}>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-[color:var(--rs-text-secondary)]">
          {state.inventory.slotsUsed} occupied / {totalSlots} slots
        </p>
        <p
          className="font-display text-sm font-bold text-[color:var(--rs-accent-primary)]"
          data-inventory-credits
        >
          <CreditsAmount amount={state.credits} />
        </p>
      </div>
      {message ? (
        <div className="mt-4">
          <Feedback tone={message.tone}>{message.message}</Feedback>
        </div>
      ) : null}
      <RuneTeleportNotice />
      <RowDetailsGrid
        ariaLabel={`${totalSlots} inventory slots`}
        className="mt-4"
        columnsClassName="grid-cols-2 sm:grid-cols-4"
        gridRef={gridRef}
        renderDetails={(placement) =>
          resolvedSelection ? (
            <RowDetailsPanel
              // Inventory's drawer ends above the footer and scrolls itself.
              clearBottomNav={false}
              aria-label={`${resolvedSelection.entry.name} details`}
              data-details-panel
              panelRef={detailsRef}
              placement={placement}
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]"
                  ref={detailsHeadingRef}
                  tabIndex={-1}
                >
                  Item details
                </h3>
                <ActionButton className="px-3" intent="secondary" onClick={clearSelection}>
                  Close details
                </ActionButton>
              </div>
              <div className="mt-3 grid items-start gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                {resolvedSelection.kind === "stack" ? (
                  <StackItemVisual
                    className="h-28 w-28 self-start"
                    itemId={resolvedSelection.entry.itemId}
                    name={resolvedSelection.entry.name}
                    quantity={resolvedSelection.entry.quantity}
                    stackLimit={resolvedSelection.entry.stackLimit}
                  />
                ) : (
                  <ItemVisual
                    accessibleLabel={resolvedSelection.entry.name}
                    badge={
                      resolvedSelection.entry.currentCharge !== undefined
                        ? `${resolvedSelection.entry.currentCharge}/${getItemMaximumCharge(resolvedSelection.entry.itemId)}`
                        : undefined
                    }
                    className="h-28 w-28 self-start"
                    itemId={resolvedSelection.entry.itemId}
                    name={resolvedSelection.entry.name}
                  />
                )}
                <dl className="min-w-0 text-sm text-[color:var(--rs-text-secondary)]">
                  <InventoryDetailsStats selection={resolvedSelection} />
                </dl>
              </div>
              {getItemPresentation(resolvedSelection.entry.itemId)?.description ? (
                <p
                  className="mt-3 text-sm italic text-[color:var(--rs-text-secondary)]"
                  data-item-description
                >
                  {getItemPresentation(resolvedSelection.entry.itemId)?.description}
                </p>
              ) : null}
              {selectedItemOffer ? (
                <div className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
                  <MissionActionButton
                    data-item-offer-inspect
                    disabled={foregroundBusy}
                    guidance="available"
                    onClick={() => {
                      if (resolvedSelection.kind !== "stack") return;
                      const { id, itemId, name } = resolvedSelection.entry;
                      setOfferSession({ offer: selectedItemOffer, stack: { id, itemId, name } });
                    }}
                    ref={inspectRef}
                  >
                    {selectedItemOffer.offer.inspectLabel}
                  </MissionActionButton>
                </div>
              ) : null}
              {resolvedSelection.kind === "stack" &&
              resolvedSelection.entry.itemId === state.echoHunt.seekerItemId ? (
                // A Seeker's Use and its current-planet reading (#393).
                <EchoSeekerDetails />
              ) : null}
              {resolvedSelection.kind === "stack" &&
              state.runeTeleport.runes[resolvedSelection.entry.itemId] ? (
                // A teleport rune's Use and its confirmation (#438).
                <RuneTeleportDetails entry={resolvedSelection.entry} />
              ) : null}
              {selectedIsPowerCell ? (
                <div className="mt-3 border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3">
                  <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
                    Load effect
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-[color:var(--rs-text-secondary)]">
                    {!loadTool ? (
                      <li>Loads into an equipped Mining Cutter</li>
                    ) : loadTool.chargedEffect.kind === "extra_yield" ? (
                      // What loading does is the equipped tool's own definition (#233).
                      <>
                        <li>{loadTool.maximumCharge} charged attempts</li>
                        <li>+{loadTool.chargedEffect.units} ore on any attempt that yields ore</li>
                        <li>Attempt timing, success chance, and XP remain unchanged</li>
                      </>
                    ) : (
                      <>
                        <li>{loadTool.maximumCharge} boosted attempts</li>
                        <li>Speeds attempt timing only</li>
                        <li>Success chance, yield, and XP remain unchanged</li>
                      </>
                    )}
                  </ul>
                </div>
              ) : null}
              {resolvedSelection.kind === "unique" ? (
                <>
                  {resolvedSelection.entry.currentCharge !== undefined ? (
                    <div className="mt-3">
                      <StatusMeter
                        detail={`${resolvedSelection.entry.currentCharge} of ${getItemMaximumCharge(resolvedSelection.entry.itemId)} charges remaining`}
                        label="Cutter charge"
                        value={
                          (resolvedSelection.entry.currentCharge /
                            (getItemMaximumCharge(resolvedSelection.entry.itemId) ?? 1)) *
                          100
                        }
                      />
                    </div>
                  ) : null}
                  {isResearchLoanItem(resolvedSelection.entry.itemId) ? (
                    // A Wise Old Enby loan (#406): what it is for and how far along the
                    // job is, in place of the generic unique-item line.
                    <ResearchLoanDetails itemId={resolvedSelection.entry.itemId} />
                  ) : (
                    <p className="mt-3 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                      Unique item — cannot be dropped.
                    </p>
                  )}
                  <ResearchLoanDestroy
                    item={resolvedSelection.entry}
                    key={resolvedSelection.entry.id}
                    onResult={(feedback) => {
                      setMessage(feedback);
                      // The selected tile is gone: land on the grid, not on <body>.
                      armFocusReturn(() => gridRef.current);
                    }}
                  />
                  {equipAvailability ? (
                    <div className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
                      <ActionButton
                        disabled={!equipAvailability.enabled}
                        intent="mining"
                        loading={foregroundBusy}
                        onClick={runEquip}
                      >
                        {equipAvailability.enabled
                          ? `Equip in ${equipAvailability.slotLabel}`
                          : "Equip"}
                      </ActionButton>
                      {equipAvailability.enabled || equipAvailability.reason === "busy" ? null : (
                        <>
                          {equipAvailability.reason === "slots_occupied" ? (
                            <Feedback>
                              {equipAvailability.slotLabels.join(" and ")}{" "}
                              {equipAvailability.slotLabels.length === 1 ? "is" : "are"} occupied.
                              Choose which one to replace in Equipment.
                            </Feedback>
                          ) : null}
                          {equipAvailability.messages.map((reason) => (
                            <Feedback key={reason}>{reason}</Feedback>
                          ))}
                          {equipAvailability.reason === "slots_occupied" ? (
                            <ActionButton
                              className="mt-2"
                              intent="secondary"
                              onClick={() => openInventory("equipment")}
                            >
                              Manage Equipment
                            </ActionButton>
                          ) : null}
                        </>
                      )}
                      {!equipAvailability.enabled && equipAvailability.reason === "busy" ? (
                        <Feedback>Another command is in progress.</Feedback>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
              {selectedIsPowerCell ? (
                <div className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
                  <ActionButton
                    disabled={!loadAvailability?.enabled}
                    intent="mining"
                    loading={loadBusy}
                    onClick={loadPowerCell}
                  >
                    Load into {loadTool?.name ?? "Mining Cutter"}
                  </ActionButton>
                  {loadAvailability && !loadAvailability.enabled ? (
                    loadAvailability.reason === "charged" ? (
                      <Feedback>
                        Power Cell already loaded — {loadAvailability.remainingCharge} boosted
                        attempts remain. Deplete the Cutter before loading another.
                      </Feedback>
                    ) : loadAvailability.reason === "no_cutter" ? (
                      <Feedback>Equip a Mining Cutter before loading a Power Cell.</Feedback>
                    ) : loadAvailability.reason === "no_cells" ? (
                      <Feedback>No loose Power Cells are carried.</Feedback>
                    ) : (
                      <Feedback>Another command is in progress.</Feedback>
                    )
                  ) : null}
                </div>
              ) : null}
              {resolvedSelection.kind === "stack" &&
              canBreakApart(resolvedSelection.entry.itemId, getEffectiveGameBalance()) ? (
                <div className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
                  {confirming?.kind === "break_apart" ? (
                    <InlineConfirmation
                      busy={foregroundBusy}
                      cancelRef={cancelButtonRef}
                      confirmLabel="Confirm break apart"
                      data-break-apart-confirmation
                      onCancel={cancelConfirmation}
                      onConfirm={runBreakApart}
                    >
                      <p className="font-bold text-[color:var(--rs-text-primary)]">
                        Destroy {itemQuantityLabel(breakApart.inputItemId, 1, "Runestone")} and
                        receive exactly{" "}
                        {itemQuantityLabel(
                          breakApart.outputItemId,
                          breakApart.outputQuantity,
                          "Rune Fragment",
                        )}
                        ?
                      </p>
                      <p className="mt-1">
                        This cannot be undone: Rune Fragments cannot be put back together. Only one
                        stone is broken, even from a larger stack.
                      </p>
                    </InlineConfirmation>
                  ) : (
                    <ActionButton
                      data-break-apart
                      disabled={foregroundBusy}
                      intent="mining"
                      onClick={() => openBreakApartConfirmation(resolvedSelection.entry)}
                    >
                      Break Apart
                    </ActionButton>
                  )}
                </div>
              ) : null}
              {resolvedSelection.kind === "stack" ? (
                <div className="mt-3 border-t border-[color:var(--rs-accent-danger)] pt-3">
                  <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-danger)]">
                    Drop
                  </p>
                  {confirming?.kind === "drop" ? (
                    <InlineConfirmation
                      busy={foregroundBusy}
                      cancelRef={cancelButtonRef}
                      confirmLabel="Confirm drop"
                      data-drop-confirmation
                      onCancel={cancelConfirmation}
                      onConfirm={runDiscard}
                    >
                      <p className="font-bold text-[color:var(--rs-text-primary)]">
                        {confirming.mode === "stack"
                          ? `Drop the full stack of ${confirming.expectedQuantity} ${confirming.itemName}?`
                          : `Drop 1 ${confirming.itemName}?`}
                      </p>
                      <p className="mt-1">
                        Dropped items are permanently destroyed in the current development build.
                      </p>
                    </InlineConfirmation>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {stackDropActions(resolvedSelection.entry.quantity).map((action) => (
                        <ActionButton
                          data-drop-action={action.mode}
                          disabled={foregroundBusy}
                          intent="danger"
                          key={action.mode}
                          onClick={() => openConfirmation(action, resolvedSelection.entry)}
                        >
                          {action.label}
                        </ActionButton>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </RowDetailsPanel>
          ) : null
        }
        selectedIndex={tiles.findIndex((tile) => tile.selected)}
        tiles={tiles}
      />
      {offerSession ? (
        <ItemOfferModal
          offer={offerSession.offer}
          onAccepted={(accepted) =>
            setMessage({
              tone: "muted",
              message: `Mission accepted: ${accepted.missionTitle}. Your ${offerSession.stack.name} stays in your Inventory.`,
            })
          }
          onClose={() => setOfferSession(undefined)}
          onFinished={() => {
            // Back to a normal Inventory, not a still-open details pane.
            setOfferSession(undefined);
            clearSelected();
            requestAnimationFrame(() =>
              gridRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed]")?.focus(),
            );
          }}
          stack={offerSession.stack}
          triggerRef={inspectRef}
        />
      ) : null}
    </div>
  );

  if (embedded) return content;
  return (
    <Drawer
      eyebrow="MYKEA SCHLEPPRAUM-8"
      label="Inventory"
      onClose={onClose}
      title="Inventory"
      triggerRef={triggerRef}
    >
      {content}
    </Drawer>
  );
}
