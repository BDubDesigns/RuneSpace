"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ItemVisual } from "@/components/items/ItemVisual";
import { InventoryStackVisual } from "@/components/items/InventoryStackVisual";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, GAME_TICK_MS } from "@/game/config/foundations";
import type {
  CargoHoldMaterialContributionActionResult,
  CargoHoldTransferActionResult,
  MiningActionResult,
} from "@/server/actions";
import {
  contributeCargoHoldMaterialsAction,
  depositCargoStackAction,
  depositCargoUniqueItemAction,
  startWeldingAction,
  stopWeldingAction,
  withdrawCargoStackAction,
  withdrawCargoUniqueItemAction,
} from "@/server/actions";
import type { CargoHoldStackState, MiningGameplayState } from "@/server/mining";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

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

function weldingMessage(state: MiningGameplayState): string | undefined {
  if (state.weldingError === "welding_unavailable_here")
    return "Welding is available only while stationary at Crash Site.";
  if (state.weldingError === "welding_locked")
    return "Install 15 Refined Ferrite and 6 Slag before Welding.";
  if (state.weldingError === "repair_complete") return "The Cargo Hold is already operational.";
  if (state.commandError === "another_action_active")
    return "Another activity is active. Finish it before starting Welding.";
  return undefined;
}

function resultError(result: MiningActionResult | CargoHoldMaterialContributionActionResult) {
  return "error" in result ? result.error : undefined;
}

