import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FlightPanel } from "@/features/ship/FlightPanel";
import { ShipArrivalNotice } from "@/features/ship/ShipArrivalNotice";
import { ShipFlightControls } from "@/features/ship/ShipFlightControls";
import { ShipPanel } from "@/features/ship/ShipPanel";
import { ShipRefuelControls } from "@/features/ship/ShipRefuelControls";
import {
  flightCountdown,
  flightProgressPercent,
  isPlayInTransit,
  isShipInFlight,
} from "@/features/ship/flight";
import { REPAIR_TARGET_IDS, SHIP_ROUTE_IDS } from "@/game/config/foundations";
import type { ShipProjection } from "@/server/ship-state";
import { EMPTY_SHIP_PROJECTION } from "./ship-projection-fixture";

const play = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({
    state: play.state,
    foregroundBusy: false,
    enqueueForeground: () => undefined,
    releaseCommand: () => undefined,
    acceptState: () => undefined,
  }),
}));
vi.mock("@/server/actions", () => ({
  refuelShipAction: vi.fn(),
  launchShipAction: vi.fn(),
  acknowledgeShipArrivalAction: vi.fn(),
  contributeRepairMaterialsAction: vi.fn(),
  startWeldingAction: vi.fn(),
  stopWeldingAction: vi.fn(),
  depositCargoStackAction: vi.fn(),
  depositCargoUniqueItemAction: vi.fn(),
  withdrawCargoStackAction: vi.fn(),
  withdrawCargoUniqueItemAction: vi.fn(),
}));

function setState(ship: Partial<ShipProjection>, extra: Record<string, unknown> = {}) {
  play.state = {
    characterId: "00000000-0000-4000-8000-000000000001",
    location: { currentLocationId: "crash_site" },
    missions: [],
    repairs: {},
    ship: { ...EMPTY_SHIP_PROJECTION, ...ship },
    ...extra,
  };
}

const render = (component: () => React.ReactElement | null) =>
  renderToStaticMarkup(React.createElement(component));

const route = {
  routeId: SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding,
  destinationLocationId: "holo_hollow_landing",
  destinationName: "Holo Hollow Landing",
  fuelCostFuelUnits: 10,
  durationMs: 15_000,
  launchNotice: "Launching permanently moves your ship from the Crash Site to Holo Hollow Landing.",
};

describe("transit helpers", () => {
  it("treat a flight like a Journey, from the server's projection alone", () => {
    expect(isShipInFlight({ ship: EMPTY_SHIP_PROJECTION })).toBe(false);
    const flying = {
      ...EMPTY_SHIP_PROJECTION,
      flight: {
        routeId: route.routeId,
        originLocationId: "crash_site",
        destinationLocationId: "holo_hollow_landing",
        destinationName: "Holo Hollow Landing",
        startedAt: "2026-10-15T12:00:00.000Z",
        arrivesAt: "2026-10-15T12:00:15.000Z",
        fuelCostFuelUnits: 10,
      },
    };
    expect(isShipInFlight({ ship: flying })).toBe(true);
    expect(isPlayInTransit({ ship: flying, travelState: undefined })).toBe(true);
    expect(isPlayInTransit({ ship: EMPTY_SHIP_PROJECTION, travelState: undefined })).toBe(false);
  });

  it("counts down from the recorded instants and never lands on a client clock", () => {
    const flight = { startedAt: "2026-10-15T12:00:00.000Z", arrivesAt: "2026-10-15T12:00:15.000Z" };
    const at = (seconds: number) =>
      new Date(`2026-10-15T12:00:${String(seconds).padStart(2, "0")}Z`).getTime();
    expect(flightProgressPercent(flight, at(0))).toBe(0);
    expect(flightProgressPercent(flight, at(0) + 7_500)).toBe(50);
    expect(flightProgressPercent(flight, at(15))).toBe(100);
    expect(flightProgressPercent(flight, at(40))).toBe(100);
    expect(flightCountdown(flight, at(10))).toEqual({ remainingSeconds: 5, arrivalPending: false });
    // Past the instant it only says touchdown is pending; the server confirms it.
    expect(flightCountdown(flight, at(16))).toEqual({ remainingSeconds: 0, arrivalPending: true });
  });
});

