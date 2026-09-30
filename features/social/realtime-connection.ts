import {
  createRealtimeFrameParser,
  parseRealtimeEnvelope,
  REALTIME_FRAME,
  REALTIME_HEARTBEAT_MS,
  REALTIME_STREAM_PATH,
  type RealtimeEnvelope,
} from "@/game/schemas/realtime";

/**
 * The browser end of one tab's realtime stream (issue #245). Framework-free so
 * its lifecycle is unit-testable; `SocialContext` owns the React wiring.
 *
 * It reads the stream with `fetch` rather than `EventSource` because the
 * lifecycle needs the refusal status: an access refusal must stop, not retry
 * forever. Every successful (re)connection reports `onReconcile` so consumers
 * re-read durable state — a missed delivery is recovered by that read, never
 * by replaying the stream.
 */

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "stopped";

export type ReconcileReason = "connect" | "reconnect" | "resume";

export type RealtimeRefusal = { status: number; code?: string };

export type RealtimeConnectionCallbacks = {
  onStatus: (status: RealtimeStatus) => void;
  /** The stream is live (again), or a live tab resumed: re-read durable state. */
  onReconcile: (reason: ReconcileReason) => void;
  onDelivery: (envelope: RealtimeEnvelope) => void;
  /** The server refused the stream (401/403/404); the connection has stopped. */
  onRefused: (refusal: RealtimeRefusal) => void;
};

/**
 * No bytes for this long means a half-open connection (common after phone
 * sleep or a network change, where the request never errors): drop it and
 * reconnect. Two missed heartbeats plus slack.
 */
export const REALTIME_WATCHDOG_MS = REALTIME_HEARTBEAT_MS * 2 + 5_000;

/**
 * Run a consumer callback without letting its failure reach the read loop,
 * where it would look like a broken stream and force a reconnect. The error
 * is rethrown asynchronously so it still surfaces as an uncaught error.
 */
export function isolated(callback: () => void) {
  try {
    callback();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/** Exponential backoff with jitter (50–100% of the step), capped. */
export function realtimeRetryDelay(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  return Math.round(step * (0.5 + random() * 0.5));
}

/**
 * Remembers recent delivery IDs so the very same delivery is handled at most
 * once per tab. Bounded: correctness never depends on it, because consumers
 * key their own state by durable domain IDs.
 */
export function createDeliveryDeduper(limit = 256) {
  const seen = new Set<string>();
  return (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > limit) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
}

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type RealtimeConnectionOptions = {
  characterId: string;
  callbacks: RealtimeConnectionCallbacks;
  fetch?: typeof fetch;
  timers?: Timers;
  random?: () => number;
};

export function createRealtimeConnection({
  characterId,
  callbacks,
  fetch: fetchStream = (...args) => globalThis.fetch(...args),
  timers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  random = Math.random,
}: RealtimeConnectionOptions) {
  const url = `${REALTIME_STREAM_PATH}?characterId=${encodeURIComponent(characterId)}`;
  const firstDelivery = createDeliveryDeduper();
  let status: RealtimeStatus = "connecting";
  let stopped = false;
  let everLive = false;
  let failures = 0;
  let current: AbortController | undefined;
  let retryTimer: unknown;
  let watchdogTimer: unknown;

  function setStatus(next: RealtimeStatus) {
    if (status === next) return;
    status = next;
    callbacks.onStatus(next);
  }

  function clearTimer(handle: unknown) {
    if (handle !== undefined) timers.clearTimeout(handle);
  }

  function armWatchdog(attempt: AbortController) {
    clearTimer(watchdogTimer);
    watchdogTimer = timers.setTimeout(() => attempt.abort(), REALTIME_WATCHDOG_MS);
  }

  function scheduleRetry() {
    if (stopped) return;
    setStatus("reconnecting");
    const delay = realtimeRetryDelay(failures, random);
    failures += 1;
    retryTimer = timers.setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, delay);
  }

  async function connect() {
    if (stopped) return;
    clearTimer(retryTimer);
    retryTimer = undefined;
    current?.abort();
    const attempt = new AbortController();
    current = attempt;
    setStatus(everLive ? "reconnecting" : "connecting");

    let closedDeliberately = false;
    try {
      armWatchdog(attempt);
      const response = await fetchStream(url, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "text/event-stream" },
        signal: attempt.signal,
      });
      if (attempt !== current) return;
      if (!response.ok || !response.body) {
        if ([400, 401, 403, 404].includes(response.status)) {
          const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
          stop();
          callbacks.onRefused({
            status: response.status,
            code: typeof body?.code === "string" ? body.code : undefined,
          });
          return;
        }
        throw new Error(`Realtime stream failed with ${response.status}`);
      }

      const parser = createRealtimeFrameParser((name, data) => {
        if (name === REALTIME_FRAME.ready) {
          failures = 0;
          setStatus("live");
          const reason = everLive ? "reconnect" : "connect";
          everLive = true;
          isolated(() => callbacks.onReconcile(reason));
        } else if (name === REALTIME_FRAME.delivery) {
          const envelope = parseRealtimeEnvelope(data);
          if (envelope && firstDelivery(envelope.id)) {
            isolated(() => callbacks.onDelivery(envelope));
          }
        } else if (name === REALTIME_FRAME.close) {
          closedDeliberately = true;
        }
      });
      const reader = response.body.getReader();
      // Aborting (watchdog, replacement, or stop) must also end a read that
      // is already pending, whatever the runtime does with the fetch signal.
      attempt.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), {
        once: true,
      });
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        // A replaced attempt must never touch the current attempt's watchdog.
        if (done || attempt !== current) break;
        armWatchdog(attempt);
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Network loss, abort, or watchdog: handled by the retry below.
    } finally {
      if (attempt === current) clearTimer(watchdogTimer);
    }

    if (stopped || attempt !== current) return;
    if (closedDeliberately) {
      // The bounded lifetime ended on purpose: reconnect now, re-authorizing.
      void connect();
    } else {
      scheduleRetry();
    }
  }

  function stop() {
    stopped = true;
    clearTimer(retryTimer);
    clearTimer(watchdogTimer);
    retryTimer = undefined;
    const attempt = current;
    current = undefined;
    attempt?.abort();
    setStatus("stopped");
  }

  return {
    start() {
      void connect();
    },
    stop,
    /**
     * The tab became visible or the network came back. A live stream just
     * reconciles; anything else reconnects immediately instead of waiting out
     * its backoff (and reconciles once it is live).
     */
    resume() {
      if (stopped) return;
      if (status === "live") {
        isolated(() => callbacks.onReconcile("resume"));
        return;
      }
      failures = 0;
      void connect();
    },
    status: () => status,
  };
}

export type RealtimeConnection = ReturnType<typeof createRealtimeConnection>;
