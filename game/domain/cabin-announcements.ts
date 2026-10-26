import {
  CABIN_ANNOUNCEMENT_POOL,
  CABIN_ANNOUNCEMENT_SLOT_SECONDS,
  CABIN_DEPARTURE_ANNOUNCEMENT,
  cabinArrivalAnnouncement,
} from "@/game/content/cabin-announcements";

/**
 * Which cabin announcement a passenger journey is on (#404). Pure and derived:
 * the choice depends only on the journey's own recorded start and arrival
 * instants and the clock, so a reload, a reopened panel or a second device lands
 * on the same line, and nothing about the flavor is persisted.
 */

/** The journey's identity for the shuffle: its route and its recorded departure. */
export function cabinAnnouncementSeed(journey: { routeId: string; startedAt: string }): string {
  return `${journey.routeId}@${journey.startedAt}`;
}

/** FNV-1a: a small, stable string hash. The seed is a label, not a secret. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: a tiny seeded generator, so the same seed always draws the same lines. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The pool indices of one journey's mid-flight lines, in the order they play:
 * `count` distinct entries of a `poolSize`-line pool, so nothing repeats within
 * a flight. A partial Fisher-Yates over the pool's indices.
 */
export function selectCabinAnnouncementIndices(
  seed: string,
  poolSize: number = CABIN_ANNOUNCEMENT_POOL.length,
  count: number = CABIN_ANNOUNCEMENT_SLOT_SECONDS.length,
): readonly number[] {
  if (!Number.isInteger(poolSize) || poolSize < count) {
    throw new RangeError("The announcement pool must hold at least one line per slot");
  }
  const random = seededRandom(hashSeed(seed));
  const indices = Array.from({ length: poolSize }, (_, index) => index);
  for (let slot = 0; slot < count; slot += 1) {
    const pick = slot + Math.floor(random() * (poolSize - slot));
    const held = indices[slot] as number;
    indices[slot] = indices[pick] as number;
    indices[pick] = held;
  }
  return indices.slice(0, count);
}

export type CabinAnnouncement = {
  phase: "departure" | "in_flight" | "arrival";
  /** Changes exactly when the line changes: what a presentation keys its typing on. */
  key: string;
  text: string;
};

/**
 * The announcement the journey is on at `nowMs`: the fixed greeting from
 * departure until 00:30, then each drawn line from its slot until the next, and
 * the fixed sign-off from the recorded arrival instant on. Resuming late simply
 * names the line the journey is on now; it never replays one that was missed.
 */
export function cabinAnnouncementAt(
  journey: { routeId: string; startedAt: string; arrivesAt: string },
  nowMs: number,
  destinationName: string,
): CabinAnnouncement {
  const startedAtMs = new Date(journey.startedAt).getTime();
  const arrivesAtMs = new Date(journey.arrivesAt).getTime();
  if (Number.isFinite(arrivesAtMs) && nowMs >= arrivesAtMs) {
    return {
      phase: "arrival",
      key: "arrival",
      text: cabinArrivalAnnouncement(destinationName),
    };
  }
  const elapsedSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, nowMs - startedAtMs) / 1_000
    : 0;
  const slot = CABIN_ANNOUNCEMENT_SLOT_SECONDS.filter((at) => elapsedSeconds >= at).length;
  if (slot === 0) {
    return { phase: "departure", key: "departure", text: CABIN_DEPARTURE_ANNOUNCEMENT };
  }
  const indices = selectCabinAnnouncementIndices(cabinAnnouncementSeed(journey));
  const line = CABIN_ANNOUNCEMENT_POOL[indices[slot - 1] as number] as string;
  return { phase: "in_flight", key: `slot-${slot}`, text: line };
}
