"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";
import {
  flightVisualsSettled,
  waitForFlightVisuals,
  warmFlightCinematic,
} from "@/features/ship/flight-cinematic-images";
import { flightDurationLabel } from "@/features/ship/flight";
import { StarChart } from "@/features/ship/StarChart";
import {
  isInterplanetaryRoute,
  resolveStarChartRoute,
  starChartModel,
  type ShipRouteProjection,
  type StarChartModel,
} from "@/features/ship/star-chart";
import { getLocationPlanetId } from "@/game/content/locations";
import { getPlanetPresentation } from "@/game/content/planets";
import { launchShipAction } from "@/server/actions";
import type { ShipProjection } from "@/server/ship-state";

/**
 * The Flight Controls (#358): the authored routes from the ship's actual berth,
 * each with its destination, cost and the tank before and after, one LAUNCH
 * control, and an explicit note that departure moves the ship. There is no
 * second confirmation: the note is the warning, and the button is the decision.
 *
 * A hop on one planet (the first flight) is a single launch card. Flights to
 * another world are chosen on the star chart (#377): the berth's world as the
 * origin, each world a projected route lands on, and a compact readout with
 * LAUNCH for the selected route. With exactly one launchable route it is
 * selected already. Selecting sends nothing; LAUNCH sends that route's ID.
 *
 * Whether a launch would be refused, and the words that say why, are the
 * server's own verdict from the same facts the launch command re-checks, so
 * "Report Thrust Issues to Wade at Rusk Recovery to start Move Along" is shown instead of a
 * dead control. The browser contributes a route ID and nothing else.
 *
 * Opening these controls (Board Ship) starts fetching and decoding the flight
 * cinematic's art (#359), so takeoff never opens on a blank frame. A LAUNCH tap
 * before that has finished shows "Preparing launch visuals…" and sends the
 * ordinary launch command as soon as the art is ready, fails, or
 * `FLIGHT_VISUALS_WAIT_MS` passes. Nothing is spent, recorded or timed until
 * that command succeeds, and the art never decides whether a launch is allowed.
 */
export function ShipFlightControls() {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const { ship } = state;
  const [feedback, setFeedback] = useState<string>();
  const [launching, setLaunching] = useState(false);
  const [preparingRouteId, setPreparingRouteId] = useState<string>();
  // The star chart's selection (#377): presentation only, until LAUNCH.
  const [chosenRouteId, setChosenRouteId] = useState<string>();
  const readoutId = useId();
  const [, startTransition] = useTransition();
  const mounted = useRef(true);
  const routeIds = ship.routes.map((route) => route.routeId).join("|");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const routeId of routeIds.split("|")) if (routeId) warmFlightCinematic(routeId);
  }, [routeIds]);

  function requestLaunch(routeId: string) {
    if (launching || preparingRouteId) return;
    setFeedback(undefined);
    if (flightVisualsSettled(routeId)) {
      launch(routeId);
      return;
    }
    setPreparingRouteId(routeId);
    void waitForFlightVisuals(routeId).then(() => {
      // Closing the panel while waiting abandons the tap: nothing was sent.
      if (!mounted.current) return;
      setPreparingRouteId(undefined);
      launch(routeId);
    });
  }

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

  const model = starChartModel(ship);
  const localRoutes = ship.routes.filter(
    (route) => !isInterplanetaryRoute(ship.berthLocationId, route),
  );
  const selectedRoute = model ? resolveStarChartRoute(model, chosenRouteId) : undefined;
  const launchProps = { launching, preparingRouteId, foregroundBusy, onLaunch: requestLaunch };

  return (
    <section className="space-y-3" data-ship-flight-controls>
      <h3 className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
        Flight controls
      </h3>
      {ship.routes.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-secondary)]" data-ship-no-routes>
          No flights are available from {ship.berthName}.
        </p>
      ) : null}
      {/* A hop on one planet, such as the first flight to Holo Hollow Landing,
          keeps its own launch card; only flights to another world use the chart. */}
      {localRoutes.map((route) => (
        <LocalRouteCard key={route.routeId} route={route} ship={ship} {...launchProps} />
      ))}
      {model ? (
        <>
          <StarChart
            berthName={ship.berthName}
            model={model}
            onSelect={setChosenRouteId}
            readoutId={readoutId}
            selectedRouteId={selectedRoute?.routeId}
            selectionLocked={launching || preparingRouteId !== undefined}
          />
          <RouteReadout
            id={readoutId}
            model={model}
            onSelect={setChosenRouteId}
            route={selectedRoute}
            ship={ship}
            {...launchProps}
          />
        </>
      ) : null}
      {feedback ? (
        <div data-ship-launch-feedback>
          <Feedback tone="danger">{feedback}</Feedback>
        </div>
      ) : null}
    </section>
  );
}

