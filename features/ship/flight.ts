import type { PlayGameplayState } from "@/server/play";

/**
 * Whether the character's Rivet is in the air (#358). Read from the
 * server-projected flight, never from a client clock: the flight exists until
 * the server confirms the landing.
 */
export function isShipInFlight(state: Pick<PlayGameplayState, "ship">): boolean {
  return state.ship.flight !== undefined;
}

/**
 * Whether a Milky Waymo shuttle is carrying the character (#404). Read from the
 * server-projected journey, never from a client clock.
 */
export function isPassengerInTransit(state: Pick<PlayGameplayState, "passenger">): boolean {
  return state.passenger.journey !== undefined;
}

/**
 * Whether the character is between places for any reason: walking, riding,
 * flying their own ship, or riding a passenger shuttle. Every surface that
 * stands down while in transit asks this, so a flight or a shuttle journey
 * blocks the same things a Journey does.
 */
export function isPlayInTransit(
  state: Pick<PlayGameplayState, "ship" | "travelState" | "passenger">,
): boolean {
  return Boolean(state.travelState) || isShipInFlight(state) || isPassengerInTransit(state);
}

/** Fraction of the flight completed, 0..100, from the server's own recorded instants. */
export function flightProgressPercent(
  flight: { startedAt: string; arrivesAt: string },
  nowMs: number,
): number {
  const start = new Date(flight.startedAt).getTime();
  const end = new Date(flight.arrivesAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(100, Math.max(0, ((nowMs - start) / (end - start)) * 100));
}

/**
 * The flight's remaining whole-second countdown and whether the local clock has
 * passed the scheduled arrival. Passing it never lands anything: the client only
 * shows "arrival pending" until the server's next read confirms touchdown.
 */
export function flightCountdown(
  flight: { arrivesAt: string },
  nowMs: number,
): { remainingSeconds: number; arrivalPending: boolean } {
  const remainingMs = new Date(flight.arrivesAt).getTime() - nowMs;
  return {
    remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1_000)),
    arrivalPending: remainingMs <= 0,
  };
}

/**
 * The first-flight cinematic's three visual phases (#359): lift off the origin
 * pad, cross the local chart, settle onto the destination pad.
 */
export type FlightCinematicPhase = "takeoff" | "travel" | "landing";

/**
 * Visual tuning targets for the takeoff and landing phases. They divide the
 * server's recorded flight; they never lengthen it. A flight shorter than these
 * allow scales them down so the chart always keeps the middle of the flight.
 */
export const FLIGHT_CINEMATIC_TAKEOFF_MS = 2_500;
export const FLIGHT_CINEMATIC_LANDING_MS = 3_000;

export type FlightCinematicFrame = {
  phase: FlightCinematicPhase;
  /** How far into the current phase the flight is, so a reload resumes mid-motion. */
  phaseElapsedMs: number;
  phaseDurationMs: number;
  /** Fraction of the chart leg flown, 0..1: 0 through takeoff, 1 from landing on. */
  travelProgress: number;
  /** The local clock has passed the scheduled arrival; only the server lands the ship. */
  arrivalPending: boolean;
};

/**
 * Which phase of the cinematic a flight is in, normalised against the server's
 * own recorded start and arrival instants, never a client stopwatch. Reloading,
 * reopening or reconnecting therefore lands in the same place the flight
 * actually is. Past the arrival instant it holds the settled landing pose and
 * reports arrival pending; it never decides that the ship has landed.
 */
export function flightCinematicFrame(
  flight: { startedAt: string; arrivesAt: string },
  nowMs: number,
): FlightCinematicFrame {
  const start = new Date(flight.startedAt).getTime();
  const end = new Date(flight.arrivesAt).getTime();
  const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
  const takeoffMs = Math.min(FLIGHT_CINEMATIC_TAKEOFF_MS, durationMs / 6);
  const landingMs = Math.min(FLIGHT_CINEMATIC_LANDING_MS, durationMs / 5);
  const travelMs = durationMs - takeoffMs - landingMs;
  const arrivalPending = durationMs === 0 || nowMs >= end;
  const elapsedMs = arrivalPending ? durationMs : Math.max(0, nowMs - start);

  if (elapsedMs < takeoffMs) {
    return {
      phase: "takeoff",
      phaseElapsedMs: elapsedMs,
      phaseDurationMs: takeoffMs,
      travelProgress: 0,
      arrivalPending,
    };
  }
  if (elapsedMs < takeoffMs + travelMs) {
    return {
      phase: "travel",
      phaseElapsedMs: elapsedMs - takeoffMs,
      phaseDurationMs: travelMs,
      travelProgress: (elapsedMs - takeoffMs) / travelMs,
      arrivalPending,
    };
  }
  return {
    phase: "landing",
    phaseElapsedMs: elapsedMs - takeoffMs - travelMs,
    phaseDurationMs: landingMs,
    travelProgress: 1,
    arrivalPending,
  };
}

/** "15 seconds", "4 min 20 s": the route's authored duration, never rounded up. */
export function flightDurationLabel(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds} seconds`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}
