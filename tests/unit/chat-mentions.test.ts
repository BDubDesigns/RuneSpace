import { describe, expect, it } from "vitest";
import { bodyShowsMention, CHAT_POLICY } from "@/game/domain/chat";
import {
  ChatMessageViewSchema,
  SendChatMessageRequestSchema,
  type RedactedChatMessageView,
} from "@/game/schemas/chat";
import { applyMessage, EMPTY_CHAT_FEED } from "@/features/chat/chat-feed";
import {
  activeMentionQuery,
  insertMention,
  matchMentionCandidates,
  mentionSegments,
  mentionsShown,
  mergeMentionCandidates,
  type MentionCandidate,
} from "@/features/chat/mention-draft";

/**
 * Issue #261 — the framework-free halves of public `@mentions` and redacted
 * placeholders: the domain's visible-text rule, the composer's query /
 * insertion / pruning, the body renderer, and the wire contracts.
 */

const candidate = (name: string, id = name): MentionCandidate => ({
  name,
  target: { characterId: `00000000-0000-4000-8000-${id.padStart(12, "0").slice(-12)}` },
});

describe("mention text rule", () => {
  it("requires the exact @Name in the body", () => {
    expect(bodyShowsMention("hi @Zoë O'Ná-7 there", "Zoë O'Ná-7")).toBe(true);
    expect(bodyShowsMention("hi @zoë o'ná-7", "Zoë O'Ná-7")).toBe(false);
    expect(bodyShowsMention("hi Zoë O'Ná-7", "Zoë O'Ná-7")).toBe(false);
  });
});

describe("activeMentionQuery", () => {
  it("finds the @query at the caret only after a word boundary, on one line", () => {
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("hey @Zo", 7)).toEqual({ start: 4, query: "Zo" });
    // Names contain spaces, so the query may too.
    expect(activeMentionQuery("hey @Bob Sm", 11)).toEqual({ start: 4, query: "Bob Sm" });
    expect(activeMentionQuery("mail me a@b", 11)).toBeUndefined();
    expect(activeMentionQuery("@Bob\nnext", 9)).toBeUndefined();
    expect(activeMentionQuery("no mention", 10)).toBeUndefined();
    expect(activeMentionQuery(`@${"x".repeat(25)}`, 26)).toBeUndefined();
    // Only text before the caret counts.
    expect(activeMentionQuery("@Zo and more", 3)).toEqual({ start: 0, query: "Zo" });
  });
});

describe("matchMentionCandidates", () => {
  const list = [candidate("Bob Smith", "1"), candidate("Bobby", "2"), candidate("Zoë", "3")];

  it("prefix-matches folded names in the candidates' own order", () => {
    expect(matchMentionCandidates(list, "bo").map((c) => c.name)).toEqual(["Bob Smith", "Bobby"]);
    expect(matchMentionCandidates(list, "ZOË").map((c) => c.name)).toEqual(["Zoë"]);
    expect(matchMentionCandidates(list, "").map((c) => c.name)).toEqual([
      "Bob Smith",
      "Bobby",
      "Zoë",
    ]);
    expect(matchMentionCandidates(list, "", 2)).toHaveLength(2);
  });

  it("stops matching a name once it is completed with a trailing space", () => {
    expect(matchMentionCandidates(list, "Bobby ")).toEqual([]);
    expect(matchMentionCandidates(list, "Bob S").map((c) => c.name)).toEqual(["Bob Smith"]);
  });
});

describe("mergeMentionCandidates", () => {
  it("keeps the first source's entry per folded name and drops exclusions", () => {
    const bySender = candidate("Zoë", "1");
    const nearby: MentionCandidate = { name: "ZOË", target: { name: "ZOË" } };
    const merged = mergeMentionCandidates(
      [[bySender], [nearby, { name: "Rook", target: { name: "Rook" } }]],
      ["rook"],
    );
    expect(merged).toEqual([bySender]);
  });
});

describe("insertMention and mentionsShown", () => {
  it("replaces the query with @Name and a space, placing the caret after it", () => {
    expect(insertMention("hi @Zo!", 3, 6, "Zoë")).toEqual({ draft: "hi @Zoë !", caret: 8 });
  });

  it("names only chosen mentions the draft still shows, once each, up to the limit", () => {
    const zoe = candidate("Zoë", "1");
    const rook = candidate("Rook", "2");
    expect(mentionsShown("@Zoë and @Zoë", [zoe, zoe, rook])).toEqual([zoe]);
    expect(mentionsShown("edited away", [zoe])).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => candidate(`P${i}`, String(i)));
    const draft = many.map((c) => `@${c.name}`).join(" ");
    expect(mentionsShown(draft, many)).toHaveLength(CHAT_POLICY.maxMentions);
  });
});

describe("mentionSegments", () => {
  it("marks only resolved mentions by their name at send, preferring the longer name", () => {
    const bob = { characterId: "b", name: "Bob" };
    const bobSmith = { characterId: "s", name: "Bob Smith" };
    expect(mentionSegments("@Bob Smith and @Bob, not @Rook", [bob, bobSmith])).toEqual([
      { text: "@Bob Smith", mention: bobSmith },
      { text: " and " },
      { text: "@Bob", mention: bob },
      { text: ", not @Rook" },
    ]);
    expect(mentionSegments("plain", [])).toEqual([{ text: "plain" }]);
  });
});

describe("wire contracts", () => {
  it("bounds a send's mentions and accepts id or exact-name targets", () => {
    const base = {
      characterId: "00000000-0000-4000-8000-000000000001",
      channel: "general",
      text: "hi",
    };
    expect(
      SendChatMessageRequestSchema.safeParse({
        ...base,
        mentions: [{ characterId: base.characterId }, { name: "Zoë O'Ná" }],
      }).success,
    ).toBe(true);
    expect(SendChatMessageRequestSchema.safeParse(base).success).toBe(true);
    expect(
      SendChatMessageRequestSchema.safeParse({
        ...base,
        mentions: Array.from({ length: CHAT_POLICY.maxMentions + 1 }, () => ({ name: "Zoë" })),
      }).success,
    ).toBe(false);
  });

  it("parses a redacted delivery with no content fields and places it in its feeds", () => {
    const redacted: RedactedChatMessageView = {
      redacted: true,
      id: "m1",
      seq: 7,
      channel: "trade",
      promoted: true,
      senderName: "Brask",
      sentAt: new Date(0).toISOString(),
    };
    const parsed = ChatMessageViewSchema.parse({ ...redacted, body: "leak?" });
    // Unknown keys are stripped: a redacted view can never carry a body.
    expect(parsed).toEqual(redacted);
    expect(applyMessage(EMPTY_CHAT_FEED, "general", parsed).messages).toEqual([redacted]);
    expect(applyMessage(EMPTY_CHAT_FEED, "trade", parsed).messages).toEqual([redacted]);
    expect(
      applyMessage(EMPTY_CHAT_FEED, "general", { ...redacted, promoted: false }).messages,
    ).toEqual([]);
  });
});
