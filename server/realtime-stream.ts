import {
  formatRealtimeFrame,
  REALTIME_FRAME,
  REALTIME_HEARTBEAT_FRAME,
  REALTIME_HEARTBEAT_MS,
  REALTIME_STREAM_LIFETIME_MS,
  type RealtimeCloseReason,
  type RealtimeEnvelope,
} from "@/game/schemas/realtime";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { getRealtimeFanout, type RealtimeFanout, type RealtimeScope } from "@/server/realtime";

/**
 * One authenticated realtime stream for one tab (issue #245).
 *
 * Every stream creation re-runs the existing gameplay-read boundary,
 * `requirePlayableOwnedCharacter`: the user must own the character and the
 * account must pass the canonical gameplay-access gate. The delivery scope is
 * derived from that authoritative row — the browser names only its active
 * character and cannot choose rooms, locations, players, or accounts.
 *
 * The stream then lives at most `REALTIME_STREAM_LIFETIME_MS` and closes on
 * purpose, so a revoked session, ownership, or access is refused on the next
 * reconnect. It holds no lock and no transaction, and reads nothing further
 * while open.
 */

/**
 * A client this far behind is not reading. Close it: the browser reconnects
 * and reconciles from durable state instead of the server buffering for it.
 */
const MAX_BACKLOG_FRAMES = 64;

export type RealtimeStreamOptions = {
  /** Aborts when the client disconnects (the request's own signal). */
  signal?: AbortSignal;
  heartbeatMs?: number;
  lifetimeMs?: number;
  fanout?: RealtimeFanout;
};

export type OpenedRealtimeStream = {
  scope: RealtimeScope;
  stream: ReadableStream<Uint8Array>;
};

/**
 * Authorize, then open. Throws the boundary's `OwnershipError` (401/404) or
 * `GameplayAccessError` (403) before any stream exists.
 */
export async function openRealtimeStream(
  userId: string,
  characterId: string,
  {
    signal,
    heartbeatMs = REALTIME_HEARTBEAT_MS,
    lifetimeMs = REALTIME_STREAM_LIFETIME_MS,
    fanout = getRealtimeFanout(),
  }: RealtimeStreamOptions = {},
): Promise<OpenedRealtimeStream> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const scope: RealtimeScope = {
    playerAccountId: character.playerAccountId,
    characterId: character.id,
  };

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let lifetime: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};

      const onAbort = () => finish();

      cleanup = () => {
        if (finished) return;
        finished = true;
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (lifetime !== undefined) clearTimeout(lifetime);
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
      };

      function write(text: string) {
        if (finished) return;
        if ((controller.desiredSize ?? 0) < -MAX_BACKLOG_FRAMES) {
          finish("overflow");
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The runtime closed the stream underneath us (client gone): stop
          // the timers and leave the fanout instead of throwing from them.
          finish();
        }
      }

      /** End the stream, telling the client why when it is still listening. */
      function finish(reason?: RealtimeCloseReason) {
        if (finished) return;
        if (reason) {
          try {
            controller.enqueue(
              encoder.encode(formatRealtimeFrame(REALTIME_FRAME.close, { reason })),
            );
          } catch {
            // Already errored or closed by the runtime; nothing left to tell.
          }
        }
        cleanup();
        try {
          controller.close();
        } catch {
          // Closed by a client cancel in the same tick.
        }
      }

      if (signal?.aborted) {
        finish();
        return;
      }
      signal?.addEventListener("abort", onAbort);

      write(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
      if (finished) return;
      unsubscribe = fanout.subscribe({
        scope,
        deliver: (envelope: RealtimeEnvelope) =>
          write(formatRealtimeFrame(REALTIME_FRAME.delivery, envelope)),
        close: (reason) => finish(reason),
      });
      heartbeat = setInterval(() => write(REALTIME_HEARTBEAT_FRAME), heartbeatMs);
      lifetime = setTimeout(() => finish("lifetime"), lifetimeMs);
    },
    cancel() {
      cleanup();
    },
  });

  return { scope, stream };
}

/** Response headers for a stream. `no-transform` also keeps compression from buffering it. */
export const REALTIME_STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  // Asks an nginx-style proxy not to buffer. Harmless where unsupported.
  "x-accel-buffering": "no",
} as const;
