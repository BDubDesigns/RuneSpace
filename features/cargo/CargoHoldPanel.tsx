"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { REPAIR_TARGET_IDS } from "@/game/config/foundations";
import type { CargoHoldTransferActionResult } from "@/server/actions";
import {
  depositCargoStackAction,
  depositCargoUniqueItemAction,
  withdrawCargoStackAction,
  withdrawCargoUniqueItemAction,
} from "@/server/actions";
import { usePlay } from "@/features/play/PlayContext";
import { CARGO_HOLD_STORAGE_LABELS, projectCargoHoldStorage } from "@/features/cargo/cargo-storage";
import { ShipSystemPanel } from "@/features/ship/ShipSystemPanel";
import type { StorageArea } from "@/features/storage/storage-selection";
import {
  StorageTransferSurface,
  type StorageTransferAdapter,
  type StorageTransferHooks,
} from "@/features/storage/StorageTransferSurface";

function transferMessage(result: CargoHoldTransferActionResult): string | undefined {
  if ("error" in result) return result.error;
  if (result.cargo.status === "transferred") return "Cargo Hold transfer complete.";
  return result.cargo.message;
}

/**
 * The Cargo Hold as one of the crashed ship's systems (#322).
 *
 * Its shell — the SHIP eyebrow, the damaged state before anyone asks for the
 * repair, the standard repair presentation while it is being repaired, and the
 * finished status — is the shared `ShipSystemPanel`, the same one the Landing
 * Gear uses. What stays here is what only the Cargo Hold does once it works:
 * the storage the finished hold gives the player.
 */
export function CargoHoldPanel() {
  return (
    <ShipSystemPanel
      data-cargo-hold
      materialsPrompt="Restore the damaged Cargo Hold with replacement plating and packed bulkhead filler. Refined Ferrite is structural material; Slag is thermal packing, not a welding tool."
      targetId={REPAIR_TARGET_IDS.cargoHold}
      weldingPrompt="The plating and filler are in. What is left is welding the hold's frame until it locks."
    >
      {({ justCompleted }) => <CargoHoldStorage justCompleted={justCompleted} />}
    </ShipSystemPanel>
  );
}

/** The finished Cargo Hold's storage: occupancy, open/close, and deposits and withdrawals. */
function CargoHoldStorage({ justCompleted }: { justCompleted: boolean }) {
  const { enqueueForeground, releaseCommand, acceptState, state } = usePlay();
  const [storageOpen, setStorageOpen] = useState(false);
  // Held here, not in the surface, so the phone view survives closing and
  // reopening the hold exactly as it did before the extraction.
  const [storageMode, setStorageMode] = useState<StorageArea>("carried");
  // A deposit/withdraw result belongs directly beneath the open storage surface (#291).
  const [transferFeedback, setTransferFeedback] = useState<string>();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const capacity = getEffectiveGameBalance().cargoHold.capacitySlots;
  const occupancy = `${state.cargoHold.slotsUsed} / ${capacity} SLOTS OCCUPIED`;

  // The Cargo Hold's authoritative transfer commands, handed to the shared
  // storage surface. The command gate, pending/error feedback and Play-state
  // reconciliation stay here with the rest of this ship-specific host.
  function runTransfer(
    action: () => Promise<CargoHoldTransferActionResult>,
    { armFocusReturn }: StorageTransferHooks,
  ) {
    enqueueForeground(() => {
      setPending(true);
      startTransition(async () => {
        try {
          const result = await action();
          if ("error" in result) setTransferFeedback(result.error);
          else {
            // Armed only on a confirmed non-error result, immediately before
            // the authoritative state that may vacate the selected tile is
            // accepted — never on submission, so a mid-flight render can never
            // consume the arm before the real reconciliation happens.
            armFocusReturn();
            acceptState(result.state);
            setTransferFeedback(transferMessage(result));
          }
        } catch {
          setTransferFeedback("Comms interruption. Cargo status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(false);
        }
      });
    });
  }

  const cargoTransfers: StorageTransferAdapter = {
    depositStack: (input, hooks) =>
      runTransfer(
        () => depositCargoStackAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
    withdrawStack: (input, hooks) =>
      runTransfer(
        () => withdrawCargoStackAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
    depositUniqueItem: (input, hooks) =>
      runTransfer(
        () => depositCargoUniqueItemAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
    withdrawUniqueItem: (input, hooks) =>
      runTransfer(
        () => withdrawCargoUniqueItemAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
  };

  const toggle = (
    <ActionButton intent="mining" onClick={() => setStorageOpen((open) => !open)}>
      {storageOpen ? "CLOSE CARGO HOLD" : "OPEN CARGO HOLD"}
    </ActionButton>
  );

  return (
    <>
      {justCompleted ? (
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
            <p className="font-display text-sm uppercase tracking-wide">{occupancy}</p>
            {toggle}
          </div>
        </section>
      ) : (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--rs-border-structural)] pt-4"
          data-cargo-hold-status="operational"
        >
          <p className="font-display text-sm uppercase tracking-wide">{occupancy}</p>
          {toggle}
        </div>
      )}
      {storageOpen ? (
        <div className="mt-4" data-cargo-storage>
          <StorageTransferSurface
            labels={CARGO_HOLD_STORAGE_LABELS}
            mode={storageMode}
            onModeChange={setStorageMode}
            onSelectItem={() => setTransferFeedback(undefined)}
            pending={pending}
            projection={projectCargoHoldStorage(state)}
            transfers={cargoTransfers}
          />
          {transferFeedback ? (
            <div className="mt-3" data-cargo-transfer-feedback>
              <Feedback>{transferFeedback}</Feedback>
            </div>
          ) : null}
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {transferFeedback ?? ""}
      </p>
    </>
  );
}