type LaunchProps = {
  launching: boolean;
  preparingRouteId: string | undefined;
  foregroundBusy: boolean;
  onLaunch: (routeId: string) => void;
};

/** The launch card for a hop on one planet (#358): unchanged by the star chart. */
function LocalRouteCard({
  route,
  ship,
  launching,
  preparingRouteId,
  foregroundBusy,
  onLaunch,
}: LaunchProps & { route: ShipRouteProjection; ship: ShipProjection }) {
  return (
    <div
      className="space-y-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-ship-route={route.routeId}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-[color:var(--rs-text-muted)]">Destination</dt>
        <dd className="font-semibold text-[color:var(--rs-text-primary)]">
          {route.destinationName}
        </dd>
        <dt className="text-[color:var(--rs-text-muted)]">Fuel cost</dt>
        <dd data-ship-route-cost>{route.fuelCostFuelUnits} FU</dd>
        <dt className="text-[color:var(--rs-text-muted)]">Flight time</dt>
        <dd data-ship-route-duration>{flightDurationLabel(route.durationMs)}</dd>
        <dt className="text-[color:var(--rs-text-muted)]">Tank now</dt>
        <dd data-ship-route-tank-now>
          {ship.fuelUnits} / {ship.tankCapacityFuelUnits} FU
        </dd>
        <dt className="text-[color:var(--rs-text-muted)]">Tank after arrival</dt>
        <dd data-ship-route-tank-after>
          {Math.max(0, ship.fuelUnits - route.fuelCostFuelUnits)} / {ship.tankCapacityFuelUnits} FU
        </dd>
      </dl>
      <p className="text-sm text-[color:var(--rs-text-secondary)]" data-ship-route-notice>
        {route.launchNotice}
      </p>
      <ReturnFuelWarning route={route} />
      <LaunchControl
        foregroundBusy={foregroundBusy}
        launching={launching}
        onLaunch={onLaunch}
        preparingRouteId={preparingRouteId}
        route={route}
      />
    </div>
  );
}

/**
 * The star chart's compact route readout (#377): the selected leg's destination,
 * its authored cost and time, the tank now and after landing, the permanence
 * note, the server's nonblocking return-fuel warning, and LAUNCH for exactly
 * this route, or the server's reason it cannot launch. Every figure is the
 * projected route's own; nothing is recomputed but the subtraction the launch
 * card already shows.
 */
