import { z } from "zod";

/**
 * The realtime/social delivery wire contract (issue #245), shared by the
 * server stream (`server/realtime-stream.ts`) and the browser seam
 * (`features/social/realtime-connection.ts`) so the frame format has exactly
 * one definition.
 *
 * Server → browser delivery is Server-Sent Events. A stream is disposable
 * delivery and invalidation only: it is never gameplay or social authority,
 * never a durable event ledger, and carries no `id:` field for
 * `Last-Event-ID` resumption. Durable domain state owns every durable ID;
 * after connect, reconnect, or tab resume the browser reconciles through
 * ordinary authoritative reads.
 */

/** Same-origin stream endpoint. The browser names only its active character. */
export const REALTIME_STREAM_PATH = "/api/realtime";

/** Transport keepalive cadence. A heartbeat is an SSE comment, not a state check. */
export const REALTIME_HEARTBEAT_MS = 25_000;

/**
 * A stream's bounded lifetime. The server then closes it deliberately so the
 * reconnect re-runs authentication, ownership, and gameplay access.
 */
export const REALTIME_STREAM_LIFETIME_MS = 5 * 60_000;

/** Named SSE frames. Heartbeats are comments and have no name. */
export const REALTIME_FRAME = {
  /** First frame of every stream: authorization passed and delivery is live. */
  ready: "ready",
  /** One published event envelope. */
  delivery: "delivery",
  /** The server is ending this stream on purpose; reconnect straight away. */
  close: "close",
} as const;

export type RealtimeFrameName = (typeof REALTIME_FRAME)[keyof typeof REALTIME_FRAME];

export type RealtimeCloseReason = "lifetime" | "overflow";

/**
 * The typed event registry. Each social domain registers its own event types
 * and payloads here when it ships — chat (#246), Whispers (#247), and trade
 * requests (#225) — keyed by a namespaced type such as `"chat.message"`. The
 * substrate itself imports no chat or trading model, and #245 registers none.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- populated by downstream slices
export interface RealtimeEventMap {}

export type RealtimeEventType = keyof RealtimeEventMap & string;

/**
 * One delivery. `id` identifies this delivery only (a fresh UUID per publish),
 * so a browser can ignore a repeat of the very same delivery; it is not a
 * domain ID and is never used to resume a stream.
 */
export type RealtimeEnvelope = {
  id: string;
  type: string;
  data: unknown;
};

const RealtimeEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.unknown(),
});

/** Parse one `delivery` frame's data, or undefined when it is malformed. */
export function parseRealtimeEnvelope(data: string): RealtimeEnvelope | undefined {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = RealtimeEnvelopeSchema.safeParse(json);
  return parsed.success
    ? { id: parsed.data.id, type: parsed.data.type, data: parsed.data.data }
    : undefined;
}

/**
 * Encode one named frame. `JSON.stringify` escapes line breaks, so the payload
 * is always exactly one `data:` line.
 */
export function formatRealtimeFrame(name: RealtimeFrameName, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The heartbeat: an SSE comment, ignored by parsers but real bytes on the wire. */
export const REALTIME_HEARTBEAT_FRAME = ": keepalive\n\n";

/**
 * Incremental SSE parser for the frames above. Text may arrive split anywhere,
 * including mid-line; complete frames are emitted in order. Comments and
 * fields other than `event`/`data` are ignored.
 */
export function createRealtimeFrameParser(onFrame: (name: string, data: string) => void) {
  let buffer = "";
  let name = "";
  let data: string[] = [];

  function dispatchLine(line: string) {
    if (line === "") {
      if (data.length > 0) onFrame(name || "message", data.join("\n"));
      name = "";
      data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
  }

  return {
    push(text: string) {
      buffer += text;
      let newline = buffer.search(/\r\n|\r|\n/);
      while (newline !== -1) {
        // A lone trailing `\r` may be the first half of `\r\n`; wait for more.
        if (buffer[newline] === "\r" && newline === buffer.length - 1) break;
        const width = buffer.startsWith("\r\n", newline) ? 2 : 1;
        dispatchLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + width);
        newline = buffer.search(/\r\n|\r|\n/);
      }
    },
  };
}
