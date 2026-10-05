import { z } from "zod";
import { CHAT_CHANNELS, CHAT_POLICY } from "@/game/domain/chat";
import { CharacterTargetSchema } from "@/game/schemas/whispers";

/**
 * Public chat request and wire contracts (issue #246), shared by the server
 * boundary (`server/chat.ts`), its route and actions, and the browser.
 *
 * Requests name only the active character and what to say: sender account,
 * character, and name are always derived server-side from the session.
 */

export const ChatChannelSchema = z.enum(CHAT_CHANNELS);

/**
 * Loose on purpose: the content contract (trim, empty, 280 code points) is the
 * domain rule's to refuse with a clear reason. This only bounds the payload.
 */
const MessageTextSchema = z.string().max(4_000);

/**
 * The characters a message `@mentions` (#261), as the composer's selection
 * named them: a chat sender or Whisper peer by stable id, a Nearby Player by
 * exact name. The server resolves each one and refuses the send unless the
 * body shows `@` and that character's current name.
 */
const MentionsSchema = z.array(CharacterTargetSchema).max(CHAT_POLICY.maxMentions).optional();

export const SendChatMessageRequestSchema = z.object({
  characterId: z.string().uuid(),
  channel: ChatChannelSchema,
  text: MessageTextSchema,
  mentions: MentionsSchema,
});

export const PostPromotedTradeAdRequestSchema = z.object({
  characterId: z.string().uuid(),
  text: MessageTextSchema,
  mentions: MentionsSchema,
});

export const ChatMentionsQuerySchema = z.object({
  characterId: z.string().uuid(),
});

export const MarkChatMentionsReadRequestSchema = z.object({
  characterId: z.string().uuid(),
  channel: ChatChannelSchema,
  /** The newest message `seq` this tab has shown in that feed. */
  throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const ChatHistoryQuerySchema = z.object({
  characterId: z.string().uuid(),
  channel: ChatChannelSchema,
  /** Load the page strictly older than this message's `seq`. */
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

/**
 * One character a public message mentions (#261): its stable id, and its name
 * as the message showed it at send — never its current name.
 */
export const ChatMentionViewSchema = z.object({
  characterId: z.string().min(1),
  name: z.string().min(1),
});
export type ChatMentionView = z.infer<typeof ChatMentionViewSchema>;

/**
 * One public message as a viewer receives it. `seq` is the durable feed order
 * and pagination cursor; `id` is the stable message identity. Account identity
 * is deliberately absent: it never leaves the server.
 */
export const VisibleChatMessageViewSchema = z.object({
  redacted: z.literal(false),
  id: z.string().min(1),
  seq: z.number().int().positive(),
  channel: ChatChannelSchema,
  senderCharacterId: z.string().min(1),
  senderName: z.string().min(1),
  body: z.string().min(1),
  sentAt: z.string().datetime(),
  /** A promoted Trade ad: one record, shown in both General and Trade. */
  promoted: z.boolean(),
  /** The characters it mentions; empty for an ordinary message. */
  mentions: z.array(ChatMentionViewSchema),
  /** A player message is never a System announcement (see `SystemChatMessageView`). */
  system: z.literal(false).optional(),
});
export type VisibleChatMessageView = z.infer<typeof VisibleChatMessageViewSchema>;

/**
 * An automatic System line in General (#308): today, a Mining RARE FIND. It
 * keeps its place in the one durable timeline like any message, but it is not
 * a player's: it has no sender id, no mentions, and nothing to Whisper, Report,
 * or Block, and a viewer who blocked someone never has it redacted because it
 * belongs to no one. `treatment` names the restrained visual it carries.
 */
export const SystemChatMessageViewSchema = z.object({
  redacted: z.literal(false),
  system: z.literal(true),
  id: z.string().min(1),
  seq: z.number().int().positive(),
  channel: z.literal("general"),
  promoted: z.literal(false),
  treatment: z.literal("rare_find"),
  body: z.string().min(1),
  sentAt: z.string().datetime(),
});
export type SystemChatMessageView = z.infer<typeof SystemChatMessageViewSchema>;

/**
 * A message from an account the viewer blocked (#261), redacted by the server
 * for that viewer alone: it keeps its place in the timeline and its sender's
 * name at send, and carries no body, ad text, mentions, or sender id. `channel`
 * and `promoted` say only which feeds it occupies; it renders the same either
 * way.
 */
export const RedactedChatMessageViewSchema = z.object({
  redacted: z.literal(true),
  id: z.string().min(1),
  seq: z.number().int().positive(),
  channel: ChatChannelSchema,
  promoted: z.boolean(),
  senderName: z.string().min(1),
  sentAt: z.string().datetime(),
});
export type RedactedChatMessageView = z.infer<typeof RedactedChatMessageViewSchema>;

export const ChatMessageViewSchema = z.union([
  VisibleChatMessageViewSchema,
  SystemChatMessageViewSchema,
  RedactedChatMessageViewSchema,
]);
export type ChatMessageView = z.infer<typeof ChatMessageViewSchema>;

/**
 * The viewer character's unread `@mentions` (#261). Each feed counts the
 * unread mentions it shows — a promoted ad shows in both — and `unreadTotal`
 * counts each mentioned message once.
 */
export type ChatMentionsView = {
  unread: Record<z.infer<typeof ChatChannelSchema>, number>;
  unreadTotal: number;
};

/**
 * The account's authoritative send budget at response time: for each recent
 * successful send, how long it stays in the rolling window, relative to the
 * response, so the browser counts down locally with no clock agreement and no
 * polling. Limits and bands are `CHAT_POLICY`'s.
 */
export type ChatSendBudget = {
  recentSendExpiresInMs: number[];
};

export type PromotedAdStatus = {
  priceCredits: number;
  /** 0 when the account may post an ad now. */
  readyInMs: number;
};

export type ChatHistoryPage = {
  channel: z.infer<typeof ChatChannelSchema>;
  /** Oldest first. */
  messages: ChatMessageView[];
  hasOlder: boolean;
  budget: ChatSendBudget;
  promotedAd: PromotedAdStatus;
};

export type ChatSendRefusalReason =
  | "empty"
  | "too_long"
  | "rate_limited"
  | "prohibited_term"
  | "socially_restricted"
  | "insufficient_credits"
  | "ad_cooldown"
  | "invalid_mention"
  | "blocked_by_you";

export type ChatSendResult =
  | {
      status: "sent";
      message: VisibleChatMessageView;
      budget: ChatSendBudget;
      promotedAd: PromotedAdStatus;
    }
  | {
      status: "refused";
      reason: ChatSendRefusalReason;
      error: string;
      budget: ChatSendBudget;
      promotedAd: PromotedAdStatus;
    };

// Register public chat's delivery on the shared realtime registry (#245): the
// substrate stays free of chat imports, and a publish or subscription of
// `"chat.message"` is typed with this payload everywhere.
declare module "@/game/schemas/realtime" {
  interface RealtimeEventMap {
    /**
     * A public General/Trade message committed; a promoted ad arrives once.
     * The sender's blockers receive the redacted form instead (#261). A System
     * announcement (#308) is delivered to everyone, unredacted.
     */
    "chat.message": ChatMessageView;
    /**
     * A message mentioning this character committed (#261). An invalidation
     * only: the browser re-reads its mention attention.
     */
    "chat.mention": Record<string, never>;
    /** The character read its mentions on some tab; its other tabs re-read. */
    "chat.mentions.read": Record<string, never>;
  }
}
