import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ChatMessageView, ChatSendResult } from "@/game/schemas/chat";
import type { WhisperMessageView, WhisperSendResult } from "@/game/schemas/whispers";
import type { RealtimeEnvelope } from "@/game/schemas/realtime";
import type { MessageReportEvidence } from "@/server/player-reports";
import { LOCATION_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const token = () => Math.random().toString(36).slice(2, 8);
const DAY_MS = 24 * 60 * 60_000;

function whispered(result: WhisperSendResult): WhisperMessageView {
  if (result.status !== "sent") throw new Error(`expected a Whisper, got ${result.reason}`);
  return result.message;
}

function posted(result: ChatSendResult): ChatMessageView {
  if (result.status !== "sent") throw new Error(`expected a send, got ${result.reason}`);
  return result.message;
}

/**
 * Issue #247 acceptance against real PostgreSQL: Whispers are durable,
 * character-to-character, share the account-wide send budget and guardrail,
 * keep durable per-character unread state, and survive renames; Block is
 * account-level, suppresses public chat for the blocker only, prevents
 * Whispers both ways without disclosure or erasing history, and records
 * signals; Report preserves bounded evidence that outlives retention.
 */
suite("issue #247 Whispers, Block, and Report (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let chat: typeof import("@/server/chat");
  let whispers: typeof import("@/server/whispers");
  let blocks: typeof import("@/server/player-blocks");
  let reports: typeof import("@/server/player-reports");
  let guardrail: typeof import("@/server/chat-guardrail");
  let realtime: typeof import("@/server/realtime");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    chat = await import("@/server/chat");
    whispers = await import("@/server/whispers");
    blocks = await import("@/server/player-blocks");
    reports = await import("@/server/player-reports");
    guardrail = await import("@/server/chat-guardrail");
    realtime = await import("@/server/realtime");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function player() {
    const userId = await createTestUser(db, authSchema, `safety-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Wsp${token()}`,
    );
    return { userId, character };
  }

  async function altOf(userId: string) {
    return createCharacterForUser(db, rune, ownership, characters, userId, `Alt${token()}`);
  }

  /** Every delivery each observed scope receives while `run` executes. */
  async function observe<T>(
    scopes: { playerAccountId: string; characterId: string }[],
    run: () => Promise<T>,
  ): Promise<{ result: T; received: Map<string, RealtimeEnvelope[]> }> {
    const fanout = realtime.getRealtimeFanout();
    const received = new Map<string, RealtimeEnvelope[]>();
    const unsubscribes = scopes.map((scope) => {
      received.set(scope.characterId, []);
      return fanout.subscribe({
        scope,
        deliver: (envelope) => received.get(scope.characterId)!.push(envelope),
        close: () => {},
      });
    });
    try {
      return { result: await run(), received };
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
  }

  const scopeOf = (character: { id: string; playerAccountId: string }) => ({
    playerAccountId: character.playerAccountId,
    characterId: character.id,
  });

  describe("Whispers", () => {
    it("sends only as a valid owned, playable character, with server-derived identity", async () => {
      const a = await player();
      const b = await player();
      const intruder = await player();
      await expect(
        whispers.sendWhisper(intruder.userId, a.character.id, {
          recipientCharacterId: b.character.id,
          text: "forged",
        }),
      ).rejects.toMatchObject({ name: "OwnershipError", status: 404 });

      const message = whispered(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: b.character.id,
          text: "  psst  ",
          senderName: "Staff",
        } as never),
      );
      expect(message).toMatchObject({
        senderCharacterId: a.character.id,
        recipientCharacterId: b.character.id,
        senderName: a.character.displayName,
        body: "psst",
      });
      expect(JSON.stringify(message)).not.toContain(a.character.playerAccountId);
      const [row] = await db
        .select()
        .from(rune.chatMessages)
        .where(eq(rune.chatMessages.id, message.id));
      expect(row).toMatchObject({
        channel: "whisper",
        senderPlayerAccountId: a.character.playerAccountId,
        promotedPriceCredits: null,
      });
      expect(row!.conversationId).toBeTruthy();
      // Whispers never appear in a public feed.
      const general = await chat.readChatHistory(a.userId, a.character.id, { channel: "general" });
      const trade = await chat.readChatHistory(a.userId, a.character.id, { channel: "trade" });
      expect([...general.messages, ...trade.messages].some((m) => m.id === message.id)).toBe(false);

      // Your own characters are not a conversation.
      const alt = await altOf(a.userId);
      expect(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: alt.id,
          text: "me?",
        }),
      ).toMatchObject({ status: "refused", reason: "undeliverable" });
      expect(
        await whispers.openWhisper(a.userId, a.character.id, { name: alt.displayName }),
      ).toEqual({ error: "You can't whisper your own characters." });
    });

    it("opens from a name or a sender id without persisting a conversation", async () => {
      const a = await player();
      const b = await player();
      for (const target of [{ name: b.character.displayName }, { characterId: b.character.id }]) {
        expect(await whispers.openWhisper(a.userId, a.character.id, target)).toEqual({
          status: "ready",
          peer: { characterId: b.character.id, name: b.character.displayName, blockedByMe: false },
        });
      }
      expect(
        await whispers.openWhisper(a.userId, a.character.id, { name: "NoSuchCaptain" }),
      ).toEqual({ error: "No character has that name." });
      // Exact names only: never a prefix or search.
      expect(
        await whispers.openWhisper(a.userId, a.character.id, {
          name: b.character.displayName.slice(0, -1),
        }),
      ).toEqual({ error: "No character has that name." });
      // Block and Report by name keep the same-location profile's boundary.
      const far = await player();
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
        .where(eq(rune.characters.id, far.character.id));
      const byName = { name: far.character.displayName };
      expect(await blocks.blockPlayer(a.userId, a.character.id, byName)).toEqual({
        error: "Character not found.",
      });
      expect(
        await reports.reportPlayer(a.userId, a.character.id, { target: byName, reason: "other" }),
      ).toEqual({ error: "Character not found." });
      const conversations = await db
        .select()
        .from(rune.whisperParticipants)
        .where(eq(rune.whisperParticipants.characterId, a.character.id));
      expect(conversations).toHaveLength(0);
      expect(await whispers.readWhisperInbox(b.userId, b.character.id)).toEqual({
        conversations: [],
        unreadTotal: 0,
      });
    });

    it("starts by exact name with a remote, offline character who never spoke publicly", async () => {
      const a = await player();
      const far = await player();
      // Elsewhere, with no open stream and no public chat history.
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
        .where(eq(rune.characters.id, far.character.id));
      const typed = far.character.displayName.toUpperCase();
      expect(await whispers.openWhisper(a.userId, a.character.id, { name: typed })).toEqual({
        status: "ready",
        peer: {
          characterId: far.character.id,
          name: far.character.displayName,
          blockedByMe: false,
        },
      });
      // Resolving a name persists nothing; the first Whisper does.
      const participants = () =>
        db
          .select()
          .from(rune.whisperParticipants)
          .where(eq(rune.whisperParticipants.characterId, far.character.id));
      expect(await participants()).toHaveLength(0);
      const message = whispered(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: far.character.id,
          text: "found you by name",
        }),
      );
      expect(await participants()).toHaveLength(1);
      const inbox = await whispers.readWhisperInbox(far.userId, far.character.id);
      expect(inbox.unreadTotal).toBe(1);
      expect(inbox.conversations[0]!.lastMessage.id).toBe(message.id);

      // Your own characters are refused by name too.
      const alt = await altOf(a.userId);
      expect(
        await whispers.openWhisper(a.userId, a.character.id, { name: alt.displayName }),
      ).toEqual({ error: "You can't whisper your own characters." });

      // A Block is still never revealed: the name resolves, the send refuses
      // generically.
      await blocks.blockPlayer(far.userId, far.character.id, { characterId: a.character.id });
      expect(
        await whispers.openWhisper(a.userId, a.character.id, { name: far.character.displayName }),
      ).toMatchObject({ status: "ready", peer: { blockedByMe: false } });
      expect(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: far.character.id,
          text: "still there?",
        }),
      ).toMatchObject({ status: "refused", error: "Your Whisper couldn't be delivered." });
    });

    it("delivers after commit to both participants only; offline recipients read history", async () => {
      const a = await player();
      const b = await player();
      const bystander = await player();
      const { result, received } = await observe(
        [scopeOf(a.character), scopeOf(bystander.character)],
        () =>
          whispers.sendWhisper(a.userId, a.character.id, {
            recipientCharacterId: b.character.id,
            text: "you there?",
          }),
      );
      const message = whispered(result);
      expect(received.get(a.character.id)!.map((envelope) => envelope.type)).toEqual([
        "whisper.message",
      ]);
      expect(received.get(bystander.character.id)).toEqual([]);

      // B had no open stream; the Whisper is durable history on return.
      const page = await whispers.readWhisperHistory(b.userId, b.character.id, {
        withCharacterId: a.character.id,
      });
      expect(page.messages.map((m) => m.id)).toEqual([message.id]);
      expect(page.peer).toEqual({
        characterId: a.character.id,
        name: a.character.displayName,
        blockedByMe: false,
      });
      const inbox = await whispers.readWhisperInbox(b.userId, b.character.id);
      expect(inbox.unreadTotal).toBe(1);
      expect(inbox.conversations[0]).toMatchObject({
        peer: { characterId: a.character.id },
        unread: 1,
        lastMessage: { id: message.id },
      });
      // Conversations are per character: B's alt has none.
      const bAlt = await altOf(b.userId);
      expect((await whispers.readWhisperInbox(b.userId, bAlt.id)).unreadTotal).toBe(0);
    });

    it("keeps participant identity and name-at-send across renames", async () => {
      const a = await player();
      const b = await player();
      const first = whispered(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: b.character.id,
          text: "before rename",
        }),
      );
      const renamed = `Ren${token()}`;
      await db
        .update(rune.characters)
        .set({ displayName: renamed, normalizedName: renamed.toLowerCase() })
        .where(eq(rune.characters.id, a.character.id));
      const second = whispered(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: b.character.id,
          text: "after rename",
        }),
      );
      const page = await whispers.readWhisperHistory(b.userId, b.character.id, {
        withCharacterId: a.character.id,
      });
      expect(page.messages.map((m) => [m.id, m.senderName])).toEqual([
        [first.id, a.character.displayName],
        [second.id, renamed],
      ]);
      expect(page.peer.name).toBe(renamed);
      const inbox = await whispers.readWhisperInbox(b.userId, b.character.id);
      expect(inbox.conversations).toHaveLength(1);
      expect(inbox.conversations[0]!.peer).toMatchObject({
        characterId: a.character.id,
        name: renamed,
      });
    });

    it("pages latest 50 then older by seq", async () => {
      const a = await player();
      const b = await player();
      whispered(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: b.character.id,
          text: "opens it",
        }),
      );
      const [participant] = await db
        .select()
        .from(rune.whisperParticipants)
        .where(eq(rune.whisperParticipants.characterId, a.character.id));
      const instant = new Date();
      await db.insert(rune.chatMessages).values(
        Array.from({ length: 119 }, (_, index) => ({
          channel: "whisper",
          conversationId: participant!.conversationId,
          senderPlayerAccountId: b.character.playerAccountId,
          senderCharacterId: b.character.id,
          senderCharacterName: b.character.displayName,
          body: `reply ${index}`,
          createdAt: instant,
        })),
      );
      const latest = await whispers.readWhisperHistory(a.userId, a.character.id, {
        withCharacterId: b.character.id,
      });
      expect(latest.messages).toHaveLength(50);
      expect(latest.hasOlder).toBe(true);
      const seen = [...latest.messages];
      let page = latest;
      while (page.hasOlder) {
        page = await whispers.readWhisperHistory(a.userId, a.character.id, {
          withCharacterId: b.character.id,
          before: page.messages[0]!.seq,
        });
        seen.unshift(...page.messages);
      }
      expect(seen).toHaveLength(120);
      expect(new Set(seen.map((m) => m.id)).size).toBe(120);
      expect(seen[0]!.body).toBe("opens it");
      expect(seen.at(-1)!.body).toBe("reply 118");
    });

    it("keeps unread durable per recipient character and clears it everywhere on read", async () => {
      const a = await player();
      const b = await player();
      const sends: WhisperMessageView[] = [];
      for (const text of ["one", "two", "three"]) {
        sends.push(
          whispered(
            await whispers.sendWhisper(a.userId, a.character.id, {
              recipientCharacterId: b.character.id,
              text,
            }),
          ),
        );
      }
      // The sender's own messages are never unread for the sender.
      expect((await whispers.readWhisperInbox(a.userId, a.character.id)).unreadTotal).toBe(0);
      expect((await whispers.readWhisperInbox(b.userId, b.character.id)).unreadTotal).toBe(3);

      // One tab reads through the second; every tab of B's character is told.
      const { received } = await observe([scopeOf(b.character)], () =>
        whispers.markWhisperRead(b.userId, b.character.id, {
          withCharacterId: a.character.id,
          throughSeq: sends[1]!.seq,
        }),
      );
      expect(received.get(b.character.id)!.map((e) => [e.type, e.data])).toEqual([
        ["whisper.read", { withCharacterId: a.character.id }],
      ]);
      // A second device re-reading sees the same durable state.
      expect((await whispers.readWhisperInbox(b.userId, b.character.id)).unreadTotal).toBe(1);

      // A stale tab cannot move the position backwards, and nothing is announced.
      const stale = await observe([scopeOf(b.character)], () =>
        whispers.markWhisperRead(b.userId, b.character.id, {
          withCharacterId: a.character.id,
          throughSeq: sends[0]!.seq,
        }),
      );
      expect(stale.received.get(b.character.id)).toEqual([]);
      expect((await whispers.readWhisperInbox(b.userId, b.character.id)).unreadTotal).toBe(1);

      // An inflated position is capped at the newest message.
      await whispers.markWhisperRead(b.userId, b.character.id, {
        withCharacterId: a.character.id,
        throughSeq: Number.MAX_SAFE_INTEGER,
      });
      expect((await whispers.readWhisperInbox(b.userId, b.character.id)).unreadTotal).toBe(0);
      const later = whispered(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: b.character.id,
          text: "four",
        }),
      );
      const inbox = await whispers.readWhisperInbox(b.userId, b.character.id);
      expect(inbox.unreadTotal).toBe(1);
      expect(inbox.conversations[0]!.lastMessage.id).toBe(later.id);
    });

    it("shares the account-wide budget across General, Whispers, and Trade", async () => {
      const a = await player();
      const b = await player();
      const alt = await altOf(a.userId);
      const start = Date.now();
      const at = (ms: number) => ({ now: new Date(start + ms) });
      const whisper = (characterId: string, ms: number) =>
        whispers.sendWhisper(
          a.userId,
          characterId,
          { recipientCharacterId: b.character.id, text: `w ${ms}` },
          at(ms),
        );

      whispered(await whisper(a.character.id, 0));
      whispered(await whisper(alt.id, 100));
      posted(
        await chat.sendChatMessage(
          a.userId,
          a.character.id,
          { channel: "general", text: "g" },
          at(200),
        ),
      );
      // Three shared sends: Trade is closed; General and Whispers have two left.
      expect(
        await chat.sendChatMessage(a.userId, alt.id, { channel: "trade", text: "t" }, at(300)),
      ).toMatchObject({ status: "refused", reason: "rate_limited" });
      whispered(await whisper(a.character.id, 400));
      const fifth = await whisper(alt.id, 500);
      expect(fifth.budget.recentSendExpiresInMs).toHaveLength(5);
      whispered(fifth);
      const sixth = await whisper(a.character.id, 600);
      expect(sixth).toMatchObject({ status: "refused", reason: "rate_limited" });
      expect(sixth.status === "refused" && sixth.error).toBe(
        "Slow down. You can send again in 10s.",
      );
    });

    it("applies the severe-term guardrail with no persistence, delivery, or sanction", async () => {
      const a = await player();
      const b = await player();
      const denylist = new Set([guardrail.severeTermDigest("zorbfrak")]);
      const { result, received } = await observe([scopeOf(b.character)], () =>
        whispers.sendWhisper(
          a.userId,
          a.character.id,
          { recipientCharacterId: b.character.id, text: "you z0rbfrak" },
          { denylist },
        ),
      );
      expect(result).toMatchObject({ status: "refused", reason: "prohibited_term" });
      expect(result.budget.recentSendExpiresInMs).toEqual([]);
      expect(received.get(b.character.id)).toEqual([]);
      expect((await whispers.readWhisperInbox(b.userId, b.character.id)).unreadTotal).toBe(0);
      whispered(
        await whispers.sendWhisper(
          a.userId,
          a.character.id,
          { recipientCharacterId: b.character.id, text: "damn fine hull" },
          { denylist },
        ),
      );
    });
  });

  describe("Block", () => {
    it("is account-level: it covers every character of both accounts, for the blocker only", async () => {
      const a = await player();
      const b = await player();
      const bAlt = await altOf(b.userId);
      const aAlt = await altOf(a.userId);
      const bystander = await player();

      const before = posted(
        await chat.sendChatMessage(b.userId, bAlt.id, { channel: "general", text: "pre-block" }),
      );
      expect(
        await blocks.blockPlayer(a.userId, a.character.id, { name: b.character.displayName }),
      ).toEqual({ status: "blocked", name: b.character.displayName });

      // B's other character is hidden too, including history sent before the Block.
      const { result, received } = await observe(
        [scopeOf(a.character), scopeOf(aAlt), scopeOf(bystander.character), scopeOf(bAlt)],
        () => chat.sendChatMessage(b.userId, bAlt.id, { channel: "general", text: "after block" }),
      );
      const after = posted(result);
      expect(received.get(a.character.id)).toEqual([]);
      expect(received.get(aAlt.id)).toEqual([]);
      expect(received.get(bystander.character.id)!.map((e) => e.data)).toEqual([after]);
      expect(received.get(bAlt.id)!.map((e) => e.data)).toEqual([after]);

      for (const viewer of [a.character.id, aAlt.id]) {
        const page = await chat.readChatHistory(a.userId, viewer, { channel: "general" });
        expect(page.messages.some((m) => m.id === before.id || m.id === after.id)).toBe(false);
      }
      const seen = await chat.readChatHistory(bystander.userId, bystander.character.id, {
        channel: "general",
      });
      expect(seen.messages.map((m) => m.id)).toEqual(expect.arrayContaining([before.id, after.id]));
      // The blocked player still sees their own messages as usual.
      const own = await chat.readChatHistory(b.userId, b.character.id, { channel: "general" });
      expect(own.messages.map((m) => m.id)).toEqual(expect.arrayContaining([before.id, after.id]));
    });

    it("prevents future Whispers both ways without disclosure, and keeps history", async () => {
      const a = await player();
      const b = await player();
      const bAlt = await altOf(b.userId);
      const earlier = whispered(
        await whispers.sendWhisper(b.userId, b.character.id, {
          recipientCharacterId: a.character.id,
          text: "earlier",
        }),
      );
      await blocks.blockPlayer(a.userId, a.character.id, { characterId: b.character.id });

      for (const sender of [b.character.id, bAlt.id]) {
        const { result, received } = await observe([scopeOf(a.character)], () =>
          whispers.sendWhisper(b.userId, sender, {
            recipientCharacterId: a.character.id,
            text: "let me in",
          }),
        );
        // Indistinguishable from any undeliverable Whisper; nothing said about a Block.
        expect(result).toMatchObject({
          status: "refused",
          reason: "undeliverable",
          error: "Your Whisper couldn't be delivered.",
        });
        expect(JSON.stringify(result)).not.toMatch(/block/i);
        expect(received.get(a.character.id)).toEqual([]);
      }
      // B's view never reveals it.
      const bView = await whispers.openWhisper(b.userId, b.character.id, {
        characterId: a.character.id,
      });
      expect(bView).toEqual({
        status: "ready",
        peer: { characterId: a.character.id, name: a.character.displayName, blockedByMe: false },
      });
      const bPage = await whispers.readWhisperHistory(b.userId, b.character.id, {
        withCharacterId: a.character.id,
      });
      expect(bPage.peer.blockedByMe).toBe(false);
      expect(JSON.stringify(bPage)).not.toMatch(/blocked(?!ByMe)/i);

      // The blocker cannot Whisper either, and is told why.
      expect(
        await whispers.sendWhisper(a.userId, a.character.id, {
          recipientCharacterId: bAlt.id,
          text: "hm",
        }),
      ).toMatchObject({ status: "refused", reason: "blocked_by_you" });

      // Prior history is still readable by both.
      for (const [userId, characterId, other] of [
        [a.userId, a.character.id, b.character.id],
        [b.userId, b.character.id, a.character.id],
      ] as const) {
        const page = await whispers.readWhisperHistory(userId, characterId, {
          withCharacterId: other,
        });
        expect(page.messages.map((m) => m.id)).toEqual([earlier.id]);
      }
      const inbox = await whispers.readWhisperInbox(a.userId, a.character.id);
      expect(inbox.conversations[0]!.peer.blockedByMe).toBe(true);
      // The #225 seam sees the Block from either side.
      expect(
        await blocks.isBlockedBetween(a.character.playerAccountId, b.character.playerAccountId),
      ).toBe(true);
      expect(
        await blocks.isBlockedBetween(b.character.playerAccountId, a.character.playerAccountId),
      ).toBe(true);
    });

    it("unblocks to restore interaction, and records every block and unblock as a signal", async () => {
      const a = await player();
      const b = await player();
      const bAlt = await altOf(b.userId);
      const { received } = await observe([scopeOf(a.character), scopeOf(b.character)], () =>
        blocks.blockPlayer(a.userId, a.character.id, { characterId: bAlt.id }),
      );
      // Only the blocker's own account is told; the blocked player hears nothing.
      expect(received.get(a.character.id)!.map((e) => e.type)).toEqual(["safety.blocks"]);
      expect(received.get(b.character.id)).toEqual([]);
      // Blocking again is idempotent: no second event.
      await blocks.blockPlayer(a.userId, a.character.id, { characterId: b.character.id });
      expect(await blocks.listBlockedPlayers(a.userId, a.character.id)).toEqual({
        blocked: [
          {
            characterId: bAlt.id,
            name: bAlt.displayName,
            playerName: expect.any(String),
            blockedAt: expect.any(String),
          },
        ],
      });
      // The blocked player cannot see or manage it.
      expect((await blocks.listBlockedPlayers(b.userId, b.character.id)).blocked).toEqual([]);

      expect(await blocks.unblockPlayer(a.userId, a.character.id, bAlt.id)).toEqual({
        status: "unblocked",
        name: bAlt.displayName,
      });
      expect((await blocks.listBlockedPlayers(a.userId, a.character.id)).blocked).toEqual([]);
      whispered(
        await whispers.sendWhisper(b.userId, b.character.id, {
          recipientCharacterId: a.character.id,
          text: "hi again",
        }),
      );
      const message = posted(
        await chat.sendChatMessage(b.userId, bAlt.id, { channel: "trade", text: "visible" }),
      );
      const page = await chat.readChatHistory(a.userId, a.character.id, { channel: "trade" });
      expect(page.messages.some((m) => m.id === message.id)).toBe(true);

      const events = await db
        .select()
        .from(rune.playerBlockEvents)
        .where(eq(rune.playerBlockEvents.blockerPlayerAccountId, a.character.playerAccountId));
      expect(
        events
          .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
          .map((event) => ({
            kind: event.kind,
            blocked: event.blockedPlayerAccountId,
            blockerCharacter: event.blockerCharacterId,
            blockedCharacter: event.blockedCharacterId,
          })),
      ).toEqual([
        {
          kind: "block",
          blocked: b.character.playerAccountId,
          blockerCharacter: a.character.id,
          blockedCharacter: bAlt.id,
        },
        {
          kind: "unblock",
          blocked: b.character.playerAccountId,
          blockerCharacter: a.character.id,
          blockedCharacter: bAlt.id,
        },
      ]);
      expect(await blocks.blockPlayer(a.userId, a.character.id, { name: "Nobody" })).toEqual({
        error: "Character not found.",
      });
      const alt = await altOf(a.userId);
      expect(await blocks.blockPlayer(a.userId, a.character.id, { characterId: alt.id })).toEqual({
        error: "You can't block your own characters.",
      });
    });
  });

  describe("Report", () => {
    async function publicRun(
      sender: { userId: string; character: { id: string } },
      channel: "general" | "trade",
      label: string,
      count: number,
    ) {
      const start = Date.now() - 60 * 60_000;
      const out: ChatMessageView[] = [];
      for (let index = 0; index < count; index += 1) {
        out.push(
          posted(
            await chat.sendChatMessage(
              sender.userId,
              sender.character.id,
              { channel, text: `${label} ${index}` },
              // Far enough apart that the rolling budget never refuses.
              { now: new Date(start + index * 11_000) },
            ),
          ),
        );
      }
      return out;
    }

    it("captures the exact message with 10 before and 10 after from its own feed", async () => {
      const reporter = await player();
      const reported = await player();
      const run = await publicRun(reported, "trade", "trade line", 25);
      const target = run[12]!;
      const result = await reports.reportMessage(reporter.userId, reporter.character.id, {
        messageId: target.id,
        reason: "spam_scam",
        note: "  keeps posting this  ",
      });
      expect(result).toEqual({
        status: "reported",
        blocked: false,
        name: reported.character.displayName,
      });

      const [row] = await db
        .select()
        .from(rune.playerReports)
        .where(eq(rune.playerReports.reporterCharacterId, reporter.character.id));
      expect(row).toMatchObject({
        kind: "message",
        reporterPlayerAccountId: reporter.character.playerAccountId,
        reportedPlayerAccountId: reported.character.playerAccountId,
        reportedCharacterId: reported.character.id,
        reason: "spam_scam",
        note: "keeps posting this",
        messageId: target.id,
        channel: "trade",
        conversationId: null,
      });
      const evidence = row!.evidence as MessageReportEvidence;
      expect(evidence.message).toMatchObject({
        id: target.id,
        body: "trade line 12",
        senderPlayerAccountId: reported.character.playerAccountId,
        senderCharacterId: reported.character.id,
      });
      // Other suites may post to Trade concurrently, so ours are the nearest
      // neighbours in order — exactly lines 2–11 and 13–22 when none did.
      const ours = (list: { body: string }[]) =>
        list.map((m) => m.body).filter((body) => body.startsWith("trade line"));
      expect(evidence.before).toHaveLength(10);
      expect(evidence.after).toHaveLength(10);
      const lines = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, index) => `trade line ${from + index}`);
      const before = ours(evidence.before);
      const after = ours(evidence.after);
      expect(before).toEqual(lines(12 - before.length, 11));
      expect(after).toEqual(lines(13, 12 + after.length));
      const seqs = [...evidence.before, evidence.message, ...evidence.after].map((m) => m.seq);
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
      expect([...evidence.before, ...evidence.after].every((m) => m.channel === "trade")).toBe(
        true,
      );
      // The reported player is not told.
      expect(await whispers.readWhisperInbox(reported.userId, reported.character.id)).toEqual({
        conversations: [],
        unreadTotal: 0,
      });
    });

    it("bounds a Whisper report to that one conversation", async () => {
      const reporter = await player();
      const reported = await player();
      const elsewhere = await player();
      const start = Date.now() - 60 * 60_000;
      let step = 0;
      const send = async (
        from: { userId: string; character: { id: string } },
        to: string,
        text: string,
      ) =>
        whispered(
          await whispers.sendWhisper(
            from.userId,
            from.character.id,
            { recipientCharacterId: to, text },
            { now: new Date(start + (step += 11_000)) },
          ),
        );
      await send(reporter, reported.character.id, "hello");
      // An unrelated private conversation of each side, interleaved.
      await send(reported, elsewhere.character.id, "private to elsewhere");
      await send(reporter, elsewhere.character.id, "reporter private");
      const bad = await send(reported, reporter.character.id, "nasty");
      await send(elsewhere, reported.character.id, "elsewhere reply");
      await send(reporter, reported.character.id, "stop");

      // A non-participant cannot report it at all.
      expect(
        await reports.reportMessage(elsewhere.userId, elsewhere.character.id, {
          messageId: bad.id,
          reason: "harassment_hate",
        }),
      ).toEqual({ error: "That message can't be reported." });

      expect(
        await reports.reportMessage(reporter.userId, reporter.character.id, {
          messageId: bad.id,
          reason: "harassment_hate",
        }),
      ).toMatchObject({ status: "reported" });
      const [row] = await db
        .select()
        .from(rune.playerReports)
        .where(eq(rune.playerReports.messageId, bad.id));
      const evidence = row!.evidence as MessageReportEvidence;
      expect(row!.channel).toBe("whisper");
      expect(row!.conversationId).toBe(evidence.message.conversationId);
      expect(evidence.before.map((m) => m.body)).toEqual(["hello"]);
      expect(evidence.after.map((m) => m.body)).toEqual(["stop"]);
      expect(JSON.stringify(evidence)).not.toContain("private");
      expect(JSON.stringify(evidence)).not.toContain("elsewhere");
    });

    it("dedupes the same account's report on the same message, not different messages", async () => {
      const reporter = await player();
      const reporterAlt = await altOf(reporter.userId);
      const reported = await player();
      const [first, second] = await publicRun(reported, "general", "dup", 2);
      const report = (characterId: string, messageId: string) =>
        reports.reportMessage(reporter.userId, characterId, { messageId, reason: "other" });
      expect(await report(reporter.character.id, first!.id)).toMatchObject({ status: "reported" });
      // Same account through another character is still the same reporter.
      expect(await report(reporterAlt.id, first!.id)).toMatchObject({ status: "duplicate" });
      expect(await report(reporter.character.id, second!.id)).toMatchObject({
        status: "reported",
      });
      const rows = await db
        .select()
        .from(rune.playerReports)
        .where(eq(rune.playerReports.reporterPlayerAccountId, reporter.character.playerAccountId));
      expect(rows).toHaveLength(2);
      // Own messages and overlong notes are refused.
      const own = posted(
        await chat.sendChatMessage(reporter.userId, reporter.character.id, {
          channel: "general",
          text: "mine",
        }),
      );
      expect(await report(reporter.character.id, own.id)).toEqual({
        error: "You can't report your own messages.",
      });
      expect(
        await reports.reportMessage(reporter.userId, reporter.character.id, {
          messageId: second!.id,
          reason: "other",
          note: "n".repeat(281),
        }),
      ).toEqual({ error: "Notes can be up to 280 characters." });
    });

    it("reports a player with a reason and optional note, and Report + Block blocks", async () => {
      const reporter = await player();
      const reported = await player();
      const reportedAlt = await altOf(reported.userId);
      const { result, received } = await observe([scopeOf(reporter.character)], () =>
        reports.reportPlayer(reporter.userId, reporter.character.id, {
          target: { name: reportedAlt.displayName },
          reason: "offensive_name_profile",
          alsoBlock: true,
        }),
      );
      expect(result).toEqual({ status: "reported", blocked: true, name: reportedAlt.displayName });
      expect(received.get(reporter.character.id)!.map((e) => e.type)).toEqual(["safety.blocks"]);
      const [row] = await db
        .select()
        .from(rune.playerReports)
        .where(eq(rune.playerReports.reporterCharacterId, reporter.character.id));
      expect(row).toMatchObject({
        kind: "player",
        reportedCharacterId: reportedAlt.id,
        reportedCharacterName: reportedAlt.displayName,
        reason: "offensive_name_profile",
        note: null,
        messageId: null,
        evidence: null,
      });
      expect(
        await blocks.isBlockedBetween(
          reporter.character.playerAccountId,
          reported.character.playerAccountId,
        ),
      ).toBe(true);

      // Reporting alone never blocks.
      const other = await player();
      await reports.reportPlayer(reporter.userId, reporter.character.id, {
        target: { characterId: other.character.id },
        reason: "threats",
        note: "said they'd find me",
      });
      expect(
        await blocks.isBlockedBetween(
          reporter.character.playerAccountId,
          other.character.playerAccountId,
        ),
      ).toBe(false);
      // The database refuses an unknown reason even from a buggy writer.
      const [filed] = await db
        .select({ caseId: rune.playerReports.caseId })
        .from(rune.playerReports)
        .where(eq(rune.playerReports.reporterCharacterId, reporter.character.id));
      await expect(
        db.insert(rune.playerReports).values({
          caseId: filed!.caseId,
          kind: "player",
          reporterPlayerAccountId: reporter.character.playerAccountId,
          reporterCharacterId: reporter.character.id,
          reportedPlayerAccountId: other.character.playerAccountId,
          reportedCharacterId: other.character.id,
          reportedCharacterName: other.character.displayName,
          reason: "vibes",
        }),
      ).rejects.toThrow();
    });

    it("Report + Block on a message blocks and hides the sender at once", async () => {
      const reporter = await player();
      const reported = await player();
      const [message] = await publicRun(reported, "general", "rb", 1);
      expect(
        await reports.reportMessage(reporter.userId, reporter.character.id, {
          messageId: message!.id,
          reason: "harassment_hate",
          alsoBlock: true,
        }),
      ).toMatchObject({ status: "reported", blocked: true });
      const page = await chat.readChatHistory(reporter.userId, reporter.character.id, {
        channel: "general",
      });
      expect(page.messages.some((m) => m.id === message!.id)).toBe(false);
    });

    it("keeps preserved evidence after ordinary retention deletes the messages", async () => {
      const reporter = await player();
      const reported = await player();
      const now = new Date();
      // One hour inside retention, so a prune just after it expires cannot
      // touch the other suites' deliberately still-retained rows.
      const old = new Date(now.getTime() - 90 * DAY_MS + 60 * 60_000);
      const [target] = await db
        .insert(rune.chatMessages)
        .values({
          channel: "general",
          senderPlayerAccountId: reported.character.playerAccountId,
          senderCharacterId: reported.character.id,
          senderCharacterName: reported.character.displayName,
          body: "old but reportable",
          createdAt: old,
        })
        .returning();
      await reports.reportMessage(
        reporter.userId,
        reporter.character.id,
        { messageId: target!.id, reason: "other" },
        { now },
      );
      // Two hours later ordinary retention removes the chat row.
      const later = new Date(now.getTime() + 2 * 60 * 60_000);
      await chat.pruneExpiredChatMessages(db, later, 10_000);
      const remaining = await db
        .select()
        .from(rune.chatMessages)
        .where(inArray(rune.chatMessages.id, [target!.id]));
      expect(remaining).toHaveLength(0);
      const [row] = await db
        .select()
        .from(rune.playerReports)
        .where(
          and(
            eq(rune.playerReports.messageId, target!.id),
            eq(rune.playerReports.reporterCharacterId, reporter.character.id),
          ),
        );
      expect((row!.evidence as MessageReportEvidence).message.body).toBe("old but reportable");
      // An expired message can no longer be reported.
      const other = await player();
      expect(
        await reports.reportMessage(
          other.userId,
          other.character.id,
          { messageId: target!.id, reason: "other" },
          { now: later },
        ),
      ).toEqual({ error: "That message can't be reported." });
    });
  });
});
