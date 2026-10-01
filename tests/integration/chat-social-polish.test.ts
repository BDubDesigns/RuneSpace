import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { CHAT_POLICY } from "@/game/domain/chat";
import type { ChatMessageView, ChatSendResult, VisibleChatMessageView } from "@/game/schemas/chat";
import type { RealtimeEnvelope } from "@/game/schemas/realtime";
import type { WhisperMessageView, WhisperSendResult } from "@/game/schemas/whispers";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const token = () => Math.random().toString(36).slice(2, 8);

function posted(result: ChatSendResult): VisibleChatMessageView {
  if (result.status !== "sent") throw new Error(`expected a send, got ${result.reason}`);
  return result.message;
}

function whispered(result: WhisperSendResult): WhisperMessageView {
  if (result.status !== "sent") throw new Error(`expected a Whisper, got ${result.reason}`);
  return result.message;
}

/**
 * Issue #261 acceptance against real PostgreSQL: public `@mentions` resolve to
 * stable characters and commit with their message, create durable per-channel
 * attention only for a valid target with no Block either way, and clear
 * everywhere when read; a blocked sender's public messages keep their place
 * as server-redacted placeholders on reads, pages, and live delivery; and a
 * Whisper conversation can be hidden from one side's inbox without deleting
 * anything, returning with the next Whisper or a reopen.
 */
