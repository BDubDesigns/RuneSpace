import { z } from "zod";
import type { ChatSendBudget } from "@/game/schemas/chat";

/**
 * Whisper (1:1 Direct Message) request and wire contracts (issue #247), shared
 * by `server/whispers.ts`, its routes and actions, and the browser.
 *
 * Player-facing identity is character-to-character, so a conversation is named
 * by the other character's stable id. Requests name only the active character
 * and the other character; sender account, character, and name are always
 * derived server-side. Account identity never leaves the server.
 */

const MessageTextSchema = z.string().max(4_000);

/**
 * The other character, as a social surface knows it: a chat sender or Whisper
 * carries a character id; the same-location profile, Nearby Players, and the
 * Whispers tab's "Start a Whisper" name the character by its exact public
 * name. Where a name may resolve is the server's decision per command.
 */
export const CharacterTargetSchema = z.union([
  z.object({ characterId: z.string().uuid() }),
  z.object({ name: z.string().min(1).max(64) }),
]);
export type CharacterTarget = z.infer<typeof CharacterTargetSchema>;

export const OpenWhisperRequestSchema = z.object({
  characterId: z.string().uuid(),
  target: CharacterTargetSchema,
});

export const SendWhisperRequestSchema = z.object({
  characterId: z.string().uuid(),
  recipientCharacterId: z.string().uuid(),
  text: MessageTextSchema,
});

export const MarkWhisperReadRequestSchema = z.object({
  characterId: z.string().uuid(),
  withCharacterId: z.string().uuid(),
  /** The newest message `seq` this tab has shown; the server caps it. */
  throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const WhisperInboxQuerySchema = z.object({
  characterId: z.string().uuid(),
});

export const WhisperHistoryQuerySchema = z.object({
  characterId: z.string().uuid(),
  withCharacterId: z.string().uuid(),
  /** Load the page strictly older than this message's `seq`. */
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

/** One Whisper as either participant receives it. */
export const WhisperMessageViewSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  senderCharacterId: z.string().min(1),
  recipientCharacterId: z.string().min(1),
  /** The sender's name when it was sent; renames never rewrite history. */
  senderName: z.string().min(1),
  body: z.string().min(1),
  sentAt: z.string().datetime(),
});
export type WhisperMessageView = z.infer<typeof WhisperMessageViewSchema>;

/**
 * The other side of a conversation for the viewer. `name` is the character's
 * current name. `blockedByMe` is the viewer's own Block; whether the other
 * account blocked the viewer is never disclosed.
 */
export type WhisperPeer = {
  characterId: string;
  name: string;
  blockedByMe: boolean;
};

export type WhisperConversationSummary = {
  peer: WhisperPeer;
  /** Retained Whispers from the peer the viewer's character has not read. */
  unread: number;
  lastMessage: WhisperMessageView;
};

/** The viewer character's conversations, most recent first. */
export type WhisperInbox = {
  conversations: WhisperConversationSummary[];
  unreadTotal: number;
};

export type WhisperHistoryPage = {
  peer: WhisperPeer;
  /** Oldest first. */
  messages: WhisperMessageView[];
  hasOlder: boolean;
  budget: ChatSendBudget;
};

export type WhisperSendRefusalReason =
  | "empty"
  | "too_long"
  | "rate_limited"
  | "prohibited_term"
  | "socially_restricted"
  | "blocked_by_you"
  | "undeliverable";

export type WhisperSendResult =
  | { status: "sent"; message: WhisperMessageView; budget: ChatSendBudget }
  | {
      status: "refused";
      reason: WhisperSendRefusalReason;
      error: string;
      budget: ChatSendBudget;
    };

export type OpenWhisperResult = { status: "ready"; peer: WhisperPeer } | { error: string };

// Register Whisper deliveries on the shared realtime registry (#245).
declare module "@/game/schemas/realtime" {
  interface RealtimeEventMap {
    /** A Whisper committed; sent to both participant characters. */
    "whisper.message": WhisperMessageView;
    /**
     * The character read a conversation on some tab; its other tabs re-read
     * their unread state. An invalidation only: it carries no state.
     */
    "whisper.read": { withCharacterId: string };
  }
}
