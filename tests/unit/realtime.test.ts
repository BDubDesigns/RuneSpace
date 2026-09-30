import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createRealtimeFrameParser,
  formatRealtimeFrame,
  parseRealtimeEnvelope,
  REALTIME_FRAME,
  REALTIME_HEARTBEAT_FRAME,
  REALTIME_STREAM_PATH,
  type RealtimeEnvelope,
} from "@/game/schemas/realtime";
import {
  audienceIncludes,
  createInMemoryRealtimeFanout,
  publishRealtimeEvent,
  type RealtimeScope,
  type RealtimeSubscriber,
} from "@/server/realtime";
import { ChatSocialLauncher, chatSocialLauncherLabel } from "@/features/social/ChatSocialLauncher";
import { ChatSocialSurface } from "@/features/social/ChatSocialSurface";
import {
  createDeliveryDeduper,
  createRealtimeConnection,
  realtimeRetryDelay,
  REALTIME_RESUME_STALE_MS,
  REALTIME_WATCHDOG_MS,
  type ReconcileReason,
  type RealtimeRefusal,
  type RealtimeStatus,
} from "@/features/social/realtime-connection";
import {
  INITIAL_SOCIAL_SHELL_STATE,
  socialAttentionCount,
  socialShellReducer,
  type SocialShellAction,
} from "@/features/social/social-state";

/**
 * Issue #245 — the shared SSE realtime/social substrate: the wire contract,
 * the in-process publisher, the browser connection lifecycle, and the
 * duplicate-safe shell seam. Stream authorization is proven against
 * PostgreSQL in tests/integration/realtime.test.ts.
 */

const scope = (playerAccountId: string, characterId: string): RealtimeScope => ({
  playerAccountId,
  characterId,
});

function recorder(subscriberScope: RealtimeScope) {
  const received: RealtimeEnvelope[] = [];
  const closed: string[] = [];
  const subscriber: RealtimeSubscriber = {
    scope: subscriberScope,
    deliver: (envelope) => received.push(envelope),
    close: (reason) => closed.push(reason),
  };
  return { subscriber, received, closed };
}

describe("wire contract", () => {
  it("round-trips named frames through the incremental parser, however the text is split", () => {
    const envelope = { id: "d-1", type: "demo.event", data: { text: "line\nbreak" } };
    const wire =
      formatRealtimeFrame(REALTIME_FRAME.ready, {}) +
      REALTIME_HEARTBEAT_FRAME +
      formatRealtimeFrame(REALTIME_FRAME.delivery, envelope) +
      formatRealtimeFrame(REALTIME_FRAME.close, { reason: "lifetime" });

    for (const size of [1, 3, 7, wire.length]) {
      const frames: [string, string][] = [];
      const parser = createRealtimeFrameParser((name, data) => frames.push([name, data]));
      for (let index = 0; index < wire.length; index += size) {
        parser.push(wire.slice(index, index + size));
      }
      expect(frames.map(([name]) => name)).toEqual(["ready", "delivery", "close"]);
      expect(parseRealtimeEnvelope(frames[1]![1])).toEqual(envelope);
    }
  });

  it("accepts CRLF line endings, including a CRLF split across chunks", () => {
    const frames: string[] = [];
    const parser = createRealtimeFrameParser((name) => frames.push(name));
    parser.push("event: ready\r");
    parser.push("\ndata: {}\r\n\r\n");
    expect(frames).toEqual(["ready"]);
  });

  it("refuses malformed delivery data instead of throwing", () => {
    expect(parseRealtimeEnvelope("not json")).toBeUndefined();
    expect(parseRealtimeEnvelope(JSON.stringify({ type: "x", data: 1 }))).toBeUndefined();
    expect(parseRealtimeEnvelope(JSON.stringify({ id: "", type: "x", data: 1 }))).toBeUndefined();
  });

  it("never emits a resumable SSE id: the stream is not an event ledger", () => {
    const frame = formatRealtimeFrame(REALTIME_FRAME.delivery, { id: "d", type: "t", data: 0 });
    expect(frame.split("\n").some((line) => line.startsWith("id:"))).toBe(false);
  });
});

