import type {
  RealtimeCloseReason,
  RealtimeEnvelope,
  RealtimeEventMap,
  RealtimeEventType,
} from "@/game/schemas/realtime";

/**
 * The shared realtime publishing boundary (issue #245).
 *
 * Social domains publish typed events to an audience; they never see a stream,
 * a connection, or this module's fanout implementation. Alpha fanout is
 * single-process and in-memory. If RuneSpace later runs more than one app
 * process, only `createInMemoryRealtimeFanout` is replaced — the audience and
 * publish contract stays the same. Deliberately no Redis, no PostgreSQL
 * LISTEN/NOTIFY, and no durable event ledger: publishing is best-effort
 * delivery on top of durable domain state, which remains the only truth.
 */

/**
 * What one open stream may receive, derived server-side from the authenticated
 * session and the owned, playable character. The browser never supplies it.
 */
export type RealtimeScope = {
  playerAccountId: string;
  characterId: string;
};

/**
 * Who a publish is addressed to. Streams match by their server-derived scope:
 * - `character` — every open tab of one character (e.g. a Whisper recipient);
 * - `account` — every open tab of every character on one account;
 * - `everyone` — every open playable stream (e.g. a public channel).
 */
export type RealtimeAudience =
  | { kind: "character"; characterId: string }
  | { kind: "account"; playerAccountId: string }
  | { kind: "everyone" };

export type RealtimeSubscriber = {
  scope: RealtimeScope;
  deliver: (envelope: RealtimeEnvelope) => void;
  close: (reason: RealtimeCloseReason) => void;
};

export type RealtimeFanout = {
  /** Register an open stream; returns its idempotent unsubscribe. */
  subscribe: (subscriber: RealtimeSubscriber) => () => void;
  /** Deliver to every matching stream; returns how many received it. */
  deliver: (audience: RealtimeAudience, envelope: RealtimeEnvelope) => number;
  /** Close every matching stream (each client reconnects); returns how many. */
  close: (audience: RealtimeAudience, reason: RealtimeCloseReason) => number;
  /** Open streams, for diagnostics and tests. */
  size: () => number;
};

export function audienceIncludes(audience: RealtimeAudience, scope: RealtimeScope): boolean {
  switch (audience.kind) {
    case "character":
      return audience.characterId === scope.characterId;
    case "account":
      return audience.playerAccountId === scope.playerAccountId;
    case "everyone":
      return true;
  }
}

export function createInMemoryRealtimeFanout(): RealtimeFanout {
  const subscribers = new Set<RealtimeSubscriber>();

  function matching(audience: RealtimeAudience) {
    // Snapshot: a delivery or close may unsubscribe while we iterate.
    return [...subscribers].filter((subscriber) => audienceIncludes(audience, subscriber.scope));
  }

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    deliver(audience, envelope) {
      let delivered = 0;
      for (const subscriber of matching(audience)) {
        try {
          subscriber.deliver(envelope);
          delivered += 1;
        } catch {
          // One broken stream must never stop delivery to the others; its
          // own cleanup removes it, and its client reconciles on reconnect.
        }
      }
      return delivered;
    },
    close(audience, reason) {
      const targets = matching(audience);
      for (const subscriber of targets) {
        try {
          subscriber.close(reason);
        } catch {
          subscribers.delete(subscriber);
        }
      }
      return targets.length;
    },
    size: () => subscribers.size,
  };
}

// One fanout per server process. Anchored on globalThis so every route
// handler and server action shares it even if a bundler or dev reload
// evaluates this module more than once.
const FANOUT_KEY = Symbol.for("runespace.realtime.fanout");
type FanoutGlobal = typeof globalThis & { [FANOUT_KEY]?: RealtimeFanout };

export function getRealtimeFanout(): RealtimeFanout {
  const holder = globalThis as FanoutGlobal;
  holder[FANOUT_KEY] ??= createInMemoryRealtimeFanout();
  return holder[FANOUT_KEY];
}

/**
 * Publish one typed social event. Call it only after the authoritative change
 * has committed: a delivery is a prompt, and a client that misses it recovers
 * the same durable state by reconciling. Returns how many open streams
 * received it; zero is normal and never an error.
 */
export function publishRealtimeEvent<Type extends RealtimeEventType>(
  audience: RealtimeAudience,
  type: Type,
  data: RealtimeEventMap[Type],
  fanout: RealtimeFanout = getRealtimeFanout(),
): number {
  return fanout.deliver(audience, { id: crypto.randomUUID(), type, data });
}