export function CargoHoldPanel() {
  const { enqueueForeground, foregroundBusy, releaseCommand, acceptState, state } = useMiningPlay();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("carried");
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [completionFeedbackVisible, setCompletionFeedbackVisible] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();
  const balance = getEffectiveGameBalance();
  const repair = state.cargoHold.repair;
  const previousCompletion = useRef(repair.complete);
  const activeWelding = state.activeAction?.actionId === ACTION_IDS.cargoHoldWelding;
  const weldingAttemptDurationMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const weldingElapsed = activeWelding
    ? Math.max(0, now - new Date(state.activeAction!.progressStartedAt).getTime())
    : 0;
  const weldingAttemptProgress = activeWelding
    ? Math.min(100, (weldingElapsed / weldingAttemptDurationMs) * 100)
    : 0;
  const secondsRemaining = activeWelding
    ? Math.max(0, (new Date(state.activeAction!.nextAttemptAt).getTime() - now) / 1_000)
    : 0;

  useEffect(() => {
    if (!activeWelding) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [activeWelding]);

  useEffect(() => {
    const wasComplete = previousCompletion.current;
    previousCompletion.current = repair.complete;
    if (wasComplete || !repair.complete) return;

    setCompletionFeedbackVisible(true);
    const timer = window.setTimeout(
      () => setCompletionFeedbackVisible(false),
      COMPLETION_FEEDBACK_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [repair.complete]);

  function applyStateResult(result: MiningActionResult) {
    const error = resultError(result);
    if (error) {
      setMessage(error);
      return;
    }
    if (!result.state) return;
    acceptState(result.state);
    setMessage(weldingMessage(result.state));
  }

  function runWeldingCommand(intent: "start" | "stop") {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          const result =
            intent === "start"
              ? await startWeldingAction(state.characterId)
              : await stopWeldingAction(state.characterId);
          applyStateResult(result);
        } catch {
          setMessage("Comms interruption. Welding status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

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
            Crash Site infrastructure
          </p>
          <h2 className="mt-1 font-display text-xl font-bold uppercase tracking-wide">
            {repair.complete ? "CARGO HOLD" : "CARGO HOLD REPAIR"}
          </h2>
        </div>
        {repair.complete ? (
          <span className="border border-[color:var(--rs-accent-mining)] px-2 py-1 font-display text-xs uppercase tracking-wide">
            Operational
          </span>
        ) : null}
      </div>

      {!repair.complete ? (
        <>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            Restore the damaged Cargo Hold with replacement plating and packed bulkhead filler.
            Refined Ferrite is structural material; Slag is thermal packing, not a welding tool.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2" data-cargo-repair-materials>
            <div className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3">
              <p className="font-display text-xs uppercase tracking-wide">Refined Ferrite</p>
              <p className="mt-1 font-display text-2xl font-bold">
                {repair.refinedFerriteContributed} / {repair.refinedFerriteRequired}
              </p>
              <p className="text-xs text-[color:var(--rs-text-secondary)]">
                replacement plating and braces
              </p>
            </div>
            <div className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3">
              <p className="font-display text-xs uppercase tracking-wide">Slag</p>
              <p className="mt-1 font-display text-2xl font-bold">
                {repair.slagContributed} / {repair.slagRequired}
              </p>
              <p className="text-xs text-[color:var(--rs-text-secondary)]">
                thermal packing for bulkhead voids
              </p>
            </div>
          </div>
          <div className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3">
            <p className="font-display text-xs uppercase tracking-wide">Welding</p>
            {!repair.materialComplete ? (
              <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                LOCKED until both material requirements are complete.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                  Material installation complete.
                </p>
                <div className="mt-3">
                  <StatusMeter
                    detail={`${repair.weldingProgress} / ${repair.weldingIncrements} completed increments`}
                    label="CARGO HOLD REPAIR"
                    value={(repair.weldingProgress / repair.weldingIncrements) * 100}
                  />
                </div>
              </>
            )}
          </div>
          <div className="mt-4 border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3">
            <p className="font-display text-xs uppercase tracking-wide">Reward</p>
            <p className="mt-1 text-sm">
              Cargo Hold — {balance.cargoHold.capacitySlots} occupied slots
            </p>
            <p className="mt-1 text-xs text-[color:var(--rs-text-secondary)]">
              No aggregate Cargo mass limit.
            </p>
          </div>
          {repair.materialComplete ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {activeWelding || pending === "stop" ? (
                <ActionButton
                  disabled={Boolean(pending)}
                  intent="danger"
                  loading={pending === "stop"}
                  onClick={() => runWeldingCommand("stop")}
                >
                  STOP WELDING
                </ActionButton>
              ) : repair.weldingProgress < repair.weldingIncrements ? (
                <ActionButton
                  disabled={Boolean(pending)}
                  intent="mining"
                  loading={pending === "start"}
                  onClick={() => runWeldingCommand("start")}
                >
                  START WELDING
                </ActionButton>
              ) : null}
              <span className="text-xs uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
                {balance.welding.attemptDurationTicks} ticks /{" "}
                {(balance.welding.attemptDurationTicks * GAME_TICK_MS) / 1000}s per weld pass · +
                {balance.welding.xpPerIncrement} Welding XP
              </span>
            </div>
          ) : (
            <ActionButton
              className="mt-4"
              disabled={
                Boolean(pending) ||
                (repair.availableContribution.refinedFerrite === 0 &&
                  repair.availableContribution.slag === 0)
              }
              intent="mining"
              onClick={() => setConfirmation(repair.availableContribution)}
            >
              CONTRIBUTE MATERIALS
            </ActionButton>
          )}
          {activeWelding ? (
            <div className="mt-4">
              <StatusMeter
                detail={`${secondsRemaining.toFixed(1)}s to next weld pass`}
                label="Current welding pass"
                value={weldingAttemptProgress}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <section
            aria-live={completionFeedbackVisible ? "polite" : undefined}
            className={
              completionFeedbackVisible
                ? "rs-result-feedback-success mt-4 border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-4"
                : "mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-4"
            }
            data-cargo-hold-status={completionFeedbackVisible ? "restored" : "operational"}
          >
            {completionFeedbackVisible ? (
              <>
                <p className="font-display text-lg font-bold uppercase tracking-wide">
                  CARGO HOLD RESTORED
                </p>
                <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                  The stationary ship storage is online and ready for use at Crash Site.
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-lg font-bold uppercase tracking-wide">CARGO HOLD</p>
                <p className="mt-1 text-sm uppercase tracking-wide text-[color:var(--rs-accent-mining)]">
                  OPERATIONAL
                </p>
              </>
            )}
            <p className="mt-3 font-display text-sm uppercase tracking-wide">
              {state.cargoHold.slotsUsed} / {state.cargoHold.capacitySlots} slots occupied
            </p>
            <ActionButton
              className="mt-3"
              intent="mining"
              onClick={() => setStorageOpen((open) => !open)}
            >
              {storageOpen ? "CLOSE CARGO HOLD" : "OPEN CARGO HOLD"}
            </ActionButton>
          </section>
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
      )}
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