describe("in-process publisher", () => {
  it("matches audiences only against the server-derived scope", () => {
    const own = scope("account-a", "char-a1");
    expect(audienceIncludes({ kind: "character", characterId: "char-a1" }, own)).toBe(true);
    expect(audienceIncludes({ kind: "character", characterId: "char-a2" }, own)).toBe(false);
    expect(audienceIncludes({ kind: "account", playerAccountId: "account-a" }, own)).toBe(true);
    expect(audienceIncludes({ kind: "account", playerAccountId: "account-b" }, own)).toBe(false);
    expect(audienceIncludes({ kind: "everyone" }, own)).toBe(true);
    // A public message skips the accounts that blocked its sender (#247).
    const blockers = new Set(["account-a"]);
    expect(audienceIncludes({ kind: "everyone", exceptAccountIds: blockers }, own)).toBe(false);
    expect(
      audienceIncludes(
        { kind: "everyone", exceptAccountIds: blockers },
        scope("account-b", "char-b1"),
      ),
    ).toBe(true);
  });

  it("delivers one publish to every matching stream, including several tabs of one character", () => {
    const fanout = createInMemoryRealtimeFanout();
    const tabOne = recorder(scope("account-a", "char-a1"));
    const tabTwo = recorder(scope("account-a", "char-a1"));
    const sibling = recorder(scope("account-a", "char-a2"));
    const stranger = recorder(scope("account-b", "char-b1"));
    for (const tab of [tabOne, tabTwo, sibling, stranger]) fanout.subscribe(tab.subscriber);

    const envelope = { id: "d-1", type: "demo.event", data: 1 };
    expect(fanout.deliver({ kind: "character", characterId: "char-a1" }, envelope)).toBe(2);
    expect(fanout.deliver({ kind: "account", playerAccountId: "account-a" }, envelope)).toBe(3);
    expect(fanout.deliver({ kind: "everyone" }, envelope)).toBe(4);
    expect(tabOne.received).toHaveLength(3);
    expect(sibling.received).toHaveLength(2);
    expect(stranger.received).toHaveLength(1);
  });

  it("isolates a broken stream, unsubscribes idempotently, and closes by audience", () => {
    const fanout = createInMemoryRealtimeFanout();
    const healthy = recorder(scope("a", "c1"));
    const unsubscribeBroken = fanout.subscribe({
      scope: scope("a", "c1"),
      deliver: () => {
        throw new Error("socket gone");
      },
      close: () => {},
    });
    fanout.subscribe(healthy.subscriber);

    expect(fanout.deliver({ kind: "everyone" }, { id: "1", type: "t", data: 0 })).toBe(1);
    expect(healthy.received).toHaveLength(1);

    unsubscribeBroken();
    unsubscribeBroken();
    expect(fanout.size()).toBe(1);
    expect(fanout.close({ kind: "character", characterId: "c1" }, "lifetime")).toBe(1);
    expect(healthy.closed).toEqual(["lifetime"]);
  });

  it("gives every publish a fresh delivery id", () => {
    const fanout = createInMemoryRealtimeFanout();
    const tab = recorder(scope("a", "c1"));
    fanout.subscribe(tab.subscriber);
    // #245 registers no domain events; a downstream type stands in here.
    const publishUntyped = publishRealtimeEvent as (...args: unknown[]) => number;
    publishUntyped({ kind: "everyone" }, "demo.event", { n: 1 }, fanout);
    publishUntyped({ kind: "everyone" }, "demo.event", { n: 1 }, fanout);
    expect(tab.received.map((envelope) => envelope.type)).toEqual(["demo.event", "demo.event"]);
    expect(tab.received[0]!.id).not.toBe(tab.received[1]!.id);
  });

  it("lets the browser name only its character: the route reads no other input", () => {
    const route = readFileSync(join(process.cwd(), "app/api/realtime/route.ts"), "utf8");
    expect([...route.matchAll(/searchParams\.get\("(\w+)"\)/g)].map((match) => match[1])).toEqual([
      "characterId",
    ]);
    expect(route).not.toContain("request.json(");
    expect(route).toContain("openRealtimeStream(user.id, characterId, {");
  });

  it("is not coupled to any chat, whisper, or trading domain model", () => {
    const substrate = [
      "game/schemas/realtime.ts",
      "server/realtime.ts",
      "server/realtime-stream.ts",
      ...readdirSync(join(process.cwd(), "features/social")).map(
        (file) => `features/social/${file}`,
      ),
    ];
    for (const path of substrate) {
      const imports = [
        ...readFileSync(join(process.cwd(), path), "utf8").matchAll(/from "([^"]+)"/g),
      ]
        .map((match) => match[1]!)
        // The shell's own sibling modules are the substrate itself.
        .filter((specifier) => !specifier.startsWith("./"));
      for (const specifier of imports) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(
          /trade|chat|whisper|merchant|mission|inventory/i,
        );
      }
    }
  });
});