suite("issue #261 Chat/Social polish (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let chat: typeof import("@/server/chat");
  let whispers: typeof import("@/server/whispers");
  let blocks: typeof import("@/server/player-blocks");
  let reports: typeof import("@/server/player-reports");
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
    realtime = await import("@/server/realtime");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function player(name = `Pol${token()}`) {
    const userId = await createTestUser(db, authSchema, `polish-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(db, rune, ownership, characters, userId, name);
    return { userId, character };
  }

  async function altOf(userId: string) {
    return createCharacterForUser(db, rune, ownership, characters, userId, `Alt${token()}`);
  }

  /** Every delivery each observed scope receives while `run` executes. */
  async function observe<T>(
    scopes: { id: string; playerAccountId: string }[],
    run: () => Promise<T>,
  ): Promise<{ result: T; received: Map<string, RealtimeEnvelope[]> }> {
    const fanout = realtime.getRealtimeFanout();
    const received = new Map<string, RealtimeEnvelope[]>();
    const unsubscribes = scopes.map((character) => {
      received.set(character.id, []);
      return fanout.subscribe({
        scope: { playerAccountId: character.playerAccountId, characterId: character.id },
        deliver: (envelope) => received.get(character.id)!.push(envelope),
        close: () => {},
      });
    });
    try {
      return { result: await run(), received };
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
  }

  const types = (envelopes: RealtimeEnvelope[] | undefined) => (envelopes ?? []).map((e) => e.type);

  async function mentionRows(messageId: string) {
    return db
      .select()
      .from(rune.chatMessageMentions)
      .where(eq(rune.chatMessageMentions.messageId, messageId));
  }

  async function sentRows(characterId: string) {
    return db
      .select({ id: rune.chatMessages.id })
      .from(rune.chatMessages)
      .where(eq(rune.chatMessages.senderCharacterId, characterId));
  }

  const unread = (userId: string, characterId: string) =>
    chat.readChatMentions(userId, characterId);

  describe("@mentions", () => {
    it("resolves stable targets by id and by Nearby name, commits them with the message, and prompts only the target", async () => {
      const sender = await player();
      const byId = await player();
      // Spaces, Unicode, punctuation, and mixed case all resolve.
      const byName = await player(`Zoë O'Ná-${token()}`);
      const bystander = await player();
      const text = `@${byId.character.displayName} and @${byName.character.displayName}: WTB shale`;

      const { result, received } = await observe(
        [byId.character, byName.character, bystander.character, sender.character],
        () =>
          chat.sendChatMessage(sender.userId, sender.character.id, {
            channel: "general",
            text,
            mentions: [
              { characterId: byId.character.id },
              { name: byName.character.displayName.toUpperCase() },
              // The same character twice is one mention.
              { characterId: byId.character.id },
            ],
          }),
      );
      const message = posted(result);
      expect(message.body).toBe(text);
      expect(
        [...message.mentions].sort((a, b) => a.characterId.localeCompare(b.characterId)),
      ).toEqual(
        [
          { characterId: byId.character.id, name: byId.character.displayName },
          { characterId: byName.character.id, name: byName.character.displayName },
        ].sort((a, b) => a.characterId.localeCompare(b.characterId)),
      );
      const rows = await mentionRows(message.id);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.mentionedCharacterId === byName.character.id)).toMatchObject({
        mentionedPlayerAccountId: byName.character.playerAccountId,
        mentionedCharacterName: byName.character.displayName,
        readAt: null,
      });
      // One send, one budget slot, however many mentions.
      expect(result.budget.recentSendExpiresInMs).toHaveLength(1);
      expect(types(received.get(byId.character.id))).toEqual(["chat.message", "chat.mention"]);
      expect(types(received.get(byName.character.id))).toEqual(["chat.message", "chat.mention"]);
      expect(types(received.get(bystander.character.id))).toEqual(["chat.message"]);
      expect(types(received.get(sender.character.id))).toEqual(["chat.message"]);

      // History carries the same mentions to every viewer.
      const page = await chat.readChatHistory(bystander.userId, bystander.character.id, {
        channel: "general",
      });
      expect(page.messages.find((m) => m.id === message.id)).toEqual(message);
      expect(await unread(byName.userId, byName.character.id)).toEqual({
        unread: { general: 1, trade: 0 },
        unreadTotal: 1,
      });
      expect((await unread(bystander.userId, bystander.character.id)).unreadTotal).toBe(0);
    });

    it("refuses forged, unmatched, own-account, out-of-reach, and excess targets without persisting anything", async () => {
      const sender = await player();
      const senderAlt = await altOf(sender.userId);
      const target = await player();
      const far = await player();
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
        .where(eq(rune.characters.id, far.character.id));
      const name = target.character.displayName;

      const cases: { text: string; mentions: never[] | object[]; error: RegExp }[] = [
        // A well-formed id that names no character.
        {
          text: "@Nobody hi",
          mentions: [{ characterId: "00000000-0000-4000-8000-000000000000" }],
          error: /couldn't be matched/,
        },
        // A longer word that merely starts with the target's name.
        {
          text: `@${name}x hi`,
          mentions: [{ characterId: target.character.id }],
          error: /matched/,
        },
        // A real target the body does not show.
        { text: "hello there", mentions: [{ characterId: target.character.id }], error: /matched/ },
        // The body shows a different capitalization than the current name.
        {
          text: `@${name.toLowerCase()} hi`,
          mentions: [{ characterId: target.character.id }],
          error: /matched/,
        },
        // The sender's own other character.
        {
          text: `@${senderAlt.displayName} hi`,
          mentions: [{ characterId: senderAlt.id }],
          error: /your own characters/,
        },
        // A name only resolves at the sender's location.
        {
          text: `@${far.character.displayName} hi`,
          mentions: [{ name: far.character.displayName }],
          error: /matched/,
        },
        {
          text: `@${name} hi`,
          mentions: Array.from({ length: CHAT_POLICY.maxMentions + 1 }, () => ({
            characterId: target.character.id,
          })),
          error: /up to 5/,
        },
      ];
      for (const attempt of cases) {
        const result = await chat.sendChatMessage(sender.userId, sender.character.id, {
          channel: "general",
          text: attempt.text,
          mentions: attempt.mentions as never,
        });
        expect(result, attempt.text).toMatchObject({
          status: "refused",
          reason: "invalid_mention",
        });
        if (result.status === "refused") expect(result.error).toMatch(attempt.error);
        expect(result.budget.recentSendExpiresInMs).toEqual([]);
      }
      expect(await sentRows(sender.character.id)).toEqual([]);
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(0);
    });

    it("treats typed lookalike text as plain text and keeps the name at send after a rename", async () => {
      const sender = await player();
      const target = await player();
      const plain = posted(
        await chat.sendChatMessage(sender.userId, sender.character.id, {
          channel: "trade",
          text: `@${target.character.displayName} typed by hand`,
        }),
      );
      expect(plain.mentions).toEqual([]);
      expect(await mentionRows(plain.id)).toEqual([]);
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(0);

      const mentioned = posted(
        await chat.sendChatMessage(
          sender.userId,
          sender.character.id,
          {
            channel: "trade",
            text: `@${target.character.displayName} chosen`,
            mentions: [{ characterId: target.character.id }],
          },
          { now: new Date(Date.now() + 11_000) },
        ),
      );
      const renamed = `Renamed${token()}`;
      await db
        .update(rune.characters)
        .set({ displayName: renamed, normalizedName: renamed.toLowerCase() })
        .where(eq(rune.characters.id, target.character.id));
      const page = await chat.readChatHistory(sender.userId, sender.character.id, {
        channel: "trade",
      });
      expect(page.messages.find((m) => m.id === mentioned.id)).toMatchObject({
        mentions: [{ characterId: target.character.id, name: target.character.displayName }],
      });
    });

    it("keeps ordinary chat quiet and counts General, Trade, and promoted-ad mentions per feed", async () => {
      const sender = await player();
      const target = await player();
      const t0 = Date.now() - 10 * 60_000;
      const at = (step: number) => ({ now: new Date(t0 + step * 11_000) });
      const mention = { mentions: [{ characterId: target.character.id }] };
      const name = target.character.displayName;

      posted(
        await chat.sendChatMessage(
          sender.userId,
          sender.character.id,
          { channel: "general", text: "ordinary" },
          at(0),
        ),
      );
      expect(await unread(target.userId, target.character.id)).toEqual({
        unread: { general: 0, trade: 0 },
        unreadTotal: 0,
      });

      const general = posted(
        await chat.sendChatMessage(
          sender.userId,
          sender.character.id,
          { channel: "general", text: `@${name} g`, ...mention },
          at(1),
        ),
      );
      const trade = posted(
        await chat.sendChatMessage(
          sender.userId,
          sender.character.id,
          { channel: "trade", text: `@${name} t`, ...mention },
          at(2),
        ),
      );
      await db
        .update(rune.characters)
        .set({ credits: 500 })
        .where(eq(rune.characters.id, sender.character.id));
      const adResult = await chat.postPromotedTradeAd(
        sender.userId,
        sender.character.id,
        { text: `@${name} ad`, ...mention },
        at(3),
      );
      const ad = posted(adResult);
      expect(ad.promoted).toBe(true);
      expect(adResult.budget.recentSendExpiresInMs).toHaveLength(1);
      // The ad shows in both feeds but is one unread mention.
      expect(await unread(target.userId, target.character.id)).toEqual({
        unread: { general: 2, trade: 2 },
        unreadTotal: 3,
      });

      // Reading General through the ad clears General's and the ad; Trade's own stays.
      const { received } = await observe([target.character], () =>
        chat.markChatMentionsRead(target.userId, target.character.id, {
          channel: "general",
          throughSeq: ad.seq,
        }),
      );
      expect(types(received.get(target.character.id))).toEqual(["chat.mentions.read"]);
      expect(await unread(target.userId, target.character.id)).toEqual({
        unread: { general: 0, trade: 1 },
        unreadTotal: 1,
      });
      // Reading only up to before the Trade mention leaves it unread.
      await chat.markChatMentionsRead(target.userId, target.character.id, {
        channel: "trade",
        throughSeq: trade.seq - 1,
      });
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(1);
      await chat.markChatMentionsRead(target.userId, target.character.id, {
        channel: "trade",
        throughSeq: trade.seq,
      });
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(0);
      // A repeat read changes nothing and tells no tab anything.
      const repeat = await observe([target.character], () =>
        chat.markChatMentionsRead(target.userId, target.character.id, {
          channel: "trade",
          throughSeq: trade.seq,
        }),
      );
      expect(types(repeat.received.get(target.character.id))).toEqual([]);
      const [readRow] = await mentionRows(general.id);
      expect(readRow!.readAt).not.toBeNull();
    });

    it("never lets mention attention cross a Block in either direction", async () => {
      const sender = await player();
      const target = await player();
      const name = target.character.displayName;

      // The target blocked the sender: the send succeeds (nothing disclosed),
      // the target's tabs get only a placeholder, and there is no attention.
      await blocks.blockPlayer(target.userId, target.character.id, {
        characterId: sender.character.id,
      });
      const { result, received } = await observe([target.character, sender.character], () =>
        chat.sendChatMessage(sender.userId, sender.character.id, {
          channel: "general",
          text: `@${name} you there?`,
          mentions: [{ characterId: target.character.id }],
        }),
      );
      const message = posted(result);
      expect(message.mentions).toEqual([{ characterId: target.character.id, name }]);
      expect(received.get(target.character.id)!.map((e) => e.data)).toEqual([
        {
          redacted: true,
          id: message.id,
          seq: message.seq,
          channel: "general",
          promoted: false,
          senderName: sender.character.displayName,
          sentAt: message.sentAt,
        },
      ]);
      expect(JSON.stringify(received.get(target.character.id))).not.toContain("you there");
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(0);
      const targetPage = await chat.readChatHistory(target.userId, target.character.id, {
        channel: "general",
      });
      expect(targetPage.messages.find((m) => m.id === message.id)).toMatchObject({
        redacted: true,
      });
      expect(JSON.stringify(targetPage)).not.toContain(target.character.id);

      // Unblocking restores the message, but never the attention the Block
      // silenced: it was stored already read.
      await blocks.unblockPlayer(target.userId, target.character.id, sender.character.id);
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(0);
      expect(
        (
          await chat.readChatHistory(target.userId, target.character.id, { channel: "general" })
        ).messages.find((m) => m.id === message.id),
      ).toMatchObject({ redacted: false, body: `@${name} you there?` });

      // An unread mention sent before a Block is settled by it, so an Unblock
      // later does not bring it back.
      posted(
        await chat.sendChatMessage(
          sender.userId,
          sender.character.id,
          {
            channel: "general",
            text: `@${name} before the block`,
            mentions: [{ characterId: target.character.id }],
          },
          { now: new Date(Date.now() + 11_000) },
        ),
      );
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(1);

      // The sender blocks the target: attention clears both ways, and
      // mentioning them is refused like a Whisper.
      await blocks.blockPlayer(sender.userId, sender.character.id, {
        characterId: target.character.id,
      });
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(0);
      const refused = await chat.sendChatMessage(
        sender.userId,
        sender.character.id,
        {
          channel: "general",
          text: `@${name} again`,
          mentions: [{ characterId: target.character.id }],
        },
        { now: new Date(Date.now() + 22_000) },
      );
      expect(refused).toMatchObject({ status: "refused", reason: "blocked_by_you" });
      await blocks.unblockPlayer(sender.userId, sender.character.id, target.character.id);
      expect((await unread(target.userId, target.character.id)).unreadTotal).toBe(0);
    });

    it("deletes mentions with their message under ordinary retention", async () => {
      const sender = await player();
      const target = await player();
      const old = new Date(Date.now() - CHAT_POLICY.retentionMs + 60 * 60_000);
      const message = posted(
        await chat.sendChatMessage(
          sender.userId,
          sender.character.id,
          {
            channel: "general",
            text: `@${target.character.displayName} old`,
            mentions: [{ characterId: target.character.id }],
          },
          { now: old },
        ),
      );
      expect(await mentionRows(message.id)).toHaveLength(1);
      // Expired mentions never count, even before a prune removes them.
      const later = new Date(Date.now() + 2 * 60 * 60_000);
      expect(
        (await chat.readChatMentions(target.userId, target.character.id, later)).unreadTotal,
      ).toBe(0);
      // Deleting the message (as the retention sweep does) takes its
      // mentions with it. Deleted directly so no other suite's rows are swept.
      await db.delete(rune.chatMessages).where(eq(rune.chatMessages.id, message.id));
      expect(await mentionRows(message.id)).toEqual([]);
    });
  });

  describe("blocked public-chat placeholders", () => {
    it("keeps every row's place across pages, redacts only the blocked account's, and restores on Unblock", async () => {
      const blocker = await player();
      const blocked = await player();
      const blockedAlt = await altOf(blocked.userId);
      const other = await player();
      const t0 = Date.now() - 30 * 60_000;
      const mine: VisibleChatMessageView[] = [];
      // 60 interleaved rows: more than one page.
      for (let index = 0; index < 30; index += 1) {
        const now = new Date(t0 + index * 11_000);
        mine.push(
          posted(
            await chat.sendChatMessage(
              other.userId,
              other.character.id,
              { channel: "general", text: `other ${index}` },
              { now },
            ),
          ),
        );
        mine.push(
          posted(
            await chat.sendChatMessage(
              blocked.userId,
              index % 2 === 0 ? blocked.character.id : blockedAlt.id,
              { channel: "general", text: `secret ${index}` },
              { now },
            ),
          ),
        );
      }
      await blocks.blockPlayer(blocker.userId, blocker.character.id, {
        characterId: blocked.character.id,
      });
      const window = Math.max(...mine.map((m) => m.seq)) + 1;

      // Page back from a fixed cursor until every one of our rows is in, so
      // other suites' concurrent rows never shift what is compared.
      const oldest = Math.min(...mine.map((m) => m.seq));
      async function pages(userId: string, characterId: string) {
        const seen: ChatMessageView[] = [];
        let before: number | undefined = window;
        for (;;) {
          const page = await chat.readChatHistory(userId, characterId, {
            channel: "general",
            before,
          });
          seen.unshift(...page.messages);
          before = page.messages[0]?.seq;
          if (!page.hasOlder || before === undefined || before <= oldest) break;
        }
        return seen;
      }
      const ids = new Set(mine.map((m) => m.id));
      const blockerSees = (await pages(blocker.userId, blocker.character.id)).filter((m) =>
        ids.has(m.id),
      );
      const otherSees = (await pages(other.userId, other.character.id)).filter((m) =>
        ids.has(m.id),
      );
      // Same rows, same order, no gap or repeat; only the content differs.
      expect(blockerSees.map((m) => m.id)).toEqual(mine.map((m) => m.id));
      expect(otherSees).toEqual(mine);
      for (const [index, row] of blockerSees.entries()) {
        const original = mine[index]!;
        if (original.senderCharacterId === other.character.id) {
          expect(row).toEqual(original);
        } else {
          expect(row).toEqual({
            redacted: true,
            id: original.id,
            seq: original.seq,
            channel: "general",
            promoted: false,
            senderName: original.senderName,
            sentAt: original.sentAt,
          });
        }
      }
      expect(JSON.stringify(blockerSees)).not.toMatch(/secret/);
      expect(JSON.stringify(blockerSees)).not.toContain(blocked.character.id);

      await blocks.unblockPlayer(blocker.userId, blocker.character.id, blocked.character.id);
      const restored = (await pages(blocker.userId, blocker.character.id)).filter((m) =>
        ids.has(m.id),
      );
      expect(restored).toEqual(mine);
    });

    it("redacts a blocked promoted ad in both feeds without its text", async () => {
      const blocker = await player();
      const advertiser = await player();
      await db
        .update(rune.characters)
        .set({ credits: 500 })
        .where(eq(rune.characters.id, advertiser.character.id));
      await blocks.blockPlayer(blocker.userId, blocker.character.id, {
        characterId: advertiser.character.id,
      });
      const { result, received } = await observe([blocker.character], () =>
        chat.postPromotedTradeAd(advertiser.userId, advertiser.character.id, {
          text: "selling rare hull plate",
        }),
      );
      const ad = posted(result);
      expect(received.get(blocker.character.id)!.map((e) => e.data)).toEqual([
        expect.objectContaining({ redacted: true, id: ad.id, promoted: true }),
      ]);
      for (const channel of ["general", "trade"] as const) {
        const page = await chat.readChatHistory(blocker.userId, blocker.character.id, { channel });
        expect(page.messages.find((m) => m.id === ad.id)).toMatchObject({ redacted: true });
        expect(JSON.stringify(page)).not.toContain("hull plate");
      }
    });
  });

  describe("Hide Whisper conversation", () => {
    it("hides only for the acting character, clears its unread, deletes nothing, and returns on the next Whisper", async () => {
      const a = await player();
      const b = await player();
      const first = whispered(
        await whispers.sendWhisper(b.userId, b.character.id, {
          recipientCharacterId: a.character.id,
          text: "first",
        }),
      );
      const second = whispered(
        await whispers.sendWhisper(
          a.userId,
          a.character.id,
          { recipientCharacterId: b.character.id, text: "second" },
          { now: new Date(Date.now() + 11_000) },
        ),
      );
      expect((await whispers.readWhisperInbox(a.userId, a.character.id)).unreadTotal).toBe(1);
      const bBefore = await whispers.readWhisperInbox(b.userId, b.character.id);

      const { received } = await observe([a.character, b.character], () =>
        whispers.hideWhisperConversation(a.userId, a.character.id, {
          withCharacterId: b.character.id,
          throughSeq: second.seq,
        }),
      );
      expect(types(received.get(a.character.id))).toEqual(["whisper.read"]);
      expect(types(received.get(b.character.id))).toEqual([]);
      expect(await whispers.readWhisperInbox(a.userId, a.character.id)).toEqual({
        conversations: [],
        unreadTotal: 0,
      });
      // The other side and the messages themselves are untouched.
      expect(await whispers.readWhisperInbox(b.userId, b.character.id)).toEqual(bBefore);
      const history = await whispers.readWhisperHistory(a.userId, a.character.id, {
        withCharacterId: b.character.id,
      });
      expect(history.messages.map((m) => m.id)).toEqual([first.id, second.id]);
      // Report evidence still binds to a hidden conversation's message.
      expect(
        await reports.reportMessage(a.userId, a.character.id, {
          messageId: first.id,
          reason: "other",
        }),
      ).toMatchObject({ status: "reported" });

      // A new Whisper from B brings it back, unread counting only the new one.
      whispered(
        await whispers.sendWhisper(
          b.userId,
          b.character.id,
          { recipientCharacterId: a.character.id, text: "third" },
          { now: new Date(Date.now() + 22_000) },
        ),
      );
      const back = await whispers.readWhisperInbox(a.userId, a.character.id);
      expect(back.conversations.map((c) => [c.peer.characterId, c.unread])).toEqual([
        [b.character.id, 1],
      ]);
    });

    it("keeps a conversation listed when a newer Whisper arrived than the tab showed, and reopens by name or own Whisper", async () => {
      const a = await player();
      const b = await player();
      const shown = whispered(
        await whispers.sendWhisper(b.userId, b.character.id, {
          recipientCharacterId: a.character.id,
          text: "shown",
        }),
      );
      whispered(
        await whispers.sendWhisper(
          b.userId,
          b.character.id,
          { recipientCharacterId: a.character.id, text: "not yet shown" },
          { now: new Date(Date.now() + 11_000) },
        ),
      );
      await whispers.hideWhisperConversation(a.userId, a.character.id, {
        withCharacterId: b.character.id,
        throughSeq: shown.seq,
      });
      const stale = await whispers.readWhisperInbox(a.userId, a.character.id);
      expect(stale.conversations.map((c) => c.unread)).toEqual([1]);

      // Hide through everything, then reopen by exact name.
      await whispers.hideWhisperConversation(a.userId, a.character.id, {
        withCharacterId: b.character.id,
        throughSeq: Number.MAX_SAFE_INTEGER,
      });
      expect((await whispers.readWhisperInbox(a.userId, a.character.id)).conversations).toEqual([]);
      expect(
        await whispers.openWhisper(a.userId, a.character.id, { name: b.character.displayName }),
      ).toMatchObject({ status: "ready", peer: { characterId: b.character.id } });
      const reopened = await whispers.readWhisperInbox(a.userId, a.character.id);
      expect(reopened.conversations.map((c) => [c.peer.characterId, c.unread])).toEqual([
        [b.character.id, 0],
      ]);

      // Hidden again, A's own next Whisper brings it back too.
      await whispers.hideWhisperConversation(a.userId, a.character.id, {
        withCharacterId: b.character.id,
        throughSeq: Number.MAX_SAFE_INTEGER,
      });
      whispered(
        await whispers.sendWhisper(
          a.userId,
          a.character.id,
          { recipientCharacterId: b.character.id, text: "me again" },
          { now: new Date(Date.now() + 22_000) },
        ),
      );
      expect(
        (await whispers.readWhisperInbox(a.userId, a.character.id)).conversations,
      ).toHaveLength(1);

      const [participant] = await db
        .select()
        .from(rune.whisperParticipants)
        .where(
          and(
            eq(rune.whisperParticipants.characterId, b.character.id),
            inArray(
              rune.whisperParticipants.conversationId,
              db
                .select({ id: rune.whisperParticipants.conversationId })
                .from(rune.whisperParticipants)
                .where(eq(rune.whisperParticipants.characterId, a.character.id)),
            ),
          ),
        );
      // B's side never carried a hidden marker.
      expect(participant!.hiddenThroughSeq).toBeNull();
    });
  });
});