describe("ShipRefuelControls", () => {
  it("shows the tank and exactly two direct source actions with their counts", () => {
    setState({ fuelUnits: 120, canisters: { inventory: 2, cargoHold: 3 } });
    const markup = render(() => React.createElement(ShipRefuelControls, { cargoHoldReady: true }));
    expect(markup).toContain("120 / 300 FU");
    expect(markup).toContain("LOAD FROM INVENTORY");
    expect(markup).toContain("LOAD FROM CARGO HOLD");
    expect(markup).toContain("(2)");
    expect(markup).toContain("(3)");
    expect(markup.match(/data-ship-refuel-source=/g)).toHaveLength(2);
    // No dropdown, no bulk "fuel all".
    expect(markup).not.toMatch(/<select|fuel all|load all/i);
    expect(markup).not.toContain('disabled=""');
  });

  it("disables an empty source with meaningful copy, and both when the tank is full", () => {
    setState({ fuelUnits: 10, canisters: { inventory: 0, cargoHold: 1 } });
    const empty = render(() => React.createElement(ShipRefuelControls, { cargoHoldReady: true }));
    expect(empty).toContain("No Full Small Fuel Canister in Inventory.");
    expect(empty.match(/disabled=""/g)).toHaveLength(1);

    setState({ fuelUnits: 300, canisters: { inventory: 1, cargoHold: 1 } });
    const full = render(() => React.createElement(ShipRefuelControls, { cargoHoldReady: true }));
    expect(full).toContain("The tank is full.");
    expect(full.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("ShipFlightControls", () => {
  it("shows destination, cost, tank before and after, the permanence note and one LAUNCH", () => {
    setState({ fuelUnits: 40, routes: [route] });
    const markup = render(() => React.createElement(ShipFlightControls));
    expect(markup).toContain("Holo Hollow Landing");
    expect(markup).toContain("10 FU");
    expect(markup).toContain("40 / 300 FU");
    expect(markup).toContain("30 / 300 FU");
    expect(markup).toContain("permanently moves your ship");
    expect(markup.match(/LAUNCH/g)).toHaveLength(1);
    expect(markup).not.toMatch(/confirm/i);
    expect(markup).not.toContain('disabled=""');
  });

  it("disables LAUNCH and says why, instead of a dead control", () => {
    setState({
      fuelUnits: 40,
      routes: [
        {
          ...route,
          launchRefusal: {
            reason: "mission_not_accepted",
            message: "Talk to Wade at Rusk Recovery to accept Move Along.",
          },
        },
      ],
    });
    const markup = render(() => React.createElement(ShipFlightControls));
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Talk to Wade at Rusk Recovery to accept Move Along.");
  });

  it("offers no flight from a berth with no route, and nothing back to the Crash Site", () => {
    setState({
      berthLocationId: "holo_hollow_landing",
      berthName: "Holo Hollow Landing",
      routes: [],
    });
    const markup = render(() => React.createElement(ShipFlightControls));
    expect(markup).toContain("No flights are available from Holo Hollow Landing.");
    expect(markup).not.toContain("LAUNCH");
  });
});

describe("ShipArrivalNotice", () => {
  it("shows the flight and the Mission it completed, with no reward tile or portrait", () => {
    setState({
      arrivalNotice: {
        noticeId: "00000000-0000-4000-8000-0000000000aa",
        routeId: route.routeId,
        destinationLocationId: "holo_hollow_landing",
        destinationName: "Holo Hollow Landing",
        arrivedAt: "2026-10-15T12:00:15.000Z",
        completedMissionId: "move_along",
        completedMissionTitle: "Move Along",
      },
    });
    const markup = render(() => React.createElement(ShipArrivalNotice));
    expect(markup).toContain("Flight complete — Arrived at Holo Hollow Landing");
    expect(markup).toContain("Mission Complete: Move Along");
    expect(markup).toContain("DISMISS");
    expect(markup).not.toMatch(/reward|Wade|portrait|toast/i);
  });

  it("omits the Mission line when the landing completed none, and renders nothing without a receipt", () => {
    setState({
      arrivalNotice: {
        noticeId: "00000000-0000-4000-8000-0000000000bb",
        routeId: route.routeId,
        destinationLocationId: "holo_hollow_landing",
        destinationName: "Holo Hollow Landing",
        arrivedAt: "2026-10-15T12:00:15.000Z",
      },
    });
    expect(render(() => React.createElement(ShipArrivalNotice))).not.toContain("Mission Complete");
    setState({});
    expect(render(() => React.createElement(ShipArrivalNotice))).toBe("");
  });
});

describe("FlightPanel", () => {
  it("renders nothing on the ground and a labelled countdown in the air", () => {
    setState({});
    expect(render(() => React.createElement(FlightPanel))).toBe("");
    setState({
      flight: {
        routeId: route.routeId,
        originLocationId: "crash_site",
        destinationLocationId: "holo_hollow_landing",
        destinationName: "Holo Hollow Landing",
        startedAt: new Date(Date.now() - 5_000).toISOString(),
        arrivesAt: new Date(Date.now() + 10_000).toISOString(),
        fuelCostFuelUnits: 10,
      },
    });
    const markup = render(() => React.createElement(FlightPanel));
    expect(markup).toContain("data-flight-surface");
    expect(markup).toContain("Holo Hollow Landing");
    expect(markup).toContain("MINIMIZE");
    expect(markup).toMatch(/\d+ seconds? remaining/);
    // No cancel, abort or refund control: the only button is Minimize.
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain("The flight cannot be cancelled.");
  });
});

describe("ShipPanel", () => {
  // A system not yet authorized for repair reads as offline; no repair work is shown.
  const repair = (complete: boolean) => ({
    targetId: "x",
    complete,
    repairAvailable: false,
    materials: [],
    welding: { completed: 0, required: 1 },
  });

  it("is absent where the ship is not, and one panel of three system sections where it is", () => {
    setState(
      { berthLocationId: "holo_hollow_landing" },
      { repairs: { [REPAIR_TARGET_IDS.cargoHold]: repair(false) } },
    );
    expect(render(() => React.createElement(ShipPanel))).toBe("");

    setState({}, { repairs: { [REPAIR_TARGET_IDS.cargoHold]: repair(false) } });
    const wreck = render(() => React.createElement(ShipPanel));
    expect(wreck.match(/data-ship-panel/g)).toHaveLength(1);
    expect(wreck).toContain("Rivet Utility Shuttle");
    expect(wreck).toContain("Berthed at Crash Site");
    // One panel, three sections — not three stacked cards.
    expect(wreck.match(/data-ship-system=/g)).toHaveLength(3);
    expect(wreck.match(/data-activity-panel/g)).toHaveLength(1);
    // Nothing to fly until the drive is restored.
    expect(wreck).not.toContain("BOARD SHIP");
  });

  it("keeps the Cargo Hold usable once repaired, before Propulsion, with no Board Ship yet", () => {
    setState(
      {},
      {
        repairs: {
          [REPAIR_TARGET_IDS.cargoHold]: repair(true),
          [REPAIR_TARGET_IDS.landingGear]: repair(false),
          [REPAIR_TARGET_IDS.propulsionSystem]: repair(false),
        },
        cargoHold: { slotsUsed: 0, stacks: [], uniqueItems: [] },
      },
    );
    const markup = render(() => React.createElement(ShipPanel));
    expect(markup).toContain("Cargo Hold operational.");
    expect(markup).toContain("OPEN CARGO HOLD");
    expect(markup).not.toContain("BOARD SHIP");
  });

  it("offers Board Ship once Propulsion is restored, with fuel and flight behind it", () => {
    setState(
      {},
      {
        repairs: {
          [REPAIR_TARGET_IDS.cargoHold]: repair(true),
          [REPAIR_TARGET_IDS.landingGear]: repair(true),
          [REPAIR_TARGET_IDS.propulsionSystem]: repair(true),
        },
        cargoHold: { slotsUsed: 0, stacks: [], uniqueItems: [] },
      },
    );
    const markup = render(() => React.createElement(ShipPanel));
    expect(markup).toContain("BOARD SHIP");
    // Closed until the player boards.
    expect(markup).not.toContain("data-ship-bay");
    expect(markup).not.toContain("LAUNCH");
    // Restored systems keep their status and are not repeated as repair cards.
    expect(markup).toContain("Propulsion restored.");
    expect(markup.match(/data-ship-system-status="complete"/g)).toHaveLength(3);
  });
});
