"use client";

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { InventoryStackVisual } from "@/components/items/InventoryStackVisual";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import { discardInventoryStackAction } from "@/server/actions";
import type { MiningGameplayState } from "@/server/mining";
import {
  deriveInventoryEquipAvailability,
  derivePowerCellLoadAvailability,
  resolveInventorySelection,
  stackDropActions,
  toggleInventorySelection,
  type InventorySelection,
  type InventoryStackEntry,
} from "./inventory-selection";
import { useEquipCommand } from "./useEquipCommand";
import { useLoadPowerCell, type LoadPowerCellFeedback } from "./useLoadPowerCell";
import { useMiningPlay } from "./MiningPlayContext";

function kilograms(grams: number) {
  return `${(grams / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

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
  const { acquireCommand, acceptState, enqueueForeground, foregroundBusy, releaseCommand } =
    useMiningPlay();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<InventorySelection | undefined>();
  const [confirming, setConfirming] = useState<DropConfirmation | undefined>();
  const [message, setMessage] = useState<LoadPowerCellFeedback>();
  const { busy: loadBusy, loadPowerCell } = useLoadPowerCell(setMessage);
  const { equip } = useEquipCommand((feedback) => {
    // Replacement-safe feedback mirror: the equipment command and the Power
    // Cell load share one status line, so success/refusal both route here.
    setMessage(feedback);
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const hasConfirmedRef = useRef(false);
  const detailsRef = useRef<HTMLElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const revealRequestedRef = useRef(false);
  // Set when an Equip command succeeds so focus can return to the grid after
  // the equipped tile disappears (its button would otherwise be removed).
  const equipReturnFocusRef = useRef(false);
  const totalSlots = state.inventory.slotsUsed + state.inventory.slotsAvailable;
  const balance = getEffectiveGameBalance();
  const resolvedSelection = resolveInventorySelection(state.inventory, selected);
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
  const ferrite = balance.items.ferriteShale;
  const powerCell = balance.items.powerCell;
  const selectedIsPowerCell =
    resolvedSelection?.kind === "stack" && resolvedSelection.entry.itemId === ITEM_IDS.powerCell;

  // Reconcile the selection with authoritative state: when the selected entry
  // no longer exists (stack consumed, dropped, or unique item re-equipped),
  // clear the selection so the stale tile never lingers.
  useEffect(() => {
    if (selected && !resolvedSelection) setSelected(undefined);
  }, [selected, resolvedSelection]);

  // After a successful Equip, the equipped tile disappears and the selection
  // reconciles away. Return focus to an inventory element (prefer the former
  // selected tile if it still exists, else the grid) so it never falls onto a
  // removed element or the drawer's backdrop.
  useEffect(() => {
    if (!equipReturnFocusRef.current || resolvedSelection) return;
    equipReturnFocusRef.current = false;
    const grid = gridRef.current;
    if (!grid) return;
    const tile = grid.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    (tile ?? grid.querySelector<HTMLButtonElement>("button[aria-pressed]"))?.focus();
  }, [resolvedSelection]);

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

  // Reveal the details panel only for an explicit player selection (never for
  // authoritative reconciliation): scroll the drawer so the panel is visible,
  // then move focus to its heading. Smooth scrolling yields to
  // prefers-reduced-motion.
  useEffect(() => {
    if (!revealRequestedRef.current) return;
    revealRequestedRef.current = false;
    if (!resolvedSelection) return;
    const panel = detailsRef.current;
    const heading = detailsHeadingRef.current;
    if (!panel || !heading) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    heading.focus({ preventScroll: true });
  }, [resolvedSelection]);

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

  // Selecting the same tile again toggles details closed; any other selection
  // replaces the current one. Both paths discard transient confirmation state.
  function toggleSelect(next: InventorySelection) {
    const nextSelection = toggleInventorySelection(selected, next);
    revealRequestedRef.current = nextSelection !== undefined;
    setMessage(undefined);
    setConfirming(undefined);
    setSelected(nextSelection);
  }

  // Passive dismissal (empty slot, unused drawer space, Close details): clears
  // the selection and any confirmation owned by it, while preserving confirmed
  // authoritative feedback already shown to the player.
  function clearSelection() {
    setConfirming(undefined);
    setSelected(undefined);
  }

  function onSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    clearSelection();
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

  function runEquip() {
    if (!equipAvailability || !equipAvailability.enabled) return;
    // Arm focus-return first: the equipped tile disappears from the next
    // authoritative state, so the reconcile effect will bring focus back to
    // the grid once the stale selection clears.
    equipReturnFocusRef.current = true;
    setMessage(undefined);
    setConfirming(undefined);
    equip(
      equipAvailability.itemInstanceId,
      equipAvailability.target,
      `Equipped ${resolvedSelection?.entry.name} into ${equipAvailability.slotLabel}.`,
    );
  }

  function runDiscard() {
    if (!confirming) return;
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

  return (
    <Drawer
      eyebrow="MYKEA SCHLEPPRAUM-8"
      label="Inventory"
      onClose={onClose}
      title="Inventory"
      triggerRef={triggerRef}
    >
      <div className="pb-2" data-inventory-surface onClick={onSurfaceClick}>
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
            <InventoryStackVisual
              interactive
              itemId={stack.itemId}
              key={stack.id}
              name={stack.name}
              onSelect={() => toggleSelect({ kind: "stack", id: stack.id })}
              quantity={stack.quantity}
              selected={selected?.kind === "stack" && selected.id === stack.id}
              stackLimit={stack.stackLimit}
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
              onSelect={() => toggleSelect({ kind: "unique", id: item.id })}
              selected={selected?.kind === "unique" && selected.id === item.id}
            />
          ))}
          {Array.from(
            { length: Math.max(0, totalSlots - state.inventory.slotsUsed) },
            (_, index) => (
              <div
                aria-label={`Empty inventory slot ${state.inventory.slotsUsed + index + 1}`}
                className="min-h-28 border border-dashed border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]"
                key={`empty-${state.inventory.slotsUsed + index}`}
                onClick={clearSelection}
              >
                Empty slot
              </div>
            ),
          )}
        </div>
        {resolvedSelection ? (
          <section
            aria-label={`${resolvedSelection.entry.name} details`}
            className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
            data-details-panel
            ref={detailsRef}
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
                <InventoryStackVisual
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
                      ? `${resolvedSelection.entry.currentCharge}/${balance.items.salvageCutter.maximumCharge}`
                      : undefined
                  }
                  className="h-28 w-28 self-start"
                  itemId={resolvedSelection.entry.itemId}
                  name={resolvedSelection.entry.name}
                />
              )}
              <dl className="min-w-0 text-sm text-[color:var(--rs-text-secondary)]">
                <StatRow dataStat="item" label="Item" value={resolvedSelection.entry.name} />
                {resolvedSelection.kind === "stack" ? (
                  <>
                    <StatRow
                      dataStat="quantity"
                      label="Quantity"
                      value={String(resolvedSelection.entry.quantity)}
                    />
                    {resolvedSelection.entry.itemId === ITEM_IDS.ferriteShale ? (
                      <>
                        <StatRow
                          dataStat="stack-limit"
                          label="Stack limit"
                          value={String(ferrite.stackLimit)}
                        />
                        <StatRow
                          dataStat="unit-mass"
                          label="Unit mass"
                          value={`${ferrite.massGrams} g`}
                        />
                        <StatRow
                          dataStat="total-mass"
                          label="Total mass"
                          value={kilograms(ferrite.massGrams * resolvedSelection.entry.quantity)}
                        />
                      </>
                    ) : resolvedSelection.entry.itemId === ITEM_IDS.powerCell ? (
                      <>
                        <StatRow
                          dataStat="stack-limit"
                          label="Stack limit"
                          value={String(powerCell.stackLimit)}
                        />
                        <StatRow
                          dataStat="unit-mass"
                          label="Unit mass"
                          value={`${powerCell.massGrams} g`}
                        />
                        <StatRow
                          dataStat="total-mass"
                          label="Total mass"
                          value={kilograms(powerCell.massGrams * resolvedSelection.entry.quantity)}
                        />
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <StatRow dataStat="identity" label="Identity" value="Unique item" />
                    <StatRow
                      dataStat="mass"
                      label="Mass"
                      value={kilograms(resolvedSelection.entry.massGrams)}
                    />
                  </>
                )}
              </dl>
            </div>
            {selectedIsPowerCell ? (
              <div className="mt-3 border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3">
                <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
                  Load effect
                </p>
                <ul className="mt-2 space-y-1 text-sm text-[color:var(--rs-text-secondary)]">
                  <li>{balance.items.salvageCutter.maximumCharge} boosted attempts</li>
                  <li>Speeds attempt timing only</li>
                  <li>Success chance, yield, and XP remain unchanged</li>
                </ul>
              </div>
            ) : null}
            {resolvedSelection.kind === "unique" ? (
              <>
                {resolvedSelection.entry.currentCharge !== undefined ? (
                  <div className="mt-3">
                    <StatusMeter
                      detail={`${resolvedSelection.entry.currentCharge} of ${balance.items.salvageCutter.maximumCharge} charges remaining`}
                      label="Cutter charge"
                      value={
                        (resolvedSelection.entry.currentCharge /
                          balance.items.salvageCutter.maximumCharge) *
                        100
                      }
                    />
                  </div>
                ) : null}
                <p className="mt-3 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                  Unique item — cannot be dropped.
                </p>
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
                        : "Equip Cutter"}
                    </ActionButton>
                    {!equipAvailability.enabled ? (
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
            {resolvedSelection.kind === "stack" ? (
              <div className="mt-3 border-t border-[color:var(--rs-accent-danger)] pt-3">
                <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-danger)]">
                  Drop
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {stackDropActions(resolvedSelection.entry.quantity).map((action) => (
                    <ActionButton
                      disabled={foregroundBusy}
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
              </div>
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
                disabled={foregroundBusy}
                intent="secondary"
                onClick={() => {
                  confirmTriggerRef.current?.focus();
                  setConfirming(undefined);
                }}
                ref={cancelButtonRef}
              >
                Cancel
              </ActionButton>
              <ActionButton
                disabled={foregroundBusy}
                intent="danger"
                loading={foregroundBusy}
                onClick={runDiscard}
              >
                {confirming.confirmLabel}
              </ActionButton>
            </div>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
