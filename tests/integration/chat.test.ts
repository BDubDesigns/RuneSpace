import { eq, inArray, lt, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { chatRetentionCutoff } from "@/game/domain/chat";
import type { ChatMessageView, ChatSendResult, VisibleChatMessageView } from "@/game/schemas/chat";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  withChatRetentionWindow,
  withPublicGameplayClosed,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const token = () => Math.random().toString(36).slice(2, 8);
const DAY_MS = 24 * 60 * 60_000;

function sent(result: ChatSendResult): VisibleChatMessageView {
  if (result.status !== "sent") throw new Error(`expected a send, got ${result.reason}`);
  return result.message;
}

/**
 * Issue #246 acceptance against real PostgreSQL: public General/Trade chat
 * persists immutable server-derived identity, pages stably, deletes expired
 * rows, publishes only after commit, enforces one account-wide rolling send
 * budget and ad cooldown across characters and concurrent requests, charges
 * promoted ads atomically, and refuses severe slurs without persisting,
 * delivering, or recording anything about the sender.
 */
suite("issue #246 public chat (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let chat: typeof import("@/server/chat");
  let guardrail: typeof import("@/server/chat-guardrail");
  let realtime: typeof import("@/server/realtime");
  let route: typeof import("@/app/api/chat/route");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    chat = await import("@/server/chat");
    guardrail = await import("@/server/chat-guardrail");
    realtime = await import("@/server/realtime");
    route = await import("@/app/api/chat/route");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function player(options: { gameplayAccess?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, `chat-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Chat${token()}`,
      undefined,
      { gameplayAccess: options.gameplayAccess },
    );
    return { userId, character };
  }

  async function secondCharacter(userId: string) {
    return createCharacterForUser(db, rune, ownership, characters, userId, `Alt${token()}`);
  }

  async function rowsFor(characterId: string) {
    return db
      .select()
      .from(rune.chatMessages)
      .where(eq(rune.chatMessages.senderCharacterId, characterId));
  }

  async function creditsOf(characterId: string) {
    const [row] = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    return row!.credits;
  }

  async function setCredits(characterId: string, credits: number) {
    await db.update(rune.characters).set({ credits }).where(eq(rune.characters.id, characterId));
  }

  it("persists server-derived identity and ignores anything the browser claims", async () => {
    const { userId, character } = await player();
    const now = new Date();
    const message = sent(
      await chat.sendChatMessage(
        userId,
        character.id,
        // Extra fields are not part of the command and are never read.
        {
          channel: "general",
          text: "  hello RuneSpace  ",
          senderName: "Staff",
          playerAccountId: "forged",
        } as never,
        { now },
      ),
    );
    const [row] = await rowsFor(character.id);
    expect(row).toMatchObject({
      id: message.id,
      seq: message.seq,
      channel: "general",
      senderPlayerAccountId: character.playerAccountId,
      senderCharacterId: character.id,
      senderCharacterName: character.displayName,
      body: "hello RuneSpace",
      promotedPriceCredits: null,
    });
    expect(row!.createdAt.getTime()).toBe(now.getTime());
    expect(message).toEqual({
      redacted: false,
      id: row!.id,
      seq: row!.seq,
      channel: "general",
      senderCharacterId: character.id,
      senderName: character.displayName,
      body: "hello RuneSpace",
      sentAt: now.toISOString(),
      promoted: false,
      mentions: [],
    });
    // Account identity never leaves the server.
    expect(JSON.stringify(message)).not.toContain(character.playerAccountId);
  });

  it("refuses a foreign character, a gated account, and an anonymous read", async () => {
    const owner = await player();
    const intruder = await player();
    await expect(
      chat.sendChatMessage(intruder.userId, owner.character.id, { channel: "general", text: "hi" }),
    ).rejects.toMatchObject({ name: "OwnershipError", status: 404 });
    await expect(
      chat.postPromotedTradeAd(intruder.userId, owner.character.id, { text: "WTS" }),
    ).rejects.toMatchObject({ name: "OwnershipError", status: 404 });
    await expect(
      chat.readChatHistory(intruder.userId, owner.character.id, { channel: "general" }),
    ).rejects.toMatchObject({ name: "OwnershipError", status: 404 });

    const waiting = await player({ gameplayAccess: false });
    await withPublicGameplayClosed(db, rune, () =>
      expect(
        chat.sendChatMessage(waiting.userId, waiting.character.id, {
          channel: "general",
          text: "hi",
        }),
      ).rejects.toMatchObject({ name: "GameplayAccessError", status: 403 }),
    );

    const headers = { host: "localhost:3000" };
    const anonymous = await route.GET(
      new Request(
        `http://localhost:3000/api/chat?characterId=${owner.character.id}&channel=general`,
        { headers },
      ),
    );
    expect(anonymous.status).toBe(401);
    for (const query of [
      `characterId=${owner.character.id}&channel=zone`,
      `characterId=not-a-uuid&channel=general`,
      `characterId=${owner.character.id}&channel=trade&before=-4`,
      `characterId=${owner.character.id}&channel=trade&before=1e20`,
    ]) {
      const malformed = await route.GET(
        new Request(`http://localhost:3000/api/chat?${query}`, { headers }),
      );
      expect(malformed.status).toBe(400);
    }
    expect(await rowsFor(owner.character.id)).toHaveLength(0);
  });

  it("refuses empty and over-length messages without persisting them", async () => {
    const { userId, character } = await player();
    for (const [text, reason] of [
      ["", "empty"],
      ["   \n ", "empty"],
      ["x".repeat(281), "too_long"],
    ] as const) {
      const result = await chat.sendChatMessage(userId, character.id, { channel: "trade", text });
      expect(result).toMatchObject({ status: "refused", reason });
    }
    sent(
      await chat.sendChatMessage(userId, character.id, { channel: "trade", text: "y".repeat(280) }),
    );
    // Control characters PostgreSQL cannot store are dropped, never a 500.
    const cleaned = sent(
      await chat.sendChatMessage(userId, character.id, { channel: "trade", text: "a\u0000b" }),
    );
    expect(cleaned.body).toBe("ab");
    expect(await rowsFor(character.id)).toHaveLength(2);
    // The database refuses an out-of-contract body even from a buggy writer.
    await expect(
      db.insert(rune.chatMessages).values({
        channel: "general",
        senderPlayerAccountId: character.playerAccountId,
        senderCharacterId: character.id,
        senderCharacterName: character.displayName,
        body: "z".repeat(281),
      }),
    ).rejects.toThrow();
  });

  it("enforces General's five and Trade's three on one shared rolling count", async () => {
    const { userId, character } = await player();
    const start = Date.now();
    const at = (ms: number) => ({ now: new Date(start + ms) });
    const send = (channel: "general" | "trade", ms: number) =>
      chat.sendChatMessage(userId, character.id, { channel, text: `${channel} ${ms}` }, at(ms));

    for (const ms of [0, 100, 200]) sent(await send("general", ms));
    // Three recent General sends: Trade is closed, General has two left.
    const trade = await send("trade", 300);
    expect(trade).toMatchObject({ status: "refused", reason: "rate_limited" });
    expect(trade.budget.recentSendExpiresInMs).toEqual([9_700, 9_800, 9_900]);
    sent(await send("general", 400));
    const fifth = sent(await send("general", 500));
    expect(fifth.body).toBe("general 500");
    const sixth = await send("general", 600);
    expect(sixth).toMatchObject({ status: "refused", reason: "rate_limited" });
    expect(sixth.status === "refused" && sixth.error).toBe("Slow down. You can send again in 10s.");

    // The first send ages out at 10s: General reopens for one, Trade still not.
    sent(await send("general", 10_000));
    expect(await send("trade", 10_050)).toMatchObject({ reason: "rate_limited" });
    // Once all but two have aged out, Trade opens again.
    sent(await send("trade", 10_401));
    // Refusals were never persisted.
    expect(await rowsFor(character.id)).toHaveLength(7);
  });

  it("shares one budget across characters and concurrent tabs of an account", async () => {
    const { userId, character } = await player();
    const alt = await secondCharacter(userId);
    const now = new Date();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        chat.sendChatMessage(
          userId,
          index % 2 === 0 ? character.id : alt.id,
          { channel: "general", text: `burst ${index}` },
          { now },
        ),
      ),
    );
    expect(attempts.filter((result) => result.status === "sent")).toHaveLength(5);
    expect(attempts.filter((result) => result.status === "refused")).toHaveLength(3);
    const persisted = [...(await rowsFor(character.id)), ...(await rowsFor(alt.id))];
    expect(persisted).toHaveLength(5);

    // Another account keeps its own budget.
    const other = await player();
    sent(
      await chat.sendChatMessage(
        other.userId,
        other.character.id,
        { channel: "trade", text: "unaffected" },
        { now },
      ),
    );
  });

  it("charges a promoted ad once, atomically, and surfaces one record in both feeds", async () => {
    const { userId, character } = await player();
    await setCredits(character.id, 120);
    const now = new Date();
    const ad = sent(
      await chat.postPromotedTradeAd(userId, character.id, { text: "WTS Ferrite Shale" }, { now }),
    );
    expect(ad).toMatchObject({ channel: "trade", promoted: true });
    expect(await creditsOf(character.id)).toBe(70);
    const rows = await rowsFor(character.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.promotedPriceCredits).toBe(50);

    const general = await chat.readChatHistory(userId, character.id, { channel: "general" }, now);
    const trade = await chat.readChatHistory(userId, character.id, { channel: "trade" }, now);
    expect(general.messages.filter((message) => message.id === ad.id)).toEqual([ad]);
    expect(trade.messages.filter((message) => message.id === ad.id)).toEqual([ad]);
    expect(general.promotedAd).toEqual({ priceCredits: 50, readyInMs: 600_000 });
  });

  it("counts an ad as one shared send and cools ads down account-wide", async () => {
    const { userId, character } = await player();
    const alt = await secondCharacter(userId);
    await setCredits(character.id, 500);
    await setCredits(alt.id, 500);
    const start = Date.now();
    const at = (ms: number) => ({ now: new Date(start + ms) });

    sent(await chat.postPromotedTradeAd(userId, character.id, { text: "ad one" }, at(0)));
    sent(await chat.sendChatMessage(userId, alt.id, { channel: "trade", text: "t1" }, at(10)));
    sent(await chat.sendChatMessage(userId, alt.id, { channel: "trade", text: "t2" }, at(20)));
    // The ad was one of the three.
    expect(
      await chat.sendChatMessage(userId, alt.id, { channel: "trade", text: "t3" }, at(30)),
    ).toMatchObject({ reason: "rate_limited" });

    // Another character on the account cannot rotate around the cooldown, and
    // a refused ad spends nothing.
    const cooling = await chat.postPromotedTradeAd(userId, alt.id, { text: "ad two" }, at(60_000));
    expect(cooling).toMatchObject({ status: "refused", reason: "ad_cooldown" });
    expect(cooling.status === "refused" && cooling.error).toBe(
      "You can post another promoted ad in 9m 0s.",
    );
    expect(cooling.promotedAd.readyInMs).toBe(540_000);
    expect(await creditsOf(alt.id)).toBe(500);

    // Concurrent ads the moment the cooldown ends: exactly one wins and pays.
    const racing = await Promise.all([
      chat.postPromotedTradeAd(userId, character.id, { text: "race a" }, at(600_000)),
      chat.postPromotedTradeAd(userId, alt.id, { text: "race b" }, at(600_000)),
    ]);
    expect(racing.filter((result) => result.status === "sent")).toHaveLength(1);
    expect((await creditsOf(character.id)) + (await creditsOf(alt.id))).toBe(1000 - 100);
  });

  it("refuses an unaffordable, cooling, or rate-limited ad without charging or persisting", async () => {
    const { userId, character } = await player();
    await setCredits(character.id, 49);
    const broke = await chat.postPromotedTradeAd(userId, character.id, { text: "WTB" });
    expect(broke).toMatchObject({ status: "refused", reason: "insufficient_credits" });
    expect(broke.status === "refused" && broke.error).toBe("A promoted ad costs 50 Credits.");
    expect(await creditsOf(character.id)).toBe(49);

    await setCredits(character.id, 100);
    const now = new Date();
    for (const index of [1, 2, 3]) {
      sent(
        await chat.sendChatMessage(
          userId,
          character.id,
          { channel: "general", text: `g${index}` },
          { now },
        ),
      );
    }
    expect(
      await chat.postPromotedTradeAd(userId, character.id, { text: "WTB" }, { now }),
    ).toMatchObject({ reason: "rate_limited" });
    expect(await creditsOf(character.id)).toBe(100);
    expect((await rowsFor(character.id)).every((row) => row.promotedPriceCredits === null)).toBe(
      true,
    );
  });

  it("refuses a listed severe slur before persistence or delivery, with no sanction", async () => {
    const { userId, character } = await player();
    await setCredits(character.id, 100);
    const denylist = new Set([guardrail.severeTermDigest("zorbfrak")]);
    const fanout = realtime.getRealtimeFanout();
    const delivered: unknown[] = [];
    const unsubscribe = fanout.subscribe({
      scope: { playerAccountId: "observer", characterId: "observer" },
      deliver: (envelope) => delivered.push(envelope.data),
      close: () => {},
    });
    try {
      for (const attempt of [
        () =>
          chat.sendChatMessage(
            userId,
            character.id,
            { channel: "general", text: "you Z0RBFRAK" },
            { denylist },
          ),
        () => chat.postPromotedTradeAd(userId, character.id, { text: "zorbfrak" }, { denylist }),
      ]) {
        const result = await attempt();
        expect(result).toMatchObject({ status: "refused", reason: "prohibited_term" });
        expect(result.status === "refused" && result.error).toBe(
          "That message wasn't sent: it contains a slur RuneSpace blocks.",
        );
        // Not a send: the budget is untouched.
        expect(result.budget.recentSendExpiresInMs).toEqual([]);
      }
      expect(delivered).toEqual([]);
      expect(await rowsFor(character.id)).toHaveLength(0);
      expect(await creditsOf(character.id)).toBe(100);

      // Nothing restricts the sender afterwards; ordinary profanity is fine.
      sent(
        await chat.sendChatMessage(
          userId,
          character.id,
          { channel: "general", text: "this damn drop rate" },
          { denylist },
        ),
      );
      expect(delivered).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it("publishes only after the message has committed", async () => {
    const { userId, character } = await player();
    const fanout = realtime.getRealtimeFanout();
    const visibleAtDelivery: Promise<number>[] = [];
    const unsubscribe = fanout.subscribe({
      scope: { playerAccountId: "observer", characterId: "observer" },
      deliver: (envelope) => {
        const { id } = envelope.data as ChatMessageView;
        expect(envelope.type).toBe("chat.message");
        // A fresh connection sees the row at the moment of delivery.
        visibleAtDelivery.push(
          db
            .select({ id: rune.chatMessages.id })
            .from(rune.chatMessages)
            .where(eq(rune.chatMessages.id, id))
            .then((rows) => rows.length),
        );
      },
      close: () => {},
    });
    try {
      const ad = await chat.sendChatMessage(userId, character.id, {
        channel: "trade",
        text: "delivered after commit",
      });
      expect(ad.status).toBe("sent");
      expect(await Promise.all(visibleAtDelivery)).toEqual([1]);
    } finally {
      unsubscribe();
    }
  });

  it("pages latest-50 then older by a seq cursor, stable across identical timestamps", async () => {
    const { userId, character } = await player();
    const instant = new Date();
    const inserted = await db
      .insert(rune.chatMessages)
      .values(
        Array.from({ length: 120 }, (_, index) => ({
          channel: "trade",
          senderPlayerAccountId: character.playerAccountId,
          senderCharacterId: character.id,
          senderCharacterName: character.displayName,
          body: `same instant ${index}`,
          createdAt: instant,
        })),
      )
      .returning({ id: rune.chatMessages.id });
    const mine = new Set(inserted.map((row) => row.id));

    const latest = await chat.readChatHistory(userId, character.id, { channel: "trade" });
    expect(latest.messages).toHaveLength(50);
    expect(latest.hasOlder).toBe(true);
    const seen: ChatMessageView[] = [...latest.messages];
    let page = latest;
    while (page.hasOlder) {
      page = await chat.readChatHistory(userId, character.id, {
        channel: "trade",
        before: page.messages[0]!.seq,
      });
      expect(page.messages.length).toBeLessThanOrEqual(50);
      seen.unshift(...page.messages);
    }
    const ours = seen.filter((message) => mine.has(message.id));
    // Every row exactly once, in insertion order, with no skip or repeat.
    expect(ours).toHaveLength(120);
    expect(new Set(ours.map((message) => message.id)).size).toBe(120);
    expect(ours.map((message) => (message.redacted ? null : message.body))).toEqual(
      Array.from({ length: 120 }, (_, index) => `same instant ${index}`),
    );
    const seqs = seen.map((message) => message.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // Trade rows never leak into General.
    const general = await chat.readChatHistory(userId, character.id, { channel: "general" });
    expect(general.messages.some((message) => mine.has(message.id))).toBe(false);
  });

  it("deletes messages past 90-day retention, in bounded batches", async () => {
    await withChatRetentionWindow(db, async () => {
      const { userId, character } = await player();
      // This test's clock runs two days ahead (issue #278). Every send anywhere
      // prunes rows expired in *real* time, so rows expired by the real clock
      // can vanish under a parallel suite before this test counts them; these
      // rows expire only on the test's clock. The retention-window lock keeps
      // the other boundary tests from sweeping them or being swept by this one.
      const now = new Date(Date.now() + 2 * DAY_MS);
      const row = (body: string, ageMs: number) => ({
        channel: "general",
        senderPlayerAccountId: character.playerAccountId,
        senderCharacterId: character.id,
        senderCharacterName: character.displayName,
        body,
        createdAt: new Date(now.getTime() - ageMs),
      });
      const expiredRows = [row("expired a", 91 * DAY_MS), row("expired b", 90 * DAY_MS + 1)];
      // Still inside real retention, so no ordinary send can prune them.
      expect(
        expiredRows.every((entry) => entry.createdAt.getTime() > chatRetentionCutoff(Date.now())),
      ).toBe(true);
      const expired = await db
        .insert(rune.chatMessages)
        .values(expiredRows)
        .returning({ id: rune.chatMessages.id });
      const [kept] = await db
        .insert(rune.chatMessages)
        .values(row("kept", 89 * DAY_MS))
        .returning({ id: rune.chatMessages.id, seq: rune.chatMessages.seq });
      const expiredIds = expired.map((entry) => entry.id);

      // Expired rows never render, even before anything prunes them. `general`
      // is shared by every test file running in parallel, and a history page is
      // only the newest few rows, so a burst of other files' sends after the
      // inserts above could push this test's rows off the latest page. Paging
      // from just past `kept` pins the page to the rows this test inserted.
      const before = await chat.readChatHistory(
        userId,
        character.id,
        { channel: "general", before: kept!.seq + 1 },
        now,
      );
      expect(before.messages.some((message) => expiredIds.includes(message.id))).toBe(false);
      expect(before.messages.some((message) => message.id === kept!.id)).toBe(true);

      // The bounded prune removes at most its batch; a send runs it.
      const deleted = await chat.pruneExpiredChatMessages(db, now, 1);
      expect(deleted).toBe(1);
      sent(
        await chat.sendChatMessage(
          userId,
          character.id,
          { channel: "general", text: "prunes the rest" },
          { now },
        ),
      );
      const remaining = await db
        .select({ id: rune.chatMessages.id })
        .from(rune.chatMessages)
        .where(inArray(rune.chatMessages.id, [...expiredIds, kept!.id]));
      expect(remaining.map((entry) => entry.id)).toEqual([kept!.id]);
    });
  });

  /**
   * Issue #352: one prune never deletes more than its limit. The old
   * `DELETE … WHERE id IN (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)` could be
   * planned as a nested-loop semi join that re-ran the locking subquery per
   * candidate row; after the first delete the rescan skipped that row and
   * returned the next, so `limit` 1 deleted several (observed once on `main`
   * CI: `expected 2 to be 1`). These tests run the production prune under both
   * the planner's default plan and that forced re-scan shape, on real
   * PostgreSQL, inside the #278 retention-window lock.
   */
  describe("issue #352 bounded retention prune", () => {
    // Discourage every join/aggregate strategy but a nested loop, so the
    // locking subquery of the old statement is rescanned once per outer row.
    const NESTED_LOOP_ONLY = [
      "enable_hashagg",
      "enable_hashjoin",
      "enable_mergejoin",
      "enable_material",
      "enable_sort",
    ];
    type Plan = "default" | "nested-loop";
    const HOUR_MS = 60 * 60_000;
    /** An age past the 90-day cutoff by `ms`; under 2 days keeps it inside real retention. */
    const expiredBy = (ms: number) => 90 * DAY_MS + ms;

    async function pruneUnder(plan: Plan, now: Date, limit: number): Promise<number> {
      return db.transaction(async (tx) => {
        if (plan === "nested-loop") {
          for (const setting of NESTED_LOOP_ONLY)
            await tx.execute(sql`select set_config(${setting}, 'off', true)`);
        }
        return chat.pruneExpiredChatMessages(tx, now, limit);
      });
    }

    /**
     * Seeds one general-channel row per age (ms before `now`), oldest `seq`
     * first, and returns them in `seq` order. Callers keep every row inside
     * *real* retention (the clock below runs ahead) so no ordinary send prunes
     * them.
     */
    async function seed(
      character: { id: string; playerAccountId: string; displayName: string },
      now: Date,
      ages: number[],
    ) {
      const rows: { id: string; seq: number }[] = [];
      for (const [index, ageMs] of ages.entries()) {
        // Expired on the test's clock only; real-time-expired rows would be
        // pruned by any send in a parallel file (#278).
        expect(now.getTime() - ageMs).toBeGreaterThan(chatRetentionCutoff(Date.now()));
        const [row] = await db
          .insert(rune.chatMessages)
          .values({
            channel: "general",
            senderPlayerAccountId: character.playerAccountId,
            senderCharacterId: character.id,
            senderCharacterName: character.displayName,
            body: `retention row ${index}`,
            createdAt: new Date(now.getTime() - ageMs),
          })
          .returning({ id: rune.chatMessages.id, seq: rune.chatMessages.seq });
        rows.push(row!);
      }
      return rows;
    }

    /** Which of `ids` still exist. */
    async function surviving(ids: string[]): Promise<string[]> {
      const rows = await db
        .select({ id: rune.chatMessages.id, seq: rune.chatMessages.seq })
        .from(rune.chatMessages)
        .where(inArray(rune.chatMessages.id, ids))
        .orderBy(rune.chatMessages.seq);
      return rows.map((row) => row.id);
    }

    /**
     * Runs `run` with the test clock two days ahead, after clearing rows other
     * files left expired on that clock (their afterEach cleanup runs outside the
     * retention lock). Nothing can seed the boundary again while the lock is
     * held, so the first rows `seq` order meets are this test's own.
     */
    async function withCleanBoundary(run: (now: Date) => Promise<void>) {
      await withChatRetentionWindow(db, async () => {
        const now = new Date(Date.now() + 2 * DAY_MS);
        while ((await chat.pruneExpiredChatMessages(db, now)) > 0) {
          // keep draining until nothing expired is left on this clock
        }
        await run(now);
      });
    }

    it("is exercised by a statement shape that really re-scans its subquery", async () => {
      await withCleanBoundary(async (now) => {
        // Control for the tests below: if the planner no longer picks this
        // shape for the pre-#352 statement, they would stop proving anything.
        const cutoff = new Date(chatRetentionCutoff(now.getTime()));
        const legacy = db
          .select({ id: rune.chatMessages.id })
          .from(rune.chatMessages)
          .where(lt(rune.chatMessages.createdAt, cutoff))
          .orderBy(rune.chatMessages.seq)
          .limit(1)
          .for("update", { skipLocked: true });
        const plan = await db.transaction(async (tx) => {
          for (const setting of NESTED_LOOP_ONLY)
            await tx.execute(sql`select set_config(${setting}, 'off', true)`);
          const result = await tx.execute<{ "QUERY PLAN": string }>(
            sql`explain delete from ${rune.chatMessages} where ${rune.chatMessages.id} in (${legacy})`,
          );
          return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
        });
        expect(plan).toContain("Nested Loop Semi Join");
        expect(plan).toContain("Subquery Scan");
      });
    });

    it.each<Plan>(["default", "nested-loop"])(
      "deletes at most the limit, oldest first, and never the boundary row (%s plan)",
      async (plan) => {
        await withCleanBoundary(async (now) => {
          const { character } = await player();
          const cutoff = chatRetentionCutoff(now.getTime());
          // Five expired rows, then one exactly at the cutoff (strictly `>`
          // 90 days is expired, so it is kept) and one well inside retention.
          const [a, b, c, d, e, boundary, fresh] = await seed(character, now, [
            expiredBy(5 * HOUR_MS),
            expiredBy(4 * HOUR_MS),
            expiredBy(3 * HOUR_MS),
            expiredBy(2),
            expiredBy(1),
            now.getTime() - cutoff,
            10 * DAY_MS,
          ]);
          const ids = [a!, b!, c!, d!, e!, boundary!, fresh!].map((row) => row.id);

          expect(await pruneUnder(plan, now, 1)).toBe(1);
          expect(await surviving(ids)).toEqual(ids.slice(1));
          expect(await pruneUnder(plan, now, 1)).toBe(1);
          expect(await surviving(ids)).toEqual(ids.slice(2));
          // Other batch sizes are capped too, and a limit above the backlog
          // removes only what is left.
          expect(await pruneUnder(plan, now, 2)).toBe(2);
          expect(await surviving(ids)).toEqual(ids.slice(4));
          expect(await pruneUnder(plan, now, 500)).toBe(1);
          // Only the boundary row and the fresh row survive, and nothing is left to do.
          expect(await surviving(ids)).toEqual([boundary!.id, fresh!.id]);
          expect(await pruneUnder(plan, now, 500)).toBe(0);
          expect(await surviving(ids)).toEqual([boundary!.id, fresh!.id]);
        });
      },
    );

    it.each<Plan>(["default", "nested-loop"])(
      "skips rows another transaction holds and deletes the next oldest (%s plan)",
      async (plan) => {
        await withCleanBoundary(async (now) => {
          const { character } = await player();
          const [a, b, c] = await seed(character, now, [
            expiredBy(3 * HOUR_MS),
            expiredBy(2 * HOUR_MS),
            expiredBy(HOUR_MS),
          ]);
          const ids = [a!, b!, c!].map((row) => row.id);

          let release!: () => void;
          const released = new Promise<void>((resolve) => (release = resolve));
          let locked!: () => void;
          const holding = new Promise<void>((resolve) => (locked = resolve));
          // A concurrent transaction holds the oldest row's lock, as an
          // in-flight prune or delete would.
          const holder = db.transaction(async (tx) => {
            await tx.execute(
              sql`select id from ${rune.chatMessages} where id = ${a!.id} for update`,
            );
            locked();
            await released;
          });
          await holding;
          try {
            // Not blocked by the held row, and not replaced by a second one.
            expect(await pruneUnder(plan, now, 1)).toBe(1);
            expect(await surviving(ids)).toEqual([a!.id, c!.id]);
            // Every remaining eligible row is now locked by someone else: 0, no wait.
            await db.transaction(async (tx) => {
              await tx.execute(
                sql`select id from ${rune.chatMessages} where id = ${c!.id} for update`,
              );
              // The prune runs on its own connection, so it sees this lock as held.
              expect(await pruneUnder(plan, now, 5)).toBe(0);
            });
          } finally {
            release();
            await holder;
          }
          // Once released, the skipped row is eligible again and still oldest.
          expect(await pruneUnder(plan, now, 1)).toBe(1);
          expect(await surviving(ids)).toEqual([c!.id]);
          expect(await pruneUnder(plan, now, 1)).toBe(1);
          expect(await surviving(ids)).toEqual([]);
        });
      },
    );

    it.each<Plan>(["default", "nested-loop"])(
      "lets two concurrent prunes take disjoint batches without waiting or double-deleting (%s plan)",
      async (plan) => {
        await withCleanBoundary(async (now) => {
          const { character } = await player();
          const rows = await seed(character, now, [
            expiredBy(6 * HOUR_MS),
            expiredBy(5 * HOUR_MS),
            expiredBy(4 * HOUR_MS),
            expiredBy(3 * HOUR_MS),
            expiredBy(2 * HOUR_MS),
            expiredBy(HOUR_MS),
          ]);
          const ids = rows.map((row) => row.id);

          let release!: () => void;
          const released = new Promise<void>((resolve) => (release = resolve));
          // First caller prunes and stays open, so its three deleted rows stay
          // locked while the second caller runs: SKIP LOCKED means the second
          // takes the next three instead of waiting on, or re-deleting, them.
          let firstDeleted!: (count: number) => void;
          const firstResult = new Promise<number>((resolve) => (firstDeleted = resolve));
          const first = db.transaction(async (tx) => {
            for (const setting of plan === "nested-loop" ? NESTED_LOOP_ONLY : [])
              await tx.execute(sql`select set_config(${setting}, 'off', true)`);
            firstDeleted(await chat.pruneExpiredChatMessages(tx, now, 3));
            await released;
          });
          let second: number;
          try {
            expect(await firstResult).toBe(3);
            second = await pruneUnder(plan, now, 3);
          } finally {
            release();
            await first;
          }
          expect(second).toBe(3);
          expect(await surviving(ids)).toEqual([]);
        });
      },
    );
  });

  it("serves the history route with the viewer's budget and ad status", async () => {
    const { userId, character } = await player();
    sent(
      await chat.sendChatMessage(userId, character.id, { channel: "general", text: "route read" }),
    );
    const page = await chat.readChatHistory(userId, character.id, { channel: "general" });
    expect(page.budget.recentSendExpiresInMs).toHaveLength(1);
    expect(page.budget.recentSendExpiresInMs[0]).toBeGreaterThan(0);
    expect(page.budget.recentSendExpiresInMs[0]).toBeLessThanOrEqual(10_000);
    expect(page.promotedAd).toEqual({ priceCredits: 50, readyInMs: 0 });
  });
});
