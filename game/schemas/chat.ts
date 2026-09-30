import { z } from "zod";
import { CHAT_CHANNELS } from "@/game/domain/chat";

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

export const SendChatMessageRequestSchema = z.object({
  characterId: z.string().uuid(),
  channel: ChatChannelSchema,
  text: MessageTextSchema,
});

export const PostPromotedTradeAdRequestSchema = z.object({
  characterId: z.string().uuid(),
  text: MessageTextSchema,
});

export const ChatHistoryQuerySchema = z.object({
  characterId: z.string().uuid(),
  channel: ChatChannelSchema,
  /** Load the page strictly older than this message's `seq`. */
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

/**
 * One public message as a viewer receives it. `seq` is the durable feed order
 * and pagination cursor; `id` is the stable message identity. Account identity
 * is deliberately absent: it never leaves the server.
 */
export const ChatMessageViewSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  channel: ChatChannelSchema,
  senderCharacterId: z.string().min(1),
  senderName: z.string().min(1),
  body: z.string().min(1),
  sentAt: z.string().datetime(),
  /** A promoted Trade ad: one record, shown in both General and Trade. */
  promoted: z.boolean(),
});

export type ChatMessageView = z.infer<typeof ChatMessageViewSchema>;

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
  | "ad_cooldown";

export type ChatSendResult =
  | {
      status: "sent";
      message: ChatMessageView;
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
    /** A public General/Trade message committed; a promoted ad arrives once. */
    "chat.message": ChatMessageView;
  }
}
