/**
 * Chat rules (issue #246, Whispers #247): the message content contract, the
 * shared account-wide send budget, the composer's send-pressure bands, and
 * the promoted Trade ad. Framework-free and deterministic; `server/chat.ts`
 * enforces them and the composer only presents them.
 *
 * `CHAT_POLICY` is the one home of every tunable number. The server returns the
 * values a browser needs (limits, window, ad price) in its responses, so a
 * change here needs no matching client edit.
 */

/** Alpha has exactly two game-wide public channels. */
export const CHAT_CHANNELS = ["general", "trade"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/**
 * Everything that spends the one shared send budget: the public channels and
 * 1:1 Whispers (#247). Whispers are never a public feed.
 */
export type ChatSendChannel = ChatChannel | "whisper";

export const CHAT_POLICY = {
  /** Every public message, promoted ads included. Counted in code points. */
  maxLength: 280,
  /** Latest page on open, and each older page — per channel or Whisper conversation. */
  pageSize: 50,
  /** Ordinary chat retention, Whispers included. */
  retentionMs: 90 * 24 * 60 * 60_000,
  /**
   * One account-wide rolling count of successful sends across General, Trade,
   * and Whispers. A send is allowed only while that count is below its
   * channel's limit; Trade's lower limit reads the same count, and Whispers
   * share General's limit with no separate per-recipient state.
   */
  sendWindowMs: 10_000,
  sendLimit: { general: 5, trade: 3, whisper: 5 } satisfies Record<ChatSendChannel, number>,
  /** Where the composer's indicator turns yellow and orange, per channel. */
  pressureBands: {
    general: { lowFrom: 1, highFrom: 3 },
    trade: { lowFrom: 1, highFrom: 2 },
    whisper: { lowFrom: 1, highFrom: 3 },
  } satisfies Record<ChatSendChannel, { lowFrom: number; highFrom: number }>,
  /**
   * The most characters one public message may `@mention` (#261). A mention is
   * personal attention, so this bounds how many players one send can ping.
   */
  maxMentions: 5,
  promotedAd: {
    /** Paid by the active character. */
    priceCredits: 50,
    /** One successful promoted ad per account in this window. */
    cooldownMs: 10 * 60_000,
  },
} as const;

export type ChatMessageRefusal = "empty" | "too_long";

/** Length as players and PostgreSQL's `char_length` count it: code points. */
export function chatMessageLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Control characters other than tab and line breaks are not text: they are
 * dropped (PostgreSQL cannot even store NUL). Line breaks become `\n`.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const NON_TEXT_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Player-typed plain text with line breaks as `\n`, non-text controls dropped,
 * and surrounding whitespace trimmed. Shared by chat bodies and report notes.
 */
export function toPlainText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(NON_TEXT_CONTROLS, "").trim();
}

/**
 * Trim surrounding whitespace and check the one content contract. The body is
 * otherwise stored as typed: plain text, never parsed as markup.
 */
export function normalizeChatMessage(
  text: string,
): { ok: true; body: string } | { ok: false; reason: ChatMessageRefusal } {
  const body = toPlainText(text);
  if (body.length === 0) return { ok: false, reason: "empty" };
  if (chatMessageLength(body) > CHAT_POLICY.maxLength) return { ok: false, reason: "too_long" };
  return { ok: true, body };
}

/**
 * The visible text a public `@mention` of `name` must contain (#261). A mention
 * is a target the composer selected AND this text in the body: the selection
 * alone never creates one, and neither does text that merely looks like one.
 */
export function mentionText(name: string): string {
  return `@${name}`;
}

/** Whether a normalized message body shows a mention of the name, exactly. */
export function bodyShowsMention(body: string, name: string): boolean {
  return body.includes(mentionText(name));
}

/** Successful sends still inside the rolling window at `now`. */
export function recentChatSends(sentAt: readonly number[], now: number): number[] {
  return sentAt.filter((time) => time > now - CHAT_POLICY.sendWindowMs).sort((a, b) => a - b);
}

/**
 * Whether one more send to `channel` fits the shared budget, and if not, how
 * long until enough recent sends age out of the window for it to fit.
 */
export function decideChatSend(
  channel: ChatSendChannel,
  sentAt: readonly number[],
  now: number,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const recent = recentChatSends(sentAt, now);
  const limit = CHAT_POLICY.sendLimit[channel];
  if (recent.length < limit) return { allowed: true };
  // The send that must expire is the one leaving exactly limit - 1 behind.
  const blocking = recent[recent.length - limit]!;
  return { allowed: false, retryAfterMs: Math.max(1, blocking + CHAT_POLICY.sendWindowMs - now) };
}

export type ChatSendPressure = "clear" | "low" | "high" | "full";

/** The composer indicator band for a shared recent-send count. */
export function chatSendPressure(channel: ChatSendChannel, recentCount: number): ChatSendPressure {
  const bands = CHAT_POLICY.pressureBands[channel];
  if (recentCount >= CHAT_POLICY.sendLimit[channel]) return "full";
  if (recentCount >= bands.highFrom) return "high";
  if (recentCount >= bands.lowFrom) return "low";
  return "clear";
}

/** Milliseconds until the account may post another promoted ad; 0 when ready. */
export function promotedAdCooldownRemaining(lastPromotedAt: number | null, now: number): number {
  if (lastPromotedAt === null) return 0;
  return Math.max(0, lastPromotedAt + CHAT_POLICY.promotedAd.cooldownMs - now);
}

/**
 * The unordered identity of a Whisper pair (#247): two character ids, lower
 * first. Stable across renames because it never contains a name.
 */
export function whisperParticipantKey(characterA: string, characterB: string): string {
  return characterA < characterB ? `${characterA}:${characterB}` : `${characterB}:${characterA}`;
}

/** Messages older than this instant are past ordinary retention. */
export function chatRetentionCutoff(now: number): number {
  return now - CHAT_POLICY.retentionMs;
}

/**
 * Leetspeak folds applied to a token before denylist comparison. Only exact
 * whole-token matches count, so folding can widen what a listed term catches
 * without ever matching inside an ordinary word.
 */
const LEET_FOLDS: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

/**
 * The comparison tokens of a message for the severe-term guardrail: Unicode
 * compatibility-folded, diacritics stripped, lowercased, split on anything
 * that is not a letter, digit, `@`, or `$`, then leet-folded. Matching is
 * whole-token equality only — never substring or fuzzy — so an ordinary word
 * that merely contains a listed term is never refused.
 */
export function chatGuardrailTokens(text: string): string[] {
  const folded = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
  return (folded.match(/[\p{L}\p{N}@$]+/gu) ?? []).map((token) =>
    Array.from(token, (char) => LEET_FOLDS[char] ?? char).join(""),
  );
}
