"use client";

import { useEffect, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { usePlay } from "@/features/play/PlayContext";
import { planRefuel, type RefuelSource } from "@/game/domain/ship";
import { refuelShipAction } from "@/server/actions";

type Confirmation = { source: RefuelSource; gained: number; wasted: number };

const SOURCE_LABELS: Record<RefuelSource, { action: string; place: string }> = {
  inventory: { action: "LOAD FROM INVENTORY", place: "Inventory" },
  cargo_hold: { action: "LOAD FROM CARGO HOLD", place: "the Cargo Hold" },
};

/**
 * The Rivet's tank and its two source actions (#358): load one Full Small Fuel
 * Canister from Inventory, or one from the Cargo Hold attached to this ship.
 * No dropdown, no bulk "fuel all", no hidden transfer step.
 *
 * Everything shown is the server's projection: the tank, the counts and the
 * gain are never kept or computed as authority here. The one rule this surface
 * restates is `planRefuel`, the same pure function the server runs, only to
 * decide which button needs a confirmation. A load that would waste fuel (less
 * than a whole canister of headroom) says exactly how much it gains and how much
 * it wastes before anything is consumed; the server re-checks both.
 */
export function ShipRefuelControls({ cargoHoldReady }: { cargoHoldReady: boolean }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const { ship } = state;
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [feedback, setFeedback] = useState<{
    tone: "muted" | "danger" | "success";
    text: string;
  }>();
  const [pendingSource, setPendingSource] = useState<RefuelSource>();
  const [, startTransition] = useTransition();

  const counts: Record<RefuelSource, number> = {
    inventory: ship.canisters.inventory,
    cargo_hold: ship.canisters.cargoHold,
  };
  const full = ship.fuelUnits >= ship.tankCapacityFuelUnits;

  // A tank, a canister count or a flight that changed under an open
  // confirmation makes its numbers stale, so it closes rather than confirming them.
  useEffect(() => {
    setConfirmation(undefined);
  }, [ship.fuelUnits, ship.canisters.inventory, ship.canisters.cargoHold]);

  function planFor(source: RefuelSource) {
    return planRefuel({
      fuelUnits: ship.fuelUnits,
      tankCapacityFuelUnits: ship.tankCapacityFuelUnits,
      canisterFuelUnits: ship.canisterFuelUnits,
      canistersAvailable: counts[source],
    });
  }

  function load(source: RefuelSource, confirmedGainFuelUnits?: number) {
    enqueueForeground(() => {
      setPendingSource(source);
      setFeedback(undefined);
      startTransition(async () => {
        try {
          const result = await refuelShipAction({
            characterId: state.characterId,
            source,
            expectedFuelUnits: ship.fuelUnits,
            ...(confirmedGainFuelUnits !== undefined ? { confirmedGainFuelUnits } : {}),
          });
          if ("error" in result) {
            setFeedback({ tone: "danger", text: result.error });
            return;
          }
          acceptState(result.state);
          if (result.refuel.status === "loaded") {
            const { gainedFuelUnits, wastedFuelUnits } = result.refuel;
            setFeedback({
              tone: "success",
              text:
                wastedFuelUnits > 0
                  ? `Loaded ${gainedFuelUnits} FU. ${wastedFuelUnits} FU did not fit and was wasted.`
                  : `Loaded ${gainedFuelUnits} FU.`,
            });
          } else {
            setFeedback({ tone: "danger", text: result.refuel.message });
          }
        } catch {
          setFeedback({
            tone: "danger",
            text: "Comms interruption. The tank could not be confirmed; check the gauge.",
          });
        } finally {
          setConfirmation(undefined);
          setPendingSource(undefined);
          releaseCommand();
        }
      });
    });
  }

  function choose(source: RefuelSource) {
    const plan = planFor(source);
    if (!plan.ok) return;
    if (plan.requiresConfirmation) {
      setFeedback(undefined);
      setConfirmation({
        source,
        gained: plan.gainedFuelUnits,
        wasted: plan.wastedFuelUnits,
      });
      return;
    }
    load(source);
  }

  const detail = `${ship.fuelUnits} / ${ship.tankCapacityFuelUnits} FU`;

  return (
    <section className="space-y-3" data-ship-refuel>
      <h3 className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
        Fuel
      </h3>
      <div data-ship-tank={ship.fuelUnits}>
        <StatusMeter
          detail={detail}
          label="Tank"
          value={(ship.fuelUnits / ship.tankCapacityFuelUnits) * 100}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["inventory", "cargo_hold"] as const).map((source) => {
          const count = counts[source];
          const empty = count < 1;
          const reason = full
            ? "The tank is full."
            : empty
              ? source === "cargo_hold" && !cargoHoldReady
                ? "The Cargo Hold is not restored."
                : `No Full Small Fuel Canister in ${SOURCE_LABELS[source].place}.`
              : undefined;
          return (
            <div className="space-y-1.5" key={source}>
              <ActionButton
                className="w-full"
                data-ship-refuel-source={source}
                disabled={full || empty || pendingSource !== undefined}
                intent="mining"
                loading={foregroundBusy && pendingSource === source}
                onClick={() => choose(source)}
              >
                {SOURCE_LABELS[source].action} ({count})
              </ActionButton>
              {reason ? (
                <p
                  className="text-xs text-[color:var(--rs-text-muted)]"
                  data-ship-refuel-reason={source}
                >
                  {reason}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {confirmation ? (
        <div
          className="space-y-3 border border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-surface-panel)] p-3"
          data-ship-refuel-confirm
          role="alertdialog"
        >
          <p className="text-sm text-[color:var(--rs-text-primary)]" data-ship-refuel-waste>
            The tank has room for only {confirmation.gained} FU. Loading a canister from{" "}
            {SOURCE_LABELS[confirmation.source].place} adds {confirmation.gained} FU and wastes{" "}
            {confirmation.wasted} FU.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              data-ship-refuel-confirm-load
              intent="danger"
              onClick={() => load(confirmation.source, confirmation.gained)}
            >
              CONFIRM LOAD
            </ActionButton>
            <ActionButton intent="secondary" onClick={() => setConfirmation(undefined)}>
              CANCEL
            </ActionButton>
          </div>
        </div>
      ) : null}
      {feedback ? (
        <div data-ship-refuel-feedback>
          <Feedback tone={feedback.tone}>{feedback.text}</Feedback>
        </div>
      ) : null}
    </section>
  );
}
