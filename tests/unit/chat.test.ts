import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_POLICY,
  chatGuardrailTokens,
  chatMessageLength,
  chatSendPressure,
  decideChatSend,
  normalizeChatMessage,
  promotedAdCooldownRemaining,
  whisperParticipantKey,
} from "@/game/domain/chat";
import type { ChatHistoryPage, ChatMessageView } from "@/game/schemas/chat";
import {
  applyLatestPage,
  applyMessage,
  applyOlderPage,
  composerPressure,
  EMPTY_CHAT_FEED,
  EMPTY_FEED,
  insertMessage,
  localBudget,
} from "@/features/chat/chat-feed";
import { containsSevereTerm, SEVERE_TERM_DIGESTS, severeTermDigest } from "@/server/chat-guardrail";

/**
 * Issue #246 — the pure public-chat rules: the message contract, the shared
 * account-wide send budget and its composer bands, the promoted-ad cooldown,
 * the severe-term guardrail's matching, and the browser feed projection.
 * Persistence, concurrency, and the Credit charge are proven against
 * PostgreSQL in tests/integration/chat.test.ts.
 */

describe("message content contract", () => {
  it("trims, refuses empty, and allows exactly 280 characters", () => {
    expect(normalizeChatMessage("  hello there \n")).toEqual({ ok: true, body: "hello there" });
    expect(normalizeChatMessage("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeChatMessage(" \n\t ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeChatMessage("x".repeat(280))).toEqual({ ok: true, body: "x".repeat(280) });
    expect(normalizeChatMessage("x".repeat(281))).toEqual({ ok: false, reason: "too_long" });
    // Surrounding whitespace never counts toward the limit.
    expect(normalizeChatMessage(`  ${"x".repeat(280)}  `).ok).toBe(true);
  });

  it("counts code points, the way PostgreSQL's char_length does", () => {
    expect(chatMessageLength("🔧🔧")).toBe(2);
    expect(normalizeChatMessage("🔧".repeat(280)).ok).toBe(true);
    expect(normalizeChatMessage("🔧".repeat(281))).toEqual({ ok: false, reason: "too_long" });
  });

  it("drops non-text control characters and normalizes line breaks", () => {
    expect(normalizeChatMessage("a\u0000b\u0007c\r\nd\te")).toEqual({
      ok: true,
      body: "abc\nd\te",
    });
    expect(normalizeChatMessage("\u0000\u0001")).toEqual({ ok: false, reason: "empty" });
  });

  it("keeps markup-looking text as plain text", () => {
    expect(normalizeChatMessage("<b>WTB</b> **shale** https://example.com")).toEqual({
      ok: true,
      body: "<b>WTB</b> **shale** https://example.com",
    });
  });

  it("matches the database's own length CHECK", () => {
    const migration = readFileSync(join(process.cwd(), "drizzle/0032_public_chat.sql"), "utf8");
    expect(migration).toContain(
      `char_length("chat_messages"."body") between 1 and ${CHAT_POLICY.maxLength}`,
    );
  });
});

describe("shared account-wide send budget", () => {
  const now = 100_000;

  it("allows General below five sends in the last ten seconds", () => {
    const four = [now - 9_000, now - 5_000, now - 2_000, now - 1];
    expect(decideChatSend("general", four, now)).toEqual({ allowed: true });
    const five = [...four, now - 500];
    // The oldest leaves the window 1s from now.
    expect(decideChatSend("general", five, now)).toEqual({ allowed: false, retryAfterMs: 1_000 });
  });

  it("lets Trade read the same count with its lower limit of three", () => {
    const three = [now - 8_000, now - 3_000, now - 100];
    expect(decideChatSend("trade", three, now)).toEqual({ allowed: false, retryAfterMs: 2_000 });
    // Three General sends block Trade, but General still has two left.
    expect(decideChatSend("general", three, now)).toEqual({ allowed: true });
    expect(decideChatSend("general", [...three, now - 50], now)).toEqual({ allowed: true });
  });

  it("forgets sends once they leave the window", () => {
    const old = [now - 10_000, now - 10_001, now - 20_000, now - 30_000, now - 40_000];
    expect(decideChatSend("general", old, now)).toEqual({ allowed: true });
    expect(decideChatSend("trade", old, now)).toEqual({ allowed: true });
  });

  it("lets Whispers (#247) share General's limit of five on the same count", () => {
    const three = [now - 8_000, now - 3_000, now - 100];
    // Three sends of any kind close Trade, never Whispers.
    expect(decideChatSend("trade", three, now)).toMatchObject({ allowed: false });
    expect(decideChatSend("whisper", three, now)).toEqual({ allowed: true });
    const five = [...three, now - 60, now - 50];
    expect(decideChatSend("whisper", five, now)).toEqual({ allowed: false, retryAfterMs: 2_000 });
    expect(decideChatSend("general", five, now)).toEqual({ allowed: false, retryAfterMs: 2_000 });
    expect([0, 1, 3, 5].map((count) => chatSendPressure("whisper", count))).toEqual([
      "clear",
      "low",
      "high",
      "full",
    ]);
  });

  it("colours the composer by the #226 bands", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((count) => chatSendPressure("general", count))).toEqual([
      "clear",
      "low",
      "low",
      "high",
      "high",
      "full",
      "full",
    ]);
    expect([0, 1, 2, 3, 4].map((count) => chatSendPressure("trade", count))).toEqual([
      "clear",
      "low",
      "high",
      "full",
      "full",
    ]);
  });
});

