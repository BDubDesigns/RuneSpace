"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { CargoHoldStorage } from "@/features/cargo/CargoHoldPanel";
import { usePlay } from "@/features/play/PlayContext";
import { ShipFlightControls } from "@/features/ship/ShipFlightControls";
import { ShipRefuelControls } from "@/features/ship/ShipRefuelControls";
import { deriveShipSystemState, ShipSystemSection } from "@/features/ship/ShipSystemPanel";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { REPAIR_TARGET_IDS } from "@/game/config/foundations";

/**
 * The one Ship panel (#358): a single presence at the ship's actual berth,
 * never a nav tab, a map hex or an enterable Local Place.
 *
 * It is the home of the ship's durable condition, its Cargo Hold, its fuel and
 * its flight controls. The three systems are sections of this one panel rather
 * than three stacked cards: a damaged system keeps its status line and, once
 * authorized, its repair interaction exactly where the Welding work and the
 * Mission guidance already point (`data-ship-system`); a repaired system keeps
 * its status and hosts its operational control, so nothing is shown twice. The
 * Cargo Hold's storage is usable as soon as the Hold is repaired, before
 * Propulsion or any flight.
 *
 * Fuel and flight sit behind one Board Ship control, and appear once Propulsion
 * is restored. The panel renders only where the ship actually is: after a
 * flight lands the same panel reflects the new berth, tank and Cargo Hold
 * there, and a character anywhere else sees no ship controls at all.
 */
export function ShipPanel() {
  const { state } = usePlay();
  const [boarded, setBoarded] = useState(false);

  if (state.location.currentLocationId !== state.ship.berthLocationId) return null;

  const cargoReady =
    deriveShipSystemState(state.repairs[REPAIR_TARGET_IDS.cargoHold]) === "complete";
  const propulsionReady =
    deriveShipSystemState(state.repairs[REPAIR_TARGET_IDS.propulsionSystem]) === "complete";

  return (
    <ActivityPanel
      data-ship-berth={state.ship.berthLocationId}
      data-ship-panel
      eyebrow="Ship"
      title="Rivet Utility Shuttle"
    >
      <p
        className="text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]"
        data-ship-berth-name
      >
        Berthed at {state.ship.berthName}
      </p>
      <ShipSystemSection
        data-cargo-hold
        materialsPrompt="Restore the damaged Cargo Hold with replacement plating and packed bulkhead filler. Refined Ferrite is structural material; Slag is thermal packing, not a welding tool."
        targetId={REPAIR_TARGET_IDS.cargoHold}
        weldingPrompt="The plating and filler are in. What is left is welding the hold's frame until it locks."
      >
        {({ justCompleted }) => <CargoHoldStorage justCompleted={justCompleted} />}
      </ShipSystemSection>
      <ShipSystemSection
        materialsPrompt="The wheels go under the ship and the mounts go on the hull. Hand over what you are carrying and bring the rest when you come back."
        targetId={REPAIR_TARGET_IDS.landingGear}
        weldingPrompt="Wheels seated, mounts in place. What is left is welding them to the frame."
      />
      <ShipSystemSection
        materialsPrompt="The drive mounts and the frame reinforcement go in first. Hand over what you are carrying and bring the rest when you come back."
        targetId={REPAIR_TARGET_IDS.propulsionSystem}
        weldingPrompt="Mounts seated, frame braced. What is left is welding the drive back into the ship."
      />
      {propulsionReady ? (
        <section
          className="space-y-4 border-t border-[color:var(--rs-border-structural)] pt-3"
          data-ship-flight-section
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-sm uppercase tracking-wide">Fuel and flight</p>
            <ActionButton
              aria-expanded={boarded}
              data-ship-board
              intent="mining"
              onClick={() => setBoarded((open) => !open)}
            >
              {boarded ? "LEAVE SHIP" : "BOARD SHIP"}
            </ActionButton>
          </div>
          {boarded ? (
            <div className="space-y-4" data-ship-bay>
              <ShipRefuelControls cargoHoldReady={cargoReady} />
              <ShipFlightControls />
            </div>
          ) : null}
        </section>
      ) : null}
    </ActivityPanel>
  );
}
