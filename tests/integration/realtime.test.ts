import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const token = () => Math.random().toString(36).slice(2, 8);

/** Read a stream's text until `done` matches or it ends. */
async function readUntil(
  stream: ReadableStream<Uint8Array>,
  done: (text: string) => boolean,
): Promise<{ text: string; ended: boolean; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return { text, ended: true, reader };
    text += decoder.decode(chunk.value, { stream: true });
    if (done(text)) return { text, ended: false, reader };
  }
}

async function readRest(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += decoder.decode(chunk.value, { stream: true });
  }
}

/**
 * Issue #245 acceptance: the realtime stream reuses the existing Better Auth +
 * owned-character + gameplay-access boundary on every creation, derives its
 * delivery scope server-side, and delivers in-process publishes only to the
 * matching open streams — proven against real PostgreSQL.
 */
suite("issue #245 realtime stream boundary (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let realtime: typeof import("@/server/realtime");
  let streams: typeof import("@/server/realtime-stream");
  let route: typeof import("@/app/api/realtime/route");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    realtime = await import("@/server/realtime");
    streams = await import("@/server/realtime-stream");
    route = await import("@/app/api/realtime/route");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function player(options: { emailVerified?: boolean; gameplayAccess?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, `rt-${token()}`, undefined, {
      emailVerified: options.emailVerified,
    });
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Rt${token()}`,
      undefined,
      { gameplayAccess: options.gameplayAccess },
    );
    return { userId, character };
  }

  it("refuses an unauthenticated or malformed stream request at the route", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    // No session cookie, but a resolvable loopback host, like a real request.
    const headers = { host: "localhost:3000" };
    const unauthenticated = await route.GET(
      new Request(`http://localhost:3000/api/realtime?characterId=${id}`, { headers }),
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("content-type")).not.toContain("text/event-stream");

    for (const query of ["", "?characterId=", "?characterId=not-a-uuid"]) {
      const malformed = await route.GET(
        new Request(`http://localhost:3000/api/realtime${query}`, { headers }),
      );
      expect(malformed.status).toBe(400);
    }
  });

  it("refuses another account's character without opening anything", async () => {
    const fanout = realtime.createInMemoryRealtimeFanout();
    const owner = await player();
    const intruder = await player();
    await expect(
      streams.openRealtimeStream(intruder.userId, owner.character.id, { fanout }),
    ).rejects.toMatchObject({ name: "OwnershipError", status: 404 });
    expect(fanout.size()).toBe(0);
  });

  it("refuses an account without gameplay access, and re-checks it on every stream", async () => {
    const fanout = realtime.createInMemoryRealtimeFanout();
    const waiting = await player({ gameplayAccess: false });
    await expect(
      streams.openRealtimeStream(waiting.userId, waiting.character.id, { fanout }),
    ).rejects.toMatchObject({ name: "GameplayAccessError", status: 403 });

    const unverified = await player({ emailVerified: false });
    await expect(
      streams.openRealtimeStream(unverified.userId, unverified.character.id, { fanout }),
    ).rejects.toMatchObject({ name: "GameplayAccessError", status: 403 });

    // Access revoked between streams: the next (re)connection is refused.
    const playing = await player();
    const first = await streams.openRealtimeStream(playing.userId, playing.character.id, {
      fanout,
    });
    await first.stream.cancel();
    await db
      .update(rune.playerAccounts)
      .set({ earlyAccessGrantedAt: null, earlyAccessGrantedByAdminUserId: null })
      .where(eq(rune.playerAccounts.id, playing.character.playerAccountId));
    await expect(
      streams.openRealtimeStream(playing.userId, playing.character.id, { fanout }),
    ).rejects.toMatchObject({ name: "GameplayAccessError", status: 403 });
    expect(fanout.size()).toBe(0);
  });

  it("accepts an owned, playable character with a server-derived scope and SSE framing", async () => {
    const fanout = realtime.createInMemoryRealtimeFanout();
    const { userId, character } = await player();
    const opened = await streams.openRealtimeStream(userId, character.id, { fanout });

    const [account] = await db
      .select({ id: rune.playerAccounts.id })
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    expect(opened.scope).toEqual({ playerAccountId: account!.id, characterId: character.id });
    expect(streams.REALTIME_STREAM_HEADERS["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(streams.REALTIME_STREAM_HEADERS["cache-control"]).toContain("no-transform");

    const { text, reader } = await readUntil(opened.stream, (sofar) => sofar.includes("\n\n"));
    expect(text).toBe("event: ready\ndata: {}\n\n");
    expect(fanout.size()).toBe(1);
    await reader.cancel();
    expect(fanout.size()).toBe(0);
  });

  it("delivers a publish only to the matching streams, across several tabs", async () => {
    const fanout = realtime.createInMemoryRealtimeFanout();
    const alice = await player();
    const aliceAlt = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      alice.userId,
      `Rt${token()}`,
    );
    const bob = await player();

    const open = (userId: string, characterId: string) =>
      streams.openRealtimeStream(userId, characterId, { fanout });
    const tabs = {
      aliceOne: await open(alice.userId, alice.character.id),
      aliceTwo: await open(alice.userId, alice.character.id),
      aliceAlt: await open(alice.userId, aliceAlt.id),
      bob: await open(bob.userId, bob.character.id),
    };
    const readers = Object.fromEntries(
      await Promise.all(
        Object.entries(tabs).map(async ([name, tab]) => {
          const { reader } = await readUntil(tab.stream, (text) => text.includes("\n\n"));
          return [name, reader] as const;
        }),
      ),
    );
    expect(fanout.size()).toBe(4);

    const publish = realtime.publishRealtimeEvent as (...args: unknown[]) => number;
    expect(
      publish(
        { kind: "character", characterId: alice.character.id },
        "demo.event",
        { n: 1 },
        fanout,
      ),
    ).toBe(2);
    expect(
      publish(
        { kind: "account", playerAccountId: alice.character.playerAccountId },
        "demo.event",
        { n: 2 },
        fanout,
      ),
    ).toBe(3);

    // End every stream the way the bounded lifetime does, then read what
    // each tab received in total.
    expect(fanout.close({ kind: "everyone" }, "lifetime")).toBe(4);
    const received = Object.fromEntries(
      await Promise.all(
        Object.entries(readers).map(async ([name, reader]) => [name, await readRest(reader)]),
      ),
    ) as Record<keyof typeof tabs, string>;

    const deliveries = (text: string) =>
      text
        .split("\n")
        .filter((line) => line.startsWith('data: {"id"'))
        .map((line) => JSON.parse(line.slice(6)).data.n);
    expect(deliveries(received.aliceOne)).toEqual([1, 2]);
    expect(deliveries(received.aliceTwo)).toEqual([1, 2]);
    expect(deliveries(received.aliceAlt)).toEqual([2]);
    expect(deliveries(received.bob)).toEqual([]);
    for (const text of Object.values(received)) {
      expect(text.endsWith('event: close\ndata: {"reason":"lifetime"}\n\n')).toBe(true);
    }
    expect(fanout.size()).toBe(0);
  });

  it("keeps several tabs of one character harmless: no writes, independent lifetimes", async () => {
    const fanout = realtime.createInMemoryRealtimeFanout();
    const { userId, character } = await player();
    const before = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));

    const controller = new AbortController();
    const first = await streams.openRealtimeStream(userId, character.id, {
      fanout,
      signal: controller.signal,
    });
    const second = await streams.openRealtimeStream(userId, character.id, { fanout });
    await readUntil(first.stream, (text) => text.includes("\n\n"));
    const secondRead = await readUntil(second.stream, (text) => text.includes("\n\n"));
    expect(fanout.size()).toBe(2);

    // The first tab disconnects; the second is untouched.
    controller.abort();
    expect(fanout.size()).toBe(1);
    await secondRead.reader.cancel();
    expect(fanout.size()).toBe(0);

    const after = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.id, character.id));
    expect(after).toEqual(before);
  });

  it("sends heartbeats and closes itself when its bounded lifetime ends", async () => {
    const fanout = realtime.createInMemoryRealtimeFanout();
    const { userId, character } = await player();
    const opened = await streams.openRealtimeStream(userId, character.id, {
      fanout,
      heartbeatMs: 10,
      lifetimeMs: 80,
    });
    const { text, ended } = await readUntil(opened.stream, () => false);
    expect(ended).toBe(true);
    expect(text.startsWith("event: ready\ndata: {}\n\n")).toBe(true);
    expect(text).toContain(": keepalive\n\n");
    expect(text.endsWith('event: close\ndata: {"reason":"lifetime"}\n\n')).toBe(true);
    expect(fanout.size()).toBe(0);
  });
});