describe("promoted ad cooldown", () => {
  it("is ten minutes from the last successful ad", () => {
    expect(CHAT_POLICY.promotedAd).toEqual({ priceCredits: 50, cooldownMs: 600_000 });
    expect(promotedAdCooldownRemaining(null, 5)).toBe(0);
    expect(promotedAdCooldownRemaining(1_000, 1_000 + 60_000)).toBe(540_000);
    expect(promotedAdCooldownRemaining(1_000, 1_000 + 600_000)).toBe(0);
  });
});

describe("severe-term guardrail matching", () => {
  // A made-up stand-in term: the real list is digests only.
  const listed = new Set([severeTermDigest("zorbfrak")]);

  it("folds case, diacritics, width, and leetspeak into whole tokens", () => {
    expect(chatGuardrailTokens("ZÖRBFRAK, z0rbfr4k! Ｚｏｒｂｆｒａｋ")).toEqual([
      "zorbfrak",
      "zorbfrak",
      "zorbfrak",
    ]);
    expect(containsSevereTerm("you zorbfrak", listed)).toBe(true);
    expect(containsSevereTerm("Z0RBFR@K", listed)).toBe(true);
    expect(containsSevereTerm("zörbfrak's", listed)).toBe(true);
  });

  it("never matches inside a longer word or across a fuzzy spelling", () => {
    expect(containsSevereTerm("zorbfraks", listed)).toBe(false);
    expect(containsSevereTerm("unzorbfrakable", listed)).toBe(false);
    expect(containsSevereTerm("zorbfrakk", listed)).toBe(false);
    expect(containsSevereTerm("zorb frak", listed)).toBe(false);
  });

  it("ships a digest-only list that leaves ordinary profanity and idioms alone", () => {
    expect(SEVERE_TERM_DIGESTS.size).toBeGreaterThan(0);
    for (const digest of SEVERE_TERM_DIGESTS) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    for (const ordinary of [
      "this fucking drop rate hates me",
      "shit trade offer, damn",
      "a chink in the armor",
      "the raccoon took my shale",
      "Niger and Nigeria are countries",
      "WTS 20 Ferrite Shale, 3 Credits each",
    ]) {
      expect(containsSevereTerm(ordinary), ordinary).toBe(false);
    }
  });
});

function message(seq: number, overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: `m${seq}`,
    seq,
    channel: "general",
    senderCharacterId: "c1",
    senderName: "Tester",
    body: `message ${seq}`,
    sentAt: new Date(seq * 1_000).toISOString(),
    promoted: false,
    ...overrides,
  };
}

function page(
  messages: ChatMessageView[],
  hasOlder: boolean,
  channel: ChatHistoryPage["channel"] = "general",
): ChatHistoryPage {
  return {
    channel,
    messages,
    hasOlder,
    budget: { recentSendExpiresInMs: [] },
    promotedAd: { priceCredits: 50, readyInMs: 0 },
  };
}