describe("client seam: duplicate delivery is harmless", () => {
  it("handles the same delivery id at most once, within a bounded memory", () => {
    const firstSeen = createDeliveryDeduper(2);
    expect(firstSeen("a")).toBe(true);
    expect(firstSeen("a")).toBe(false);
    expect(firstSeen("b")).toBe(true);
    expect(firstSeen("c")).toBe(true);
    expect(firstSeen("a")).toBe(true); // evicted, not remembered forever
  });

  it("applies every shell mutation idempotently, keyed by durable domain identity", () => {
    const card = { key: "trade-request:1", label: "Trade request", content: "card" };
    const actions: SocialShellAction[] = [
      { type: "upsertCard", card },
      { type: "setAttention", source: "whispers", count: 2 },
      { type: "upsertCard", card: { key: "trade-request:2", label: "Trade request", content: "" } },
    ];
    const once = actions.reduce(socialShellReducer, INITIAL_SOCIAL_SHELL_STATE);
    const twice = [...actions, ...actions].reduce(socialShellReducer, INITIAL_SOCIAL_SHELL_STATE);

    expect(twice).toEqual(once);
    expect(once.cards.map((entry) => entry.key)).toEqual(["trade-request:2", "trade-request:1"]);
    expect(socialAttentionCount(once)).toBe(4);

    const removed = socialShellReducer(
      socialShellReducer(once, { type: "removeCard", key: "trade-request:1" }),
      { type: "removeCard", key: "trade-request:1" },
    );
    expect(removed.cards).toHaveLength(1);
    const cleared = socialShellReducer(removed, {
      type: "setAttention",
      source: "whispers",
      count: 0,
    });
    expect(socialAttentionCount(cleared)).toBe(1);
    expect(
      socialShellReducer(cleared, { type: "setAttention", source: "whispers", count: 0 }),
    ).toBe(cleared);
  });
});

type FakeTimer = { fn: () => void; ms: number };

function harness(respond: (attempt: number) => Response | Promise<Response>) {
  const events = {
    statuses: [] as RealtimeStatus[],
    reconciles: [] as ReconcileReason[],
    deliveries: [] as RealtimeEnvelope[],
    refusals: [] as RealtimeRefusal[],
  };
  const timers = new Map<number, FakeTimer>();
  let nextTimer = 0;
  const requests: string[] = [];
  const connection = createRealtimeConnection({
    characterId: "11111111-1111-4111-8111-111111111111",
    callbacks: {
      onStatus: (status) => events.statuses.push(status),
      onReconcile: (reason) => events.reconciles.push(reason),
      onDelivery: (envelope) => events.deliveries.push(envelope),
      onRefused: (refusal) => events.refusals.push(refusal),
    },
    fetch: async (input) => {
      requests.push(String(input));
      return respond(requests.length);
    },
    timers: {
      setTimeout: (fn, ms) => {
        nextTimer += 1;
        timers.set(nextTimer, { fn, ms });
        return nextTimer;
      },
      clearTimeout: (handle) => timers.delete(handle as number),
    },
    random: () => 1,
  });
  return { connection, events, timers, requests };
}

