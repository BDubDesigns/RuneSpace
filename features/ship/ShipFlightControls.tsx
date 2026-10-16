"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import { launchShipAction } from "@/server/actions";

/**
 * The Flight Controls (#358): one authored route at a time from the ship's
 * actual berth, with its destination, cost and the tank before and after, one
 * LAUNCH control, and an explicit note that departure permanently moves the
 * ship. There is no second confirmation: the note is the warning, and the
 * button is the decision.
 *
 * Whether a launch would be refused, and the words that say why, are the
 * server's own verdict from the same facts the launch command re-checks, so
 * "Report Thrust Issues to Wade at Rusk Recovery to start Move Along" is shown instead of a
 * dead control. The browser contributes a route ID and nothing else.
 */
export function ShipFlightControls() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const { ship } = state;
  const [feedback, setFeedback] = useState<string>();
  const [launching, setLaunching] = useState(false);
  const [, startTransition] = useTransition();

  function launch(routeId: string) {
    enqueueForeground(() => {
      setLaunching(true);
      setFeedback(undefined);
      startTransition(async () => {
        try {
          const result = await launchShipAction({ characterId: state.characterId, routeId });
          if ("error" in result) {
            setFeedback(result.error);
            return;
          }
          acceptState(result.state);
          if (result.launch.status === "refused") setFeedback(result.launch.message);
        } catch {
          setFeedback("Comms interruption. The launch could not be confirmed; check the gauge.");
        } finally {
          setLaunching(false);
          releaseCommand();
        }
      });
    });
  }

  return (
    <section className="space-y-3" data-ship-flight-controls>
      <h3 className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
        Flight controls
      </h3>
      {ship.routes.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-secondary)]" data-ship-no-routes>
          No flights are available from {ship.berthName}.
        </p>
      ) : (
        ship.routes.map((route) => (
          <div
            className="space-y-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
            data-ship-route={route.routeId}
            key={route.routeId}
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-[color:var(--rs-text-muted)]">Destination</dt>
              <dd className="font-semibold text-[color:var(--rs-text-primary)]">
                {route.destinationName}
              </dd>
              <dt className="text-[color:var(--rs-text-muted)]">Fuel cost</dt>
              <dd data-ship-route-cost>{route.fuelCostFuelUnits} FU</dd>
              <dt className="text-[color:var(--rs-text-muted)]">Flight time</dt>
              <dd>{Math.round(route.durationMs / 1_000)} seconds</dd>
              <dt className="text-[color:var(--rs-text-muted)]">Tank now</dt>
              <dd data-ship-route-tank-now>
                {ship.fuelUnits} / {ship.tankCapacityFuelUnits} FU
              </dd>
              <dt className="text-[color:var(--rs-text-muted)]">Tank after arrival</dt>
              <dd data-ship-route-tank-after>
                {Math.max(0, ship.fuelUnits - route.fuelCostFuelUnits)} /{" "}
                {ship.tankCapacityFuelUnits} FU
              </dd>
            </dl>
            <p className="text-sm text-[color:var(--rs-text-secondary)]" data-ship-route-notice>
              {route.launchNotice}
            </p>
            <ActionButton
              data-ship-launch={route.routeId}
              disabled={route.launchRefusal !== undefined || launching}
              intent="primary"
              loading={foregroundBusy && launching}
              onClick={() => launch(route.routeId)}
            >
              LAUNCH
            </ActionButton>
            {route.launchRefusal ? (
              <p
                className="text-sm text-[color:var(--rs-text-muted)]"
                data-ship-launch-guidance={route.launchRefusal.reason}
              >
                {route.launchRefusal.message}
              </p>
            ) : null}
          </div>
        ))
      )}
      {feedback ? (
        <div data-ship-launch-feedback>
          <Feedback tone="danger">{feedback}</Feedback>
        </div>
      ) : null}
    </section>
  );
}