describe("browser feed projection", () => {
  it("merges every source by message id, in seq order, rendering each once", () => {
    let feed = applyLatestPage(EMPTY_CHAT_FEED, page([message(2), message(3)], true));
    feed = applyMessage(feed, "general", message(4));
    feed = applyMessage(feed, "general", message(4));
    feed = applyLatestPage(feed, page([message(3), message(4), message(5)], true));
    feed = applyOlderPage(feed, page([message(1), message(2)], false));
    expect(feed.messages.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(feed.hasOlder).toBe(false);
  });

  it("orders a late-committing lower seq into place", () => {
    let feed = applyLatestPage(EMPTY_CHAT_FEED, page([message(10)], false));
    feed = applyMessage(feed, "general", message(12));
    feed = applyMessage(feed, "general", message(11));
    expect(feed.messages.map((entry) => entry.seq)).toEqual([10, 11, 12]);
  });

  it("restarts from a reconnect page that cannot reach what it holds", () => {
    const held = applyLatestPage(EMPTY_CHAT_FEED, page([message(1), message(2)], false));
    // Missed 3..60 while offline: the latest page starts at 11 and more exist.
    const latest = Array.from({ length: 50 }, (_, index) => message(index + 11));
    const feed = applyLatestPage(held, page(latest, true));
    expect(feed.messages[0]!.seq).toBe(11);
    expect(feed.messages).toHaveLength(50);
    expect(feed.hasOlder).toBe(true);
  });

  it("shows one promoted ad in both feeds and ordinary messages in their own", () => {
    const general = applyLatestPage(EMPTY_CHAT_FEED, page([], false));
    const trade = applyLatestPage(EMPTY_CHAT_FEED, page([], false, "trade"));
    const ad = message(7, { channel: "trade", promoted: true });
    const tradeOnly = message(8, { channel: "trade" });
    expect(applyMessage(general, "general", ad).messages).toEqual([ad]);
    expect(applyMessage(trade, "trade", ad).messages).toEqual([ad]);
    expect(applyMessage(general, "general", tradeOnly).messages).toEqual([]);
    expect(applyMessage(trade, "trade", message(9)).messages).toEqual([]);
  });

  it("keeps a delivery that lands before the first read, which may predate it", () => {
    let feed = applyMessage(EMPTY_CHAT_FEED, "general", message(12));
    feed = applyLatestPage(feed, page([message(10), message(11)], true));
    expect(feed.messages.map((entry) => entry.seq)).toEqual([10, 11, 12]);
    expect(feed).toMatchObject({ loaded: true, hasOlder: true, syncedThrough: 11 });
  });

  it("still sees a reconnect gap when a live delivery lands before the re-read", () => {
    let feed = applyLatestPage(EMPTY_CHAT_FEED, page([message(99), message(100)], false));
    // Missed 101..180 while asleep; 181 arrives live as the stream reopens.
    feed = applyMessage(feed, "general", message(181));
    const latest = Array.from({ length: 50 }, (_, index) => message(index + 132));
    feed = applyLatestPage(feed, page(latest, true));
    // Restarted from the page: no silent hole between 100 and 132.
    expect(feed.messages[0]!.seq).toBe(132);
    expect(feed.messages.at(-1)!.seq).toBe(181);
    expect(feed.messages).toHaveLength(50);
    expect(feed.hasOlder).toBe(true);
  });
});

describe("composer send pressure", () => {
  it("counts down locally from the authoritative budget", () => {
    const budget = localBudget({ recentSendExpiresInMs: [9_000, 2_000, 5_000, -10] }, 1_000);
    expect(budget.expiresAt).toEqual([3_000, 6_000, 10_000]);

    // Three recent sends: Trade is red until the first ages out.
    expect(composerPressure(budget, "trade", 1_000)).toEqual({
      count: 3,
      limit: 3,
      pressure: "full",
      nextChangeAt: 3_000,
      readyAt: 3_000,
    });
    expect(composerPressure(budget, "general", 1_000)).toMatchObject({
      count: 3,
      limit: 5,
      pressure: "high",
      readyAt: undefined,
    });
    expect(composerPressure(budget, "trade", 3_000)).toMatchObject({ count: 2, pressure: "high" });
    expect(composerPressure(budget, "trade", 10_000)).toMatchObject({
      count: 0,
      pressure: "clear",
      nextChangeAt: undefined,
    });
  });
});

describe("Whisper conversations (#247)", () => {
  it("names a pair by its two stable character ids, in either order", () => {
    expect(whisperParticipantKey("b-char", "a-char")).toBe("a-char:b-char");
    expect(whisperParticipantKey("a-char", "b-char")).toBe("a-char:b-char");
  });

  it("merges a Whisper once, in seq order, from any source", () => {
    const whisper = (id: string, seq: number) => ({
      id,
      seq,
      senderCharacterId: "a",
      recipientCharacterId: "b",
      senderName: "A",
      body: id,
      sentAt: new Date(0).toISOString(),
    });
    let feed = applyLatestPage(EMPTY_FEED, { messages: [whisper("one", 1)], hasOlder: false });
    feed = insertMessage(feed, whisper("three", 3));
    feed = insertMessage(feed, whisper("two", 2));
    // The same delivery again (another tab, a reconnect racing a read).
    feed = insertMessage(feed, whisper("three", 3));
    expect(feed.messages.map((message) => message.id)).toEqual(["one", "two", "three"]);
  });
});
