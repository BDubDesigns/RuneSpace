import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Character } from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import type { TradeCommandResult, TradeStateView } from "@/game/schemas/player-trade";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const token = () => Math.random().toString(36).slice(2, 8);
const DAY_MS = 24 * 60 * 60_000;
const REQUEST_TTL_MS = 20_000;
const SESSION_IDLE_MS = 300_000;
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);

type Player = { userId: string; character: Character };

/**
 * Issue #266 acceptance against real PostgreSQL: player trade requests are
 * authoritative (same World Location, Block, social restriction, one outgoing
 * request, an account-wide 4-per-30-seconds budget), acceptance is atomic and
 * exclusive under concurrency, an accepted session gates every ordinary
 * gameplay command for both participants, and expiry is derived from the
 * injected request clock rather than a job. Prompts reach both participants
 * only after commit.
 */
suite("issue #266 player trade requests and sessions (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let trades: typeof import("@/server/player-trades");
  let gate: typeof import("@/server/player-trade-gate");
  let blocks: typeof import("@/server/player-blocks");
  let play: typeof import("@/server/play");
  let miningCommands: typeof import("@/server/mining-commands");
  let inventory: typeof import("@/server/inventory");
  let equipment: typeof import("@/server/equipment");
  let merchant: typeof import("@/server/trade");
  let cargo: typeof import("@/server/cargo-hold");
  let characterPreferences: typeof import("@/server/character-preference-commands");
  let chat: typeof import("@/server/chat");
  let realtime: typeof import("@/server/realtime");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    trades = await import("@/server/player-trades");
    gate = await import("@/server/player-trade-gate");
    blocks = await import("@/server/player-blocks");
    play = await import("@/server/play");
    miningCommands = await import("@/server/mining-commands");
    inventory = await import("@/server/inventory");
    equipment = await import("@/server/equipment");
    merchant = await import("@/server/trade");
    cargo = await import("@/server/cargo-hold");
    characterPreferences = await import("@/server/character-preference-commands");
    chat = await import("@/server/chat");
    realtime = await import("@/server/realtime");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  // --- fixtures ---------------------------------------------------------

  async function player(): Promise<Player> {
    const userId = await createTestUser(db, authSchema, `trade-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Trd${token()}`,
    );
    return { userId, character };
  }

  async function altOf(owner: Player): Promise<Player> {
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      owner.userId,
      `Alt${token()}`,
    );
    return { userId: owner.userId, character };
  }

  async function moveTo(who: Player, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, who.character.id));
  }

  /** Begins Travel, which leaves an active action row: the character is busy. */
  async function makeBusy(who: Player) {
    await play.beginTravel(who.userId, who.character.id, LOCATION_IDS.abandonedProcessingYard);
  }

  async function addStack(who: Player, quantity = 3): Promise<string> {
    const [row] = await db
      .insert(rune.inventoryStacks)
      .values({ characterId: who.character.id, itemId: ITEM_IDS.ferriteShale, quantity })
      .returning({ id: rune.inventoryStacks.id });
    return row!.id;
  }

  /** A social restriction in effect now, written the way an operator action would. */
  async function restrictSocially(accountId: string) {
    const [moderationCase] = await db
      .insert(rune.moderationCases)
      .values({ subjectPlayerAccountId: accountId, openedBy: "report" })
      .returning();
    const startsAt = new Date(Date.now() - 60_000);
    await db.insert(rune.moderationSanctions).values({
      caseId: moderationCase!.id,
      playerAccountId: accountId,
      kind: "social_restriction",
      ruleCategory: "harassment",
      duration: "7d",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 7 * DAY_MS),
      issuedByAdminUserId: "00000000-0000-4000-8000-000000000266",
    });
  }

  // --- command shorthands -------------------------------------------------

  function ok(result: TradeCommandResult): TradeStateView {
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.reason}`);
    return result.state;
  }

  const create = (from: Player, to: Player, now?: Date) =>
    trades.createTradeRequest(
      from.userId,
      from.character.id,
      { characterId: to.character.id },
      now,
    );

  /** Creates a request and returns its id. */
  async function send(from: Player, to: Player, now?: Date): Promise<string> {
    return ok(await create(from, to, now)).outgoing!.id;
  }

  const accept = (who: Player, requestId: string, now?: Date) =>
    trades.acceptTradeRequest(who.userId, who.character.id, requestId, now);
  const cancel = (who: Player, requestId: string, now?: Date) =>
    trades.cancelTradeRequest(who.userId, who.character.id, requestId, now);
  const decline = (who: Player, requestId: string, now?: Date) =>
    trades.declineTradeRequest(who.userId, who.character.id, requestId, now);
  const cancelSession = (who: Player, sessionId: string, now?: Date) =>
    trades.cancelTradeSession(who.userId, who.character.id, sessionId, now);
  const stateOf = (who: Player, now?: Date) =>
    trades.getTradeState(who.userId, who.character.id, now);

  /** Opens an accepted session between two players; returns its id. */
  async function openSession(requester: Player, recipient: Player, now = new Date()) {
    const requestId = await send(requester, recipient, now);
    const state = ok(await accept(recipient, requestId, now));
    return { requestId, sessionId: state.session!.id };
  }

  // --- direct reads -------------------------------------------------------

  async function requestRow(id: string) {
    const [row] = await db
      .select()
      .from(rune.playerTradeRequests)
      .where(eq(rune.playerTradeRequests.id, id));
    return row;
  }

  async function requestsBy(characterId: string, status?: string) {
    return db
      .select()
      .from(rune.playerTradeRequests)
      .where(
        and(
          eq(rune.playerTradeRequests.requesterCharacterId, characterId),
          status ? eq(rune.playerTradeRequests.status, status) : undefined,
        ),
      );
  }

  async function activeSessionsOf(characterId: string) {
    return db
      .select()
      .from(rune.playerTradeSessions)
      .where(
        and(
          eq(rune.playerTradeSessions.status, "active"),
          or(
            eq(rune.playerTradeSessions.requesterCharacterId, characterId),
            eq(rune.playerTradeSessions.recipientCharacterId, characterId),
          ),
        ),
      );
  }

  async function sessionRow(id: string) {
    const [row] = await db
      .select()
      .from(rune.playerTradeSessions)
      .where(eq(rune.playerTradeSessions.id, id));
    return row;
  }

  async function claimsOf(characterId: string) {
    return db
      .select()
      .from(rune.playerTradeClaims)
      .where(eq(rune.playerTradeClaims.characterId, characterId));
  }

  async function actionsOf(characterId: string) {
    return db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, characterId));
  }

  /**
   * The canonical invariant sweep: no character is in two active sessions or
   * holds two pending outgoing rows, every claim names that character's one
   * active session, and every active session holds exactly its two claims.
   */
  async function expectConsistent(who: Player[]) {
    const ids = who.map((p) => p.character.id);
    for (const id of ids) {
      const active = await activeSessionsOf(id);
      expect(active.length).toBeLessThanOrEqual(1);
      const claims = await claimsOf(id);
      expect(claims).toHaveLength(active.length);
      if (active[0]) expect(claims[0]!.sessionId).toBe(active[0].id);
      expect((await requestsBy(id, "pending")).length).toBeLessThanOrEqual(1);
    }
    const sessions = await db
      .select()
      .from(rune.playerTradeSessions)
      .where(
        and(
          eq(rune.playerTradeSessions.status, "active"),
          or(
            inArray(rune.playerTradeSessions.requesterCharacterId, ids),
            inArray(rune.playerTradeSessions.recipientCharacterId, ids),
          ),
        ),
      );
    for (const session of sessions) {
      const held = await db
        .select()
        .from(rune.playerTradeClaims)
        .where(eq(rune.playerTradeClaims.sessionId, session.id));
      expect(held.map((c) => c.characterId).sort()).toEqual(
        [session.requesterCharacterId, session.recipientCharacterId].sort(),
      );
    }
  }

  async function expectUniqueViolation(attempt: Promise<unknown>) {
    let error: unknown;
    try {
      await attempt;
    } catch (caught) {
      error = caught;
    }
    const failure = error as { code?: string; cause?: { code?: string } } | undefined;
    expect(failure, "expected the insert to be rejected").toBeDefined();
    expect(failure?.cause?.code ?? failure?.code).toBe("23505");
  }

  // --- realtime capture -----------------------------------------------------

  type Delivery = {
    type: string;
    data: { requestId?: string; sessionId?: string; change: string };
    /** The row's committed status read at the instant of delivery. */
    statusAtDelivery: string | undefined;
  };

  /** Every delivery each character receives while `run` executes. */
  async function observe<T>(
    who: Player[],
    run: () => Promise<T>,
  ): Promise<{ result: T; received: Map<string, Delivery[]> }> {
    const fanout = realtime.getRealtimeFanout();
    const pending: Promise<void>[] = [];
    const received = new Map<string, Delivery[]>();
    const unsubscribes = who.map(({ character }) => {
      received.set(character.id, []);
      return fanout.subscribe({
        scope: { playerAccountId: character.playerAccountId, characterId: character.id },
        deliver: (envelope) => {
          const data = envelope.data as Delivery["data"];
          const delivery: Delivery = { type: envelope.type, data, statusAtDelivery: undefined };
          received.get(character.id)!.push(delivery);
          const lookup = data.requestId
            ? db
                .select({ status: rune.playerTradeRequests.status })
                .from(rune.playerTradeRequests)
                .where(eq(rune.playerTradeRequests.id, data.requestId))
            : db
                .select({ status: rune.playerTradeSessions.status })
                .from(rune.playerTradeSessions)
                .where(eq(rune.playerTradeSessions.id, data.sessionId!));
          pending.push(
            Promise.resolve(lookup).then((rows) => {
              delivery.statusAtDelivery = rows[0]?.status;
            }),
          );
        },
        close: () => {},
      });
    });
    try {
      const result = await run();
      await Promise.all(pending);
      return { result, received };
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
  }

  const shape = (deliveries: Delivery[] | undefined) =>
    (deliveries ?? []).map((d) => [d.type, d.data]);

  // --- request authority and limits ---------------------------------------------

  describe("request authority and limits", () => {
    it("refuses forged, remote, nonexistent, and self targets with no row and no delivery", async () => {
      const a = await player();
      const near = await player();
      const far = await player();
      await moveTo(far, LOCATION_IDS.theJag);
      const targets = [
        { characterId: far.character.id },
        { name: far.character.displayName },
        { characterId: randomUUID() },
        { name: `Nobody${token()}` },
        { characterId: a.character.id },
        { name: a.character.displayName },
      ];

      const { result, received } = await observe([a, near, far], async () => {
        const results: TradeCommandResult[] = [];
        for (const target of targets) {
          results.push(await trades.createTradeRequest(a.userId, a.character.id, target));
        }
        return results;
      });

      for (const refusal of result) {
        expect(refusal).toMatchObject({ status: "refused", reason: "unavailable" });
      }
      // Acting as someone else's character is not an alternate door.
      await expect(
        trades.createTradeRequest(a.userId, near.character.id, { characterId: far.character.id }),
      ).rejects.toMatchObject({ name: "OwnershipError", status: 404 });

      for (const who of [a, near, far]) {
        expect(await requestsBy(who.character.id)).toEqual([]);
        expect(received.get(who.character.id)).toEqual([]);
      }
      expect((await stateOf(a)).outgoing).toBeNull();
    });

    it("lets a Block in either direction stop requests across every character of both accounts", async () => {
      const a1 = await player();
      const a2 = await altOf(a1);
      const b1 = await player();
      const b2 = await altOf(b1);
      expect(
        await blocks.blockPlayer(a1.userId, a1.character.id, { characterId: b1.character.id }),
      ).toMatchObject({ status: "blocked" });

      const unavailable = await trades.createTradeRequest(b1.userId, b1.character.id, {
        characterId: randomUUID(),
      });
      expect(unavailable).toMatchObject({ status: "refused", reason: "unavailable" });

      const { received } = await observe([a1, a2, b1, b2], async () => {
        for (const from of [a1, a2]) {
          for (const to of [b1, b2]) {
            // The blocker is told plainly; it is their own setting.
            expect(await create(from, to)).toMatchObject({
              status: "refused",
              reason: "blocked_by_you",
            });
          }
        }
        for (const from of [b1, b2]) {
          for (const to of [a1, a2]) {
            // The blocked side never learns: exactly any other unavailable target.
            expect(await create(from, to)).toEqual(unavailable);
          }
        }
      });

      for (const who of [a1, a2, b1, b2]) {
        expect(await requestsBy(who.character.id)).toEqual([]);
        expect(received.get(who.character.id)).toEqual([]);
      }
    });

    it("refuses a socially restricted requester but lets that account accept a request", async () => {
      const restricted = await player();
      const friend = await player();
      await restrictSocially(restricted.character.playerAccountId);

      expect(await create(restricted, friend)).toMatchObject({
        status: "refused",
        reason: "socially_restricted",
      });
      expect(await requestsBy(restricted.character.id)).toEqual([]);

      const requestId = await send(friend, restricted);
      const state = ok(await accept(restricted, requestId));
      expect(state.session).toMatchObject({ counterpart: { characterId: friend.character.id } });
      expect((await requestRow(requestId))?.status).toBe("accepted");
    });

    it("lets exactly one of two concurrent tabs create, and the unique index backs it", async () => {
      const a = await player();
      const b = await player();
      const c = await player();

      const results = await Promise.all([create(a, b), create(a, c)]);

      expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
      expect(results.filter((r) => r.status === "refused")).toEqual([
        expect.objectContaining({ reason: "already_requesting" }),
      ]);
      const pending = await requestsBy(a.character.id, "pending");
      expect(pending).toHaveLength(1);
      await expectConsistent([a, b, c]);

      const now = new Date();
      await expectUniqueViolation(
        db.insert(rune.playerTradeRequests).values({
          requesterCharacterId: a.character.id,
          requesterPlayerAccountId: a.character.playerAccountId,
          recipientCharacterId: b.character.id,
          recipientPlayerAccountId: b.character.playerAccountId,
          locationId: LOCATION_IDS.crashSite,
          createdAt: now,
          expiresAt: plus(now, REQUEST_TTL_MS),
        }),
      );
    });

    it("cancels immediately and idempotently, with no per-target cooldown", async () => {
      const a = await player();
      const b = await player();
      const now = new Date();
      const requestId = await send(a, b, now);
      expect(await gate.findTradeEngagement(db, a.character.id, now)).toBe("pending_request");

      const first = ok(await cancel(a, requestId, plus(now, 1_000)));
      expect(first.outgoing).toBeNull();
      expect(await gate.findTradeEngagement(db, a.character.id, plus(now, 1_000))).toBeNull();
      const canceled = await requestRow(requestId);
      expect(canceled?.status).toBe("canceled");

      ok(await cancel(a, requestId, plus(now, 2_000)));
      const again = await requestRow(requestId);
      expect(again?.status).toBe("canceled");
      expect(again?.resolvedAt?.getTime()).toBe(canceled?.resolvedAt?.getTime());

      // The same target, immediately: no cooldown.
      const second = ok(await create(a, b, plus(now, 2_000)));
      expect(second.outgoing).toMatchObject({ counterpart: { characterId: b.character.id } });
      expect(second.outgoing!.id).not.toBe(requestId);
    });

    it("expires a request at exactly 20 seconds, derived from the injected clock", async () => {
      const a = await player();
      const b = await player();
      const t0 = new Date();
      const requestId = await send(a, b, t0);
      const row = await requestRow(requestId);
      expect(row?.expiresAt.getTime()).toBe(t0.getTime() + REQUEST_TTL_MS);

      const justBefore = plus(t0, REQUEST_TTL_MS - 1);
      const expiry = plus(t0, REQUEST_TTL_MS);
      expect((await stateOf(a, justBefore)).outgoing?.id).toBe(requestId);
      expect((await stateOf(b, justBefore)).incoming).toHaveLength(1);
      expect(await gate.findTradeEngagement(db, a.character.id, justBefore)).toBe(
        "pending_request",
      );
      await expect(
        play.beginTravel(
          a.userId,
          a.character.id,
          LOCATION_IDS.abandonedProcessingYard,
          justBefore,
        ),
      ).rejects.toMatchObject({ name: "TradeEngagedError", engagement: "pending_request" });

      expect((await stateOf(a, expiry)).outgoing).toBeNull();
      expect((await stateOf(b, expiry)).incoming).toEqual([]);
      expect(await gate.findTradeEngagement(db, a.character.id, expiry)).toBeNull();
      // Nothing was written by the reads or the refused command.
      expect((await requestRow(requestId))?.status).toBe("pending");
      // A command run at the expiry instant is no longer refused.
      await play.beginTravel(
        a.userId,
        a.character.id,
        LOCATION_IDS.abandonedProcessingYard,
        expiry,
      );

      expect(await accept(b, requestId, expiry)).toMatchObject({
        status: "refused",
        reason: "unavailable",
      });
      const expired = await requestRow(requestId);
      expect(expired?.status).toBe("expired");
      expect(expired?.resolvedAt?.getTime()).toBe(expiry.getTime());
      expect(await activeSessionsOf(b.character.id)).toEqual([]);
    });

    it("limits one account to 4 requests per rolling 30 seconds across its characters, even concurrently", async () => {
      const s1 = await player();
      const s2 = await altOf(s1);
      const s3 = await altOf(s1);
      const target = await player();
      const t0 = new Date();

      // Three characters, three tabs at once.
      const first = await Promise.all([s1, s2, s3].map((s) => create(s, target, t0)));
      const created = first.map(ok);
      expect(created).toHaveLength(3);
      for (const state of created) expect(state.outgoing).not.toBeNull();

      const t1 = plus(t0, 1_000);
      await Promise.all([
        cancel(s1, created[0]!.outgoing!.id, t1),
        cancel(s2, created[1]!.outgoing!.id, t1),
      ]);

      // Two concurrent creations compete for the one remaining slot.
      const t2 = plus(t0, 2_000);
      const race = await Promise.all([create(s1, target, t2), create(s2, target, t2)]);
      const winners = race.filter((r) => r.status === "ok");
      const losers = race.filter((r) => r.status === "refused");
      expect(winners).toHaveLength(1);
      expect(losers).toEqual([
        expect.objectContaining({ reason: "rate_limited", retryAfterMs: 28_000 }),
      ]);
      const ledger = await db
        .select()
        .from(rune.playerTradeRequests)
        .where(eq(rune.playerTradeRequests.requesterPlayerAccountId, s1.character.playerAccountId));
      expect(ledger).toHaveLength(4);

      // A fifth, from a character that is free to ask, is refused with a wait.
      const idle = race[0]!.status === "ok" ? s2 : s1;
      const fifth = await create(idle, target, plus(t0, 4_000));
      expect(fifth).toMatchObject({ status: "refused", reason: "rate_limited" });
      expect((fifth as { retryAfterMs: number }).retryAfterMs).toBe(26_000);
      expect(await create(idle, target, plus(t0, 29_999))).toMatchObject({
        status: "refused",
        reason: "rate_limited",
        retryAfterMs: 1,
      });

      // The window slides: the oldest requests age out.
      expect(ok(await create(idle, target, plus(t0, 30_001))).outgoing).not.toBeNull();
      await expectConsistent([s1, s2, s3, target]);
    });

    it("does not spend budget on invalid, blocked, or busy attempts", async () => {
      const s1 = await player();
      const s2 = await altOf(s1);
      const target = await player();
      const far = await player();
      const blocked = await player();
      await moveTo(far, LOCATION_IDS.theJag);
      await blocks.blockPlayer(s1.userId, s2.character.id, { characterId: blocked.character.id });
      await makeBusy(s1);
      const t0 = new Date();

      for (let i = 0; i < 3; i += 1) {
        expect(await create(s1, target, t0)).toMatchObject({ reason: "busy" });
        expect(await create(s2, far, t0)).toMatchObject({ reason: "unavailable" });
        expect(
          await trades.createTradeRequest(
            s2.userId,
            s2.character.id,
            { name: `Nobody${token()}` },
            t0,
          ),
        ).toMatchObject({ reason: "unavailable" });
        expect(await create(s2, blocked, t0)).toMatchObject({ reason: "blocked_by_you" });
      }
      expect(await requestsBy(s1.character.id)).toEqual([]);
      expect(await requestsBy(s2.character.id)).toEqual([]);

      // All four valid requests still fit.
      for (let i = 0; i < 4; i += 1) {
        const now = plus(t0, i * 100);
        const requestId = await send(s2, target, now);
        if (i < 3) ok(await cancel(s2, requestId, now));
      }
      expect(await create(s2, target, plus(t0, 500))).toMatchObject({
        reason: "already_requesting",
      });
      ok(await cancel(s2, (await requestsBy(s2.character.id, "pending"))[0]!.id, plus(t0, 600)));
      expect(await create(s2, target, plus(t0, 700))).toMatchObject({ reason: "rate_limited" });
    });

    it("makes Block prominent only after repeated requests from the same sender account", async () => {
      const sender = await player();
      const other = await player();
      const recipient = await player();
      const t0 = new Date();
      const prominentFor = async (from: Player, now: Date) => {
        const incoming = (await stateOf(recipient, now)).incoming;
        return incoming.find((r) => r.counterpart.characterId === from.character.id)
          ?.blockProminent;
      };

      for (let i = 0; i < 3; i += 1) {
        const now = plus(t0, i * 1_000);
        const requestId = await send(sender, recipient, now);
        expect(await prominentFor(sender, now)).toBe(false);
        ok(await cancel(sender, requestId, now));
      }
      const now = plus(t0, 3_000);
      await send(other, recipient, now);
      await send(sender, recipient, now);
      expect(await prominentFor(sender, now)).toBe(true);
      // A different sender is counted on its own.
      expect(await prominentFor(other, now)).toBe(false);
      // The prominence is only a UI hint: nothing was blocked or sanctioned.
      expect(
        await blocks.isBlockedBetween(
          sender.character.playerAccountId,
          recipient.character.playerAccountId,
        ),
      ).toBe(false);
    });
  });

  // --- acceptance concurrency -------------------------------------------------

  describe("acceptance concurrency", () => {
    it("starts exactly one session when a recipient accepts two incoming requests at once", async () => {
      const a = await player();
      const b = await player();
      const c = await player();
      const now = new Date();
      const ab = await send(a, b, now);
      const cb = await send(c, b, now);

      const results = await Promise.all([accept(b, ab, now), accept(b, cb, now)]);

      expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
      expect(results.filter((r) => r.status === "refused")).toHaveLength(1);
      expect(await activeSessionsOf(b.character.id)).toHaveLength(1);
      expect(await claimsOf(b.character.id)).toHaveLength(1);
      const winner = results[0]!.status === "ok" ? a : c;
      const loser = winner === a ? c : a;
      expect(await gate.findTradeEngagement(db, loser.character.id, now)).toBeNull();
      expect(await gate.findTradeEngagement(db, winner.character.id, now)).toBe("session");
      expect(await activeSessionsOf(loser.character.id)).toEqual([]);
      await expectConsistent([a, b, c]);
    });

    it("keeps a character with its own outgoing request in exactly one session when both accept", async () => {
      const a = await player();
      const b = await player();
      const c = await player();
      const now = new Date();
      const ab = await send(a, b, now);
      const bc = await send(b, c, now);

      const results = await Promise.all([accept(b, ab, now), accept(c, bc, now)]);

      expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
      expect(await activeSessionsOf(b.character.id)).toHaveLength(1);
      expect(await claimsOf(b.character.id)).toHaveLength(1);
      expect(await requestsBy(b.character.id, "pending")).toEqual([]);
      await expectConsistent([a, b, c]);
    });

    it("starts exactly one session for crossed requests accepted at the same time", async () => {
      const a = await player();
      const b = await player();
      const now = new Date();
      const ab = await send(a, b, now);
      const ba = await send(b, a, now);

      const results = await Promise.all([accept(b, ab, now), accept(a, ba, now)]);

      expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
      const between = await db
        .select()
        .from(rune.playerTradeSessions)
        .where(
          and(
            eq(rune.playerTradeSessions.status, "active"),
            or(
              eq(rune.playerTradeSessions.requesterCharacterId, a.character.id),
              eq(rune.playerTradeSessions.recipientCharacterId, a.character.id),
            ),
          ),
        );
      expect(between).toHaveLength(1);
      await expectConsistent([a, b]);
    });

    it("resolves Accept against Cancel to exactly one outcome, never both", async () => {
      const outcomes = { accepted: 0, canceled: 0 };
      for (let i = 0; i < 10; i += 1) {
        const a = await player();
        const b = await player();
        const now = new Date();
        const requestId = await send(a, b, now);

        const [acceptResult, cancelResult] = await Promise.all([
          accept(b, requestId, now),
          cancel(a, requestId, now),
        ]);
        const row = await requestRow(requestId);
        const sessions = await activeSessionsOf(a.character.id);

        if (acceptResult.status === "ok") {
          outcomes.accepted += 1;
          expect(cancelResult).toMatchObject({ status: "refused", reason: "already_accepted" });
          expect(row?.status).toBe("accepted");
          expect(sessions).toHaveLength(1);
          expect(row?.sessionId).toBe(sessions[0]!.id);
        } else {
          outcomes.canceled += 1;
          expect(acceptResult).toMatchObject({ status: "refused", reason: "unavailable" });
          expect(cancelResult.status).toBe("ok");
          expect(row?.status).toBe("canceled");
          expect(sessions).toEqual([]);
          expect(await claimsOf(a.character.id)).toEqual([]);
        }
        await expectConsistent([a, b]);
      }
      expect(outcomes.accepted + outcomes.canceled).toBe(10);
    });

    it("refuses Accept at exactly the expiry instant and records it as expired", async () => {
      const a = await player();
      const b = await player();
      const t0 = new Date();
      const requestId = await send(a, b, t0);
      const expiresAt = plus(t0, REQUEST_TTL_MS);

      const result = await accept(b, requestId, expiresAt);

      expect(result).toMatchObject({ status: "refused", reason: "unavailable" });
      const row = await requestRow(requestId);
      expect(row?.status).toBe("expired");
      expect(row?.resolvedAt?.getTime()).toBe(expiresAt.getTime());
      expect(await activeSessionsOf(a.character.id)).toEqual([]);
      expect(await claimsOf(b.character.id)).toEqual([]);

      // One millisecond earlier it would have been valid.
      const c = await player();
      const d = await player();
      const second = await send(c, d, t0);
      expect(ok(await accept(d, second, plus(t0, REQUEST_TTL_MS - 1))).session).not.toBeNull();
    });

    it("invalidates a request when either character has left the shared World Location", async () => {
      for (const mover of ["recipient", "requester"] as const) {
        const a = await player();
        const b = await player();
        const now = new Date();
        const requestId = await send(a, b, now);

        await moveTo(mover === "recipient" ? b : a, LOCATION_IDS.theJag);

        // The requester is released before anything is written.
        expect(await gate.findTradeEngagement(db, a.character.id, now)).toBeNull();
        expect((await requestRow(requestId))?.status).toBe("pending");
        expect((await stateOf(b, now)).incoming).toEqual([]);

        expect(await accept(b, requestId, now)).toMatchObject({
          status: "refused",
          reason: "unavailable",
        });
        expect((await requestRow(requestId))?.status).toBe("invalidated");
        expect(await activeSessionsOf(a.character.id)).toEqual([]);
        expect(await activeSessionsOf(b.character.id)).toEqual([]);
        await expectConsistent([a, b]);
      }
    });

    it("keeps a lapsed request lapsed once its released requester acts, even if the recipient returns", async () => {
      const a = await player();
      const b = await player();
      const now = new Date();
      const requestId = await send(a, b, now);
      await moveTo(b, LOCATION_IDS.theJag);

      // Released, the requester runs an ordinary command; the gate records
      // the lapse under its lock before the command proceeds.
      await characterPreferences.setAutoDiscardSlagPreference(a.userId, a.character.id, true, now);
      expect((await requestRow(requestId))?.status).toBe("invalidated");

      await moveTo(b, a.character.currentLocationId);
      expect(await gate.findTradeEngagement(db, a.character.id, now)).toBeNull();
      expect((await stateOf(b, now)).incoming).toEqual([]);
      expect(await accept(b, requestId, now)).toMatchObject({
        status: "refused",
        reason: "unavailable",
      });
      await expectConsistent([a, b]);
    });

    it("answers a retried Accept with the same session after older requests are pruned", async () => {
      const a = await player();
      const b = await player();
      const c = await player();
      const d = await player();
      const t0 = new Date();
      const { requestId, sessionId } = await openSession(a, b, t0);

      // Any later successful creation prunes spent rows outside the window.
      await send(c, d, plus(t0, 31_000));

      expect((await requestRow(requestId))?.sessionId).toBe(sessionId);
      const retried = ok(await accept(b, requestId, plus(t0, 31_000)));
      expect(retried.session?.id).toBe(sessionId);
      await expectConsistent([a, b, c, d]);
    });

    it("cancels the recipient's own outgoing request atomically when it accepts", async () => {
      const a = await player();
      const b = await player();
      const c = await player();
      const now = new Date();
      const bc = await send(b, c, now);
      const ab = await send(a, b, now);

      const { received } = await observe([a, b, c], () => accept(b, ab, now));

      expect((await requestRow(bc))?.status).toBe("canceled");
      expect((await requestRow(ab))?.status).toBe("accepted");
      expect(await requestsBy(b.character.id, "pending")).toEqual([]);
      expect(await gate.findTradeEngagement(db, c.character.id, now)).toBeNull();
      expect(shape(received.get(c.character.id))).toEqual([
        ["trade.request", { requestId: bc, change: "canceled" }],
      ]);
      expect(shape(received.get(b.character.id))).toContainEqual([
        "trade.request",
        { requestId: bc, change: "canceled" },
      ]);
      await expectConsistent([a, b, c]);
    });

    it("accepts between two characters of the same account", async () => {
      const a = await player();
      const b = await altOf(a);
      const requestId = await send(a, b);

      const state = ok(await accept(b, requestId));

      expect(state.session?.counterpart).toEqual({
        characterId: a.character.id,
        name: a.character.displayName,
      });
      expect((await stateOf(a)).session?.counterpart.characterId).toBe(b.character.id);
      expect(await gate.findTradeEngagement(db, a.character.id, new Date())).toBe("session");
      expect(await gate.findTradeEngagement(db, b.character.id, new Date())).toBe("session");
      await expectConsistent([a, b]);
    });

    it("creates crossed requests concurrently without deadlocking", async () => {
      // Creation locks the requester's row and then inserts a row that
      // references the recipient, so requests that cross must not wait on each other.
      for (let round = 0; round < 5; round += 1) {
        const a = await player();
        const b = await player();
        const now = new Date();
        const crossed = await Promise.all([create(a, b, now), create(b, a, now)]);
        expect(crossed.map((r) => r.status)).toEqual(["ok", "ok"]);
        await expectConsistent([a, b]);
      }
    });

    it("creates a ring of requests concurrently without deadlocking", async () => {
      const ring = [await player(), await player(), await player(), await player()];
      const now = new Date();
      const sent = await Promise.all(
        ring.map((from, i) => create(from, ring[(i + 1) % ring.length]!, now)),
      );
      expect(sent.map((r) => r.status)).toEqual(Array(4).fill("ok"));
      await expectConsistent(ring);
    });

    it("keeps every character in at most one session under rings of simultaneous accepts", async () => {
      for (let round = 0; round < 5; round += 1) {
        const ring = [await player(), await player(), await player(), await player()];
        const now = new Date();
        const requestIds: string[] = [];
        for (const [i, from] of ring.entries()) {
          requestIds.push(await send(from, ring[(i + 1) % ring.length]!, now));
        }
        const incomingOf = (i: number) => requestIds[(i + ring.length - 1) % ring.length]!;

        const accepted = await Promise.all(ring.map((who, i) => accept(who, incomingOf(i), now)));

        expect(accepted.some((r) => r.status === "ok")).toBe(true);
        for (const [i, result] of accepted.entries()) {
          const row = await requestRow(incomingOf(i));
          // A loser's request was voided by the winner or canceled as its recipient's own.
          if (result.status === "ok") expect(row?.status).toBe("accepted");
          else expect(["invalidated", "canceled"]).toContain(row?.status);
        }
        await expectConsistent(ring);
      }
    });
  });

  // --- authorization and exclusivity ---------------------------------------------

  describe("authorization", () => {
    it("treats guessed and foreign ids exactly like a missing one and changes nothing", async () => {
      const a = await player();
      const b = await player();
      const x = await player();
      const c = await player();
      const d = await player();
      const now = new Date();
      const requestId = await send(a, b, now);
      const { sessionId } = await openSession(c, d, now);
      const guessed = randomUUID();

      const missing = await accept(b, guessed, now);
      expect(missing).toMatchObject({ status: "refused", reason: "unavailable" });
      const refusals = [
        await cancel(a, guessed, now),
        await decline(b, guessed, now),
        await cancelSession(c, guessed, now),
        // A third party on someone else's request or session.
        await accept(x, requestId, now),
        await cancel(x, requestId, now),
        await decline(x, requestId, now),
        await cancelSession(x, sessionId, now),
        // The wrong side of one's own request.
        await decline(a, requestId, now),
        await cancel(b, requestId, now),
        await accept(a, requestId, now),
      ];
      for (const refusal of refusals) {
        expect(refusal).toMatchObject({ status: "refused", reason: "unavailable" });
      }

      expect((await requestRow(requestId))?.status).toBe("pending");
      expect((await sessionRow(sessionId))?.status).toBe("active");
      expect(await claimsOf(c.character.id)).toHaveLength(1);

      const view = await stateOf(x, now);
      expect(view).toEqual({ outgoing: null, incoming: [], session: null });
      expect(JSON.stringify(view)).not.toContain(sessionId);
    });

    it("throws an ownership error for a valid character id under the wrong account", async () => {
      const a = await player();
      const b = await player();
      const intruder = await player();
      const now = new Date();
      const requestId = await send(a, b, now);
      const { sessionId } = await openSession(await player(), await player(), now);
      const notFound = { name: "OwnershipError", status: 404 };

      await expect(
        trades.createTradeRequest(intruder.userId, a.character.id, { characterId: b.character.id }),
      ).rejects.toMatchObject(notFound);
      await expect(
        trades.acceptTradeRequest(intruder.userId, b.character.id, requestId),
      ).rejects.toMatchObject(notFound);
      await expect(
        trades.cancelTradeRequest(intruder.userId, a.character.id, requestId),
      ).rejects.toMatchObject(notFound);
      await expect(
        trades.declineTradeRequest(intruder.userId, b.character.id, requestId),
      ).rejects.toMatchObject(notFound);
      await expect(
        trades.cancelTradeSession(intruder.userId, a.character.id, sessionId),
      ).rejects.toMatchObject(notFound);
      await expect(trades.getTradeState(intruder.userId, a.character.id)).rejects.toMatchObject(
        notFound,
      );
      expect((await requestRow(requestId))?.status).toBe("pending");
    });

    it("refuses every gameplay command in a second tab while a session is active", async () => {
      const a = await player();
      const b = await player();
      await openSession(a, b);
      const stackA = await addStack(a);
      const stackB = await addStack(b);
      const drop = (who: Player, stackId: string) =>
        inventory.discardInventoryStack(who.userId, who.character.id, {
          stackId,
          mode: "stack",
          expectedQuantity: 3,
        });
      const travel = (who: Player) =>
        play.beginTravel(who.userId, who.character.id, LOCATION_IDS.abandonedProcessingYard);

      const settled = await Promise.allSettled([
        travel(a),
        drop(a, stackA),
        travel(b),
        drop(b, stackB),
        travel(a),
        drop(b, stackB),
      ]);

      for (const outcome of settled) {
        expect(outcome.status).toBe("rejected");
        const reason = (outcome as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(gate.TradeEngagedError);
        expect(reason).toMatchObject({ status: 409, engagement: "session" });
      }
      expect(await actionsOf(a.character.id)).toEqual([]);
      expect(await actionsOf(b.character.id)).toEqual([]);
      const stacks = await db
        .select()
        .from(rune.inventoryStacks)
        .where(inArray(rune.inventoryStacks.id, [stackA, stackB]));
      expect(stacks.map((s) => s.quantity)).toEqual([3, 3]);
    });

    it("refuses representative gameplay and inventory commands while a trade is accepted", async () => {
      const a = await player();
      const b = await player();
      const stackId = await addStack(a);
      await play.getPlayGameplayState(a.userId, a.character.id);
      const { sessionId } = await openSession(a, b);
      const creditsBefore = (
        await db.select().from(rune.characters).where(eq(rune.characters.id, a.character.id))
      )[0]!.credits;

      const commands: Record<string, () => Promise<unknown>> = {
        drop: () =>
          inventory.discardInventoryStack(a.userId, a.character.id, {
            stackId,
            mode: "stack",
            expectedQuantity: 3,
          }),
        unequip: () =>
          equipment.changeEquipment(a.userId, a.character.id, {
            kind: "unequip",
            target: { assignmentKind: "gear", suitSlotId: "mining_tool" },
          }),
        merchantTrade: () =>
          merchant.tradeWithMerchant(a.userId, a.character.id, {
            itemId: ITEM_IDS.powerCell,
            direction: "buy",
            quantity: 1,
          }),
        cargoDeposit: () =>
          cargo.depositCargoStack(a.userId, a.character.id, {
            stackId,
            mode: "stack",
            expectedQuantity: 3,
          }),
        travel: () =>
          play.beginTravel(a.userId, a.character.id, LOCATION_IDS.abandonedProcessingYard),
        mining: () => miningCommands.startMining(a.userId, a.character.id),
        promotedAd: () =>
          chat.postPromotedTradeAd(a.userId, a.character.id, { text: "Selling ferrite" }),
      };
      for (const [name, run] of Object.entries(commands)) {
        await expect(run(), name).rejects.toMatchObject({
          name: "TradeEngagedError",
          status: 409,
          engagement: "session",
        });
      }
      // Nothing moved.
      expect(await actionsOf(a.character.id)).toEqual([]);
      const [after] = await db
        .select()
        .from(rune.characters)
        .where(eq(rune.characters.id, a.character.id));
      expect(after?.credits).toBe(creditsBefore);
      const [stack] = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.id, stackId));
      expect(stack?.quantity).toBe(3);

      // Reads and the Scavenge acknowledgement stay available.
      await expect(play.getPlayGameplayState(a.userId, a.character.id)).resolves.toBeDefined();
      await play.acknowledgeScavengeReveal(a.userId, a.character.id, randomUUID());

      ok(await cancelSession(a, sessionId));
      expect(await gate.findTradeEngagement(db, a.character.id, new Date())).toBeNull();
      const dropped = await commands.drop!();
      expect(dropped).toMatchObject({ discard: { status: "discarded", discardedQuantity: 3 } });
      await commands.travel!();
      expect(await actionsOf(a.character.id)).toHaveLength(1);
    });

    it("releases both characters when an idle session passes its inactivity expiry", async () => {
      const a = await player();
      const b = await player();
      const t0 = new Date();
      const { sessionId } = await openSession(a, b, t0);
      const justBefore = plus(t0, SESSION_IDLE_MS - 1);
      const expiry = plus(t0, SESSION_IDLE_MS);

      expect((await stateOf(a, justBefore)).session?.id).toBe(sessionId);
      expect(await gate.findTradeEngagement(db, b.character.id, justBefore)).toBe("session");
      await expect(
        play.beginTravel(
          a.userId,
          a.character.id,
          LOCATION_IDS.abandonedProcessingYard,
          justBefore,
        ),
      ).rejects.toMatchObject({ name: "TradeEngagedError", engagement: "session" });

      expect((await stateOf(a, expiry)).session).toBeNull();
      expect((await stateOf(b, expiry)).session).toBeNull();
      expect(await gate.findTradeEngagement(db, b.character.id, expiry)).toBeNull();
      // The gate and the reads derive it: nothing was written yet.
      expect((await sessionRow(sessionId))?.status).toBe("active");
      await play.beginTravel(
        a.userId,
        a.character.id,
        LOCATION_IDS.abandonedProcessingYard,
        expiry,
      );

      // The next request involving a claimed character writes the expiry down.
      const requestId = await send(b, a, expiry);
      const ended = await sessionRow(sessionId);
      expect(ended).toMatchObject({ status: "expired", endedByCharacterId: null });
      expect(ended?.endedAt?.getTime()).toBe(expiry.getTime());
      expect(await claimsOf(a.character.id)).toEqual([]);
      expect(await claimsOf(b.character.id)).toEqual([]);
      expect((await requestRow(requestId))?.status).toBe("pending");
    });

    it("gates only the requester of a pending request, never its recipient", async () => {
      const a = await player();
      const b = await player();
      const stackB = await addStack(b);
      const requestId = await send(a, b);

      await expect(
        play.beginTravel(a.userId, a.character.id, LOCATION_IDS.abandonedProcessingYard),
      ).rejects.toMatchObject({
        name: "TradeEngagedError",
        status: 409,
        engagement: "pending_request",
      });
      await expect(
        chat.postPromotedTradeAd(a.userId, a.character.id, { text: "Selling ferrite" }),
      ).rejects.toMatchObject({ name: "TradeEngagedError", engagement: "pending_request" });

      const dropped = await inventory.discardInventoryStack(b.userId, b.character.id, {
        stackId: stackB,
        mode: "stack",
        expectedQuantity: 3,
      });
      expect(dropped.discard).toMatchObject({ status: "discarded" });
      expect(await gate.findTradeEngagement(db, b.character.id, new Date())).toBeNull();

      // Releasing the request releases the requester.
      ok(await decline(b, requestId));
      await play.beginTravel(a.userId, a.character.id, LOCATION_IDS.abandonedProcessingYard);
    });
  });

  // --- realtime --------------------------------------------------------------------

  describe("realtime", () => {
    it("publishes every request and session change to both participants once, after commit", async () => {
      const a = await player();
      const b = await player();
      const bystander = await player();
      const expectedStatus = (change: string) =>
        change === "created" ? "pending" : change === "started" ? "active" : change;
      const expectBoth = (
        received: Map<string, Delivery[]>,
        events: Array<[string, Record<string, string>]>,
      ) => {
        for (const who of [a, b]) {
          const mine = received.get(who.character.id);
          expect(shape(mine)).toEqual(events);
          // Each prompt was published after its change was visible to other connections.
          for (const delivery of mine ?? []) {
            expect(delivery.statusAtDelivery).toBe(expectedStatus(delivery.data.change));
          }
        }
        expect(received.get(bystander.character.id)).toEqual([]);
      };
      const watch = <T>(run: () => Promise<T>) => observe([a, b, bystander], run);

      const created = await watch(() => create(a, b));
      const first = ok(created.result).outgoing!.id;
      expectBoth(created.received, [["trade.request", { requestId: first, change: "created" }]]);

      const canceled = await watch(() => cancel(a, first));
      expectBoth(canceled.received, [["trade.request", { requestId: first, change: "canceled" }]]);

      const second = (await watch(() => create(a, b)).then((r) => ok(r.result))).outgoing!.id;
      const declined = await watch(() => decline(b, second));
      expectBoth(declined.received, [["trade.request", { requestId: second, change: "declined" }]]);

      const third = ok(await create(a, b)).outgoing!.id;
      const accepted = await watch(() => accept(b, third));
      const sessionId = ok(accepted.result).session!.id;
      expectBoth(accepted.received, [
        ["trade.request", { requestId: third, change: "accepted" }],
        ["trade.session", { sessionId, change: "started" }],
      ]);

      const ended = await watch(() => cancelSession(b, sessionId));
      expectBoth(ended.received, [["trade.session", { sessionId, change: "canceled" }]]);

      // An idempotent repeat and a refusal announce nothing.
      const quiet = await watch(async () => {
        await cancelSession(a, sessionId);
        await cancel(a, third);
        await accept(b, randomUUID());
      });
      expectBoth(quiet.received, []);
    });
  });
});
