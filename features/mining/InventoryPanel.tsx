"use client";

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import { inventoryStackFillFraction } from "@/game/domain/inventory";
import { discardInventoryStackAction } from "@/server/actions";
import type { MiningGameplayState } from "@/server/mining";
import {
  derivePowerCellLoadAvailability,
  resolveInventorySelection,
  stackDropActions,
  type InventorySelection,
  type InventoryStackEntry,
} from "./inventory-selection";
import { useLoadPowerCell, type LoadPowerCellFeedback } from "./useLoadPowerCell";
import { useMiningPlay } from "./MiningPlayContext";

function kilograms(grams: number) {
  return `${(grams / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

type DropConfirmation = {
  stackId: string;
  mode: "one" | "stack";
  expectedQuantity: number;
  itemName: string;
  confirmLabel: string;
};

export function InventoryPanel({
  state,
  onClose,
  triggerRef,
}: {
  state: MiningGameplayState;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { acquireCommand, acceptState, busy, releaseCommand } = useMiningPlay();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<InventorySelection | undefined>();
  const [confirming, setConfirming] = useState<DropConfirmation | undefined>();
  const [message, setMessage] = useState<LoadPowerCellFeedback>();
  const { busy: loadBusy, loadPowerCell } = useLoadPowerCell(setMessage);
  const gridRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const hasConfirmedRef = useRef(false);
  const totalSlots = state.inventory.slotsUsed + state.inventory.slotsAvailable;
  const balance = getEffectiveGameBalance();
  const resolvedSelection = resolveInventorySelection(state.inventory, selected);
  const loadAvailability = derivePowerCellLoadAvailability(state, resolvedSelection, busy);
  const ferrite = balance.items.ferriteShale;
  const powerCell = balance.items.powerCell;

  // Reconcile the selection with authoritative state: when the selected entry
  // no longer exists (stack consumed, dropped, or unique item re-equipped),
  // clear the selection so the stale tile never lingers.
  useEffect(() => {
    if (selected && !resolvedSelection) setSelected(undefined);
  }, [selected, resolvedSelection]);

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
    const grid = gridRef.current;
    if (!grid) return;
    const selectedTile = grid.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    (selectedTile ?? grid.querySelector<HTMLButtonElement>("button[aria-pressed]"))?.focus();
  }, [confirming]);

  function select(next: InventorySelection) {
    setMessage(undefined);
    setConfirming(undefined);
    setSelected(next);
  }

  function openConfirmation(
    action: { mode: "one" | "stack"; label: string },
    entry: InventoryStackEntry,
    trigger: HTMLButtonElement,
  ) {
    confirmTriggerRef.current = trigger;
    setConfirming({
      stackId: entry.id,
      mode: action.mode,
      expectedQuantity: entry.quantity,
      itemName: entry.name,
      confirmLabel: action.label,
    });
  }

  function runDiscard() {
    if (!confirming) return;
    if (!acquireCommand()) return;
    const request = {
      stackId: confirming.stackId,
      mode: confirming.mode,
      expectedQuantity: confirming.expectedQuantity,
    };
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
  }

  const selectedIsPowerCell =
    resolvedSelection?.kind === "stack" && resolvedSelection.entry.itemId === ITEM_IDS.powerCell;

  return (
    <Drawer
      eyebrow="MYKEA SCHLEPPRAUM-8"
      label="Inventory"
      onClose={onClose}
      title="Inventory"
      triggerRef={triggerRef}
    >
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        {state.inventory.slotsUsed} occupied / {totalSlots} slots
      </p>
      {message ? (
        <div className="mt-4">
          <Feedback tone={message.tone}>{message.message}</Feedback>
        </div>
      ) : null}
      <div
        ref={gridRef}
        className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label={`${totalSlots} inventory slots`}
      >
        {state.inventory.stacks.map((stack) => (
          <ItemVisual
            background={
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 z-0 w-2 overflow-hidden bg-[color:var(--rs-accent-mining-stack-track)]"
                data-stack-track
              >
                <span
                  className="absolute inset-x-0 bottom-0 bg-[color:var(--rs-accent-mining)] transition-[height] duration-[var(--rs-duration-fast)]"
                  data-stack-fill={Math.round(
                    inventoryStackFillFraction(stack.quantity, stack.stackLimit) * 100,
                  )}
                  style={{
                    height: `${inventoryStackFillFraction(stack.quantity, stack.stackLimit) * 100}%`,
                  }}
                />
              </span>
            }
            interactive
            itemId={stack.itemId}
            key={stack.id}
            name={stack.name}
            onSelect={() => select({ kind: "stack", id: stack.id })}
            quantity={stack.quantity}
            selected={selected?.kind === "stack" && selected.id === stack.id}
          />
        ))}
        {state.inventory.uniqueItems.map((item) => (
          <ItemVisual
            accessibleLabel={item.name}
            additionalDescription={
              item.currentCharge !== undefined
                ? `${item.currentCharge} of ${balance.items.salvageCutter.maximumCharge} charges remaining`
                : undefined
            }
            badge={
              item.currentCharge !== undefined
                ? `${item.currentCharge}/${balance.items.salvageCutter.maximumCharge}`
                : undefined
            }
            interactive
            itemId={item.itemId}
            key={item.id}
            name={item.name}
            onSelect={() => select({ kind: "unique", id: item.id })}
            selected={selected?.kind === "unique" && selected.id === item.id}
          />
        ))}
        {Array.from({ length: Math.max(0, totalSlots - state.inventory.slotsUsed) }, (_, index) => (
          <div
            aria-label={`Empty inventory slot ${state.inventory.slotsUsed + index + 1}`}
            className="min-h-28 border border-dashed border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]"
            key={`empty-${state.inventory.slotsUsed + index}`}
          >
            Empty slot
          </div>
        ))}
      </div>
      {resolvedSelection ? (
        <section
          aria-label={`${resolvedSelection.entry.name} details`}
          className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
        >
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <ItemVisual
              accessibleLabel={
                resolvedSelection.kind === "stack" ? undefined : resolvedSelection.entry.name
              }
              additionalDescription={
                resolvedSelection.kind === "unique"
                  ? resolvedSelection.entry.currentCharge !== undefined
                    ? `${resolvedSelection.entry.currentCharge} of ${balance.items.salvageCutter.maximumCharge} charges remaining`
                    : undefined
                  : undefined
              }
              badge={
                resolvedSelection.kind === "unique"
                  ? resolvedSelection.entry.currentCharge !== undefined
                    ? `${resolvedSelection.entry.currentCharge}/${balance.items.salvageCutter.maximumCharge}`
                    : undefined
                  : undefined
              }
              itemId={resolvedSelection.entry.itemId}
              name={resolvedSelection.entry.name}
              quantity={
                resolvedSelection.kind === "stack" ? resolvedSelection.entry.quantity : undefined
              }
            />
            <div className="text-sm text-[color:var(--rs-text-secondary)]">
              <p className="font-display uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                {resolvedSelection.entry.name}
              </p>
              {resolvedSelection.kind === "stack" ? (
                <>
                  <p>Quantity: {resolvedSelection.entry.quantity}</p>
                  {resolvedSelection.entry.itemId === ITEM_IDS.ferriteShale ? (
                    <>
                      <p>
                        Mass: {ferrite.massGrams} g each ·{" "}
                        {kilograms(ferrite.massGrams * resolvedSelection.entry.quantity)} total
                      </p>
                      <p>Stack limit: {ferrite.stackLimit}</p>
                    </>
                  ) : resolvedSelection.entry.itemId === ITEM_IDS.powerCell ? (
                    <>
                      <p>
                        Mass: {powerCell.massGrams} g each ·{" "}
                        {kilograms(powerCell.massGrams * resolvedSelection.entry.quantity)} total
                      </p>
                      <p>Stack limit: {powerCell.stackLimit}</p>
                      <p>
                        One cell loads the equipped Salvage Cutter to{" "}
                        {balance.items.salvageCutter.maximumCharge} boosted attempts. Boost changes
                        timing only — success chance, yield, and XP are unchanged.
                      </p>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <p>{kilograms(resolvedSelection.entry.massGrams)}</p>
                  {resolvedSelection.entry.currentCharge !== undefined ? (
                    <p>
                      {resolvedSelection.entry.currentCharge} of{" "}
                      {balance.items.salvageCutter.maximumCharge} charges remaining
                    </p>
                  ) : null}
                  <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                    Unique item — cannot be dropped.
                  </p>
                </>
              )}
            </div>
          </div>
          {resolvedSelection.kind === "stack" ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {stackDropActions(resolvedSelection.entry.quantity).map((action) => (
                  <ActionButton
                    disabled={busy}
                    intent="danger"
                    key={action.mode}
                    onClick={(event) =>
                      openConfirmation(action, resolvedSelection.entry, event.currentTarget)
                    }
                  >
                    {action.label}
                  </ActionButton>
                ))}
              </div>
              {selectedIsPowerCell ? (
                <div className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3">
                  <ActionButton
                    disabled={!loadAvailability?.enabled}
                    intent="mining"
                    loading={loadBusy}
                    onClick={loadPowerCell}
                  >
                    Load into Salvage Cutter
                  </ActionButton>
                  {loadAvailability && !loadAvailability.enabled ? (
                    loadAvailability.reason === "charged" ? (
                      <Feedback>
                        Power Cell already loaded — {loadAvailability.remainingCharge} boosted
                        attempts remain. Deplete the Cutter before loading another.
                      </Feedback>
                    ) : loadAvailability.reason === "no_cutter" ? (
                      <Feedback>Equip a Salvage Cutter before loading a Power Cell.</Feedback>
                    ) : loadAvailability.reason === "no_cells" ? (
                      <Feedback>No loose Power Cells are carried.</Feedback>
                    ) : (
                      <Feedback>Another command is in progress.</Feedback>
                    )
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      {confirming ? (
        <div
          role="alert"
          className="mt-4 border border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-surface-panel)] p-3"
        >
          <p className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-danger)]">
            Confirm drop
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            {confirming.mode === "stack"
              ? `Drop the full stack of ${confirming.expectedQuantity} ${confirming.itemName}?`
              : `Drop 1 ${confirming.itemName}?`}
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            Dropped items are permanently destroyed in the current development build.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              disabled={busy}
              intent="secondary"
              onClick={() => {
                confirmTriggerRef.current?.focus();
                setConfirming(undefined);
              }}
              ref={cancelButtonRef}
            >
              Cancel
            </ActionButton>
            <ActionButton disabled={busy} intent="danger" loading={busy} onClick={runDiscard}>
              {confirming.confirmLabel}
            </ActionButton>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
