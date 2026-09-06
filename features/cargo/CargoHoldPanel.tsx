"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { ItemVisual } from "@/components/items/ItemVisual";
import { InventoryStackVisual } from "@/components/items/InventoryStackVisual";
import { getEffectiveGameBalance } from "@/game/config/balance";
import type { CargoHoldTransferActionResult } from "@/server/actions";
import {
  contributeCargoHoldMaterialsAction,
  depositCargoStackAction,
  depositCargoUniqueItemAction,
  withdrawCargoStackAction,
  withdrawCargoUniqueItemAction,
} from "@/server/actions";
import type { CargoHoldStackState } from "@/server/play";
import { usePlay } from "@/features/play/PlayContext";

type Confirmation = {
  refinedFerrite: number;
  slag: number;
};

type StorageMode = "carried" | "cargo";

const COMPLETION_FEEDBACK_DURATION_MS = 3_600;

function transferMessage(result: CargoHoldTransferActionResult): string | undefined {
  if ("error" in result) return result.error;
  if (result.cargo.status === "transferred") return "Cargo Hold transfer complete.";
  return result.cargo.message;
}

export function CargoHoldPanel() {
  const { enqueueForeground, releaseCommand, acceptState, state } = usePlay();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("carried");
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [completionFeedbackVisible, setCompletionFeedbackVisible] = useState(false);
  const [completionAnnouncement, setCompletionAnnouncement] = useState("");
  const [, startTransition] = useTransition();
  const balance = getEffectiveGameBalance();
  const repair = state.cargoHold.repair;
  const previousCompletion = useRef(repair.complete);

  useEffect(() => {
    const wasComplete = previousCompletion.current;
    previousCompletion.current = repair.complete;
    if (wasComplete || !repair.complete) return;

    setCompletionFeedbackVisible(true);
    setCompletionAnnouncement("CARGO HOLD RESTORED");
    const timer = window.setTimeout(() => {
      setCompletionFeedbackVisible(false);
      setCompletionAnnouncement("");
    }, COMPLETION_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [repair.complete]);

  function commitMaterials() {
    if (!confirmation) return;
    enqueueForeground(() => {
      setPending("materials");
      startTransition(async () => {
        try {
          const result = await contributeCargoHoldMaterialsAction({
            characterId: state.characterId,
            expectedRefinedFerrite: confirmation.refinedFerrite,
            expectedSlag: confirmation.slag,
          });
          if ("error" in result) setMessage(result.error);
          else {
            acceptState(result.state);
            setMessage(
              result.cargo.status === "committed"
                ? "Repair materials installed permanently."
                : result.cargo.message,
            );
          }
        } catch {
          setMessage("Comms interruption. Repair materials were not confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
          setConfirmation(undefined);
        }
      });
    });
  }

  function runTransfer(action: () => Promise<CargoHoldTransferActionResult>) {
    enqueueForeground(() => {
      setPending("transfer");
      startTransition(async () => {
        try {
          const result = await action();
          if ("error" in result) setMessage(result.error);
          else {
            acceptState(result.state);
            setMessage(transferMessage(result));
          }
        } catch {
          setMessage("Comms interruption. Cargo status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  function stackActions(stack: CargoHoldStackState, direction: "deposit" | "withdraw") {
    const action = (mode: "one" | "stack") => {
      const input = {
        characterId: state.characterId,
        stackId: stack.id,
        mode,
        expectedQuantity: stack.quantity,
      };
      runTransfer(() =>
        direction === "deposit" ? depositCargoStackAction(input) : withdrawCargoStackAction(input),
      );
    };
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton
          className="px-3"
          disabled={Boolean(pending)}
          intent="secondary"
          onClick={() => action("one")}
        >
          {direction === "deposit" ? "DEPOSIT 1" : "WITHDRAW 1"}
        </ActionButton>
        <ActionButton
          className="px-3"
          disabled={Boolean(pending)}
          intent="secondary"
          onClick={() => action("stack")}
        >
          {direction === "deposit" ? "DEPOSIT STACK" : "WITHDRAW STACK"}
        </ActionButton>
      </div>
    );
  }

  function renderCarried() {
    return (
      <section aria-label="Carried Inventory" data-cargo-mode="carried">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-sm uppercase tracking-wide">CARRIED</h3>
          <span className="text-xs text-[color:var(--rs-text-secondary)]">
            {state.inventory.slotsUsed} /{" "}
            {state.inventory.slotsUsed + state.inventory.slotsAvailable}
          </span>
        </div>
        {state.inventory.stacks.length || state.inventory.uniqueItems.length ? (
          <div className="mt-3 space-y-3">
            {state.inventory.stacks.map((stack) => (
              <div
                className="border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2"
                data-cargo-entry={stack.id}
                key={stack.id}
              >
                <div className="flex items-center gap-3">
                  <InventoryStackVisual
                    className="h-20 min-h-20 w-20 shrink-0"
                    itemId={stack.itemId}
                    name={stack.name}
                    quantity={stack.quantity}
                    stackLimit={stack.stackLimit}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{stack.name}</p>
                    {stackActions(stack, "deposit")}
                  </div>
                </div>
              </div>
            ))}
            {state.inventory.uniqueItems.map((item) => (
              <div
                className="border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2"
                data-cargo-entry={item.id}
                key={item.id}
              >
                <div className="flex items-center gap-3">
                  <ItemVisual
                    additionalDescription={
                      item.currentCharge !== undefined
                        ? `${item.currentCharge} of ${balance.items.salvageCutter.maximumCharge} charges remaining`
                        : undefined
                    }
                    className="h-20 min-h-20 w-20 shrink-0"
                    itemId={item.itemId}
                    name={item.name}
                  />
                  <ActionButton
                    className="px-3"
                    disabled={Boolean(pending)}
                    intent="secondary"
                    onClick={() =>
                      runTransfer(() =>
                        depositCargoUniqueItemAction({
                          characterId: state.characterId,
                          itemInstanceId: item.id,
                        }),
                      )
                    }
                  >
                    DEPOSIT ITEM
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3">
            <Feedback>No occupied carried items.</Feedback>
          </div>
        )}
      </section>
    );
  }

  function renderCargo() {
    return (
      <section aria-label="Cargo Hold storage" data-cargo-mode="cargo">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-sm uppercase tracking-wide">CARGO</h3>
          <span className="text-xs text-[color:var(--rs-text-secondary)]">
            {state.cargoHold.slotsUsed} / {state.cargoHold.capacitySlots}
          </span>
        </div>
        {state.cargoHold.stacks.length || state.cargoHold.uniqueItems.length ? (
          <div className="mt-3 space-y-3">
            {state.cargoHold.stacks.map((stack) => (
              <div
                className="border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2"
                data-cargo-entry={stack.id}
                key={stack.id}
              >
                <div className="flex items-center gap-3">
                  <InventoryStackVisual
                    className="h-20 min-h-20 w-20 shrink-0"
                    itemId={stack.itemId}
                    name={stack.name}
                    quantity={stack.quantity}
                    stackLimit={stack.stackLimit}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{stack.name}</p>
                    {stackActions(stack, "withdraw")}
                  </div>
                </div>
              </div>
            ))}
            {state.cargoHold.uniqueItems.map((item) => (
              <div
                className="border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2"
                data-cargo-entry={item.id}
                key={item.id}
              >
                <div className="flex items-center gap-3">
                  <ItemVisual
                    additionalDescription={
                      item.currentCharge !== undefined
                        ? `${item.currentCharge} of ${balance.items.salvageCutter.maximumCharge} charges remaining`
                        : undefined
                    }
                    className="h-20 min-h-20 w-20 shrink-0"
                    itemId={item.itemId}
                    name={item.name}
                  />
                  <ActionButton
                    className="px-3"
                    disabled={Boolean(pending)}
                    intent="secondary"
                    onClick={() =>
                      runTransfer(() =>
                        withdrawCargoUniqueItemAction({
                          characterId: state.characterId,
                          itemInstanceId: item.id,
                        }),
                      )
                    }
                  >
                    WITHDRAW ITEM
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3">
            <Feedback>No occupied Cargo Hold items.</Feedback>
          </div>
        )}
      </section>
    );
  }

  return (
    <Panel data-cargo-hold>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
            CRASH SITE INFRASTRUCTURE
          </p>
          <h2
            className="mt-1 font-display text-xl font-bold uppercase tracking-wide"
            data-cargo-hold-status={repair.complete ? undefined : "locked"}
          >
            {repair.complete ? "CARGO HOLD" : "Damaged Cargo Hold"}
          </h2>
        </div>
        {repair.complete ? (
          <span className="border border-[color:var(--rs-accent-mining)] px-2 py-1 font-display text-xs uppercase tracking-wide">
            OPERATIONAL
          </span>
        ) : null}
      </div>

      {repair.complete ? (
        <>
          {completionFeedbackVisible ? (
            <section
              className="rs-result-feedback-success mt-4 border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-4"
              data-cargo-hold-status="restored"
            >
              <p className="font-display text-lg font-bold uppercase tracking-wide">
                CARGO HOLD RESTORED
              </p>
              <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                The stationary ship storage is online and ready for use at Crash Site.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="font-display text-sm uppercase tracking-wide">
                  {state.cargoHold.slotsUsed} / {state.cargoHold.capacitySlots} SLOTS OCCUPIED
                </p>
                <ActionButton intent="mining" onClick={() => setStorageOpen((open) => !open)}>
                  {storageOpen ? "CLOSE CARGO HOLD" : "OPEN CARGO HOLD"}
                </ActionButton>
              </div>
            </section>
          ) : (
            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--rs-border-structural)] pt-4"
              data-cargo-hold-status="operational"
            >
              <p className="font-display text-sm uppercase tracking-wide">
                {state.cargoHold.slotsUsed} / {state.cargoHold.capacitySlots} SLOTS OCCUPIED
              </p>
              <ActionButton intent="mining" onClick={() => setStorageOpen((open) => !open)}>
                {storageOpen ? "CLOSE CARGO HOLD" : "OPEN CARGO HOLD"}
              </ActionButton>
            </div>
          )}
          {storageOpen ? (
            <section className="mt-4" data-cargo-storage>
              <div
                className="mb-3 flex gap-2 sm:hidden"
                role="tablist"
                aria-label="Cargo storage mode"
              >
                <ActionButton
                  aria-selected={storageMode === "carried"}
                  className="flex-1"
                  intent={storageMode === "carried" ? "primary" : "secondary"}
                  onClick={() => setStorageMode("carried")}
                  role="tab"
                >
                  CARRIED {state.inventory.slotsUsed} /{" "}
                  {state.inventory.slotsUsed + state.inventory.slotsAvailable}
                </ActionButton>
                <ActionButton
                  aria-selected={storageMode === "cargo"}
                  className="flex-1"
                  intent={storageMode === "cargo" ? "primary" : "secondary"}
                  onClick={() => setStorageMode("cargo")}
                  role="tab"
                >
                  CARGO {state.cargoHold.slotsUsed} / {state.cargoHold.capacitySlots}
                </ActionButton>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={storageMode === "carried" ? "" : "hidden sm:block"}>
                  {renderCarried()}
                </div>
                <div className={storageMode === "cargo" ? "" : "hidden sm:block"}>
                  {renderCargo()}
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-cargo-hold-announcement
        role="status"
      >
        {completionAnnouncement}
      </p>
      <p aria-live="polite" className="sr-only">
        {message ?? ""}
      </p>
      {message ? (
        <div className="mt-3">
          <Feedback>{message}</Feedback>
        </div>
      ) : null}
      {confirmation ? (
        <div
          aria-label="Confirm Cargo Hold material contribution"
          className="mt-4 border border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-surface-panel)] p-3"
          data-cargo-confirmation
          role="alert"
        >
          <p className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-danger)]">
            Commit to Cargo Hold repair
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            Refined Ferrite ×{confirmation.refinedFerrite}
            <br />
            Slag ×{confirmation.slag}
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            These materials become permanently installed and cannot be recovered.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              disabled={Boolean(pending)}
              intent="secondary"
              onClick={() => setConfirmation(undefined)}
            >
              CANCEL
            </ActionButton>
            <ActionButton
              disabled={Boolean(pending)}
              intent="danger"
              loading={pending === "materials"}
              onClick={commitMaterials}
            >
              COMMIT MATERIALS
            </ActionButton>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