/** A controllable streaming body. */
function streamingResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("browser connection lifecycle", () => {
  it("reconciles on connect, dedupes deliveries, and reconnects straight after a deliberate close", async () => {
    const streams = [streamingResponse(), streamingResponse()];
    const { connection, events, requests } = harness((attempt) => streams[attempt - 1]!.response);
    connection.start();
    await settle();

    expect(requests[0]).toBe(
      `${REALTIME_STREAM_PATH}?characterId=11111111-1111-4111-8111-111111111111`,
    );
    const first = streams[0]!;
    first.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
    const delivery = { id: "d-1", type: "demo.event", data: { n: 1 } };
    first.send(formatRealtimeFrame(REALTIME_FRAME.delivery, delivery));
    first.send(formatRealtimeFrame(REALTIME_FRAME.delivery, delivery));
    first.send(formatRealtimeFrame(REALTIME_FRAME.close, { reason: "lifetime" }));
    first.end();
    await settle();
    await settle();

    expect(events.deliveries).toEqual([delivery]);
    expect(requests).toHaveLength(2);
    streams[1]!.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
    await settle();

    expect(events.reconciles).toEqual(["connect", "reconnect"]);
    expect(connection.status()).toBe("live");

    connection.resume();
    expect(events.reconciles).toEqual(["connect", "reconnect", "resume"]);
    connection.stop();
    expect(connection.status()).toBe("stopped");
  });

  it("backs off after an unexpected end, and resume reconnects without waiting", async () => {
    const streams = [streamingResponse(), streamingResponse()];
    const { connection, events, timers, requests } = harness(
      (attempt) => streams[attempt - 1]!.response,
    );
    connection.start();
    await settle();
    streams[0]!.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
    streams[0]!.end(); // a deploy or network drop: no close frame
    await settle();
    await settle();

    expect(connection.status()).toBe("reconnecting");
    expect(requests).toHaveLength(1);
    const retry = [...timers.values()].find((timer) => timer.ms !== REALTIME_WATCHDOG_MS);
    expect(retry?.ms).toBe(realtimeRetryDelay(0, () => 1));

    connection.resume(); // tab visible again / back online
    await settle();
    expect(requests).toHaveLength(2);
    streams[1]!.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
    await settle();
    expect(events.reconciles).toEqual(["connect", "reconnect"]);
    connection.stop();
  });

  it("reconnects on resume when a live stream has gone silent, instead of waiting for the watchdog", async () => {
    const streams = [streamingResponse(), streamingResponse()];
    let clock = 1_000_000;
    let requests = 0;
    const reconciles: ReconcileReason[] = [];
    const connection = createRealtimeConnection({
      characterId: "11111111-1111-4111-8111-111111111111",
      callbacks: {
        onStatus: () => {},
        onReconcile: (reason) => reconciles.push(reason),
        onDelivery: () => {},
        onRefused: () => {},
      },
      fetch: async () => streams[requests++]!.response,
      timers: { setTimeout: () => 0, clearTimeout: () => {} },
      now: () => clock,
    });
    connection.start();
    await settle();
    streams[0]!.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
    await settle();

    clock += REALTIME_RESUME_STALE_MS; // a heartbeat is due or just late: still fresh
    connection.resume();
    expect(reconciles).toEqual(["connect", "resume"]);
    expect(requests).toBe(1);

    clock += 1; // the phone slept through a heartbeat
    connection.resume();
    await settle();
    expect(requests).toBe(2);
    streams[1]!.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
    await settle();
    expect(reconciles).toEqual(["connect", "resume", "reconnect"]);
    connection.stop();
  });

  it("drops a silent half-open stream when the watchdog fires", async () => {
    const streams = [streamingResponse(), streamingResponse()];
    const { connection, timers, requests } = harness((attempt) => streams[attempt - 1]!.response);
    connection.start();
    await settle();
    streams[0]!.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
    await settle();

    const watchdog = [...timers.values()].find((timer) => timer.ms === REALTIME_WATCHDOG_MS);
    watchdog!.fn();
    await settle();
    await settle();
    expect(connection.status()).toBe("reconnecting");
    connection.resume();
    await settle();
    expect(requests).toHaveLength(2);
    connection.stop();
  });

  it("keeps the stream live when a consumer throws, surfacing the error asynchronously", async () => {
    const stream = streamingResponse();
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    let requests = 0;
    const statuses: RealtimeStatus[] = [];
    const connection = createRealtimeConnection({
      characterId: "11111111-1111-4111-8111-111111111111",
      callbacks: {
        onStatus: (status) => statuses.push(status),
        onReconcile: () => {
          throw new Error("consumer bug in reconcile");
        },
        onDelivery: () => {
          throw new Error("consumer bug in delivery");
        },
        onRefused: () => {},
      },
      fetch: async () => {
        requests += 1;
        return stream.response;
      },
      timers: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    try {
      connection.start();
      await settle();
      stream.send(formatRealtimeFrame(REALTIME_FRAME.ready, {}));
      stream.send(
        formatRealtimeFrame(REALTIME_FRAME.delivery, { id: "d", type: "demo.event", data: 0 }),
      );
      await settle();
      await settle();
      expect(connection.status()).toBe("live");
      expect(requests).toBe(1);
      expect(statuses).toEqual(["live"]);
      expect(uncaught.map((error) => (error as Error).message)).toEqual([
        "consumer bug in reconcile",
        "consumer bug in delivery",
      ]);
    } finally {
      connection.stop();
      process.off("uncaughtException", onUncaught);
    }
  });

  it("stops on an access refusal instead of retrying, and reports the stable code", async () => {
    const { connection, events, timers } = harness(() =>
      Response.json({ error: "no", code: "GAMEPLAY_ACCESS_REQUIRED" }, { status: 403 }),
    );
    connection.start();
    await settle();
    await settle();

    expect(events.refusals).toEqual([{ status: 403, code: "GAMEPLAY_ACCESS_REQUIRED" }]);
    expect(connection.status()).toBe("stopped");
    expect(timers.size).toBe(0);
    connection.resume();
    expect(events.reconciles).toEqual([]);
  });

  it("retries a server error with capped, jittered exponential backoff", async () => {
    const { connection, timers } = harness(() => new Response("oops", { status: 502 }));
    connection.start();
    await settle();
    await settle();
    expect(connection.status()).toBe("reconnecting");
    expect([...timers.values()].map((timer) => timer.ms)).toContain(1_000);
    expect(realtimeRetryDelay(10, () => 1)).toBe(30_000);
    expect(realtimeRetryDelay(0, () => 0)).toBe(500);
    connection.stop();
  });
});

describe("Chat/Social shell presentation", () => {
  it("folds attention into the launcher's accessible name", () => {
    expect(chatSocialLauncherLabel(0)).toBe("Chat");
    expect(chatSocialLauncherLabel(1)).toBe("Chat, 1 item needs attention");
    expect(chatSocialLauncherLabel(3)).toBe("Chat, 3 items need attention");

    const quiet = renderToStaticMarkup(
      React.createElement(ChatSocialLauncher, {
        attentionCount: 0,
        onOpen: () => {},
        status: "live",
      }),
    );
    expect(quiet).toContain('aria-label="Chat"');
    expect(quiet).not.toContain("data-chat-social-attention");

    const attention = renderToStaticMarkup(
      React.createElement(ChatSocialLauncher, {
        attentionCount: 12,
        onOpen: () => {},
        status: "live",
      }),
    );
    expect(attention).toContain('aria-label="Chat, 12 items need attention"');
    expect(attention).toContain('aria-hidden="true"');
    expect(attention).toContain('data-chat-social-attention="12"');
    expect(attention).toContain(">9+<");
    expect(attention).toContain("var(--rs-glow-news-unread)");
  });

  it("pins actionable cards above ordinary conversation content", () => {
    const conversations = React.createElement("p", null, "composed conversations");
    const empty = renderToStaticMarkup(
      React.createElement(ChatSocialSurface, { cards: [], conversations }),
    );
    expect(empty).not.toContain("data-social-pinned-cards");
    expect(empty).toContain('aria-label="Conversations"');
    expect(empty).toContain("composed conversations");

    const withCards = renderToStaticMarkup(
      React.createElement(ChatSocialSurface, {
        conversations,
        cards: [
          {
            key: "trade-request:1",
            label: "Trade request from a test character",
            content: React.createElement("p", null, "domain-owned card"),
          },
        ],
      }),
    );
    expect(withCards.indexOf('aria-label="Needs your attention"')).toBeGreaterThan(-1);
    expect(withCards.indexOf('aria-label="Needs your attention"')).toBeLessThan(
      withCards.indexOf('aria-label="Conversations"'),
    );
    expect(withCards).toContain('aria-label="Trade request from a test character"');
    expect(withCards).toContain("domain-owned card");
  });
});
