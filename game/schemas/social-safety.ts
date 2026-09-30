import { z } from "zod";
import { REPORT_REASONS } from "@/game/domain/social-safety";
import { CharacterTargetSchema } from "@/game/schemas/whispers";

/**
 * Block and Report request and wire contracts (issue #247). The browser names
 * its active character and a character-facing target; every account identity
 * is resolved and kept server-side, and nothing here ever tells a player who
 * blocked or reported them.
 */

export const BlockRequestSchema = z.object({
  characterId: z.string().uuid(),
  target: CharacterTargetSchema,
});

export const UnblockRequestSchema = z.object({
  characterId: z.string().uuid(),
  /** A character from the Blocked Players list; unblocks its whole account. */
  blockedCharacterId: z.string().uuid(),
});

export const BlockedPlayersQuerySchema = z.object({
  characterId: z.string().uuid(),
});

export const ReportReasonSchema = z.enum(REPORT_REASONS);

/** Loose on purpose: `normalizeReportNote` refuses an overlong note clearly. */
const NoteSchema = z.string().max(4_000).optional();

export const ReportMessageRequestSchema = z.object({
  characterId: z.string().uuid(),
  messageId: z.string().uuid(),
  reason: ReportReasonSchema,
  note: NoteSchema,
  /** Report + Block in one step. */
  alsoBlock: z.boolean().default(false),
});

export const ReportPlayerRequestSchema = z.object({
  characterId: z.string().uuid(),
  target: CharacterTargetSchema,
  reason: ReportReasonSchema,
  note: NoteSchema,
  alsoBlock: z.boolean().default(false),
});

/** One entry of the viewer account's Blocked Players list. */
export type BlockedPlayerView = {
  /** The character that was blocked; its whole account stays blocked. */
  characterId: string;
  /** That character's current name. */
  name: string;
  /** The account's public Player name, when it has one. */
  playerName: string | null;
  blockedAt: string;
};

export type BlockedPlayersView = { blocked: BlockedPlayerView[] };

export type BlockResult = { status: "blocked" | "unblocked"; name: string } | { error: string };

/**
 * `duplicate`: this account already reported that message; nothing new was
 * stored. `blocked` says whether Report + Block's Block now stands.
 */
export type ReportResult =
  | { status: "reported" | "duplicate"; blocked: boolean; name: string }
  | { error: string };

// Register Block invalidation on the shared realtime registry (#245).
declare module "@/game/schemas/realtime" {
  interface RealtimeEventMap {
    /**
     * The viewer's account blocked or unblocked someone on some tab: every tab
     * of every character on that account re-reads its feeds, Whispers, and
     * Blocked Players list. Sent only to the blocker's own account.
     */
    "safety.blocks": Record<string, never>;
  }
}
