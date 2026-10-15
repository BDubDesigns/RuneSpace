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
 * Whether the character is between places for any reason: walking, riding, or
 * flying. Every surface that stands down while in transit asks this, so a
 * flight blocks the same things a Journey does.
 */
export function isPlayInTransit(state: Pick<PlayGameplayState, "ship" | "travelState">): boolean {
  return Boolean(state.travelState) || isShipInFlight(state);
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