function RouteReadout({
  id,
  model,
  route,
  ship,
  onSelect,
  ...launch
}: LaunchProps & {
  id: string;
  model: StarChartModel;
  route: ShipRouteProjection | undefined;
  ship: ShipProjection;
  onSelect: (routeId: string) => void;
}) {
  if (!route) {
    return (
      <p
        className="border border-dashed border-[color:var(--rs-border-structural)] p-3 text-sm text-[color:var(--rs-text-secondary)]"
        data-star-chart-prompt
        id={id}
      >
        Choose a destination on the star chart to see the flight.
      </p>
    );
  }
  const planetId = getLocationPlanetId(route.destinationLocationId);
  const siblings =
    model.destinations.find((destination) => destination.planetId === planetId)?.routes ?? [];
  const stats = [
    ["Fuel cost", "data-ship-route-cost", `${route.fuelCostFuelUnits} FU`],
    ["Flight time", "data-ship-route-duration", flightDurationLabel(route.durationMs)],
    [
      "Fuel now",
      "data-ship-route-tank-now",
      `${ship.fuelUnits} / ${ship.tankCapacityFuelUnits} FU`,
    ],
    [
      "Fuel after landing",
      "data-ship-route-tank-after",
      `${Math.max(0, ship.fuelUnits - route.fuelCostFuelUnits)} / ${ship.tankCapacityFuelUnits} FU`,
    ],
  ] as const;

  return (
    <div
      className="space-y-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-ship-route={route.routeId}
      data-star-chart-readout
      id={id}
    >
      <p aria-live="polite" className="text-sm" data-star-chart-readout-destination>
        <span className="font-display text-xs uppercase tracking-[0.14em] text-[color:var(--rs-text-muted)]">
          Destination{" "}
        </span>
        <strong className="text-[color:var(--rs-text-primary)]">{route.destinationName}</strong>
        {planetId ? (
          <span className="text-[color:var(--rs-text-secondary)]">
            {" "}
            · {getPlanetPresentation(planetId).displayName}
          </span>
        ) : null}
      </p>
      {siblings.length > 1 ? (
        // More than one authored station on the selected world: pick the one to land at.
        <div className="flex flex-wrap gap-2" data-star-chart-stations>
          {siblings.map((sibling) => (
            <ActionButton
              aria-pressed={sibling.routeId === route.routeId}
              data-star-chart-station-choice={sibling.routeId}
              disabled={launch.launching || launch.preparingRouteId !== undefined}
              intent={sibling.routeId === route.routeId ? "primary" : "secondary"}
              key={sibling.routeId}
              onClick={() => onSelect(sibling.routeId)}
            >
              {sibling.destinationName}
            </ActionButton>
          ))}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {stats.map(([label, attribute, value]) => (
          <div key={attribute}>
            <dt className="text-xs text-[color:var(--rs-text-muted)]">{label}</dt>
            <dd
              className="font-semibold text-[color:var(--rs-text-primary)]"
              {...{ [attribute]: "" }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <ReturnFuelWarning route={route} />
      <LaunchControl {...launch} route={route} wide />
      <p className="text-xs text-[color:var(--rs-text-secondary)]" data-ship-route-notice>
        {route.launchNotice}
      </p>
    </div>
  );
}

function ReturnFuelWarning({ route }: { route: ShipRouteProjection }) {
  if (!route.returnFuelWarning) return null;
  // The server's own projection (#375): a warning, never a gate.
  return (
    <p
      className="border-l-2 border-[color:var(--rs-accent-mining)] pl-3 text-sm text-[color:var(--rs-text-primary)]"
      data-ship-return-fuel-warning
    >
      You will land with {route.returnFuelWarning.fuelAfterArrival} FU, less than the{" "}
      {route.returnFuelWarning.returnFuelCostFuelUnits} FU the flight back needs. Nothing refuels
      the Rivet for free and there is no automatic return: you will need to load fuel bought, traded
      or made there before you can fly back.
    </p>
  );
}

/** LAUNCH for one route, its preparing note, and the server's reason when it would be refused. */
function LaunchControl({
  route,
  launching,
  preparingRouteId,
  foregroundBusy,
  onLaunch,
  wide = false,
}: LaunchProps & { route: ShipRouteProjection; wide?: boolean }) {
  return (
    <>
      <ActionButton
        className={wide ? "w-full sm:w-auto sm:min-w-48" : ""}
        data-ship-launch={route.routeId}
        disabled={route.launchRefusal !== undefined || launching || preparingRouteId !== undefined}
        intent="primary"
        loading={(foregroundBusy && launching) || preparingRouteId === route.routeId}
        onClick={() => onLaunch(route.routeId)}
      >
        LAUNCH
      </ActionButton>
      {preparingRouteId === route.routeId ? (
        <p
          className="text-sm text-[color:var(--rs-text-secondary)]"
          data-ship-launch-preparing
          role="status"
        >
          Preparing launch visuals…
        </p>
      ) : null}
      {route.launchRefusal ? (
        <p
          className="text-sm text-[color:var(--rs-text-muted)]"
          data-ship-launch-guidance={route.launchRefusal.reason}
        >
          {route.launchRefusal.message}
        </p>
      ) : null}
    </>
  );
}
